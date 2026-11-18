from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date, datetime, timedelta, timezone
from collections import defaultdict, deque
from pathlib import Path
import json
import re
import sqlite3
import os
import threading
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from . import planner

BACKEND_DIR = Path(__file__).resolve().parents[1]
# Single-database path, used by local scripts and tests that call the functions directly.
DB_PATH = Path(os.getenv("STUDY_DB_PATH", str(BACKEND_DIR / "study_planner.db")))
# Each tester's browser gets its own workspace: a separate SQLite file named by a random id.
DATA_DIR = Path(os.getenv("STUDY_DATA_DIR", str(BACKEND_DIR / "data")))
ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if origin.strip()]
MAX_WORKSPACES = int(os.getenv("MAX_WORKSPACES", "1000"))
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "240"))
WORKSPACE_ID = re.compile(r"^[a-f0-9]{32}$")

app = FastAPI(title="Study Planner API", version="1.1.0")
current_db = ContextVar("current_db", default=DB_PATH)
_ready = set()
_ready_lock = threading.Lock()
_hits = defaultdict(deque)
_hits_lock = threading.Lock()


def connect(path=None):
    db = sqlite3.connect(path or current_db.get())
    db.row_factory = sqlite3.Row
    return db


@contextmanager
def database(path=None):
    db = connect(path)
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def initialize(path=DB_PATH):
    path.parent.mkdir(parents=True, exist_ok=True)
    with database(path) as db:
        db.execute("""CREATE TABLE IF NOT EXISTS study_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            subject TEXT NOT NULL,
            due_date TEXT NOT NULL,
            estimated_minutes INTEGER NOT NULL,
            completed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS focus_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_key TEXT NOT NULL UNIQUE,
            task_title TEXT NOT NULL,
            subject TEXT NOT NULL,
            duration_minutes INTEGER NOT NULL,
            completed_at TEXT NOT NULL
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            kind TEXT NOT NULL,
            subject TEXT NOT NULL DEFAULT '',
            date TEXT,
            weekday INTEGER,
            start_time TEXT,
            end_time TEXT,
            location TEXT NOT NULL DEFAULT '',
            until TEXT,
            created_at TEXT NOT NULL
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS assistant_undo (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            label TEXT NOT NULL,
            snapshot TEXT NOT NULL,
            created_at TEXT NOT NULL
        )""")
        count = db.execute("SELECT COUNT(*) FROM study_tasks").fetchone()[0]
        if count == 0:
            seed_demo(db)


def seed_demo(db):
    """Load a realistic sample week, dated relative to today, so the demo never looks stale."""
    today = date.today()
    now = datetime.now(timezone.utc)
    # (title, subject, due in days, estimated minutes, completed)
    samples = [
        ("Summarise lecture notes", "Statistics", -2, 30, 1),
        ("Normalise the library schema", "Database Systems", -1, 40, 1),
        ("Finish probability problem set", "Statistics", -1, 50, 0),
        ("Review probability distributions", "Statistics", 0, 45, 0),
        ("Read chapter 4: REST design", "Computer Science", 0, 30, 1),
        ("Build a REST API revision sheet", "Computer Science", 1, 60, 0),
        ("Complete SQL practice set", "Database Systems", 2, 35, 0),
        ("Draft algorithms lab report", "Computer Science", 4, 90, 0),
        ("Flashcards: hypothesis testing", "Statistics", 5, 25, 0),
        ("Index tuning exercise", "Database Systems", 6, 45, 0),
    ]
    db.executemany(
        "INSERT INTO study_tasks(title,subject,due_date,estimated_minutes,completed,created_at) VALUES(?,?,?,?,?,?)",
        [(title, subject, (today + timedelta(days=due)).isoformat(), minutes, done, now.isoformat())
         for title, subject, due, minutes, done in samples],
    )
    # (days ago, task title, subject, minutes)
    sessions = [
        (6, "Summarise lecture notes", "Statistics", 25),
        (5, "Normalise the library schema", "Database Systems", 45),
        (5, "Normalise the library schema", "Database Systems", 20),
        (4, "Read chapter 4: REST design", "Computer Science", 30),
        (3, "Finish probability problem set", "Statistics", 45),
        (2, "Finish probability problem set", "Statistics", 25),
        (2, "Complete SQL practice set", "Database Systems", 15),
        (1, "Read chapter 4: REST design", "Computer Science", 40),
        (0, "Review probability distributions", "Statistics", 25),
    ]
    db.executemany(
        "INSERT INTO focus_sessions(session_key,task_title,subject,duration_minutes,completed_at) VALUES(?,?,?,?,?)",
        [(f"demo-{index}", title, subject, minutes, (now - timedelta(days=ago)).isoformat())
         for index, (ago, title, subject, minutes) in enumerate(sessions)],
    )
    # A sample timetable: weekly classes, one test and one academic-calendar date.
    term_start = (today - timedelta(days=today.weekday())).isoformat()
    timetable = [
        ("Statistics lecture", "class", "Statistics", term_start, 0, "09:00", "11:00", "Room B2"),
        ("Statistics lecture", "class", "Statistics", term_start, 2, "09:00", "11:00", "Room B2"),
        ("Database Systems lab", "class", "Database Systems", term_start, 1, "13:00", "15:00", "Lab 3"),
        ("Database Systems lab", "class", "Database Systems", term_start, 3, "13:00", "15:00", "Lab 3"),
        ("Computer Science seminar", "class", "Computer Science", term_start, 4, "10:00", "12:00", "Hall A"),
        ("Statistics test", "test", "Statistics", (today + timedelta(days=5)).isoformat(), None, "14:00", "15:30", "Room B2"),
        ("Mid-semester break begins", "event", "", (today + timedelta(days=9)).isoformat(), None, None, None, ""),
    ]
    db.executemany(
        "INSERT INTO events(title,kind,subject,date,weekday,start_time,end_time,location,until,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        [(*row, None, now.isoformat()) for row in timetable],
    )
    test = db.execute("SELECT * FROM events WHERE kind='test' ORDER BY id DESC LIMIT 1").fetchone()
    planner.plan_for_test(db, test, today, now.isoformat())


initialize()


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")


def _rate_limited(ip: str) -> bool:
    now = time.monotonic()
    with _hits_lock:
        window = _hits[ip]
        while window and now - window[0] > 60:
            window.popleft()
        if len(window) >= RATE_LIMIT_PER_MINUTE:
            return True
        window.append(now)
        return False


def _workspace_db(workspace: str):
    """Path to this workspace's database, created and seeded on first use. None when full."""
    path = DATA_DIR / f"ws_{workspace}.db"
    with _ready_lock:
        if path in _ready:
            return path
        if not path.exists():
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            if sum(1 for _ in DATA_DIR.glob("ws_*.db")) >= MAX_WORKSPACES:
                return None
        initialize(path)
        _ready.add(path)
        return path


@app.middleware("http")
async def workspace_scope(request: Request, call_next):
    path = request.url.path
    if request.method == "OPTIONS" or not path.startswith("/api/") or path == "/api/health":
        return await call_next(request)
    if _rate_limited(_client_ip(request)):
        return JSONResponse({"detail": "Too many requests. Wait a minute and try again."}, status_code=429)
    workspace = request.headers.get("x-workspace", "").lower()
    if not WORKSPACE_ID.match(workspace):
        return JSONResponse({"detail": "Missing or invalid workspace id."}, status_code=400)
    db_path = _workspace_db(workspace)
    if db_path is None:
        return JSONResponse({"detail": "StudyFlow's test is full right now. Please try again later."}, status_code=503)
    token = current_db.set(db_path)
    try:
        return await call_next(request)
    finally:
        current_db.reset(token)


# Added last so it wraps everything: error responses from the workspace check still carry CORS headers.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-Workspace"],
)


class TaskCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(min_length=2, max_length=120)
    subject: str = Field(min_length=2, max_length=60)
    due_date: date
    estimated_minutes: int = Field(ge=5, le=600)


class FocusSessionCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    session_key: str = Field(min_length=1, max_length=80)
    task_title: str = Field(min_length=2, max_length=120)
    subject: str = Field(min_length=2, max_length=60)
    duration_minutes: int = Field(ge=1, le=45)


def task_dict(row):
    return {**dict(row), "completed": bool(row["completed"])}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/tasks")
def list_tasks():
    with database() as db:
        # Sessions store the task title they were recorded against, so studied time joins on title.
        rows = db.execute(
            """SELECT t.*, COALESCE((SELECT SUM(s.duration_minutes) FROM focus_sessions s
                                     WHERE s.task_title = t.title AND s.subject = t.subject), 0) AS studied_minutes
               FROM study_tasks t ORDER BY t.completed, t.due_date, t.id"""
        ).fetchall()
    return [task_dict(row) for row in rows]


@app.post("/api/sessions", status_code=201)
def create_focus_session(session: FocusSessionCreate):
    completed_at = datetime.now(timezone.utc).isoformat()
    with database() as db:
        db.execute(
            "INSERT OR IGNORE INTO focus_sessions(session_key,task_title,subject,duration_minutes,completed_at) VALUES(?,?,?,?,?)",
            (session.session_key, session.task_title, session.subject, session.duration_minutes, completed_at),
        )
        row = db.execute("SELECT * FROM focus_sessions WHERE session_key=?", (session.session_key,)).fetchone()
    return dict(row)


@app.post("/api/tasks", status_code=201)
def create_task(task: TaskCreate):
    with database() as db:
        cursor = db.execute(
            "INSERT INTO study_tasks(title,subject,due_date,estimated_minutes,created_at) VALUES(?,?,?,?,?)",
            (task.title, task.subject, task.due_date.isoformat(), task.estimated_minutes, datetime.now(timezone.utc).isoformat()),
        )
        row = db.execute("SELECT * FROM study_tasks WHERE id=?", (cursor.lastrowid,)).fetchone()
    return task_dict(row)


@app.put("/api/tasks/{task_id}")
def update_task(task_id: int, task: TaskCreate):
    with database() as db:
        cursor = db.execute(
            "UPDATE study_tasks SET title=?,subject=?,due_date=?,estimated_minutes=? WHERE id=?",
            (task.title, task.subject, task.due_date.isoformat(), task.estimated_minutes, task_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Study task not found")
        row = db.execute("SELECT * FROM study_tasks WHERE id=?", (task_id,)).fetchone()
    return task_dict(row)


@app.patch("/api/tasks/{task_id}/complete")
def toggle_task(task_id: int):
    with database() as db:
        row = db.execute("SELECT * FROM study_tasks WHERE id=?", (task_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Study task not found")
        db.execute("UPDATE study_tasks SET completed=? WHERE id=?", (0 if row["completed"] else 1, task_id))
        updated = db.execute("SELECT * FROM study_tasks WHERE id=?", (task_id,)).fetchone()
    return task_dict(updated)


@app.delete("/api/tasks/{task_id}", status_code=204)
def delete_task(task_id: int):
    with database() as db:
        cursor = db.execute("DELETE FROM study_tasks WHERE id=?", (task_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Study task not found")


@app.post("/api/demo/reset")
def reset_demo():
    with database() as db:
        db.execute("DELETE FROM study_tasks")
        db.execute("DELETE FROM focus_sessions")
        db.execute("DELETE FROM events")
        db.execute("DELETE FROM assistant_undo")
        seed_demo(db)
    return {"status": "reset"}


Day = date  # the field below is named `date`, which would shadow the type inside the class


class EventCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(min_length=2, max_length=120)
    kind: str = Field(pattern="^(class|test|event)$")
    subject: str = Field(default="", max_length=60)
    date: Day | None = None
    weekday: int | None = Field(default=None, ge=0, le=6)
    start_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    end_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    location: str = Field(default="", max_length=120)
    plan_study: bool = True


class CalendarImport(BaseModel):
    content: str = Field(min_length=10, max_length=2_000_000)


class AssistantMessage(BaseModel):
    message: str = Field(min_length=1, max_length=500)


def _insert_event(db, event, now_iso):
    cursor = db.execute(
        "INSERT INTO events(title,kind,subject,date,weekday,start_time,end_time,location,until,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        (event["title"], event["kind"], event.get("subject") or "", event.get("date"), event.get("weekday"),
         event.get("start_time"), event.get("end_time"), event.get("location") or "", event.get("until"), now_iso),
    )
    return dict(db.execute("SELECT * FROM events WHERE id=?", (cursor.lastrowid,)).fetchone())


@app.get("/api/events")
def list_events():
    with database() as db:
        return [dict(row) for row in db.execute("SELECT * FROM events ORDER BY kind, date, weekday, start_time")]


@app.post("/api/events", status_code=201)
def create_event(event: EventCreate):
    if event.kind == "class" and event.weekday is None:
        raise HTTPException(status_code=422, detail="A class needs a weekday")
    if event.kind != "class" and event.date is None:
        raise HTTPException(status_code=422, detail="Tests and events need a date")
    today, now_iso = date.today(), datetime.now(timezone.utc).isoformat()
    data = event.model_dump()
    data["date"] = (event.date or today).isoformat()
    with database() as db:
        created = _insert_event(db, data, now_iso)
        planned = planner.plan_for_test(db, created, today, now_iso) if event.plan_study else []
    return {**created, "planned_sessions": planned}


@app.put("/api/events/{event_id}")
def update_event(event_id: int, event: EventCreate):
    if event.kind == "class" and event.weekday is None:
        raise HTTPException(status_code=422, detail="A class needs a weekday")
    if event.kind != "class" and event.date is None:
        raise HTTPException(status_code=422, detail="Tests and events need a date")
    today, now_iso = date.today(), datetime.now(timezone.utc).isoformat()
    with database() as db:
        before = db.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
        if before is None:
            raise HTTPException(status_code=404, detail="Event not found")
        db.execute(
            "UPDATE events SET title=?, kind=?, subject=?, date=?, weekday=?, start_time=?, end_time=?, location=? WHERE id=?",
            (event.title, event.kind, event.subject, (event.date or date.fromisoformat(before["date"] or today.isoformat())).isoformat(),
             event.weekday if event.kind == "class" else None, event.start_time, event.end_time, event.location, event_id),
        )
        updated = dict(db.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone())
        planned = []
        # A test that moved or was renamed gets its unfinished sessions re-planned around the new date.
        if before["kind"] == "test" and (before["date"] != updated["date"] or before["title"] != updated["title"] or updated["kind"] != "test"):
            planner.remove_test_sessions(db, before["title"])
        if updated["kind"] == "test" and event.plan_study:
            planned = planner.plan_for_test(db, updated, today, now_iso)
    return {**updated, "planned_sessions": planned}


@app.delete("/api/events/{event_id}", status_code=204)
def delete_event(event_id: int):
    with database() as db:
        event = db.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
        if event is None:
            raise HTTPException(status_code=404, detail="Event not found")
        db.execute("DELETE FROM events WHERE id=?", (event_id,))
        if event["kind"] == "test":
            planner.remove_test_sessions(db, event["title"])


@app.post("/api/events/import")
def import_calendar(payload: CalendarImport):
    parsed = planner.parse_ics(payload.content)
    if not parsed:
        raise HTTPException(status_code=422, detail="No events found. Export your calendar as an .ics file and try again.")
    today, now_iso = date.today(), datetime.now(timezone.utc).isoformat()
    counts = {"class": 0, "test": 0, "event": 0, "skipped": 0, "study_sessions": 0}
    with database() as db:
        for item in parsed[:2000]:
            duplicate = db.execute(
                "SELECT 1 FROM events WHERE title=? AND kind=? AND IFNULL(date,'')=IFNULL(?,'') AND IFNULL(weekday,-1)=IFNULL(?,-1) AND IFNULL(start_time,'')=IFNULL(?,'')",
                (item["title"], item["kind"], item["date"], item["weekday"], item["start_time"]),
            ).fetchone()
            # Past one-off events add nothing to a plan; skip them along with duplicates.
            if duplicate or (item["kind"] != "class" and item["date"] < today.isoformat()):
                counts["skipped"] += 1
                continue
            created = _insert_event(db, item, now_iso)
            counts[item["kind"]] += 1
            counts["study_sessions"] += len(planner.plan_for_test(db, created, today, now_iso))
    return counts


@app.get("/api/agenda")
def agenda(days: int = 7):
    days = max(1, min(days, 31))
    with database() as db:
        events = [dict(row) for row in db.execute("SELECT * FROM events")]
    return planner.occurrences(events, date.today(), days)


def _snapshot(db):
    return json.dumps({
        "study_tasks": [dict(row) for row in db.execute("SELECT * FROM study_tasks")],
        "events": [dict(row) for row in db.execute("SELECT * FROM events")],
    })


def _restore(db, snapshot):
    data = json.loads(snapshot)
    for table in ("study_tasks", "events"):
        db.execute(f"DELETE FROM {table}")
        for row in data[table]:
            columns = ",".join(row)
            db.execute(f"INSERT INTO {table}({columns}) VALUES({','.join('?' * len(row))})", tuple(row.values()))


@app.post("/api/assistant")
def assistant(payload: AssistantMessage):
    now_iso = datetime.now(timezone.utc).isoformat()
    with database() as db:
        if re.match(r"^\s*(undo|undo that|take that back|revert)\s*[.!]?\s*$", payload.message, re.I):
            saved = db.execute("SELECT * FROM assistant_undo WHERE id=1").fetchone()
            if saved is None:
                return {"reply": "There's nothing to undo.", "changed": False, "undoable": False}
            _restore(db, saved["snapshot"])
            db.execute("DELETE FROM assistant_undo")
            return {"reply": f"Undone: {saved['label']}", "changed": True, "undoable": False}
        # Keep the plan as it was before this message, so one undo can put it back.
        before = _snapshot(db)
        result = planner.handle_message(db, payload.message, date.today(), now_iso)
        if result["changed"]:
            db.execute("INSERT OR REPLACE INTO assistant_undo(id,label,snapshot,created_at) VALUES(1,?,?,?)",
                       (result["reply"].split("\n")[0][:200], before, now_iso))
        return {**result, "undoable": result["changed"]}


@app.get("/api/insights")
def insights():
    with database() as db:
        rows = db.execute("SELECT * FROM study_tasks").fetchall()
        sessions = db.execute("SELECT * FROM focus_sessions").fetchall()
    today = date.today()
    total = len(rows)
    completed = sum(row["completed"] for row in rows)
    overdue = sum(not row["completed"] and date.fromisoformat(row["due_date"]) < today for row in rows)
    due_soon = sum(not row["completed"] and today <= date.fromisoformat(row["due_date"]) <= today + timedelta(days=3) for row in rows)
    minutes_left = sum(row["estimated_minutes"] for row in rows if not row["completed"])
    subjects = {}
    for row in rows:
        entry = subjects.setdefault(row["subject"], {"subject": row["subject"], "total": 0, "completed": 0, "planned_minutes": 0, "studied_minutes": 0})
        entry["total"] += 1
        entry["completed"] += int(row["completed"])
        entry["planned_minutes"] += row["estimated_minutes"]
    # Studied time per subject comes only from recorded sessions, never from estimates.
    for session in sessions:
        if session["subject"] in subjects:
            subjects[session["subject"]]["studied_minutes"] += session["duration_minutes"]
    week = []
    sessions_by_day = defaultdict(list)
    for session in sessions:
        session_day = date.fromisoformat(session["completed_at"][:10])
        if today - timedelta(days=6) <= session_day <= today:
            sessions_by_day[session_day.isoformat()].append(session)
    study_time_week = []
    for offset in range(7):
        day = today + timedelta(days=offset)
        due_that_day = [row for row in rows if not row["completed"] and row["due_date"] == day.isoformat()]
        week.append({
            "date": day.isoformat(),
            "day": day.strftime("%a"),
            "day_number": day.day,
            "tasks": len(due_that_day),
            "estimated_minutes": sum(row["estimated_minutes"] for row in due_that_day),
        })
    # Recorded focus time looks back over the last seven days, ending today.
    for offset in range(6, -1, -1):
        day = today - timedelta(days=offset)
        day_sessions = sessions_by_day[day.isoformat()]
        study_time_week.append({
            "date": day.isoformat(),
            "day": day.strftime("%a"),
            "day_number": day.day,
            "sessions": len(day_sessions),
            "minutes": sum(session["duration_minutes"] for session in day_sessions),
        })
    return {
        "completion_rate": round(completed / total * 100) if total else 0,
        "completed_tasks": completed,
        "total_tasks": total,
        "due_soon": due_soon,
        "overdue": overdue,
        "estimated_minutes_left": minutes_left,
        "subjects": sorted(subjects.values(), key=lambda item: item["subject"]),
        "week": week,
        "study_time_week": study_time_week,
        "focus_minutes_week": sum(item["minutes"] for item in study_time_week),
        "focus_sessions_week": sum(item["sessions"] for item in study_time_week),
        "focus_minutes_total": sum(session["duration_minutes"] for session in sessions),
    }
