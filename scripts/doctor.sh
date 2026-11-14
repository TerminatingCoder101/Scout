#!/usr/bin/env bash
# Usage: scripts/doctor.sh
# Checks that this machine and agent are set up for the board. Changes nothing.
set -uo pipefail
cd "$(dirname "$0")/.."
ok()  { echo "  ok    $*"; }
bad() { echo "  FIX   $*"; FAIL=1; }
FAIL=0

echo "Scout board doctor"
command -v gh >/dev/null && ok "gh installed" || bad "install gh: brew install gh"
command -v jq >/dev/null && ok "jq installed" || bad "install jq: brew install jq"
if command -v gh >/dev/null; then
  LOGIN="$(gh api user -q .login 2>/dev/null)"
  [ -n "$LOGIN" ] && ok "gh logged in as @$LOGIN" || bad "run: gh auth login"
fi

if [ -n "${AGENT_USER:-}" ]; then
  ok "AGENT_USER=$AGENT_USER"
  [ -n "${LOGIN:-}" ] && [ "$(echo "$LOGIN" | tr A-Z a-z)" != "$(echo "$AGENT_USER" | tr A-Z a-z)" ] \
    && bad "AGENT_USER ($AGENT_USER) doesn't match your gh login ($LOGIN)"
  MINE="$(awk -v u="$(echo "$AGENT_USER" | tr A-Z a-z)" '!/^#/ && NF>=2 && tolower($2)==u {printf "%s ", $1}' OWNERS.txt)"
  [ -n "$MINE" ] && ok "you own: $MINE" || echo "  note  you don't own a folder yet, so you can work in unclaimed folders (CLAIM on the board first)"
else
  bad "run: export AGENT_USER=<your-github-username>"
fi

UNCLAIMED="$(awk '!/^#/ && $2 ~ /^USER_/ {printf "%s ", $1}' OWNERS.txt)"
[ -n "$UNCLAIMED" ] && echo "  note  unclaimed (anyone may edit): $UNCLAIMED"

REPO="$(tr -d '[:space:]' < .board_repo 2>/dev/null)"
case "$REPO" in
  ''|OWNER/*) bad ".board_repo still has the placeholder";;
  *) if command -v gh >/dev/null && VIS="$(gh repo view "$REPO" --json visibility -q .visibility 2>/dev/null)"; then
       [ "$VIS" = "PRIVATE" ] && ok "board repo $REPO is private and you can see it" || bad "board repo $REPO is $VIS, not PRIVATE"
     else
       bad "can't access $REPO. Ask its owner to add you as a collaborator"
     fi;;
esac
[ -s .board_issue ] && ok "board issue #$(cat .board_issue)" || bad ".board_issue is missing (run scripts/setup_board.sh once, or git pull)"

[ "$FAIL" = 0 ] && echo "All good." || echo "Fix the items above."
exit "$FAIL"
