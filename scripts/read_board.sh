#!/usr/bin/env bash
# Usage: scripts/read_board.sh [count]     (default 15)
# Prints the last N board comments, oldest first. Read-only. It doesn't change what wait_for_tag.sh has seen.
set -euo pipefail
source "$(dirname "$0")/_board.sh"
need_issue

N="${1:-15}"
gh api --paginate "repos/$BOARD_REPO/issues/$BOARD_ISSUE/comments?per_page=100" \
  | jq -rs --argjson n "$N" 'add // [] | .[-$n:][] | "=== \(.created_at) by @\(.user.login)\n\(.body)\n"'
