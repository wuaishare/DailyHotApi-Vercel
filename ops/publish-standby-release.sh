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
if gh release view "$tag" >/dev/null 2>&1; then
  # Fail closed if prior known-good assets cannot be read.
  gh release download "$tag" --pattern '*.json' --dir "$previous_dir" --clobber
else
  gh release create "$tag" --target "$GITHUB_SHA" \
    --title "Public offsite standby snapshots" \
    --notes "Verified public ranking snapshots; not an independent live collector." \
    --latest=false
fi
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
