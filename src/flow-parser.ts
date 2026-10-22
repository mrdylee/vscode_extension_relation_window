import { Node } from 'web-tree-sitter';
import { FlowExpression as Expr, FlowLocal, FlowProgram, FlowStatement as Statement, GlobalInitializer, Location } from './model';
import { declaredType, declarator } from './type-info';

type Locate = (node: Node) => Location;
function ancestor(node: Node, type: string): Node | undefined {
  for (let parent = node.parent; parent; parent = parent.parent) if (parent.type === type) return parent;
}
export function flowFacts(root: Node, uri: string, locate: Locate, active?: Set<number>, skipInactive = true, namespace = '', context?: (node: Node) => string[], basic = false) {
  const programs: FlowProgram[] = [], initializers: GlobalInitializer[] = [];
  const present = (node: Node) => !active || active.has(node.id);
  function expression(node: Node | null | undefined, locals: FlowLocal[], ranges: Map<string, {start:number;end:number; declaration:number}>, fn: string, depth = 0): Expr {
    const location = node ? locate(node) : locate(root);
    const unknown = (): Expr => ({ kind: 'unknown', location });
    if (!node || !present(node) || depth >= 48) return unknown();
    const expr = (value: Node | null | undefined) => expression(value, locals, ranges, fn, depth + 1);
    const field = (name: string) => expr(node.childForFieldName(name));
    // Unevaluated operands have no side effects, but their result is not zero.
    // Without ABI/layout sizes retain an unknown value (not a zero-byte write).
    if (['sizeof_expression','alignof_expression','attribute_specifier','attribute_declaration'].includes(node.type)) return unknown();
    if (node.type === 'identifier') {
      const candidates = locals.filter(local => { const range = ranges.get(local.id)!; return local.name === node.text && range.start <= node.startIndex && range.end > node.startIndex && (local.parameter !== undefined || range.declaration <= node.startIndex); });
      candidates.sort((a,b) => { const x=ranges.get(a.id)!,y=ranges.get(b.id)!; return (x.end-x.start)-(y.end-y.start) || y.declaration-x.declaration; });
      const selected:FlowLocal[]=[]; let hidden=false;
      for(const width of [...new Set(candidates.map(local=>{const range=ranges.get(local.id)!;return range.end-range.start;}))]){
        const level=candidates.filter(local=>{const range=ranges.get(local.id)!;return range.end-range.start===width;});
        const unconditional=level.find(local=>!local.conditions?.length);
        selected.push(...level.filter(local=>local.conditions?.length),...(unconditional?[unconditional]:[]));
        if(unconditional){hidden=true;break;}
      }
      return {kind:'name',name:node.text,localId:selected[0]?.id,alternatives:selected.length>1?selected.slice(1).map(local=>local.id):undefined,globalFallback:selected.length>0&&!hidden,location};
    }
    if (node.type === 'number_literal' || node.type === 'null') return {kind:'number',value:node.text,location};
    if (node.type === 'parenthesized_expression') return expr(node.namedChildren[0]);
    if (node.type === 'cast_expression') return {kind:'cast',object:field('value'),location};
    if (node.type === 'pointer_expression') return {kind:node.childForFieldName('operator')?.text === '&'?'address':'dereference',object:field('argument'),location};
    if (node.type === 'field_expression') return {kind:'member',object:field('argument'),field:node.childForFieldName('field')!.text,arrow:node.childForFieldName('operator')?.text === '->',location};
    if (node.type === 'subscript_expression') return {kind:'index',object:field('argument'),index:field('index'),location};
    if (node.type === 'assignment_expression') return {kind:'assign',left:field('left'),right:field('right'),operator:node.childForFieldName('operator')?.text ?? '=',location};
    if (node.type === 'update_expression') return {kind:'assign',left:field('argument'),right:unknown(),operator:'update',location};
    if (node.type === 'conditional_expression') return {kind:'sequence',values:[field('condition'),{kind:'choice',values:[field('consequence'),field('alternative')],location}],location};
    if (node.type === 'comma_expression') return {kind:'sequence',values:node.namedChildren.map(expr),location};
    if (node.type === 'call_expression') return {kind:'call',callee:field('function'),args:node.childForFieldName('arguments')!.namedChildren.filter(n=>n.type!=='comment').map(expr),key:`${fn}${namespace}:call:${node.startIndex}`,location};
    if (node.type === 'initializer_list') {
      const hasName = (n: Node): boolean => n.type === 'identifier' || n.namedChildren.some(hasName);
      const children=node.namedChildren.filter(n=>n.type!=='comment'&&present(n) && (!basic || hasName(n.childForFieldName('value') ?? n)));
      const enclosing=context?.(node)??[];
      const guards=children.map(child=>(context?.(child)??[]).filter(condition=>!enclosing.includes(condition)));
      const labels=[...new Set(guards.flat().map(label=>label.replace(/^else of /,'')))];
      const entries=children.map(child=>({
      path: child.type === 'initializer_pair' ? child.childrenForFieldName('designator').flatMap<string | number>(designator=> {
        if (designator.type === 'field_designator' || designator.type === 'field_identifier') return [designator.type==='field_identifier'?designator.text:designator.namedChildren[0].text];
        const value=designator.namedChildren[0]?.text.replace(/[uUlL]+$/,'');
        const number=value&&/^0[0-7]+$/.test(value)?parseInt(value,8):Number(value);
        return Number.isSafeInteger(number)&&number>=0?[number]:['*'];
      }) : [], value:expr(child.type === 'initializer_pair'?child.childForFieldName('value'):child) }));
      if(!labels.length)return{kind:'initializer',entries,location};
      if(labels.length>5)return unknown();
      // Branch on whole lists: treating both .cb writes as sequential would
      // overwrite one candidate, and positional entries would shift indices.
      return{kind:'choice',values:Array.from({length:2**labels.length},(_,mask)=>({kind:'initializer' as const,
        entries:entries.filter((_,i)=>guards[i].every(label=>!!(mask&(1<<labels.indexOf(label.replace(/^else of /,''))))!==label.startsWith('else of '))),location})),location};
    }
    const effects:Node[]=[];
    function sideEffects(current:Node){
      if(['sizeof_expression','alignof_expression'].includes(current.type))return;
      if(['call_expression','assignment_expression','update_expression'].includes(current.type)){effects.push(current);return;}
      for(const child of current.namedChildren)sideEffects(child);
    }
    for(const child of node.namedChildren)sideEffects(child);
    return {kind:'unknown',children:effects.length?effects.map(expr):undefined,location};
  }
  function collect(node: Node) {
    if (!present(node)) return;
    if (node.type === 'function_definition') {
      const name = declarator(node.childForFieldName('declarator')!).name, body=node.childForFieldName('body'); if(!name||!body)return;
      const id=`${uri}#${locate(name).start}`, locals:FlowLocal[]=[], ranges=new Map<string,{start:number;end:number; declaration:number}>(), params:string[]=[];
      const outerParams=ancestor(name,'function_declarator')?.childForFieldName('parameters');
      const functionConditions=context?.(name)??[];
      const persistentNames=new Map<string,number>();
      function declarations(current:Node) {
        if(!present(current))return;
        if(current.type==='function_definition' && current.id!==node.id)return;
        if(['declaration','parameter_declaration'].includes(current.type)) for(const child of current.childrenForFieldName('declarator')) {
          const target=child.type==='init_declarator'?child.childForFieldName('declarator')!:child, info=declarator(target); if(!info.name||(info.functionLike&&current.type!=='parameter_declaration'))continue;
          const parameters=ancestor(current,'parameter_list');
          if(parameters && parameters.id!==outerParams?.id)continue;
          let scope=ancestor(current,'compound_statement')??node;
          const loop=ancestor(current,'for_statement');if(loop&&loop.startIndex>scope.startIndex)scope=loop;
          const parameter=current.type==='parameter_declaration'?params.length:undefined;
          if(parameter!==undefined)scope=node;
          const persistent=current.namedChildren.some(child=>child.type==='storage_class_specifier'&&child.text==='static');
          const location=locate(info.name),key=location.start+':'+info.name.text,ordinal=persistentNames.get(key)??0;
          if(persistent)persistentNames.set(key,ordinal+1);
          const localId=persistent?`${id}:static:${key}:${ordinal}`:`${id}${namespace}:local:${info.name.startIndex}:${info.name.text}`;
          const type=declaredType(current,target,uri);
          if(type?.id){const typeNode=current.childForFieldName('type')!,typeName=typeNode.childForFieldName('name');type.id=typeName?`${uri}#${locate(typeName).start}`:`${uri}#${locate(typeNode).start}:aggregate`;}
          locals.push({id:localId,name:info.name.text,location,type,scope:{start:locate(scope).start,end:locate(scope).end},parameter,persistent,
            conditions:parameter!==undefined?[]:(context?.(info.name)??[]).filter(condition=>!functionConditions.includes(condition))});
          ranges.set(localId,{start:scope.startIndex,end:scope.endIndex,declaration:info.name.startIndex});if(parameter!==undefined)params.push(localId);
        }
        for(const child of current.namedChildren)declarations(child);
      }
      declarations(node);
      const expr=(value:Node|null|undefined)=>expression(value,locals,ranges,id);
      const hasRegistrationEffect=(value:Node):boolean=>['call_expression','assignment_expression'].includes(value.type)||value.namedChildren.some(hasRegistrationEffect);
      const guarded=(anchor:Node|undefined,result:Statement[]):Statement[]=>{
        if(!namespace||!anchor||!(context?.(anchor)??[]).some(condition=>!functionConditions.includes(condition)))return result;
        return[{kind:'branch',condition:{kind:'unknown',location:locate(anchor)},then:result,otherwise:[]}];
      };
      function statements(current:Node|null|undefined):Statement[] {
        if(!current||!present(current)||current.type==='function_definition')return[];
        if(['sizeof_expression','alignof_expression','type_definition','preproc_def','preproc_function_def','preproc_include','preproc_call'].includes(current.type))return[];
        if(current.type==='return_statement')return guarded(current,[{kind:'return',value:expr(current.namedChildren[0])}]);
        if(current.type==='declaration')return current.childrenForFieldName('declarator').flatMap(child=>{
          const value=child.childForFieldName('value'), target=child.childForFieldName('declarator'),name=target&&declarator(target).name;
          if(!name)return[];
          const own=locals.find(local=>ranges.get(local.id)?.declaration===name.startIndex);
          if(own?.persistent){initializers.push({id:own.id,value:value?expr(value):{kind:'initializer',entries:[],location:own.location},location:value?locate(value):own.location});return[];}
          if(!value)return[];
          const left:Expr={kind:'name',name:name.text,localId:own?.id,location:locate(name)};
          return guarded(name,[{kind:'expression' as const,value:{kind:'assign' as const,left,right:expr(value),operator:'=',location:locate(child)}}]);
        });
        if(current.type==='expression_statement')return current.namedChildren.filter(n=>n.type!=='comment'&&(!basic||hasRegistrationEffect(n))).flatMap(n=>guarded(n,[{kind:'expression',value:expr(n)}]));
        if(current.type==='if_statement')return[{kind:'branch',condition:expr(current.childForFieldName('condition')),then:statements(current.childForFieldName('consequence')),otherwise:statements(current.childForFieldName('alternative'))}];
        if(current.type==='switch_statement'){
          const cases=current.childForFieldName('body')?.namedChildren.filter(child=>child.type==='case_statement')??[];
          if(basic)return[{kind:'branch',condition:{kind:'unknown',location:locate(current)},then:cases.flatMap(branch=>branch.namedChildren.filter(child=>child.id!==branch.childForFieldName('value')?.id).flatMap(statements)),otherwise:[]}];
          const alternatives=cases.map((_,start)=>{const path:Statement[]=[];let stopped=false;
            for(const branch of cases.slice(start))for(const child of branch.namedChildren){
              if(stopped)break;if(child.type==='break_statement'){stopped=true;break;}
              if(child.id!==branch.childForFieldName('value')?.id)path.push(...statements(child));
            }return path;});
          let otherwise:Statement[]=[];
          for(const path of alternatives.reverse())otherwise=[{kind:'branch',condition:{kind:'unknown',location:locate(current)},then:path,otherwise}];
          return[{kind:'expression',value:expr(current.childForFieldName('condition'))},...otherwise];
        }
        if(['while_statement','do_statement','for_statement'].includes(current.type)){
          const init=current.childForFieldName('initializer'),update=current.childForFieldName('update');
          const before=init?(init.type==='declaration'?statements(init):[{kind:'expression' as const,value:expr(init)}]):[];
          return[...before,{kind:'loop',condition:expr(current.childForFieldName('condition')),body:[...statements(current.childForFieldName('body')),...(update?[{kind:'expression' as const,value:expr(update)}]:[])]}];
        }
        if(['preproc_if','preproc_elif','preproc_ifdef','preproc_elifdef'].includes(current.type)){
          const alternative=current.childForFieldName('alternative'),condition=current.childForFieldName('condition')??current.childForFieldName('name');
          const yes=current.namedChildren.filter(c=>c.id!==alternative?.id&&c.id!==condition?.id).flatMap(statements),no=statements(alternative);
          const literal=condition?.text.replace(/[()\s]/g,'');
          if(skipInactive && (literal==='0'||literal==='1'))return literal==='0'?no:yes;
          return[{kind:'branch',condition:{kind:'unknown',location:locate(current)},then:yes,otherwise:no}];
        }
        if(current.type.endsWith('_expression'))return basic&&!hasRegistrationEffect(current)?[]:[{kind:'expression',value:expr(current)}];
        return current.namedChildren.flatMap(statements);
      }
      programs.push({id,locals,params,body:statements(body)});return;
    }
    if(node.type==='declaration' && !ancestor(node,'function_definition'))for(const child of node.childrenForFieldName('declarator')){
      const value=child.childForFieldName('value'),target=child.childForFieldName('declarator'),name=target&&declarator(target).name;
      if(value&&name)initializers.push({id:`${uri}#${locate(name).start}`,value:expression(value,[],new Map(),'global'),location:locate(value)});
    }
    for(const child of node.namedChildren)collect(child);
  }
  collect(root);return {programs,initializers};
}
