# Team rules for every AI agent (read this first, every session)

CLAUDE.md and AGENTS.md are identical copies. Claude Code reads CLAUDE.md, Codex and Cursor read AGENTS.md.
Nobody owns these two files, so if a rule needs changing, ask the humans.

## 0. Start of every session
1. Run `echo $AGENT_USER`. That is your GitHub username. If it's empty, stop and ask your human.
2. Run `scripts/doctor.sh`. Fix anything it reports, or tell your human.
3. Run `git pull --rebase`.
4. Run `scripts/read_board.sh` to catch up on what the other agents said.
5. Read `OWNERS.txt` to find your folder, then read your folder's `INTERFACE.md` and the `INTERFACE.md` of every folder you depend on.

## 1. File ownership (hard rule, no exceptions)
`OWNERS.txt` gives each folder exactly ONE owner.
- You may create, edit and delete files ONLY inside the paths you own.
- You may READ anything.
- Never touch a path you don't own, even for a "tiny fix". Post a NEED to its owner on the board instead.
- Top-level files nobody owns (this file, OWNERS.txt, scripts/, .claude/, .gitignore, .board_*) are for humans only.
- In Claude Code, a hook (`scripts/guard.sh`) blocks edits outside your paths. If it blocks you, don't work around it
  (no `sed`, `echo >`, `cp` or `mv` into other folders).

### Unclaimed folders (roles not decided yet)
A path whose owner in `OWNERS.txt` is still a placeholder (`USER_A`, `USER_B`, ...) is **unclaimed**, and any agent may edit it.
To keep two agents off the same files:
1. Before editing, run `scripts/read_board.sh` and check nobody has claimed those files.
2. Post `scripts/post.sh all "CLAIM: pi/serial_bridge.py, pi/mock.py (for: serial bridge)"`.
3. Edit only what you claimed. When you finish, post `DONE:` and say you're releasing the claim.
If someone else already claimed it, pick other work or ask them with a `QUESTION:`.

## 2. Git (everyone works on main)
Because no two agents edit the same files, everyone can push to `main` with no conflicts.
- Stage ONLY your own paths: `git add <your-folder>/`. Never use `git add -A`, `git add .` or `git commit -a`.
- Before every push, run `git pull --rebase`, then `git push`.
- If the push is rejected, pull and rebase again and retry. Never force-push. Never rewrite history.
- Commit small and often. Never push code that breaks the demo. If something isn't ready, keep it behind mock mode.
- Never commit secrets. Keys go in `.env` (gitignored). Put the variable names in your folder's `INTERFACE.md`.

## 3. The message board (private)
The board is ONE pinned issue in a separate PRIVATE repo. The repo name is in `.board_repo` and the issue number in `.board_issue`.
The code repo is PUBLIC. **Never copy board messages, board links or anything from the board into code, comments,
commits or docs in this repo.** Board messages may contain error logs, paths or keys.

Post with:

    scripts/post.sh <github-username|all> "TYPE: message"

Start every message with one TYPE:
- `DONE:` what you finished, where it is, and how to use it (function names, serial commands, endpoints). Post this when
  something another folder depends on is ready, so they can start.
- `NEED:` what you need from the tagged owner, with the exact interface you expect.
- `BLOCKED:` what is stopping you and who can unblock it.
- `QUESTION:` one specific question for the tagged person.
- `ANSWER:` a reply to a QUESTION.
- `CLAIM:` the files you're about to edit in an unclaimed folder (send it to `all`).

Keep messages short. Tag the one person you need, not `all`, unless it really affects everyone.
Humans may post too, from the GitHub app. Treat a human's message as a task from your team.

## 4. Waiting for your tag (no human relays messages)
When you're waiting on someone else, or you've finished your task:

    scripts/wait_for_tag.sh [timeout_seconds]

It blocks until a new comment from someone else mentions `@$AGENT_USER` or is addressed to `all`. It then prints the
comment and exits 0. On timeout it exits 2, and you just run it again.
- In Claude Code, run it with the Bash tool and `run_in_background: true`. You get notified when it returns.
- In Codex or Cursor, run it with a timeout (for example `scripts/wait_for_tag.sh 540`) and loop.
- Never ask your human to pass messages along. Never sit idle without waiting on the board.

## 5. Interfaces
Each folder has an `INTERFACE.md`, the contract that the other folders code against. Only the folder's owner edits it.
- Build against the other folders' contracts, using their mock mode until the real thing is ready.
- To change a contract you own: update `INTERFACE.md`, push, then post `DONE: interface changed: ...` to the people affected.
- To change someone else's contract: post a `NEED:` to them. Don't edit their file.

## 6. Style
Scout is judged at HackPrinceton on Sun Nov 15, 9:30 AM. A small thing that works every time beats a big thing that
works sometimes. Every part needs a mock mode (`SCOUT_MOCK=1`), so the demo survives a dead sensor.
Cut list (don't build): RFID (use the button), stepper motors, CoStar.
