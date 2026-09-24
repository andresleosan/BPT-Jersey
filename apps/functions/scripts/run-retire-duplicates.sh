#!/usr/bin/env bash
# Runs retire-duplicate-regyfit-series.mjs against production with the operator's service-account
# key, so the runbook's commands stay short (docs/runbooks/2026-09-25-app-check-y-duplicados-regyfit.md).
# Usage, from anywhere: bash apps/functions/scripts/run-retire-duplicates.sh dryrun|apply|verify
# BPT_SECRETS_DIR and BPT_RUNBOOK_DIR exist only so the wrapper can be tested without the real paths.
set -euo pipefail

readonly project="bptjersey-f5a25"
readonly academy="demo-academy"
readonly secrets_dir="${BPT_SECRETS_DIR:-/root/secrets}"
readonly runbook_dir="${BPT_RUNBOOK_DIR:-/root/bpt-runbook}"
readonly script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/retire-duplicate-regyfit-series.mjs"

mode="${1:-}"
case "$mode" in
  dryrun | verify) extra=() ;;
  apply) extra=(--apply) ;;
  *)
    echo "Usage: $0 dryrun|apply|verify" >&2
    exit 1
    ;;
esac

shopt -s nullglob
keys=("$secrets_dir"/*adminsdk*.json)
shopt -u nullglob
if [[ ${#keys[@]} -ne 1 ]]; then
  echo "Expected exactly one service-account key matching $secrets_dir/*adminsdk*.json, found ${#keys[@]}." >&2
  exit 1
fi

if [[ $mode == "apply" ]]; then
  read -r -p "Write to $project (academy $academy): stop the duplicate series and cancel their unbooked sessions? [y/N] " answer
  if [[ $answer != "y" && $answer != "Y" ]]; then
    echo "Cancelled. Nothing written."
    exit 1
  fi
fi

mkdir -p -m 700 "$runbook_dir"
output="$runbook_dir/$mode-$(date -u +%Y%m%dT%H%M%SZ).txt"
echo "Key: ${keys[0]##*/}"
echo "Output: $output"
GOOGLE_APPLICATION_CREDENTIALS="${keys[0]}" node "$script" \
  --project="$project" --academy="$academy" "${extra[@]}" 2>&1 | tee "$output"
