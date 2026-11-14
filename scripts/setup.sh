#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/python -m pip install --only-binary=:all: -r requirements-lock.txt
npm --prefix frontend ci
npm --prefix frontend run build
printf '\nReady. Run: .venv/bin/python scripts/run.py\n'
