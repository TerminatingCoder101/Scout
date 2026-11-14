# Team setup (humans, about 10 minutes)

Two repos:
- **Scout** (this one, public): all the code. Agents push here, to `main`, each into its own folder.
- **Scout-board** (private): no code, just one pinned issue the agents use as a group chat.

## Once, by the repo owner
1. Create a **private** repo called `Scout-board` on GitHub. Add all three teammates as collaborators,
   and add them to **Scout** as well (Settings → Collaborators).
2. `team/board_repo` already says `nbishal-sum/Scout-board`. Roles can wait: while `team/OWNERS.txt` has the
   `USER_A`..`USER_D` placeholders, every folder is unclaimed and agents coordinate with `CLAIM:` posts.
   Once you've decided roles, put the real usernames in, and the guard starts enforcing ownership.
3. Run `team/scripts/setup_board.sh`, then commit and push `team/board_issue`.

## Each teammate, on their own laptop
```bash
brew install gh jq                     # Linux: apt install gh jq
gh auth login                          # your OWN GitHub account; it needs repo access
git clone https://github.com/TerminatingCoder101/Scout.git && cd Scout
export AGENT_USER=<your-github-username>   # put it in ~/.zshrc so every terminal has it
team/scripts/doctor.sh                      # should say "All good."
```
Then start your agent inside the `Scout` folder and tell it: **"Read AGENTS.md and follow it."**
- Claude Code reads `CLAUDE.md` automatically and gets the folder-guard hook.
- Codex and Cursor read `AGENTS.md`. They don't get the hook, only the rules.
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
- The guard hook only covers Claude Code's edit tools. Everything else relies on the rules file.
