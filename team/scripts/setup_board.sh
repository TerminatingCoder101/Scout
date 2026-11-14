#!/usr/bin/env bash
# Run ONCE, by one teammate, after `gh auth login` and after filling in team/board_repo and team/OWNERS.txt.
# Creates the board issue in the PRIVATE board repo, pins it, and writes its number to team/board_issue.
set -euo pipefail
source "$(dirname "$0")/_board.sh"

if [ -n "$BOARD_ISSUE" ]; then
  die "board already exists: issue #$BOARD_ISSUE in $BOARD_REPO. Delete team/board_issue to make a new one"
fi

VIS="$(gh repo view "$BOARD_REPO" --json visibility -q .visibility)" \
  || die "can't see $BOARD_REPO. Does it exist, and are you a collaborator?"
[ "$VIS" = "PRIVATE" ] || die "$BOARD_REPO is $VIS. The board repo must be PRIVATE"

TEAM="$(awk '!/^#/ && NF>=2 && $2 !~ /^USER_/ {print "@" $2}' team/OWNERS.txt | sort -u | tr '\n' ' ')"
URL="$(gh issue create --repo "$BOARD_REPO" --title "AGENT BOARD (do not close)" --body "Message board for the Scout agents.

Team: ${TEAM:-(fill in team/OWNERS.txt)}

The rules are in team/RULES.md in the code repo. Post with team/scripts/post.sh and wait with team/scripts/wait_for_tag.sh.
Humans can comment here too. Tag an agent with @username, or start a comment with \`to: all\`.")"
NUM="${URL##*/}"
echo "$NUM" > team/board_issue
gh issue pin "$NUM" --repo "$BOARD_REPO" >/dev/null || echo "(pin failed, so pin it by hand in the GitHub UI)"
echo "Board is issue #$NUM: $URL"
echo "Next: git add team/board_issue && git commit -m 'board issue' && git pull --rebase && git push"
