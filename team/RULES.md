# Agent board rules (read this first, every session)

This is for agents that collaborate through the private message board. Everything board-related lives in `team/`,
so it never gets in the way of the project code. Only humans edit files in `team/`, `AGENTS.md` and `CLAUDE.md`.

## 0. Start of every session
1. Run `echo $AGENT_USER`. That is your GitHub username. If it's empty, stop and ask your human.
2. Run `team/scripts/doctor.sh`. Fix anything it reports, or tell your human.
3. Run `git pull --rebase`, then `git log --oneline -10` to see what teammates pushed.
4. Run `team/scripts/read_board.sh` to catch up on the board.
5. Read `team/OWNERS.txt` (who owns what) and `team/BACKLOG.md` (what's left to do).
   For the code itself, read `README.md`, `docs/HARDWARE.md` and `docs/TESTING.md`.

## 1. Who edits what
- `team/OWNERS.txt` maps code paths to roles. A path whose owner is still a `USER_*` placeholder is **unclaimed**.
- **Paths owned by someone else:** read only. Post a `NEED:` to the owner instead of editing.
- **Unclaimed or unlisted paths:** anyone may edit, but **CLAIM first**:
  1. Run `team/scripts/read_board.sh` and check nobody has claimed those files.
  2. Run `team/scripts/post.sh all "CLAIM: backend/scout/vision.py (for: Gemini retry on timeout)"`.
  3. Edit only what you claimed. When you finish, post `DONE: ... releasing claim`.
  If someone already claimed it, pick other work or ask them with a `QUESTION:`.
- **Never edit** `team/`, `AGENTS.md` or `CLAUDE.md`. Those are for humans.
- If your human enabled the optional guard hook (see `team/SETUP.md`) and it blocks you, don't work around it.

## 2. Git (everyone works on main)
- Stage only the files you changed: `git add <paths>`. Never `git add -A`, `git add .` or `git commit -a`.
- Before every push: `git pull --rebase`, look at what's new (`git log --oneline ORIG_HEAD..HEAD`), make sure it
  doesn't clash with your change, then `git push`.
- If you touched `backend/`, run `.venv/bin/pytest -q`. If you touched `frontend/`, run `npm --prefix frontend test`.
  Don't push if they fail.
- Never force-push or rewrite history. Never push something that breaks the simulator demo.
- Never commit secrets. Keys belong in the app's Settings or in `.env` (gitignored).

## 3. The message board (private)
The board is ONE pinned issue in a separate PRIVATE repo (`team/board_repo`, issue number in `team/board_issue`).
The code repo is PUBLIC. **Never copy board messages, board links or anything from the board into code, comments,
commits or docs.** Board messages may contain error logs, paths or keys.

    team/scripts/post.sh <github-username|all> "TYPE: message"

Start every message with one TYPE:
- `DONE:` what you finished, where it is, and how to use it. Tag whoever depends on it.
- `NEED:` what you need from the tagged person, with the exact interface you expect.
- `BLOCKED:` what is stopping you and who can unblock it.
- `QUESTION:` / `ANSWER:` one specific question or its reply.
- `CLAIM:` the files you're about to edit (send to `all`).

Keep messages short. Tag the one person you need, not `all`, unless it really affects everyone.
Humans post too, from the GitHub app. Treat a human's message as a task from your team.

## 4. Staying busy
`team/BACKLOG.md` lists the work left, by role. When you finish something:
1. Post `DONE:` to whoever depends on it.
2. `CLAIM:` and start the next item for your role (or any unclaimed item if you have no role yet).
3. If something you need isn't ready, use the simulator (Demo simulator in the app) instead of waiting.
4. Only when nothing is left, or everything is blocked, run
   `team/scripts/post.sh all "QUESTION: my backlog is done, what should I take next?"` and wait (section 5).
Your human may be busy with physical work (wiring, cardboard, interviews). Keep going without them.

## 5. Waiting for your tag (no human relays messages)
    team/scripts/wait_for_tag.sh [timeout_seconds]
It blocks until a new comment from someone else mentions `@$AGENT_USER` or starts with `to: all`, then prints it and
exits 0. On timeout it exits 2, so run it again.
- In Claude Code, run it with the Bash tool and `run_in_background: true`. You get notified when it returns.
- In Codex or Cursor, run it with a timeout (for example `team/scripts/wait_for_tag.sh 540`) and loop.
- Never ask your human to pass messages along.

## 6. Contracts between parts
The contracts already exist in the code and docs:
- Arduino ⇄ laptop serial JSON: `docs/HARDWARE.md` section 5, and `firmware/scout_radar/scout_radar.ino`.
- Backend ⇄ frontend HTTP/SSE API: http://127.0.0.1:8000/api/docs while the app runs.
- Digital twin import format: `docs/twin.example.json`.
To change one: update the code, its doc and its tests together, then post `DONE: contract changed: ...` to everyone affected.

## 7. Style
Due on Devpost Sun Nov 15, 8:30 AM ET (hard feature freeze Sat 2:00 AM), and judged at 9:30 AM.
A small thing that works every time beats a big thing that works sometimes. Keep the simulator demo working at all times.
Never fabricate data, test results, interviews, accuracy numbers or sponsor claims. Label demo and simulated values as such.
