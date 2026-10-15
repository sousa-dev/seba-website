#!/usr/bin/env bash
# Publish the website: privacy check -> build -> commit -> push to main -> wait for the
# GitHub Pages deploy -> DM Henrique on Slack with what changed.
#
# Usage: scripts/publish.sh "<commit title>" "<what changed, 1-3 short lines, for Henrique>"
# Example: scripts/publish.sh "New post: The night shift" "New blog post: *The night shift* — a short story about cron jobs."
set -euo pipefail
cd "$(dirname "$0")/.."

TITLE="${1:?usage: publish.sh \"<commit title>\" \"<summary for Henrique>\"}"
SUMMARY="${2:?usage: publish.sh \"<commit title>\" \"<summary for Henrique>\"}"
SITE="https://seba.sousadev.com"
HENRIQUE="user:U0B3T2XQCT1"
REPO="sousa-dev/seba-website"

dm() { openclaw message send --channel slack --target "$HENRIQUE" --message "$1" >/dev/null || echo "WARN: Slack DM failed - tell Henrique yourself, don't retry the script"; }

git pull -q --rebase origin main 2>/dev/null || true   # Henrique may edit on GitHub
[ -d node_modules ] || npm ci --silent

node scripts/privacy-check.mjs --text "$TITLE"
npm run build --silent >/dev/null

git add -A
if git diff --cached --quiet; then
  if [ -z "$(git log origin/main..HEAD --oneline 2>/dev/null || git log --oneline)" ]; then
    echo "Nothing to publish."; exit 0
  fi
else
  git commit -q -m "$TITLE"
fi
git push -q origin main     # pre-push hook re-runs the privacy check
SHA=$(git rev-parse HEAD)
echo "Pushed ${SHA:0:7}. Waiting for the deploy..."

RUN=""
for _ in $(seq 1 30); do
  RUN=$(gh run list -R "$REPO" --commit "$SHA" --workflow deploy.yml --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
  [ -n "$RUN" ] && break; sleep 4
done
if [ -n "$RUN" ] && gh run watch "$RUN" -R "$REPO" --exit-status >/dev/null 2>&1; then
  dm "🤖 *S.E.B.A website updated* — ${SITE}
${SUMMARY}
_commit ${SHA:0:7}: ${TITLE}_"
  echo "✓ Live at $SITE — Henrique notified."
else
  dm "🤖 *S.E.B.A website* — I pushed \"${TITLE}\" but the deploy failed or timed out. Checking it. https://github.com/${REPO}/actions"
  echo "✗ Deploy failed or timed out. Inspect: gh run view ${RUN:-<id>} -R $REPO --log-failed"; exit 1
fi
