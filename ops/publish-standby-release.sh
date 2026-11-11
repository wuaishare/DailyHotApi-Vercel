#!/usr/bin/env bash
# Only the trusted default-branch scheduler may write public Release assets.
set -euo pipefail
shopt -s nullglob
repo=wuaishare/DailyHotApi-Vercel
if [[ "${GITHUB_REPOSITORY:-}" != "$repo" ||
      "${GH_REPO:-}" != "$repo" ||
      "${GITHUB_REF:-}" != 'refs/heads/master' ||
      ( "${GITHUB_EVENT_NAME:-}" != schedule && "${GITHUB_EVENT_NAME:-}" != workflow_dispatch ) ]]; then
  echo "::error::Release publisher restricted to default-branch schedule/dispatch" >&2
  exit 2
fi
if [[ -z "${GH_TOKEN:-}" || -z "${RUNNER_TEMP:-}" ]]; then
  echo "::error::Missing authorized GitHub release execution environment" >&2
  exit 2
fi
files=("$RUNNER_TEMP"/hotapi-standby/*.json)
if (( ${#files[@]} == 0 )); then
  echo "::error::No verified snapshot; preserving last cloud release" >&2
  exit 1
fi
tag=cloud-standby-v1
previous_dir="$RUNNER_TEMP/hotapi-standby-last-good"
mkdir -p "$previous_dir"
# The public Release and its seven last-good assets already exist. An
# unsuccessful view can mean 404, denied permissions or transient GitHub API
# failure; never reinterpret it as permission to create a different Release.
# Initial bootstrap is a separate reviewed operation, not a cron side effect.
if ! gh release view "$tag" >/dev/null 2>&1; then
  echo "::error::Cannot verify existing cloud Release; refusing create/upload" >&2
  exit 1
fi
# Fail closed if prior known-good assets cannot be read.
gh release download "$tag" --pattern '*.json' --dir "$previous_dir" --clobber
updated=0
kept=0
for snapshot in "${files[@]}"; do
  asset="$(basename "$snapshot")"
  verdict="$(node ops/compare-release-snapshot.mjs "$snapshot" "$previous_dir/$asset")"
  if [[ "$verdict" == KEEP ]]; then
    echo "PRESERVED $asset (no newer upstream updateTime)"
    kept=$((kept+1))
    continue
  fi
  if [[ "$verdict" != PUBLISH ]]; then
    echo "::error::Snapshot admission refused for $asset" >&2
    exit 1
  fi
  gh release upload "$tag" "$snapshot" --clobber
  echo "PUBLISHED $asset"
  updated=$((updated+1))
done
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  echo "Cloud assets updated=$updated preserved=$kept; no Vercel deployment." >> "$GITHUB_STEP_SUMMARY"
fi
