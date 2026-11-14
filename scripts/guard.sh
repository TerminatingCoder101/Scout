#!/usr/bin/env bash
# Claude Code PreToolUse hook (wired in .claude/settings.json).
# Blocks Edit/Write/MultiEdit/NotebookEdit on files in this repo that $AGENT_USER doesn't own per OWNERS.txt.
# Reads the tool-call JSON on stdin. Exit 2 = block, and stderr goes back to the agent.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
INPUT="$(cat)"
FILE="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)"
[ -z "$FILE" ] && exit 0

case "$FILE" in /*) ABS="$FILE";; *) ABS="$PWD/$FILE";; esac
case "/$ABS/" in */../*|*/./*) echo "BLOCKED: use a plain path without '.' or '..' segments: $FILE" >&2; exit 2;; esac
ABS="${ABS/#\/private\/var\//\/var\/}"; ROOT_CMP="${ROOT/#\/private\/var\//\/var\/}"

# Outside this repo is not the team's business (scratch files, ~/.claude memory, and so on).
case "$ABS" in "$ROOT_CMP"/*|"$ROOT"/*) ;; *) exit 0;; esac
REL="${ABS#"$ROOT_CMP"/}"; REL="${REL#"$ROOT"/}"

case "$REL" in .board_state/*) exit 0;; esac

if [ -z "${AGENT_USER:-}" ]; then
  echo "BLOCKED: AGENT_USER is not set, so ownership can't be checked. Ask your human to export AGENT_USER and restart." >&2
  exit 2
fi
ME_LC="$(printf '%s' "$AGENT_USER" | tr '[:upper:]' '[:lower:]')"

OWNER_OF=""
while read -r P OWNER _; do
  case "$P" in ''|\#*) continue;; esac
  case "$P" in
    */) case "$REL" in "$P"*) OWNER_OF="$OWNER";; esac;;
    *)  [ "$REL" = "$P" ] && OWNER_OF="$OWNER";;
  esac
  if [ -n "$OWNER_OF" ]; then
    # Owner still a placeholder (USER_A..), so the folder is unclaimed and anyone may edit. Agents coordinate with CLAIM on the board.
    case "$OWNER_OF" in USER_*) exit 0;; esac
    [ "$(printf '%s' "$OWNER_OF" | tr '[:upper:]' '[:lower:]')" = "$ME_LC" ] && exit 0
    break
  fi
done < "$ROOT/OWNERS.txt"

if [ -n "$OWNER_OF" ]; then
  echo "BLOCKED: '$REL' belongs to @$OWNER_OF, not @$AGENT_USER. Ask them: scripts/post.sh $OWNER_OF \"NEED: ...\"" >&2
else
  echo "BLOCKED: '$REL' is a shared top-level file (humans only). Ask your human if it really needs to change." >&2
fi
exit 2
