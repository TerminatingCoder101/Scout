# Shared helpers for the board scripts. Source it, don't run it.
# Sets ROOT, BOARD_REPO, and (if it exists) BOARD_ISSUE. Moves into ROOT.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

die() { echo "error: $*" >&2; exit 1; }

command -v gh >/dev/null || die "gh is not installed (macOS: brew install gh, then gh auth login)"
command -v jq >/dev/null || die "jq is not installed (macOS: brew install jq)"

[ -f .board_repo ] || die ".board_repo is missing"
BOARD_REPO="$(tr -d '[:space:]' < .board_repo)"
case "$BOARD_REPO" in
  ''|OWNER/*) die ".board_repo still has the placeholder. Put the private repo name in it, e.g. yourname/Scout-board";;
  */*) ;;
  *) die ".board_repo must look like owner/repo, got '$BOARD_REPO'";;
esac

BOARD_ISSUE=""
[ -f .board_issue ] && BOARD_ISSUE="$(tr -d '[:space:]' < .board_issue)"

need_issue() {
  [ -n "$BOARD_ISSUE" ] || die ".board_issue is missing. One teammate runs scripts/setup_board.sh first, then pulls"
}
need_user() {
  [ -n "${AGENT_USER:-}" ] || die "AGENT_USER is not set. Run: export AGENT_USER=<your-github-username>"
}
