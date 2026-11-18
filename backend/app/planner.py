"""Schedule helpers: agenda expansion, calendar (.ics) import, test study plans,
and the plain-text commands behind the assistant. No AI service is involved: the
assistant understands a fixed set of phrasings and says so when it does not."""
import re
from datetime import date, datetime, timedelta, timezone

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTHS = {name: index + 1 for index, name in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
ICS_DAYS = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
TEST_WORDS = re.compile(r"\b(exam|test|quiz|midterm|mid-sem|finals?|assessment)\b", re.I)
KINDS = ("class", "test", "event")


def fmt_day(day: date) -> str:
    return f"{WEEKDAY_SHORT[day.weekday()]} {day.day} {day.strftime('%b')}"


# ---------- Agenda ----------

def occurrences(events, start: date, days: int):
    """Expand stored events into dated occurrences for `days` days from `start`."""
    out = []
    for offset in range(days):
        day = start + timedelta(days=offset)
        iso = day.isoformat()
        for event in events:
            if event["kind"] == "class" and event["weekday"] is not None:
                if event["weekday"] != day.weekday():
                    continue
                if event["date"] and iso < event["date"]:
                    continue
                if event["until"] and iso > event["until"]:
                    continue
            elif event["date"] != iso:
                continue
            out.append({
                "id": event["id"], "title": event["title"], "kind": event["kind"], "subject": event["subject"],
                "date": iso, "start_time": event["start_time"], "end_time": event["end_time"],
                "location": event["location"], "recurring": event["kind"] == "class" and event["weekday"] is not None,
            })
    out.sort(key=lambda item: (item["date"], item["start_time"] or "99:99", item["title"]))
    return out


def remove_test_sessions(db, title: str) -> int:
    """Delete the unfinished study sessions that were planned for a test."""
    like = title.replace("%", r"\%").replace("_", r"\_")
    return db.execute(
        "DELETE FROM study_tasks WHERE completed=0 AND title LIKE ? ESCAPE '\\'", (f"Study for {like} (%",)
    ).rowcount


def plan_for_test(db, event, today: date, now_iso: str):
    """Create short study sessions on the days before a test. Returns the titles created."""
    if event["kind"] != "test" or not event["date"]:
        return []
    test_day = date.fromisoformat(event["date"])
    days = [test_day - timedelta(days=gap) for gap in (3, 2, 1)]
    days = [day for day in days if day >= today]
    if not days and test_day > today:
        days = [today]
    created = []
    subject = event["subject"] or "General"
    for index, day in enumerate(days, start=1):
        title = f"Study for {event['title']} ({index} of {len(days)})"
        exists = db.execute("SELECT 1 FROM study_tasks WHERE title=? AND subject=?", (title, subject)).fetchone()
        if exists:
            continue
        db.execute(
            "INSERT INTO study_tasks(title,subject,due_date,estimated_minutes,created_at) VALUES(?,?,?,?,?)",
            (title, subject, day.isoformat(), 45, now_iso),
        )
        created.append(f"{fmt_day(day)}")
    return created


# ---------- Calendar import ----------

def _unescape(value: str) -> str:
    return value.replace("\\n", " ").replace("\\N", " ").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")


def _ics_datetime(value: str):
    match = re.match(r"(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?", value.strip())
    if not match:
        return None, None
    year, month, day = int(match.group(1)), int(match.group(2)), int(match.group(3))
    try:
        if match.group(4) is None:
            return date(year, month, day), None
        moment = datetime(year, month, day, int(match.group(4)), int(match.group(5)))
    except ValueError:
        return None, None
    if match.group(7):  # UTC: show it in the server's local time
        moment = moment.replace(tzinfo=timezone.utc).astimezone().replace(tzinfo=None)
    return moment.date(), moment.strftime("%H:%M")


def parse_ics(text: str):
    """Read VEVENTs from an iCalendar file. Weekly rules become classes; everything else is dated."""
    lines = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    events, current = [], None
    for line in lines:
        if line.strip() == "BEGIN:VEVENT":
            current = {}
        elif line.strip() == "END:VEVENT":
            if current is not None:
                events.extend(_ics_event(current))
            current = None
        elif current is not None and ":" in line:
            key, value = line.split(":", 1)
            current.setdefault(key.split(";", 1)[0].upper(), value)
    return events


def _ics_event(raw):
    title = _unescape(raw.get("SUMMARY", "")).strip()[:120] or "Untitled"
    day, start = _ics_datetime(raw.get("DTSTART", ""))
    if day is None:
        return []
    _, end = _ics_datetime(raw.get("DTEND", "")) if "DTEND" in raw else (None, None)
    if start is None:
        end = None
    rule = raw.get("RRULE", "").upper()
    location = _unescape(raw.get("LOCATION", "")).strip()[:120]
    base = {"title": title, "subject": "", "start_time": start, "end_time": end, "location": location}
    if "FREQ=WEEKLY" in rule:
        until = None
        until_match = re.search(r"UNTIL=(\d{4})(\d{2})(\d{2})", rule)
        if until_match:
            until = "-".join(until_match.groups())
        byday = re.search(r"BYDAY=([A-Z,]+)", rule)
        weekdays = [ICS_DAYS[code] for code in byday.group(1).split(",") if code in ICS_DAYS] if byday else []
        weekdays = weekdays or [day.weekday()]
        return [{**base, "kind": "class", "date": day.isoformat(), "weekday": weekday, "until": until} for weekday in weekdays]
    kind = "test" if TEST_WORDS.search(title) else "event"
    return [{**base, "kind": kind, "date": day.isoformat(), "weekday": None, "until": None}]


# ---------- Plain-text commands ----------

def _clock(hour: int, minute: int, suffix):
    suffix = (suffix or "").lower()
    if suffix == "pm" and hour < 12:
        hour += 12
    if suffix == "am" and hour == 12:
        hour = 0
    if not suffix and 1 <= hour <= 7:  # "class 2-4" means the afternoon
        hour += 12
    if hour > 23 or minute > 59:
        return None
    return f"{hour:02d}:{minute:02d}"


_T = r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?"
TIME_RANGE = re.compile(rf"\b(?:from\s+)?{_T}\s*(?:-|–|to|until|till)\s*{_T}(?![\d/])", re.I)
TIME_ONE = re.compile(r"\b(?:at\s+)?(?:(\d{1,2}):(\d{2})\s*(am|pm)?|(\d{1,2})\s*(am|pm))\b", re.I)
DURATION = re.compile(r"\b(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h)\b", re.I)


def extract_when(text: str, today: date):
    """Pull date, weekdays, times and duration out of a message. Returns (info, leftover text)."""
    info = {"date": None, "weekdays": [], "start": None, "end": None, "minutes": None}
    work = f" {text} "

    def take(pattern, handler, flags=re.I):
        nonlocal work
        match = re.search(pattern, work, flags)
        if match and handler(match) is not False:
            work = work[:match.start()] + " " + work[match.end():]
            return True
        return False

    def on_iso(match):
        try:
            info["date"] = date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        except ValueError:
            return False

    def on_day_month(day_text, month_text):
        month = MONTHS.get(month_text[:3].lower())
        try:
            candidate = date(today.year, month, int(day_text))
        except (ValueError, TypeError):
            return False
        if candidate < today - timedelta(days=30):
            candidate = candidate.replace(year=today.year + 1)
        info["date"] = candidate

    def on_slash(match):
        try:
            candidate = date(today.year, int(match.group(2)), int(match.group(1)))
        except ValueError:
            return False
        if candidate < today - timedelta(days=30):
            candidate = candidate.replace(year=today.year + 1)
        info["date"] = candidate

    def on_ordinal(day_text):
        day_number = int(day_text)
        year, month = today.year, today.month
        for _ in range(2):
            try:
                candidate = date(year, month, day_number)
            except ValueError:
                candidate = None
            if candidate and candidate >= today:
                info["date"] = candidate
                return None
            year, month = (year + 1, 1) if month == 12 else (year, month + 1)
        return False

    month_names = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?"
    (take(r"\b(\d{4})-(\d{2})-(\d{2})\b", on_iso)
     or take(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?({month_names})\b", lambda m: on_day_month(m.group(1), m.group(2)))
     or take(rf"\b({month_names})\s+(\d{{1,2}})(?:st|nd|rd|th)?\b", lambda m: on_day_month(m.group(2), m.group(1)))
     or take(r"\b(\d{1,2})/(\d{1,2})\b", on_slash)
     or take(r"\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b", lambda m: on_ordinal(m.group(1))))

    def on_duration(match):
        amount = float(match.group(1))
        info["minutes"] = int(round(amount * 60)) if match.group(2).lower().startswith("h") else int(amount)
    take(DURATION.pattern, on_duration)

    def on_range(match):
        start = _clock(int(match.group(1)), int(match.group(2) or 0), match.group(3) or match.group(6))
        end = _clock(int(match.group(4)), int(match.group(5) or 0), match.group(6))
        if not start or not end:
            return False
        if end <= start and not match.group(6):  # "11-1" runs past noon
            hour = int(end[:2]) + 12
            end = f"{hour:02d}{end[2:]}" if hour < 24 else end
        info["start"], info["end"] = start, end
    if not take(TIME_RANGE.pattern, on_range):
        def on_time(match):
            if match.group(1) is not None:
                value = _clock(int(match.group(1)), int(match.group(2)), match.group(3))
            else:
                value = _clock(int(match.group(4)), 0, match.group(5))
            if not value:
                return False
            info["start"] = value
        if not take(TIME_ONE.pattern, on_time):
            def on_bare_hour(match):
                value = _clock(int(match.group(1)), 0, None)
                if not value:
                    return False
                info["start"] = value
            take(r"\bat\s+(\d{1,2})\b(?!\s*(?:st|nd|rd|th|/|\d))", on_bare_hour)

    if info["date"] is None:
        def on_relative(match):
            word = match.group(1).lower()
            info["date"] = today + timedelta(days={"today": 0, "tonight": 0, "tomorrow": 1}[word])
        if not take(r"\b(today|tonight|tomorrow)\b", on_relative):
            take(r"\bin\s+(\d{1,2})\s+days?\b", lambda m: info.__setitem__("date", today + timedelta(days=int(m.group(1)))))

    day_names = "|".join(f"{name}s?|{name[:3]}s?" for name in WEEKDAYS) + "|tues|thur|thurs"
    while True:
        found = re.search(rf"\b(?:next\s+|every\s+|on\s+)?({day_names})\b", work, re.I)
        if not found:
            break
        index = [name[:3] for name in WEEKDAYS].index(found.group(1)[:3].lower())
        if index not in info["weekdays"]:
            info["weekdays"].append(index)
        work = work[:found.start()] + " " + work[found.end():]
    if info["date"] is None and info["weekdays"]:
        ahead = (info["weekdays"][0] - today.weekday()) % 7 or 7
        info["date"] = today + timedelta(days=ahead)

    work = re.sub(r"\b(on|at|due|by|and|every|from|is|are|will be|it's)\s*(?=\s|$)", " ", work, flags=re.I)
    work = re.sub(r"[\s,;:.!]+", " ", work).strip(" -")
    return info, work


HELP = (
    "I update your plan from short messages. I'm a simple command helper, not an AI model. Try:\n"
    "• class Statistics Mon Wed 9-11 in Room B2\n"
    "• test Database Systems on Friday 2pm\n"
    "• task Read chapter 5 for Statistics due tomorrow 40m\n"
    "• event Mid-semester break on 24 Nov\n"
    "• move SQL practice to Monday\n"
    "• done lecture notes\n"
    "• what's today · what's this week\n"
    "• undo (reverses my last change)"
)


def _title_case(text: str) -> str:
    return " ".join(word if word.isupper() else word[:1].upper() + word[1:] for word in text.split())


def _known_subject(db, text: str):
    subjects = [row[0] for row in db.execute(
        "SELECT DISTINCT subject FROM study_tasks UNION SELECT DISTINCT subject FROM events WHERE subject != ''")]
    lowered = text.lower()
    for subject in sorted(subjects, key=len, reverse=True):
        if subject and subject.lower() in lowered:
            return subject
    # Abbreviations keep the first letters and drop some later ones: "stats" -> Statistics,
    # "maths" -> Mathematics. Same first three letters, and every letter appears in order.
    def abbreviates(word, part):
        if word[:3] != part[:3]:
            return False
        rest = iter(part)
        return all(char in rest for char in word)
    words = [word for word in re.findall(r"[a-z]+", lowered) if len(word) >= 4]
    for subject in subjects:
        if any(abbreviates(word, part) for word in words for part in subject.lower().split()):
            return subject
    return None


def _find(rows, fragment: str):
    """Exact title first, then titles containing the whole phrase, then the phrase minus a
    trailing kind word ("the SQL task" -> "sql")."""
    full = re.sub(r"^(my|the)\s+", "", fragment.strip().lower())
    short = re.sub(r"\s+(task|test|exam|class|event)$", "", full)
    for candidate in (full, short):
        if len(candidate) < 2:
            continue
        exact = [row for row in rows if row["title"].lower() == candidate]
        if exact:
            return exact
        partial = [row for row in rows if candidate in row["title"].lower()]
        if partial:
            return partial
    return []


def _pick(matches, what: str):
    if not matches:
        return None, f"I couldn't find {what} matching that. Check the name and try again."
    if len({row["title"].lower() for row in matches}) == 1:
        # Same name more than once (a class on two weekdays, a repeated test): take the next one.
        dated = sorted(matches, key=lambda row: row.get("date") or row.get("due_date") or "9999")
        upcoming = [row for row in dated if (row.get("date") or row.get("due_date") or "") >= date.today().isoformat()]
        return (upcoming or dated)[0], None
    if len(matches) > 1:
        names = ", ".join(f"“{row['title']}”" for row in matches[:4])
        return None, f"That matches more than one: {names}. Use a longer part of the name."
    return matches[0], None


def _span(start, end):
    return f" at {start}–{end}" if start and end else f" at {start}" if start else ""


def handle_message(db, message: str, today: date, now_iso: str):
    text = re.sub(r"\s+", " ", message).strip()
    lowered = text.lower()
    reply = lambda words, changed=False: {"reply": words, "changed": changed}

    if not text or re.match(r"^(help|\?|hi|hello|hey|what can you do)\b", lowered):
        return reply(HELP)

    natural = re.match(r"^(?:i have|i've got|ive got|there is|there's|we have)?\s*(?:an?\s+|my\s+|the\s+)?(.+?)\s+(test|exam|quiz|midterm)\b\s*(.*)$", text, re.I)
    if natural and natural.group(1).lower() not in ('a', 'an', 'my', 'the') and not re.match(r"^(add|create|new|schedule|test|exam|quiz|midterm|move|reschedule|push|shift|change|delete|remove|cancel|done|finished|completed|complete|mark|what|whats|show|list|task|todo|assignment|homework|remind|event|class|lecture|lab|tutorial|help|undo)\b", lowered):
        return handle_message(db, f"{natural.group(2)} {natural.group(1)} {natural.group(3)}", today, now_iso)

    events = [dict(row) for row in db.execute("SELECT * FROM events")]
    open_tasks = [dict(row) for row in db.execute("SELECT * FROM study_tasks WHERE completed=0")]

    query = re.match(r"^(?:what'?s|whats|what is|what do i have|show|list)?\s*(?:on\s+|my\s+|for\s+)?(today|tomorrow|this week|week|next|schedule|agenda)\b", lowered)
    if query:
        word = query.group(1)
        start = today + timedelta(days=1 if word == "tomorrow" else 0)
        span = 1 if word in ("today", "tomorrow") else 7
        items = occurrences(events, start, span)
        due = [task for task in open_tasks if start.isoformat() <= task["due_date"] < (start + timedelta(days=span)).isoformat()]
        if word == "next":
            now_time = datetime.now().strftime("%H:%M")
            upcoming = [item for item in items if item["date"] > today.isoformat() or (item["start_time"] or "24:00") >= now_time]
            if not upcoming:
                return reply("Nothing else is scheduled in the next 7 days.")
            item = upcoming[0]
            return reply(f"Next: {item['title']} on {fmt_day(date.fromisoformat(item['date']))}{_span(item['start_time'], item['end_time'])}.")
        if not items and not due:
            return reply("Nothing is scheduled then, and no tasks are due.")
        lines = [f"• {fmt_day(date.fromisoformat(item['date'])) + ' ' if span > 1 else ''}{item['start_time'] or 'All day'} {item['title']}" for item in items[:12]]
        lines += [f"• Due {fmt_day(date.fromisoformat(task['due_date']))}: {task['title']}" for task in due[:8]]
        return reply("\n".join(lines))

    lead = re.match(r"^(?:please\s+)?(?:add|create|new|schedule|i have|i've got|there is|there's)?\s*(?:an?\s+|my\s+)?(class|lecture|lab|tutorial|test|exam|quiz|midterm|event|task|todo|assignment|homework)\b[:\s]*(.*)$", lowered)
    remind = re.match(r"^remind me to\s+(.*)$", lowered)
    if lead or remind:
        word = "task" if remind else lead.group(1)
        offset = len(text) - len((remind.group(1) if remind else lead.group(2)))
        rest = text[offset:]
        info, leftover = extract_when(rest, today)

        if word in ("class", "lecture", "lab", "tutorial"):
            location = ""
            place = re.search(r"\b(?:in|room|venue)\s+(.+)$", leftover, re.I)
            if place:
                location, leftover = place.group(1).strip()[:120], leftover[:place.start()].strip()
            if not leftover or not info["weekdays"] or not info["start"]:
                return reply("To add a class I need a name, the day or days, and a time. For example: class Statistics Mon Wed 9-11 in Room B2")
            subject = _known_subject(db, leftover) or _title_case(leftover)
            title = _title_case(leftover) if word == "class" else f"{_title_case(leftover)} {word}"
            for weekday in info["weekdays"]:
                db.execute(
                    "INSERT INTO events(title,kind,subject,date,weekday,start_time,end_time,location,until,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (title[:120], "class", subject[:60], today.isoformat(), weekday, info["start"], info["end"], location, None, now_iso),
                )
            days = ", ".join(WEEKDAY_SHORT[weekday] for weekday in info["weekdays"])
            return reply(f"Added {title} every {days}{_span(info['start'], info['end'])}{' in ' + location if location else ''}.", True)

        if word in ("test", "exam", "quiz", "midterm"):
            if not info["date"]:
                return reply(f"When is the {word}? For example: {word} Statistics on Friday 2pm")
            leftover = re.sub(r"^(?:in|for|on|of)\s+", "", leftover, flags=re.I).strip()
            subject = _known_subject(db, leftover) or (_title_case(leftover) if leftover else "General")
            name = subject if subject != "General" and len(leftover) <= len(subject) else _title_case(leftover)
            title = f"{name} {word}" if leftover else word.capitalize()
            cursor = db.execute(
                "INSERT INTO events(title,kind,subject,date,weekday,start_time,end_time,location,until,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (title[:120], "test", subject[:60], info["date"].isoformat(), None, info["start"], info["end"], "", None, now_iso),
            )
            event = dict(db.execute("SELECT * FROM events WHERE id=?", (cursor.lastrowid,)).fetchone())
            planned = plan_for_test(db, event, today, now_iso)
            extra = f" I planned {len(planned)} study session{'s' if len(planned) != 1 else ''} before it: {', '.join(planned)}." if planned else ""
            return reply(f"Added {title} on {fmt_day(info['date'])}{_span(info['start'], info['end'])}.{extra}", True)

        if word == "event":
            if not leftover or not info["date"]:
                return reply("To add an event I need a name and a date. For example: event Mid-semester break on 24 Nov")
            db.execute(
                "INSERT INTO events(title,kind,subject,date,weekday,start_time,end_time,location,until,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (_title_case(leftover)[:120], "event", "", info["date"].isoformat(), None, info["start"], info["end"], "", None, now_iso),
            )
            return reply(f"Added {_title_case(leftover)} on {fmt_day(info['date'])}{_span(info['start'], info['end'])}.", True)

        # task
        subject = None
        for_subject = re.search(r"\bfor\s+(.+)$", leftover, re.I)
        if for_subject:
            subject = _known_subject(db, for_subject.group(1)) or _title_case(for_subject.group(1))
            leftover = leftover[:for_subject.start()].strip()
        if len(leftover) < 2:
            return reply("What is the task? For example: task Read chapter 5 for Statistics due tomorrow 40m")
        subject = subject or _known_subject(db, leftover) or "General"
        due = info["date"] or today
        minutes = min(600, max(5, info["minutes"] or 45))
        title = leftover[:1].upper() + leftover[1:]
        db.execute(
            "INSERT INTO study_tasks(title,subject,due_date,estimated_minutes,created_at) VALUES(?,?,?,?,?)",
            (title[:120], subject[:60], due.isoformat(), minutes, now_iso),
        )
        return reply(f"Added “{title}” for {subject}, due {fmt_day(due)}, {minutes} minutes planned.", True)

    move = re.match(r"^(?:move|reschedule|push|shift|change)\s+(.+?)\s+to\s+(.+)$", text, re.I)
    if move:
        info, _ = extract_when(move.group(2), today)
        if not info["date"]:
            return reply("I couldn't read that date. Try: move SQL practice to Monday")
        dated = [event for event in events if event["kind"] != "class"]
        target, problem = _pick(_find(dated, move.group(1)) or _find(open_tasks, move.group(1)), "a task, test or event")
        if problem:
            return reply(problem)
        if "due_date" in target:
            db.execute("UPDATE study_tasks SET due_date=? WHERE id=?", (info["date"].isoformat(), target["id"]))
        else:
            db.execute("UPDATE events SET date=?, start_time=COALESCE(?, start_time), end_time=CASE WHEN ? IS NULL THEN end_time ELSE ? END WHERE id=?",
                       (info["date"].isoformat(), info["start"], info["start"], info["end"], target["id"]))
            if target["kind"] == "test":
                remove_test_sessions(db, target["title"])
                plan_for_test(db, dict(db.execute("SELECT * FROM events WHERE id=?", (target["id"],)).fetchone()), today, now_iso)
        return reply(f"Moved “{target['title']}” to {fmt_day(info['date'])}{_span(info['start'], info['end']) if 'due_date' not in target else ''}.", True)

    done = re.match(r"^(?:done|finished|completed|complete|mark)\s+(?:with\s+)?(.+?)(?:\s+(?:as\s+)?done)?$", text, re.I)
    if done:
        target, problem = _pick(_find(open_tasks, done.group(1)), "an open task")
        if problem:
            return reply(problem)
        db.execute("UPDATE study_tasks SET completed=1 WHERE id=?", (target["id"],))
        return reply(f"Marked “{target['title']}” as done.", True)

    remove = re.match(r"^(?:delete|remove|cancel)\s+(.+)$", text, re.I)
    if remove:
        target, problem = _pick(_find(events, remove.group(1)) or _find(open_tasks, remove.group(1)), "a task, class, test or event")
        if problem:
            return reply(problem)
        if "due_date" in target:
            db.execute("DELETE FROM study_tasks WHERE id=?", (target["id"],))
        else:
            db.execute("DELETE FROM events WHERE title=? AND kind=?", (target["title"], target["kind"]))
            if target["kind"] == "test":
                dropped = remove_test_sessions(db, target["title"])
                if dropped:
                    return reply(f"Removed “{target['title']}” and its {dropped} unfinished study session{'s' if dropped != 1 else ''}.", True)
        return reply(f"Removed “{target['title']}”.", True)

    return reply("I didn't understand that.\n" + HELP)
