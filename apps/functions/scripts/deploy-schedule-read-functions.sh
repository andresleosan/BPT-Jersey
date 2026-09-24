#!/usr/bin/env bash
# Deploys only the 13 schedule read callables that stopped consuming App Check tokens
# (runbook docs/runbooks/2026-09-25-app-check-y-duplicados-regyfit.md, part B).
# Usage, from the repo root: bash apps/functions/scripts/deploy-schedule-read-functions.sh --project bptjersey-f5a25
set -euo pipefail

readonly expected_project="bptjersey-f5a25"
readonly functions=(
  listScheduleCatalog
  listClasses
  listSessions
  getDailyOperationsDashboard
  listSessionBookedCounts
  listSessionBookings
  listStudentBookings
  listSessionAttendance
  listStudentAttendance
  listAttendanceHistory
  listSessionCheckouts
  getStudentCheckout
  getSessionOperationalView
)

if [[ $# -ne 2 || $1 != "--project" || $2 != "$expected_project" ]]; then
  echo "Usage: $0 --project $expected_project" >&2
  exit 1
fi

only=""
for name in "${functions[@]}"; do
  only+="${only:+,}functions:${name}"
done

echo "Project: $2"
echo "Functions to deploy (${#functions[@]}):"
printf '  %s\n' "${functions[@]}"
read -r -p "Deploy these ${#functions[@]} functions to $2? [y/N] " answer
if [[ $answer != "y" && $answer != "Y" ]]; then
  echo "Cancelled. Nothing deployed."
  exit 1
fi

corepack pnpm exec firebase deploy --only "$only" --project "$2"
