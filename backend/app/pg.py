"""A thin Postgres adapter so the same SQL works on SQLite (local) and Postgres (hosted).

Each workspace lives in its own Postgres schema (ws_<id>), the hosted equivalent of one
SQLite file per workspace. The adapter makes a psycopg connection behave like sqlite3:
`?` placeholders, rows readable by name or position, and `cursor.lastrowid` after INSERT.
"""
import re

import psycopg

_INSERT = re.compile(r"^\s*INSERT\s+INTO\s+(\w+)", re.I)
# Tables whose primary key is generated, so an INSERT can return the new id.
_SERIAL_TABLES = {"study_tasks", "focus_sessions", "events"}


class Row(dict):
    """A dict row that can also be read by position, like sqlite3.Row."""

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


def _row_factory(cursor):
    names = [column.name for column in cursor.description or []]
    return lambda values: Row(zip(names, values))


def _translate(sql):
    sql = sql.replace("%", "%%").replace("?", "%s")
    return sql.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")


class Cursor:
    def __init__(self, cursor, lastrowid=None):
        self._cursor = cursor
        self.lastrowid = lastrowid
        self.rowcount = cursor.rowcount

    def fetchone(self):
        return self._cursor.fetchone() if self._cursor.description else None

    def fetchall(self):
        return self._cursor.fetchall() if self._cursor.description else []

    def __iter__(self):
        return iter(self.fetchall())


class Connection:
    def __init__(self, url, schema):
        # Client-side binding: works through Neon's pooler and lets Postgres type NULL parameters.
        self._db = psycopg.connect(url, cursor_factory=psycopg.ClientCursor, row_factory=_row_factory,
                                   connect_timeout=10, prepare_threshold=None)
        self.schema = schema
        # SET LOCAL lasts for this transaction only, so a pooled server connection never
        # carries one workspace's search_path into another request.
        self._db.execute(f'SET LOCAL search_path TO "{schema}"')

    def create_schema(self):
        self._db.execute(f'CREATE SCHEMA IF NOT EXISTS "{self.schema}"')

    def execute(self, sql, params=()):
        match = _INSERT.match(sql)
        if match and match.group(1).lower() in _SERIAL_TABLES and "RETURNING" not in sql.upper():
            cursor = self._db.execute(_translate(sql) + " RETURNING id", params)
            row = cursor.fetchone()
            return Cursor(cursor, row["id"] if row else None)
        return Cursor(self._db.execute(_translate(sql), params))

    def executemany(self, sql, rows):
        with self._db.cursor() as cursor:
            cursor.executemany(_translate(sql), rows)

    def reset_ids(self, table):
        """After inserting explicit ids (undo), move the id sequence past them."""
        self._db.execute(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                         f"COALESCE((SELECT MAX(id) FROM {table}), 0) + 1, false)")

    def lock(self, key):
        """Serialise first-time setup of one workspace across concurrent requests."""
        self._db.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (key,))

    def commit(self):
        self._db.commit()

    def rollback(self):
        self._db.rollback()

    def close(self):
        self._db.close()


def count_workspaces(url):
    with psycopg.connect(url, connect_timeout=10, prepare_threshold=None) as db:
        return db.execute("SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name LIKE 'ws\\_%%'").fetchone()[0]


def workspace_exists(url, schema):
    with psycopg.connect(url, connect_timeout=10, prepare_threshold=None) as db:
        return db.execute("SELECT 1 FROM information_schema.schemata WHERE schema_name = %s", (schema,)).fetchone() is not None
