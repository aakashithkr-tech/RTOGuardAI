"""Minimal SQLite storage for scored-order results."""

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(__import__("os").environ.get(
    "PREDICTIONS_DB_PATH", str(ROOT / "data" / "predictions.db")
))


def _connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS predictions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                rto_probability REAL NOT NULL,
                band TEXT NOT NULL,
                action TEXT NOT NULL,
                action_label TEXT NOT NULL,
                expected_loss_if_shipped_inr REAL NOT NULL,
                is_cod INTEGER NOT NULL,
                result_json TEXT NOT NULL
            )
        """)


def save_prediction(result: dict) -> int:
    """Save a scoring result and return its database record ID."""
    init_db()
    with _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO predictions (
                order_id, created_at, rto_probability, band, action,
                action_label, expected_loss_if_shipped_inr, is_cod, result_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(result["order_id"]),
                datetime.now(timezone.utc).isoformat(),
                float(result["rto_probability"]),
                str(result["band"]),
                str(result["action"]),
                str(result["action_label"]),
                float(result["expected_loss_if_shipped_inr"]),
                int(bool(result["is_cod"])),
                json.dumps(result),
            ),
        )
        return int(cursor.lastrowid)


def list_predictions(limit: int = 20) -> list[dict]:
    """Return newest scoring records first."""
    init_db()
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, order_id, created_at, rto_probability, band,
                   action, action_label, expected_loss_if_shipped_inr, is_cod
            FROM predictions
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]
