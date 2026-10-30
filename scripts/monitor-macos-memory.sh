#!/usr/bin/env bash
# Read-only macOS sampling. Run outside VS Code's Extension Host.
set -euo pipefail
usage() {
  echo 'Usage: bash monitor-macos-memory.sh [NEW_OUTPUT_DIR] [DURATION_SECONDS=1800] [INTERVAL_SECONDS=2]'
  echo 'Ctrl+C stops and preserves logs. VSCODE_USER_DATA_DIR overrides the Code data directory.'
}
if [[ ${1:-} == --help ]]; then usage; exit 0; fi
if (( $# > 3 )); then usage >&2; exit 2; fi
duration=${2:-1800}
interval=${3:-2}
for value in "$duration" "$interval"; do
  if [[ ! $value =~ ^[1-9][0-9]{0,5}$ ]]; then echo 'Duration and interval must be positive integers of at most six digits.' >&2; exit 2; fi
done
if [[ $(uname -s) != Darwin ]]; then echo 'Run this script on macOS.' >&2; exit 1; fi
umask 077
if [[ -n ${1:-} ]]; then output=$1; mkdir -- "$output";
else output=$(mktemp -d "${TMPDIR:-/tmp}/dynsight-memory.XXXXXX"); fi
output=$(cd -- "$output" && pwd)
data_root=${VSCODE_USER_DATA_DIR:-"$HOME/Library/Application Support/Code"}
printf 'timestamp_utc\tpid\tppid\trole\trss_kib\tvsz_kib\telapsed\tstarted_local\texecutable\n' > "$output/processes.tsv"
printf 'timestamp_utc\tevent\n' > "$output/events.tsv"
{
  printf 'Started UTC: %s\nKernel: %s\nCode data: %s\n' "$(date -u +%FT%TZ)" "$(uname -r)" "$data_root"
  printf 'Duration: %s s; interval: %s s\nRAM bytes: ' "$duration" "$interval"
  sysctl -n hw.memsize
  echo 'RSS is resident process memory; VSZ is virtual address space, not RAM usage.'
  echo 'code-plugin includes helper processes. Match the journal pid to identify the Dynsight host.'
  echo 'Worker threads share the host PID/RSS; their last heap sample can be stale while idle.'
  echo 'Installed extension directories (not proof of active version):'
  for dir in "$HOME"/.vscode/extensions/dylee.dynsight-* "$HOME"/.vscode/extensions/ms-vscode.cpptools-*; do
    if [[ -d $dir ]]; then basename -- "$dir"; fi
  done
} > "$output/info.txt"

copy_logs() {
  local base file relative target
  for base in "$data_root/User/workspaceStorage" "$data_root/logs"; do
    [[ -d $base ]] || continue
    while IFS= read -r -d '' file; do
      relative=${file#"$data_root/"}; target="$output/logs/$relative"
      mkdir -p -- "$(dirname -- "$target")"
      if tail -c 262144 -- "$file" > "$target.tmp" 2>/dev/null; then mv -- "$target.tmp" "$target";
      else rm -f -- "$target.tmp"; fi
    done < <(find "$base" -type f -mmin -2 \( -path '*/dylee.dynsight/diagnostics/*.jsonl' -o -name exthost.log -o -name main.log \) -print0 2>/dev/null)
  done
}
sample() {
  local stamp
  stamp=$(date -u +%FT%TZ)
  LC_ALL=C ps -axo pid=,ppid=,rss=,vsz=,etime=,lstart=,comm= | awk -v at="$stamp" '
    {
      exe=$11; for(i=12;i<=NF;i++) exe=exe " " $i
      if(exe ~ /\/cpptools-srv/) role="cpptools-srv"
      else if(exe ~ /\/cpptools$/) role="cpptools"
      else if(exe ~ /Visual Studio Code[^\/]*\.app\//) {
        if(exe ~ /Code Helper \(Plugin\)/) role="code-plugin"
        else if(exe ~ /Code Helper \(Renderer\)/) role="code-renderer"
        else role="code-other"
      } else next
      started=$6 " " $7 " " $8 " " $9 " " $10
      printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n",at,$1,$2,role,$3,$4,$5,started,exe
    }
  ' >> "$output/processes.tsv"
  {
    printf '%s\n' "$stamp"
    vm_stat
    sysctl vm.swapusage
  } >> "$output/system.txt"
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
