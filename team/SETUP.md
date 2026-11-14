# Team setup (humans, about 10 minutes)

Two repos:
- **Scout** (this one, public): all the code. Agents push here, to `main`. Board tooling stays inside `team/`.
- **Scout-board** (private): no code, just one pinned issue the agents use as a group chat.

## Once, by the repo owner
1. Create a **private** repo called `Scout-board` on GitHub. Add all three teammates as collaborators,
   and add them to **Scout** as well (Settings → Collaborators).
2. Done already: `team/board_repo` is `nbishal-sum/Scout-board`, and the board is issue #1.
3. Roles can wait. While `team/OWNERS.txt` has `USER_*` placeholders, agents coordinate with `CLAIM:` posts.
   Once you've decided roles, replace the placeholders with real usernames.

## Each teammate, on their own laptop
```bash
brew install gh jq                     # Linux: apt install gh jq
gh auth login                          # your OWN GitHub account; it needs repo access
git clone https://github.com/TerminatingCoder101/Scout.git && cd Scout
export AGENT_USER=<your-github-username>   # put it in ~/.zshrc so every terminal has it
team/scripts/doctor.sh                      # should say "All good."
```
Then start your agent inside the `Scout` folder and tell it:
**"Read team/RULES.md and follow it. Do the start-of-session steps, then take work from team/BACKLOG.md."**
- `AGENTS.md` and `CLAUDE.md` point agents to `team/RULES.md` automatically.

### Optional: the folder guard (Claude Code only)
Once roles are assigned, you can make Claude Code physically block edits outside your paths. It's per person and isn't
committed: put this in `.claude/settings.local.json` (gitignored):
```json
{"hooks": {"PreToolUse": [{"matcher": "Edit|Write|MultiEdit|NotebookEdit",
  "hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/team/scripts/guard.sh"}]}]}}
```
- A chat-only tab (ChatGPT or Claude on the web) can't run the scripts, so it can't use the board.

## Before you build: test one round trip
```bash
# teammate A
team/scripts/wait_for_tag.sh
# teammate B
team/scripts/post.sh <A-username> "QUESTION: can you hear me?"
```
A's terminal should print B's message within about 15 seconds.

## From your phone
Open Scout-board → the pinned issue in the GitHub app. Comment `@username do X` to give that agent a task,
or start a comment with the line `to: all` to reach everyone.

## Known limits
- An agent only notices a tag while it's running `wait_for_tag.sh`. An idle session won't react.
- Everyone needs their own GitHub account, because the scripts skip your own comments.
- The optional guard only covers Claude Code's edit tools. Everything else relies on the rules.
