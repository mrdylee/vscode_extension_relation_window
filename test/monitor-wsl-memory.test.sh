#!/usr/bin/env bash
# Run on Linux: bash test/monitor-wsl-memory.test.sh
set -euo pipefail
script=$(cd -- "$(dirname -- "$0")/../scripts" && pwd)/monitor-wsl-memory.sh
bash -n "$script"
bash "$script" --help > /dev/null
if bash "$script" /unused 0 > /dev/null 2>&1; then echo 'Accepted zero duration' >&2; exit 1; fi
if [[ $(uname -s) != Linux ]]; then echo 'SKIP: /proc integration requires Linux'; exit 0; fi
fixture=$(mktemp -d)
pids=()
cleanup() { for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; rm -rf -- "$fixture"; }
trap cleanup EXIT
export VSCODE_AGENT_FOLDER="$fixture/server"
root=$VSCODE_AGENT_FOLDER
journal="$root/data/User/workspaceStorage/workspace/dylee.dynsight/diagnostics"
mkdir -p "$journal" "$root/data/logs/session/exthost1" "$root/extensions/dylee.dynsight-0.1.86"
printf '{"event":"sample","host":{"heapMiB":123}}\n' > "$journal/current.jsonl"
printf 'initial log\n' > "$root/data/logs/session/exthost1/exthost.log"
printf 'DO_NOT_COPY\n' > "$root/data/logs/session/other.log"

start_process() {
  bash -c 'exec -a "$1" bash -c "while :; do sleep 1; done" "$2" COMMAND_LINE_SECRET' -- "$1" "$2" &
  child=$!
  pids+=("$child")
}
start_process "$root/bin/node" --type=extensionHost
first=$child
start_process "$root/extensions/ms-vscode.cpptools/bin/cpptools-srv" test
start_process "$root/extensions/ms-vscode.cpptools/bin/cpptools" test
bash "$script" "$fixture/output" 30 1 > "$fixture/console.txt" &
monitor=$!
pids+=("$monitor")
for ((i=0; i<50; i++)); do
  if [[ -f "$fixture/output/processes.tsv" ]] && awk -F '\t' -v pid="$first" '$2==pid {found=1} END {exit !found}' "$fixture/output/processes.tsv"; then break; fi
  sleep 0.1
done
kill "$first"
wait "$first" 2>/dev/null || true
start_process "$root/bin/node" --type=extensionHost
second=$child
printf 'fatal error fixture\n' >> "$root/data/logs/session/exthost1/exthost.log"
for ((i=0; i<50; i++)); do
  if awk -F '\t' -v pid="$second" '$2==pid {found=1} END {exit !found}' "$fixture/output/processes.tsv"; then break; fi
  sleep 0.1
done
kill -TERM "$monitor"
code=0
wait "$monitor" || code=$?
[[ $code == 143 ]]
awk -F '\t' -v first="$first" -v second="$second" '
  NR>1 {if(NF!=10 || $3!~/^[0-9]+$/ || $6<=0) exit 1; roles[$5]=1; seen[$2]=1}
  END {if(!seen[first] || !seen[second] || !roles["cpptools"] || !roles["cpptools-srv"]) exit 1}
' "$fixture/output/processes.tsv"
awk -F '\t' 'NR>1 {if(NF!=5 || $2<=0) exit 1; found=1} END {if(!found) exit 1}' "$fixture/output/system.tsv"
cmp "$journal/current.jsonl" "$fixture/output/logs/User/workspaceStorage/workspace/dylee.dynsight/diagnostics/current.jsonl"
cmp "$root/data/logs/session/exthost1/exthost.log" "$fixture/output/logs/logs/session/exthost1/exthost.log"
[[ ! -e "$fixture/output/logs/logs/session/other.log" ]]
if grep -R -q COMMAND_LINE_SECRET "$fixture/output"; then echo 'Recorded a command line' >&2; exit 1; fi
if bash "$script" "$fixture/output" 1 > /dev/null 2>&1; then echo 'Overwrote an existing capture' >&2; exit 1; fi
bash "$script" "$fixture/timed" 1 2 > /dev/null
grep -q 'Stopped UTC:' "$fixture/timed/info.txt"
echo 'PASS: process roles, restart, samples, journal/log capture, termination, duration and argument handling'
