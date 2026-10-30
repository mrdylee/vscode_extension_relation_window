#!/usr/bin/env bash
set -euo pipefail
script=$(cd -- "$(dirname -- "$0")/../scripts" && pwd)/monitor-macos-memory.sh
bash -n "$script"
bash "$script" --help > /dev/null
if bash "$script" /unused 0 >/dev/null 2>&1; then echo 'Accepted zero duration' >&2; exit 1; fi
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/Code/User/workspaceStorage/workspace/dylee.dynsight/diagnostics"
cat > "$fixture/bin/uname" <<'SH'
#!/usr/bin/env bash
if [[ $1 == -s ]]; then echo Darwin; else echo 24.0; fi
SH
cat > "$fixture/bin/ps" <<'SH'
#!/usr/bin/env bash
cat <<'ROWS'
101 1 2048 1950000000 01:02 Fri Oct 30 23:00:00 2026 /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)
102 101 4096 500000 00:30 Fri Oct 30 23:00:32 2026 /Users/test/.vscode/extensions/ms-vscode.cpptools/bin/cpptools
103 102 1024 500000 00:20 Fri Oct 30 23:00:42 2026 /Users/test/.vscode/extensions/ms-vscode.cpptools/bin/cpptools-srv2
104 1 8192 500000 00:10 Fri Oct 30 23:00:52 2026 /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Renderer).app/Contents/MacOS/Code Helper (Renderer)
999 1 4096 500000 00:05 Fri Oct 30 23:00:57 2026 /usr/bin/other
ROWS
SH
cat > "$fixture/bin/sysctl" <<'SH'
#!/usr/bin/env bash
if [[ $1 == -n ]]; then echo 17179869184; else echo 'vm.swapusage: total = 0.00M'; fi
SH
cat > "$fixture/bin/vm_stat" <<'SH'
#!/usr/bin/env bash
echo 'Mach Virtual Memory Statistics: (page size of 16384 bytes)'
SH
chmod +x "$fixture/bin/"*
export VSCODE_USER_DATA_DIR="$fixture/Code"
printf '{"pid":101,"host":{"heapMiB":123,"limitMiB":4192}}\n' > "$fixture/Code/User/workspaceStorage/workspace/dylee.dynsight/diagnostics/current.jsonl"
PATH="$fixture/bin:$PATH" bash "$script" "$fixture/output" 1 1 > /dev/null
awk -F '\t' '
  NR>1 {if(NF!=9 || $5<=0 || $2==999) exit 1; roles[$4]=1; count++}
  END {if(count!=4 || !roles["code-plugin"] || !roles["code-renderer"] || !roles["cpptools"] || !roles["cpptools-srv"]) exit 1}
' "$fixture/output/processes.tsv"
cmp "$fixture/Code/User/workspaceStorage/workspace/dylee.dynsight/diagnostics/current.jsonl" "$fixture/output/logs/User/workspaceStorage/workspace/dylee.dynsight/diagnostics/current.jsonl"
grep -q 'Stopped UTC:' "$fixture/output/info.txt"
grep -q 'page size of 16384' "$fixture/output/system.txt"
if PATH="$fixture/bin:$PATH" bash "$script" "$fixture/output" 1 > /dev/null 2>&1; then echo 'Overwrote capture' >&2; exit 1; fi
echo 'PASS: macOS process parsing, spaced paths, role filtering, journal capture, memory units and duration'
