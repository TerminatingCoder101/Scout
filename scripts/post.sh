#!/usr/bin/env bash
# Usage: scripts/post.sh <github-username|all> "TYPE: message"
# Posts a comment on the private board issue addressed to one person (tagged with @) or to all.
set -euo pipefail
source "$(dirname "$0")/_board.sh"
need_issue; need_user

TO="${1:?usage: scripts/post.sh <github-username|all> \"TYPE: message\"}"
MSG="${2:?usage: scripts/post.sh <github-username|all> \"TYPE: message\"}"
TO="${TO#@}"

# "all" is deliberately not written as an @mention, because that would notify a real GitHub user called "all".
if [ "$(printf '%s' "$TO" | tr '[:upper:]' '[:lower:]')" = "all" ]; then TAG="all"; else TAG="@$TO"; fi

BODY="to: ${TAG}
from: @${AGENT_USER}

${MSG}"

gh issue comment "$BOARD_ISSUE" --repo "$BOARD_REPO" --body "$BODY" >/dev/null
echo "posted to $BOARD_REPO#$BOARD_ISSUE for $TAG"
