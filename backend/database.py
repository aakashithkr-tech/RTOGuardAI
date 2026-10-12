"""Unified SQLite persistence layer for RTOGuardAI.

Provides persistent storage for:
1. Orders (customer details, financials, risk assessment, NDR status, audit timeline).
2. Model predictions (CatBoost probability, action, band, expected loss, SHAP reasons, raw payload).

Configurable via DATABASE_PATH environment variable (for Render persistent disk).
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parent
DEFAULT_DB_PATH = ROOT / "data" / "rtoguard.db"
DB_PATH = Path(os.environ.get("DATABASE_PATH", str(DEFAULT_DB_PATH)))


def get_db_path() -> Path:
    return Path(os.environ.get("DATABASE_PATH", str(DEFAULT_DB_PATH)))


def _connect() -> sqlite3.Connection:
    path = get_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    """Initialize database tables and indexes safely."""
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY,
                order_number TEXT UNIQUE NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                order_value REAL NOT NULL,
                payment_method TEXT NOT NULL,
                status TEXT NOT NULL,
                delivery_attempts INTEGER NOT NULL DEFAULT 0,
                data_json TEXT NOT NULL
            )
            """
        )

        conn.execute(
            """
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
            """
        )

        conn.execute(
            """
            DELETE FROM predictions
            WHERE id NOT IN (
                SELECT MAX(id) FROM predictions GROUP BY order_id
            )
            """
        )
        conn.execute("DROP INDEX IF EXISTS idx_predictions_order_id")
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_predictions_order_id "
            "ON predictions(order_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)"
        )


def save_prediction(result: dict[str, Any]) -> int:
    """Insert or replace the latest scoring result for an order."""
    init_db()
    created_at = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO predictions (
                order_id, created_at, rto_probability, band, action,
                action_label, expected_loss_if_shipped_inr, is_cod, result_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(order_id) DO UPDATE SET
                created_at = excluded.created_at,
                rto_probability = excluded.rto_probability,
                band = excluded.band,
                action = excluded.action,
                action_label = excluded.action_label,
                expected_loss_if_shipped_inr = excluded.expected_loss_if_shipped_inr,
                is_cod = excluded.is_cod,
                result_json = excluded.result_json
            """,
            (
                str(result["order_id"]),
                created_at,
                float(result["rto_probability"]),
                str(result["band"]),
                str(result["action"]),
                str(result["action_label"]),
                float(result["expected_loss_if_shipped_inr"]),
                int(bool(result["is_cod"])),
                json.dumps(result),
            ),
        )
        row = conn.execute(
            "SELECT id FROM predictions WHERE order_id = ?",
            (str(result["order_id"]),),
        ).fetchone()
        return int(row["id"])


def list_predictions(limit: int = 50) -> list[dict[str, Any]]:
    """Return latest scoring records first."""
    init_db()
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, order_id, created_at, rto_probability, band,
                   action, action_label, expected_loss_if_shipped_inr, is_cod, result_json
            FROM predictions
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    results = []
    for row in rows:
        d = dict(row)
        d["details"] = json.loads(d["result_json"])
        results.append(d)
    return results


def get_latest_prediction_for_order(order_id: str) -> Optional[dict[str, Any]]:
    """Retrieve the latest prediction record for a specific order ID."""
    init_db()
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT id, order_id, created_at, rto_probability, band,
                   action, action_label, expected_loss_if_shipped_inr, is_cod, result_json
            FROM predictions
            WHERE order_id = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (order_id,),
        ).fetchone()
    if row is None:
        return None
    d = dict(row)
    d["details"] = json.loads(d["result_json"])
    return d


def get_all_orders() -> list[dict[str, Any]]:
    """Retrieve all orders from persistent storage."""
    init_db()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, order_number, data_json FROM orders ORDER BY rowid ASC"
        ).fetchall()
    return [json.loads(row["data_json"]) for row in rows]


def get_order_by_id(order_id: str) -> Optional[dict[str, Any]]:
    """Find an order by id or orderNumber."""
    init_db()
    with _connect() as conn:
        row = conn.execute(
            "SELECT data_json FROM orders WHERE id = ? OR order_number = ?",
            (order_id, order_id),
        ).fetchone()
    if row:
        return json.loads(row["data_json"])
    return None


def upsert_order(order: dict[str, Any]) -> dict[str, Any]:
    """Insert or update an order in the database."""
    init_db()
    order_id = str(order["id"])
    order_number = str(order.get("orderNumber", order_id))
    now = datetime.now(timezone.utc).isoformat()
    created_at = str(order.get("createdAt", now))
    updated_at = str(order.get("updatedAt", now))
    order_val = float(order.get("orderValue", 0))
    payment = str(order.get("paymentMethod", "COD"))
    status = str(order.get("status", "PENDING"))
    attempts = int(order.get("deliveryAttempts", 0))

    data_json = json.dumps(order)

    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO orders (
                id, order_number, created_at, updated_at,
                order_value, payment_method, status, delivery_attempts, data_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                order_number = excluded.order_number,
                updated_at = excluded.updated_at,
                order_value = excluded.order_value,
                payment_method = excluded.payment_method,
                status = excluded.status,
                delivery_attempts = excluded.delivery_attempts,
                data_json = excluded.data_json
            """,
            (
                order_id,
                order_number,
                created_at,
                updated_at,
                order_val,
                payment,
                status,
                attempts,
                data_json,
            ),
        )
    return order


def count_orders() -> int:
    init_db()
    with _connect() as conn:
        row = conn.execute("SELECT COUNT(*) as count FROM orders").fetchone()
        return int(row["count"]) if row else 0


def count_predictions() -> int:
    init_db()
    with _connect() as conn:
        row = conn.execute("SELECT COUNT(*) as count FROM predictions").fetchone()
        return int(row["count"]) if row else 0
