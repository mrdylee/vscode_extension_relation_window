const minIntervalMs = 10_000;
const maxIntervalMs = 20_000;
const spriteSize = 48;

type Move = readonly [time: number, x: number, y: number, rotation?: number, easing?: string, scaleY?: number, flip?: boolean];
type Scene = {
  name: string;
  rotation: number;
  moves: readonly Move[];
  poses: readonly [time: number, tile: number][];
  flip?: boolean;
  easing?: string;
  grounded?: boolean;
};

const enum DailyPose {
  Look,
  Blink,
  Stand,
  Leap,
  Creep,
  Sit,
  WideEyes,
  StepA,
  StepB,
  StepC,
  Yawn = 13,
  Drowsy,
  Nod,
  Curled,
  Stretched,
  PawUp,
  Lick,
  Scratch,
  HeadTilt,
  WaterBowl,
  Lap,
  TailUp,
  TailOut,
  BellyUp,
  OnSide,
}

// The original thirteen tiles cover the sill poses, steps, and eating.
const scenes: readonly (Scene | ((panel: DOMRect) => Scene))[] = [
  fromRight({
    name: 'play',
    rotation: 0,
    moves: [
      [540, 0, 0], [1750, 0, 0], [2010, -10, -11], [2280, -20, 0],
      [2440, -20, 0], [2700, -30, -7], [2980, -39, 0], [3170, -39, 0],
      [3420, -41, 0], [3700, -41, 0], [3960, -51, -7], [4220, -61, 0],
      [4930, -61, 0],
    ],
    poses: [
      [0, 0], [1080, 1], [1250, 0], [1750, 3], [2280, 2], [2440, 3],
      [2980, 2], [3170, 4], [3700, 3], [4220, 2], [4380, 5],
    ],
  }),
  fromRight({
    name: 'gaze',
    rotation: 0,
    moves: [[580, 0, 0], [3150, 0, 0]],
    poses: [[0, 0], [1320, 1], [1490, 0], [2490, 1], [2650, 0]],
  }, true),
  {
    name: 'top',
    rotation: 180,
    moves: [[0, 0, -34], [630, 0, 0], [2450, 0, 0], [3100, 0, -34]],
    poses: [[0, 0], [1330, 1], [1500, 0]],
  },
  {
    name: 'left',
    rotation: 90,
    moves: [[0, -34, 0], [630, 0, 0], [2450, 0, 0], [3100, -34, 0]],
    poses: [[0, 0], [1330, 1], [1500, 0]],
  },
  fromRight({
    name: 'expression',
    rotation: 0,
    moves: [[550, 0, 0], [3150, 0, 0]],
    poses: [[0, 0], [1050, 6], [1940, 1], [2640, 0]],
  }, true),
  ({ width }) => walk(width, true),
  ({ width }) => walk(width, false),
  fromRight({
    name: 'butterfly',
    rotation: 0,
    moves: [
      [450, 0, 0], [1050, 0, 0], [1280, -10, -11], [1550, -22, 0],
      [1800, -22, 0], [2090, -34, -9], [2360, -44, 0], [2580, -44, 0],
      [2780, -54, 0], [3170, -54, 0], [3390, -53, 0], [3950, -53, 0],
    ],
    poses: [[0, 2], [1050, 3], [1550, 2], [1800, 3], [2360, 2], [2580, 4], [3390, 5]],
  }),
  fromRight({
    name: 'eat',
    rotation: 0,
    moves: [[520, 0, 0], [3690, 0, 0]],
    poses: [
      [0, 10], [920, 11], [1170, 10], [1390, 11], [1640, 10],
      [1860, 11], [2110, 10], [2350, 11], [2580, 10], [2820, 12],
    ],
  }),
  pop,
  onSill('yawn', 3420, [
    [0, DailyPose.Drowsy], [950, DailyPose.Nod], [1190, DailyPose.Yawn],
    [2140, DailyPose.Nod], [2460, DailyPose.Drowsy],
  ], [
    [820, 0, 0], [1120, 0, 0, -3, 'ease-out', .97], [1520, 0, 0, 3, 'ease-in-out', 1.065],
    [1870, 0, 0, 4, 'ease-in-out', 1.035], [2230, 0, 0, -2], [2610, 0, 0],
  ]),
  onSill('doze', 4520, [
    [0, DailyPose.Drowsy], [920, DailyPose.Nod], [1550, DailyPose.Drowsy],
    [2130, DailyPose.Nod], [3080, DailyPose.Drowsy], [3390, DailyPose.Nod], [3910, DailyPose.HeadTilt],
  ], [
    [720, 0, 0], [1320, 0, 0, -5, 'ease-in-out', .96], [1680, 0, 0],
    [1930, 0, 0], [2680, 0, 0, -6, 'ease-in-out', .96], [3220, 0, 0],
    [3800, 0, 0, -6, 'ease-out', .96], [3980, 0, 0, 4], [4370, 0, 0],
  ]),
  fromRight({
    name: 'nap',
    rotation: 0,
    grounded: true,
    moves: [
      [520, 0, 0], [1060, 0, 0], [1510, -3, 0],
      [2160, -3, 0, 0, 'ease-in-out', 1.065], [2830, -3, 0],
      [3490, -3, 0, 0, 'ease-in-out', 1.065], [4190, -3, 0],
      [4790, -3, 0, 0, 'ease-in-out', 1.05],
      [5160, -3, 0],
    ],
    poses: [[0, DailyPose.Drowsy], [980, DailyPose.Nod], [1330, DailyPose.Curled]],
  }),
  onSill('stretch', 3590, [
    [0, DailyPose.HeadTilt], [1060, DailyPose.Stretched], [2600, DailyPose.HeadTilt],
  ], [
    [920, 0, 0], [1260, -2, 0], [2060, -6, 0], [2500, -5, 0], [2850, 0, 0],
  ]),
  onSill('groom', 3900, [
    [0, DailyPose.Nod], [910, DailyPose.PawUp], [1290, DailyPose.Lick], [1520, DailyPose.PawUp],
    [1780, DailyPose.Lick], [2010, DailyPose.PawUp], [2270, DailyPose.Lick],
    [2510, DailyPose.PawUp], [3020, DailyPose.Nod],
  ]),
  onSill('scratch', 3520, [
    [0, DailyPose.HeadTilt], [1020, DailyPose.Scratch], [1230, DailyPose.HeadTilt],
    [1420, DailyPose.Scratch], [1620, DailyPose.HeadTilt], [1810, DailyPose.Scratch],
    [2010, DailyPose.HeadTilt], [2200, DailyPose.Scratch], [2420, DailyPose.HeadTilt],
  ]),
  onSill('drink', 4180, [
    [0, DailyPose.WaterBowl], [990, DailyPose.Lap], [1310, DailyPose.WaterBowl],
    [1580, DailyPose.Lap], [1900, DailyPose.WaterBowl], [2170, DailyPose.Lap],
    [2490, DailyPose.WaterBowl], [2760, DailyPose.Lap], [3080, DailyPose.WaterBowl],
  ]),
  onSill('tilt', 3650, [
    [0, DailyPose.Drowsy], [980, DailyPose.HeadTilt], [2080, DailyPose.Drowsy],
    [2450, DailyPose.HeadTilt], [3090, DailyPose.Drowsy],
  ], [
    [820, 0, 0], [1280, 0, 0, 4], [1880, 0, 0, 2], [2180, 0, 0],
    [2680, 0, 0, 3], [3220, 0, 0],
  ]),
  onSill('wag', 3560, [
    [0, DailyPose.TailUp], [880, DailyPose.TailOut], [1110, DailyPose.TailUp],
    [1340, DailyPose.TailOut], [1570, DailyPose.TailUp], [1800, DailyPose.TailOut],
    [2030, DailyPose.TailUp], [2260, DailyPose.TailOut], [2500, DailyPose.TailUp],
  ]),
  fromRight({
    name: 'roll',
    rotation: 0,
    grounded: true,
    moves: [
      [520, 0, 0], [1050, 0, 0], [1360, -4, 0, -4], [1790, -9, 0],
      [2140, -10, 0, -4], [2570, -9, 0, 1], [3130, -6, 0, 3],
      [3650, -3, 0], [4300, -3, 0],
    ],
    poses: [[0, DailyPose.OnSide], [1350, DailyPose.BellyUp], [3120, DailyPose.OnSide]],
  }),
  onSill('wake-up', 3600, [
    [0, DailyPose.Curled], [1080, DailyPose.Nod], [1560, DailyPose.Yawn],
    [2180, DailyPose.Drowsy], [2610, DailyPose.Sit],
  ], [[1040, 0, 0], [1580, 0, 0, 0, 'ease-out', 1.06], [2260, 0, 0]]),
  onSill('tiptoe', 2960, [
    [0, DailyPose.StepA], [870, DailyPose.StepB], [1100, DailyPose.StepC], [1330, DailyPose.StepB],
    [1540, DailyPose.StepA], [1760, DailyPose.StepC], [1950, DailyPose.HeadTilt], [2390, DailyPose.Stand],
  ], [[760, 0, 0, 0, 'linear'], [1950, -34, 0], [2480, -34, 0]]),
  onSill('pounce', 3020, [
    [0, DailyPose.Stand], [930, DailyPose.Creep], [1500, DailyPose.Leap],
    [1830, DailyPose.Creep], [2230, DailyPose.PawUp], [2560, DailyPose.Stand],
  ], [[940, 0, 0], [1500, -4, 0], [1660, -25, -17], [1830, -46, 0], [2060, -48, 0]]),
  onSill('backstep', 3050, [
    [0, DailyPose.Stand], [900, DailyPose.StepA], [1030, DailyPose.StepB], [1160, DailyPose.StepC],
    [1370, DailyPose.WideEyes], [1830, DailyPose.StepC], [1970, DailyPose.StepB], [2150, DailyPose.Creep],
  ], [[850, 0, 0, 0, 'linear'], [1300, -28, 0], [1810, -28, 0, 0, 'linear'], [2170, -7, 0]]),
  onSill('turn-around', 2980, [
    [0, DailyPose.TailUp], [1020, DailyPose.StepB], [1160, DailyPose.Stand], [1700, DailyPose.HeadTilt],
    [2190, DailyPose.StepC], [2300, DailyPose.TailUp],
  ], [
    [820, -9, 0], [1099, -13, 0, 0, 'steps(1, end)'], [1100, -13, 0, 0, 'ease-in-out', 1, true],
    [2219, -13, 0, 0, 'steps(1, end)', 1, true], [2220, -13, 0], [2520, -18, 0],
  ]),
  onSill('double-take', 2800, [
    [0, DailyPose.Sit], [900, DailyPose.HeadTilt], [1220, DailyPose.Sit],
    [1490, DailyPose.WideEyes], [1850, DailyPose.HeadTilt], [2290, DailyPose.Sit],
  ], [[830, 0, 0], [1010, -2, 0, 5], [1240, 0, 0], [1530, -5, 0, 7], [1930, -3, 0]]),
  onSill('slow-blink', 3570, [
    [0, DailyPose.Sit], [1000, DailyPose.Drowsy], [1400, DailyPose.Nod], [2130, DailyPose.Drowsy],
    [2460, DailyPose.Sit], [2800, DailyPose.Blink], [3040, DailyPose.Sit],
  ], [[1180, 0, 0], [1670, 0, 0, 0, 'ease-in-out', .96], [2650, 0, 0]]),
  onSill('paw-wave', 3070, [
    [0, DailyPose.Sit], [900, DailyPose.PawUp], [1160, DailyPose.Scratch], [1410, DailyPose.PawUp],
    [1640, DailyPose.Scratch], [1850, DailyPose.PawUp], [2110, DailyPose.Sit],
  ], [[840, 0, 0], [1170, 0, 0, 4], [1500, 0, 0, -2], [1680, 0, 0, 4], [2150, 0, 0]]),
  onSill('face-wash', 3340, [
    [0, DailyPose.Sit], [930, DailyPose.Lick], [1210, DailyPose.Scratch], [1490, DailyPose.Nod],
    [1820, DailyPose.Lick], [2090, DailyPose.Scratch], [2440, DailyPose.Nod], [2760, DailyPose.Sit],
  ], [[980, 0, 0, 0, 'ease-in-out', .98], [1310, 0, 0, -6], [1590, 0, 0],
    [1870, 0, 0, 0, 'ease-in-out', .98], [2210, 0, 0, -6], [2640, 0, 0]]),
  onSill('listen', 3310, [
    [0, DailyPose.Sit], [1150, DailyPose.Stand], [1590, DailyPose.HeadTilt],
    [2340, DailyPose.WideEyes], [2640, DailyPose.Sit],
  ], [[1040, 0, 0], [1490, 0, 0, 3], [1810, 0, 0, -5], [2280, 0, 0, -5], [2490, 0, 0]]),
  onSill('sniff', 2940, [
    [0, DailyPose.Stand], [870, DailyPose.Creep], [1440, DailyPose.Stand],
    [1720, DailyPose.Creep], [2230, DailyPose.HeadTilt],
  ], [[810, 0, 0], [1030, -8, 0, -3], [1240, -11, 0, 1], [1440, -12, 0],
    [1830, -18, 0, -3], [2210, -19, 0]]),
  onSill('tail-flick', 3140, [
    [0, DailyPose.Sit], [970, DailyPose.TailUp], [1550, DailyPose.TailOut], [1680, DailyPose.TailUp],
    [2160, DailyPose.TailOut], [2300, DailyPose.TailUp], [2570, DailyPose.HeadTilt],
  ]),
  onSill('crouch', 3210, [
    [0, DailyPose.Stand], [1140, DailyPose.Creep], [2280, DailyPose.WideEyes], [2660, DailyPose.Stand],
  ], [[800, 0, 0], [1210, -9, 0, 0, 'ease-out', .92], [2000, -9, 0, 0, 'ease-in-out', .92], [2590, -9, 0]]),
  onSill('startle', 2660, [
    [0, DailyPose.Nod], [1050, DailyPose.WideEyes], [1150, DailyPose.Leap],
    [1390, DailyPose.Stand], [1770, DailyPose.HeadTilt], [2190, DailyPose.Sit],
  ], [[1040, -12, 0], [1190, -8, -19, -7], [1400, -3, 0, 0, 'ease-out', .92], [1540, -3, 0]]),
  onSill('morning-stretch', 3610, [
    [0, DailyPose.Drowsy], [950, DailyPose.Yawn], [1420, DailyPose.Stretched],
    [2340, DailyPose.TailUp], [2700, DailyPose.Stand],
  ], [[880, 0, 0], [1530, -10, 0, 0, 'ease-in-out', .93], [2210, -15, 0, 0, 'ease-in-out', .93], [2660, -10, 0]]),
  onSill('dream-twitch', 3950, [
    [0, DailyPose.Curled], [1240, DailyPose.OnSide], [2040, DailyPose.Curled],
    [2480, DailyPose.OnSide], [2640, DailyPose.Curled], [3350, DailyPose.Nod],
  ], [[1170, 0, 0], [1310, -3, 0, -4], [1460, 0, 0], [2410, 0, 0], [2540, -4, 0, 2], [2700, 0, 0]]),
  onSill('belly-stretch', 3490, [
    [0, DailyPose.OnSide], [1110, DailyPose.BellyUp], [2270, DailyPose.OnSide], [2740, DailyPose.Stretched],
  ], [[960, 0, 0], [1390, -8, 0, -5], [1950, -8, 0, 0, 'ease-in-out', 1.09], [2390, -4, 0], [2860, -8, 0]]),
  onSill('small-hop', 2620, [
    [0, DailyPose.Stand], [930, DailyPose.Creep], [1130, DailyPose.Leap], [1420, DailyPose.Stand],
    [1670, DailyPose.Leap], [1910, DailyPose.Creep], [2150, DailyPose.Sit],
  ], [[900, 0, 0], [1240, -5, -9], [1440, -10, 0], [1760, -14, -6], [1920, -18, 0], [2140, -18, 0]]),
  onSill('shake-off', 2800, [
    [0, DailyPose.Stand], [1160, DailyPose.HeadTilt], [1350, DailyPose.Stand],
    [1510, DailyPose.HeadTilt], [1720, DailyPose.Stand], [2180, DailyPose.Sit],
  ], [[1040, 0, 0], [1150, -2, 0, -6], [1280, 0, 0, 6], [1410, -2, 0, -6],
    [1540, 0, 0, 6], [1750, -1, 0]]),
  onSill('chase-tail', 3560, [
    [0, DailyPose.TailUp], [980, DailyPose.TailOut], [1230, DailyPose.StepA], [1530, DailyPose.TailOut],
    [1920, DailyPose.StepB], [2180, DailyPose.TailUp], [2680, DailyPose.Curled],
  ], [[950, 0, 0], [1299, -16, 0, 0, 'steps(1, end)'], [1300, -16, 0, 0, 'ease-in-out', 1, true],
    [1839, -3, 0, 0, 'steps(1, end)', 1, true], [1840, -3, 0], [2180, -14, 0], [2710, -9, 0]]),
];

function onSill(name: string, leaveAt: number, poses: Scene['poses'], gestures: readonly Move[] = []): Scene {
  const [, x] = gestures.at(-1) ?? [0, 0];
  return fromRight({
    name,
    rotation: 0,
    grounded: true,
    moves: [[520, 0, 0], ...gestures, [leaveAt, x, 0]],
    poses,
  });
}

function fromRight(scene: Scene, peek = false): Scene {
  const edge = spriteSize + 6;
  const [arrival] = scene.moves[0];
  const [departure, x] = scene.moves.at(-1)!;
  const end = departure + Math.max(500, Math.round((edge - x) / .11));
  const entrance: Move = [0, edge, 0, 0, peek ? 'ease-in-out' : 'linear'];
  if (peek) return { ...scene, moves: [entrance, ...scene.moves, [end, edge, 0]] };
  return {
    ...scene,
    moves: [entrance, ...scene.moves.slice(0, -1), [departure - 1, x, 0, 0, 'steps(1, end)'],
      [departure, x, 0, 0, 'linear', 1, true], [end, edge, 0, 0, 'linear', 1, true]],
    poses: [...footsteps(0, arrival, 110), [arrival, scene.poses[0][1]], ...scene.poses.slice(1), ...footsteps(departure, end, 110)],
  };
}

function walk(width: number, toRight: boolean): Scene {
  const left = -spriteSize;
  const right = width;
  const duration = Math.min(9000, Math.max(1800, (right - left) / (toRight ? .095 : .14)));
  return {
    name: toRight ? 'walk-right' : 'walk-left',
    rotation: 0,
    flip: toRight,
    easing: 'linear',
    moves: [[0, toRight ? left : right, 0], [duration, toRight ? right : left, 0]],
    poses: footsteps(0, duration, toRight ? 112 : 80),
  };
}

function footsteps(start: number, end: number, stride: number): Scene['poses'] {
  const steps = [7, 8, 9, 8];
  return Array.from({ length: Math.ceil((end - start) / stride) }, (_, index) => [start + index * stride, steps[index % steps.length]]);
}

function pop({ width, height }: DOMRect): Scene {
  const half = spriteSize / 2;
  const reach = spriteSize - 1;
  const edges = [
    { x: -spriteSize, y: height * .66 - half, dx: reach, dy: 0, rotation: 90 },
    { x: width, y: height * .44 - half, dx: -reach, dy: 0, rotation: -90 },
    { x: width * .48 - half, y: -spriteSize, dx: 0, dy: reach, rotation: 180 },
    { x: width, y: height * .82 - half, dx: -reach, dy: 0, rotation: -90 },
  ];
  const moves: Move[] = [];
  let time = 0;
  while (edges.length > 0) {
    const [{ x, y, dx, dy, rotation }] = edges.splice(Math.floor(Math.random() * edges.length), 1);
    moves.push(
      [time, x, y, rotation],
      [time + 150, x + dx, y + dy, rotation],
      [time + 300, x + dx, y + dy, rotation],
      // Stay outside until the next peek starts at another edge.
      [time + 430, x, y, rotation, 'steps(1, end)'],
    );
    time += 560;
  }
  const [, x, y, rotation] = moves.at(-1)!;
  moves.push([time, x, y, rotation]);
  return { name: 'pop', rotation: 0, moves, poses: [[0, 0]] };
}

function tilePosition(tile: number) {
  return `${(tile % 4) * 100 / 3}% ${Math.floor(tile / 4) * 100 / 6}%`;
}

export function createIdleMascot(parent: HTMLElement) {
  const mascot = document.createElement('div');
  mascot.className = 'idle-mascot';
  mascot.hidden = true;
  const cat = document.createElement('button');
  cat.type = 'button';
  cat.className = 'mascot-cat';
  cat.setAttribute('aria-label', 'Say hello to Salgu');
  const ball = document.createElement('div');
  ball.className = 'mascot-ball';
  ball.hidden = true;
  const butterfly = document.createElement('div');
  butterfly.className = 'mascot-butterfly';
  butterfly.hidden = true;
  const wings = document.createElement('div');
  wings.className = 'mascot-wings';
  butterfly.append(wings);
  const heart = document.createElement('span');
  heart.className = 'mascot-heart';
  heart.textContent = '♥';
  heart.setAttribute('aria-hidden', 'true');
  heart.hidden = true;
  mascot.append(ball, cat, butterfly, heart);
  parent.append(mascot);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let workbenchReducesMotion = document.body.classList.contains('vscode-reduce-motion');
  let available = false;
  let timer: number | undefined;
  let animations: Animation[] = [];

  function stop() {
    mascot.hidden = true;
    heart.hidden = true;
    for (const animation of animations) animation.cancel();
    animations = [];
  }

  function playScene(index: number) {
    stop();
    const choice = scenes[index];
    mascot.hidden = false;
    const scene = typeof choice === 'function' ? choice(mascot.getBoundingClientRect()) : choice;
    mascot.dataset.scene = scene.name;
    const duration = scene.moves.at(-1)![0];
    const options: KeyframeAnimationOptions = { duration, fill: 'both' };
    // The sprite box extends one pixel past the sill. Keep breathing and leaning anchored there.
    cat.style.transformOrigin = scene.grounded ? '50% calc(100% - 1px)' : '';
    const movement = cat.animate(scene.moves.map(([time, x, y, rotation = scene.rotation, easing = scene.easing ?? 'ease-in-out', scaleY = 1, flip = scene.flip]) => ({
      offset: time / duration,
      transform: `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${flip ? -1 : 1}, ${scaleY})`,
      easing,
    })), options);
    const expressions = cat.animate([
      ...scene.poses.map(([time, tile]) => ({
        offset: time / duration, backgroundPosition: tilePosition(tile), easing: 'steps(1, end)',
      })),
      { offset: 1, backgroundPosition: tilePosition(scene.poses.at(-1)![1]) },
    ], options);
    animations = [movement, expressions];

    ball.hidden = scene.name !== 'play';
    if (!ball.hidden) animations.push(ball.animate([
      { offset: 0, opacity: 0 },
      { offset: 2350 / duration, opacity: 0 },
      { offset: 2440 / duration, opacity: 1, transform: 'translateX(0)' },
      { offset: 3270 / duration, opacity: 1, transform: 'translateX(0)', easing: 'ease-out' },
      { offset: 3760 / duration, opacity: 1, transform: 'translateX(-22px) rotate(-270deg)' },
      { offset: 4420 / duration, opacity: 1, transform: 'translateX(-22px) rotate(-270deg)' },
      { offset: 4520 / duration, opacity: 0 },
      { offset: 1, opacity: 0 },
    ], options));

    butterfly.hidden = scene.name !== 'butterfly';
    if (!butterfly.hidden) {
      const flight = [
        [0, 38, -23, 1], [450, -18, -36, 1], [920, -44, -23, 1],
        [1260, -51, -38, 1], [1660, -63, -28, 1], [2060, -77, -38, 1],
        [2350, -81, -24, 1], [2610, -75, -13, 1], [2810, -78, 1, 1],
        [3170, -78, 1, 1], [3440, -84, -19, 1], [3820, -110, -38, 1],
        [4140, -132, -55, 0], [4450, -132, -55, 0],
      ];
      animations.push(butterfly.animate(flight.map(([time, x, y, opacity]) => ({
        offset: time / duration,
        transform: `translate(${x}px, ${y}px)`,
        opacity,
        easing: 'ease-in-out',
      })), options));
      animations.push(wings.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(.42)' }, { transform: 'scaleX(1)' }], {
        duration: 180, iterations: Math.ceil(duration / 180),
      }));
    }

    movement.onfinish = () => {
      if (animations[0] === movement) stop();
    };
  }

  cat.addEventListener('click', () => {
    if (mascot.hidden || !heart.hidden) return;
    const playing = animations;
    for (const animation of playing) animation.pause();
    const panel = mascot.getBoundingClientRect();
    const box = cat.getBoundingClientRect();
    heart.style.left = `${Math.max(12, Math.min(panel.width - 12, box.left + box.width / 2 - panel.left))}px`;
    heart.style.top = `${Math.max(16, box.top - panel.top - 3)}px`;
    heart.hidden = false;
    const greetingMs = 850;
    const blink = cat.animate([
      { backgroundPosition: tilePosition(DailyPose.Look), offset: 0, easing: 'steps(1, end)' },
      { backgroundPosition: tilePosition(DailyPose.Blink), offset: .24, easing: 'steps(1, end)' },
      { backgroundPosition: tilePosition(DailyPose.Look), offset: .41 },
      { backgroundPosition: tilePosition(DailyPose.Look), offset: 1 },
    ], { duration: greetingMs, fill: 'both' });
    const float = heart.animate([
      { opacity: 0, transform: 'translate(-50%, 5px)' },
      { opacity: 1, transform: 'translate(-50%, 0)', offset: .22 },
      { opacity: 1, transform: 'translate(-50%, -7px)', offset: .57 },
      { opacity: 0, transform: 'translate(-50%, -15px)' },
    ], { duration: greetingMs });
    animations = [...playing, blink, float];
    float.onfinish = () => {
      if (!animations.includes(float)) return;
      heart.hidden = true;
      blink.cancel();
      animations = playing;
      for (const animation of playing) animation.play();
    };
  });

  function canPlay() {
    return available && !document.hidden && !reducedMotion.matches && !workbenchReducesMotion;
  }

  function schedule() {
    const interval = minIntervalMs + Math.floor(Math.random() * (maxIntervalMs - minIntervalMs + 1));
    timer = window.setTimeout(() => {
      if (!canPlay()) return;
      playScene(Math.floor(Math.random() * scenes.length));
      schedule();
    }, interval);
  }

  function restart() {
    window.clearTimeout(timer);
    stop();
    if (canPlay()) schedule();
  }

  document.addEventListener('visibilitychange', restart);
  reducedMotion.addEventListener('change', restart);
  new MutationObserver(() => {
    const reduced = document.body.classList.contains('vscode-reduce-motion');
    if (workbenchReducesMotion === reduced) return;
    workbenchReducesMotion = reduced;
    restart();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return {
    playScene,
    restart,
    setAvailable(isAvailable: boolean) {
      if (available === isAvailable) return;
      available = isAvailable;
      restart();
    },
  };
}
