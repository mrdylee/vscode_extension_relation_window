#!/usr/bin/env bash
# Read-only Linux/WSL sampling. Does not change VS Code settings or heap limits.
set -euo pipefail

usage() {
  echo 'Usage: bash scripts/monitor-wsl-memory.sh [NEW_OUTPUT_DIR] [DURATION_SECONDS=1800] [INTERVAL_SECONDS=2]'
  echo 'Requires Linux /proc, Bash and standard GNU utilities. Ctrl+C stops and preserves logs.'
  echo 'For a custom VS Code Server location, set VSCODE_AGENT_FOLDER.'
}
if [[ ${1:-} == --help ]]; then usage; exit 0; fi
if (( $# > 3 )); then usage >&2; exit 2; fi
duration=${2:-1800}
interval=${3:-2}
for value in "$duration" "$interval"; do
  if [[ ! $value =~ ^[1-9][0-9]{0,5}$ ]]; then
    echo 'Duration and interval must be positive integers of at most six digits.' >&2
    exit 2
  fi
done
if [[ $(uname -s) != Linux || ! -r /proc/meminfo ]]; then
  echo 'Run this script inside WSL/Linux, in the same environment as the VS Code Server.' >&2
  exit 1
fi
umask 077
if [[ -n ${1:-} ]]; then
  output=$1
  mkdir -- "$output"
else
  output=$(mktemp -d "${TMPDIR:-/tmp}/dynsight-memory.XXXXXX")
fi
output=$(cd -- "$output" && pwd)
server_root=${VSCODE_AGENT_FOLDER:-"$HOME/.vscode-server"}
printf 'timestamp_utc\tpid\tstart_ticks\tppid\trole\trss_kib\tpeak_rss_kib\tswap_kib\tthreads\texecutable\n' > "$output/processes.tsv"
printf 'timestamp_utc\tmem_total_kib\tmem_available_kib\tswap_total_kib\tswap_free_kib\n' > "$output/system.tsv"
printf 'timestamp_utc\tevent\n' > "$output/events.tsv"
{
  printf 'Started UTC: %s\nKernel: %s\nServer root: %s\n' "$(date -u +%FT%TZ)" "$(uname -r)" "$server_root"
  printf 'Duration: %s s; interval: %s s\n' "$duration" "$interval"
  echo 'RSS is per process, not JavaScript heap. Worker threads share their host PID.'
  echo 'RSS sums may double-count shared pages. This does not measure Windows VmmemWSL.'
  echo 'Empty process samples may mean VS Code is closed, inaccessible, or outside this environment.'
  echo 'Installed extension directories below are not proof of which version is active:'
  if [[ -d "$server_root/extensions" ]]; then
    find "$server_root/extensions" -maxdepth 1 -type d \( -name 'dylee.dynsight-*' -o -name 'ms-vscode.cpptools-*' \) -printf '%f\n'
  fi
} > "$output/info.txt"

# Keep recently written diagnostic journals and bounded VS Code log tails. Re-scan
# on restart; do not attach a debugger, read source files, or record command lines.
copy_logs() {
  local base relative file target
  for base in "$server_root/data/User/workspaceStorage" "$server_root/data/logs"; do
    [[ -d $base ]] || continue
    while IFS= read -r -d '' file; do
      relative=${file#"$server_root/data/"}
      target="$output/logs/$relative"
      mkdir -p -- "$(dirname -- "$target")"
      if tail -c 262144 -- "$file" > "$target.tmp" 2>/dev/null; then
        mv -- "$target.tmp" "$target"
      else
        rm -f -- "$target.tmp"
      fi
    done < <(find "$base" -type f -mmin -2 \( -path '*/dylee.dynsight/diagnostics/*.jsonl' -o -name remoteagent.log -o -name exthost.log \) -print0 2>/dev/null)
  done
}

sample() {
  local stamp proc executable command role
  stamp=$(date -u +%FT%TZ)
  awk -v at="$stamp" '
    $1=="MemTotal:" {total=$2} $1=="MemAvailable:" {available=$2}
    $1=="SwapTotal:" {totalSwap=$2} $1=="SwapFree:" {freeSwap=$2}
    END {printf "%s\t%s\t%s\t%s\t%s\n",at,total,available,totalSwap,freeSwap}
  ' /proc/meminfo >> "$output/system.tsv"
  for proc in /proc/[0-9]*; do
    executable=''
    { IFS= read -r -d '' executable < "$proc/cmdline"; } 2>/dev/null || continue
    case "$executable" in
      *"$server_root/"*|*'/.vscode-server/'*|*'/.vscode-server-insiders/'*|*cpptools*|*/node|node) ;;
      *) continue ;;
    esac
    command=$(tr '\0' ' ' < "$proc/cmdline" 2>/dev/null) || continue
    case "$command" in
      *--type=extensionHost*|*extensionHostProcess.js*) role=extension-host ;;
      *cpptools-srv*) role=cpptools-srv ;;
      *cpptools*) role=cpptools ;;
      *"$server_root/"*|*'/.vscode-server/'*|*'/.vscode-server-insiders/'*) role=vscode-server-other ;;
      *) continue ;;
    esac
    awk -v at="$stamp" -v pid="${proc##*/}" -v role="$role" -v exe="$executable" '
      FILENAME ~ /\/stat$/ {sub(/^.*\) /, ""); split($0,stat," "); start=stat[20]; next}
      $1=="PPid:" {ppid=$2} $1=="VmRSS:" {rss=$2} $1=="VmHWM:" {peak=$2}
      $1=="VmSwap:" {swap=$2} $1=="Threads:" {threads=$2}
      END {if(start!="" && rss!="") printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n",at,pid,start,ppid,role,rss,peak,swap,threads,exe}
    ' "$proc/stat" "$proc/status" >> "$output/processes.tsv" 2>/dev/null || true
  done
}

finish() {
  copy_logs
  printf 'Stopped UTC: %s\n' "$(date -u +%FT%TZ)" >> "$output/info.txt"
  printf '\nSaved: %s\n' "$output"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'Recording for %s seconds. Output: %s\n' "$duration" "$output"
printf 'Reproduce Ctrl+T and Ctrl+Shift+O separately. Ctrl+C stops recording.\n'
started=$SECONDS
next_logs=$SECONDS
while (( SECONDS - started < duration )); do
  sample
  if (( SECONDS >= next_logs )); then copy_logs; next_logs=$((SECONDS + 30)); fi
  remaining=$((duration - (SECONDS - started)))
  (( remaining > 0 )) || break
  delay=$interval
  (( delay <= remaining )) || delay=$remaining
  sleep "$delay"
done
