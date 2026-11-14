import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from .config import DATA


def now():
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connection():
    conn = sqlite3.connect(DATA / "scout.db", timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init():
    with connection() as db:
        db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS twins(id TEXT PRIMARY KEY, document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS scans(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL, document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, scan_id TEXT NOT NULL, created_at TEXT NOT NULL, kind TEXT NOT NULL, document TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS events_scan ON events(scan_id,id);
        CREATE TABLE IF NOT EXISTS trials(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, document TEXT NOT NULL);
        """)
        demo = dict(
            id="princeton-demo",
            name="Nassau Hall · East entrance",
            location="Princeton, NJ · Demonstration fixture",
            source="demo",
            source_reference="Illustrative twin — not a live CoStar or Matterport record",
            width_in=36.0,
            running_slope_deg=3.5,
            cross_slope_deg=0.4,
            captured_at="2026-11-13",
        )
        db.execute(
            "INSERT OR IGNORE INTO twins VALUES (?,?)", (demo["id"], json.dumps(demo))
        )
        # A single-process laptop service cannot resume physical movement after a restart.
        for row in db.execute(
            "SELECT * FROM scans WHERE status IN ('queued','running')"
        ).fetchall():
            doc = json.loads(row["document"])
            doc.update(
                status="interrupted",
                error="Server restarted. Start a new inspection.",
                completed_at=now(),
            )
            db.execute(
                "UPDATE scans SET status=?,document=? WHERE id=?",
                ("interrupted", json.dumps(doc), row["id"]),
            )


def twins():
    with connection() as db:
        return [
            json.loads(r[0])
            for r in db.execute("SELECT document FROM twins ORDER BY id")
        ]


def get_twin(id):
    with connection() as db:
        row = db.execute("SELECT document FROM twins WHERE id=?", (id,)).fetchone()
        return json.loads(row[0]) if row else None


def put_twin(doc):
    with connection() as db:
        db.execute(
            "INSERT INTO twins VALUES (?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
            (doc["id"], json.dumps(doc)),
        )
    return doc


def save_scan(doc):
    with connection() as db:
        db.execute(
            "INSERT INTO scans VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,document=excluded.document",
            (doc["id"], doc["created_at"], doc["status"], json.dumps(doc)),
        )


def get_scan(id):
    with connection() as db:
        row = db.execute("SELECT document FROM scans WHERE id=?", (id,)).fetchone()
        return json.loads(row[0]) if row else None


def scans():
    with connection() as db:
        return [
            json.loads(r[0])
            for r in db.execute(
                "SELECT document FROM scans ORDER BY created_at DESC LIMIT 100"
            )
        ]


def add_event(id, kind, data):
    timestamp = now()
    with connection() as db:
        cur = db.execute(
            "INSERT INTO events(scan_id,created_at,kind,document) VALUES (?,?,?,?)",
            (id, timestamp, kind, json.dumps(data)),
        )
        return dict(id=cur.lastrowid, created_at=timestamp, kind=kind, data=data)


def events(id, after=0):
    with connection() as db:
        return [
            dict(
                id=r["id"],
                created_at=r["created_at"],
                kind=r["kind"],
                data=json.loads(r["document"]),
            )
            for r in db.execute(
                "SELECT * FROM events WHERE scan_id=? AND id>? ORDER BY id LIMIT 1000",
                (id, after),
            )
        ]


def add_trial(doc):
    with connection() as db:
        cur = db.execute(
            "INSERT INTO trials(created_at,document) VALUES (?,?)",
            (now(), json.dumps(doc)),
        )
    return dict(id=cur.lastrowid, **doc)


def trials():
    with connection() as db:
        return [
            dict(id=r["id"], created_at=r["created_at"], **json.loads(r["document"]))
            for r in db.execute("SELECT * FROM trials ORDER BY id DESC LIMIT 500")
        ]
