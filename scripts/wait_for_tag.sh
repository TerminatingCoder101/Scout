#!/usr/bin/env bash
# Usage: scripts/wait_for_tag.sh [timeout_seconds]     (0 or empty means wait forever)
# Blocks until a NEW board comment, written by someone else, mentions @$AGENT_USER or starts with "to: all".
# It prints that comment and exits 0. Exits 2 on timeout. Polls every $POLL_SECONDS (default 15).
# If several messages arrive, it returns the oldest one. Run it again to get the next.
# The first ever run starts from "now". Older messages are history, so use scripts/read_board.sh for those.
set -euo pipefail
source "$(dirname "$0")/_board.sh"
need_issue; need_user

TIMEOUT="${1:-0}"
POLL="${POLL_SECONDS:-15}"
mkdir -p .board_state
STATE=".board_state/${AGENT_USER}.last_id"
ME_LC="$(printf '%s' "$AGENT_USER" | tr '[:upper:]' '[:lower:]')"
API="repos/$BOARD_REPO/issues/$BOARD_ISSUE/comments"

fetch() {  # prints: id <TAB> author <TAB> base64(body), for comments with id > $1, oldest first
  gh api --paginate "$API?per_page=100" \
    --jq ".[] | select(.id > $1) | [.id, .user.login, (.body | @base64)] | @tsv"
}

if [ -f "$STATE" ]; then
  LAST="$(cat "$STATE")"
else
  LAST="$(fetch 0 | tail -n 1 | cut -f1)"; LAST="${LAST:-0}"
  echo "$LAST" > "$STATE"
fi

START=$(date +%s)
while true; do
  if ROWS="$(fetch "$LAST" 2>/dev/null)"; then
    while IFS=$'\t' read -r ID AUTHOR B64; do
      [ -z "${ID:-}" ] && continue
      LAST="$ID"; echo "$ID" > "$STATE"
      AUTHOR_LC="$(printf '%s' "$AUTHOR" | tr '[:upper:]' '[:lower:]')"
      [ "$AUTHOR_LC" = "$ME_LC" ] && [ "${ALLOW_SELF:-0}" != "1" ] && continue
      BODY="$(printf '%s' "$B64" | base64 --decode)"
      # mentions me (word-bounded, so @bob doesn't match @bobby), or is addressed to everyone
      if printf '%s' "$BODY" | grep -Eiq "@${ME_LC}([^a-z0-9-]|\$)" \
         || printf '%s' "$BODY" | head -n 1 | grep -Eiq '^to:[[:space:]]*all[[:space:]]*$'; then
        echo "--- new board message (comment $ID by @$AUTHOR) ---"
        printf '%s\n' "$BODY"
        exit 0
      fi
    done <<< "$ROWS"
  else
    echo "(board fetch failed, retrying in ${POLL}s)" >&2
  fi
  if [ "$TIMEOUT" -gt 0 ] && [ $(( $(date +%s) - START )) -ge "$TIMEOUT" ]; then
    echo "timeout: no new message for @$AGENT_USER. Run scripts/wait_for_tag.sh again."
    exit 2
  fi
  sleep "$POLL"
done
