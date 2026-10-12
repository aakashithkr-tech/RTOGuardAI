"""Unified SQLite persistence layer for RTOGuardAI.

Provides persistent storage for:
1. Orders (customer details, financials, risk assessment, NDR status, audit timeline).
2. Model predictions (CatBoost probability, action, band, expected loss, SHAP reasons, raw payload).
3. Analytics and risk reporting.

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
    """Initialize database tables, columns, and indexes safely."""
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
                risk_category TEXT,
                risk_score REAL,
                rto_probability REAL,
                data_json TEXT NOT NULL
            )
            """
        )

        # Check existing table columns for smooth migrations without table rebuilds
        existing_cols = {
            row["name"] for row in conn.execute("PRAGMA table_info(orders)").fetchall()
        }
        for col, col_type in [
            ("risk_category", "TEXT"),
            ("risk_score", "REAL"),
            ("rto_probability", "REAL"),
        ]:
            if col not in existing_cols:
                conn.execute(f"ALTER TABLE orders ADD COLUMN {col} {col_type}")

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
            CREATE TABLE IF NOT EXISTS razorpay_orders (
                order_id TEXT PRIMARY KEY,
                razorpay_order_id TEXT NOT NULL UNIQUE,
                amount_paise INTEGER NOT NULL,
                mode TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )

        # Remove historical duplicate predictions for the same order if any
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
        conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders(payment_method)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_risk ON orders(risk_category)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_predictions_created ON predictions(created_at)")


def save_prediction(result: dict[str, Any]) -> int:
    """Insert or replace the latest scoring result for an order."""
    init_db()
    created_at = datetime.now(timezone.utc).isoformat()
    order_id = str(result["order_id"])
    prob = float(result["rto_probability"])
    band = str(result.get("band", "medium"))
    action = str(result.get("action", "review"))
    action_label = str(result.get("action_label", "REVIEW"))
    loss = float(result.get("expected_loss_if_shipped_inr", 0.0))
    is_cod = int(bool(result.get("is_cod", True)))

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
                order_id,
                created_at,
                prob,
                band,
                action,
                action_label,
                loss,
                is_cod,
                json.dumps(result),
            ),
        )
        row = conn.execute(
            "SELECT id FROM predictions WHERE order_id = ?",
            (order_id,),
        ).fetchone()
        return int(row["id"])


def save_razorpay_order(
    order_id: str,
    razorpay_order_id: str,
    amount_paise: int,
    mode: str,
) -> None:
    """Persist the gateway order reference used to verify checkout completion."""
    init_db()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO razorpay_orders (
                order_id, razorpay_order_id, amount_paise, mode, created_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(order_id) DO UPDATE SET
                razorpay_order_id = excluded.razorpay_order_id,
                amount_paise = excluded.amount_paise,
                mode = excluded.mode,
                created_at = excluded.created_at
            """,
            (
                order_id,
                razorpay_order_id,
                amount_paise,
                mode,
                datetime.now(timezone.utc).isoformat(),
            ),
        )


def get_razorpay_order(order_id: str) -> Optional[dict[str, Any]]:
    """Return the persisted Razorpay reference for a local order."""
    init_db()
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT order_id, razorpay_order_id, amount_paise, mode, created_at
            FROM razorpay_orders WHERE order_id = ?
            """,
            (order_id,),
        ).fetchone()
    return dict(row) if row else None


def get_order_for_razorpay_reference(razorpay_order_id: str) -> Optional[dict[str, Any]]:
    """Resolve a Razorpay order ID to its local order."""
    init_db()
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT order_id, razorpay_order_id, amount_paise, mode, created_at
            FROM razorpay_orders WHERE razorpay_order_id = ?
            """,
            (razorpay_order_id,),
        ).fetchone()
    return dict(row) if row else None


def list_predictions(
    limit: int = 50,
    offset: int = 0,
    order_id: Optional[str] = None,
    band: Optional[str] = None,
    min_prob: Optional[float] = None,
    max_prob: Optional[float] = None,
) -> list[dict[str, Any]]:
    """Return filtered scoring records ordered newest first."""
    init_db()
    query = """
        SELECT id, order_id, created_at, rto_probability, band,
               action, action_label, expected_loss_if_shipped_inr, is_cod, result_json
        FROM predictions
        WHERE 1=1
    """
    params: list[Any] = []

    if order_id:
        query += " AND order_id = ?"
        params.append(order_id)
    if band:
        query += " AND band = ?"
        params.append(band.lower())
    if min_prob is not None:
        query += " AND rto_probability >= ?"
        params.append(min_prob)
    if max_prob is not None:
        query += " AND rto_probability <= ?"
        params.append(max_prob)

    query += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    with _connect() as conn:
        rows = conn.execute(query, params).fetchall()

    results = []
    for row in rows:
        d = dict(row)
        try:
            d["details"] = json.loads(d["result_json"])
        except Exception:
            d["details"] = {}
        results.append(d)
    return results


def get_prediction_by_id(pred_identifier: str | int) -> Optional[dict[str, Any]]:
    """Retrieve prediction by numeric id or order_id string."""
    init_db()
    with _connect() as conn:
        if str(pred_identifier).isdigit():
            row = conn.execute(
                """
                SELECT id, order_id, created_at, rto_probability, band,
                       action, action_label, expected_loss_if_shipped_inr, is_cod, result_json
                FROM predictions
                WHERE id = ? OR order_id = ?
                ORDER BY id DESC LIMIT 1
                """,
                (int(pred_identifier), str(pred_identifier)),
            ).fetchone()
        else:
            row = conn.execute(
                """
                SELECT id, order_id, created_at, rto_probability, band,
                       action, action_label, expected_loss_if_shipped_inr, is_cod, result_json
                FROM predictions
                WHERE order_id = ?
                ORDER BY id DESC LIMIT 1
                """,
                (str(pred_identifier),),
            ).fetchone()

    if row is None:
        return None
    d = dict(row)
    try:
        d["details"] = json.loads(d["result_json"])
    except Exception:
        d["details"] = {}
    return d


def get_latest_prediction_for_order(order_id: str) -> Optional[dict[str, Any]]:
    """Retrieve the latest prediction record for a specific order ID."""
    return get_prediction_by_id(order_id)


def upsert_order(order: dict[str, Any]) -> dict[str, Any]:
    """Insert or update an order in the database, extracting indexed fields."""
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

    risk = order.get("risk", {})
    risk_cat = risk.get("riskCategory") if isinstance(risk, dict) else None
    risk_score = risk.get("riskScore") if isinstance(risk, dict) else None
    rto_prob = risk.get("modelProbability") if isinstance(risk, dict) else None

    data_json = json.dumps(order)

    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO orders (
                id, order_number, created_at, updated_at,
                order_value, payment_method, status, delivery_attempts,
                risk_category, risk_score, rto_probability, data_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                order_number = excluded.order_number,
                updated_at = excluded.updated_at,
                order_value = excluded.order_value,
                payment_method = excluded.payment_method,
                status = excluded.status,
                delivery_attempts = excluded.delivery_attempts,
                risk_category = excluded.risk_category,
                risk_score = excluded.risk_score,
                rto_probability = excluded.rto_probability,
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
                risk_cat,
                risk_score,
                rto_prob,
                data_json,
            ),
        )
    return order


def create_order(order: dict[str, Any]) -> dict[str, Any]:
    """Create a new order. Rejects if order id or orderNumber already exists."""
    init_db()
    order_id = str(order["id"])
    order_num = str(order.get("orderNumber", order_id))

    with _connect() as conn:
        existing = conn.execute(
            "SELECT id FROM orders WHERE id = ? OR order_number = ?",
            (order_id, order_num),
        ).fetchone()
        if existing:
            raise ValueError(f"Order '{order_id}' or order number '{order_num}' already exists")

    return upsert_order(order)


def patch_order(order_id: str, patch_data: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Update permitted fields on an existing order."""
    init_db()
    existing = get_order_by_id(order_id)
    if not existing:
        return None

    # Merge permitted top-level and nested properties
    now = datetime.now(timezone.utc).isoformat()
    if "status" in patch_data and patch_data["status"] is not None:
        existing["status"] = str(patch_data["status"])
    if "orderValue" in patch_data and patch_data["orderValue"] is not None:
        existing["orderValue"] = float(patch_data["orderValue"])
    if "paymentMethod" in patch_data and patch_data["paymentMethod"] is not None:
        existing["paymentMethod"] = str(patch_data["paymentMethod"])
    if "deliveryAttempts" in patch_data and patch_data["deliveryAttempts"] is not None:
        existing["deliveryAttempts"] = int(patch_data["deliveryAttempts"])

    if "customer" in patch_data and isinstance(patch_data["customer"], dict):
        existing.setdefault("customer", {}).update(patch_data["customer"])
    if "financials" in patch_data and isinstance(patch_data["financials"], dict):
        existing.setdefault("financials", {}).update(patch_data["financials"])
    if "ndr" in patch_data and isinstance(patch_data["ndr"], dict):
        existing.setdefault("ndr", {}).update(patch_data["ndr"])
    if "items" in patch_data and isinstance(patch_data["items"], list):
        existing["items"] = patch_data["items"]

    existing["updatedAt"] = now
    return upsert_order(existing)


def delete_order(order_id: str) -> bool:
    """Delete an order by ID."""
    init_db()
    with _connect() as conn:
        cursor = conn.execute("DELETE FROM orders WHERE id = ? OR order_number = ?", (order_id, order_id))
        return cursor.rowcount > 0


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


def list_orders(
    status: Optional[str] = None,
    payment_method: Optional[str] = None,
    risk_category: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """List orders with pagination, filtering, and search."""
    init_db()
    query = "SELECT id, order_number, data_json FROM orders WHERE 1=1"
    count_query = "SELECT COUNT(*) as total FROM orders WHERE 1=1"
    params: list[Any] = []
    count_params: list[Any] = []

    if status:
        query += " AND status = ?"
        count_query += " AND status = ?"
        params.append(status)
        count_params.append(status)

    if payment_method:
        query += " AND payment_method = ?"
        count_query += " AND payment_method = ?"
        params.append(payment_method)
        count_params.append(payment_method)

    if risk_category:
        query += " AND risk_category = ?"
        count_query += " AND risk_category = ?"
        params.append(risk_category)
        count_params.append(risk_category)

    if search:
        search_like = f"%{search.strip()}%"
        query += " AND (id LIKE ? OR order_number LIKE ? OR data_json LIKE ?)"
        count_query += " AND (id LIKE ? OR order_number LIKE ? OR data_json LIKE ?)"
        params.extend([search_like, search_like, search_like])
        count_params.extend([search_like, search_like, search_like])

    query += " ORDER BY rowid DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    with _connect() as conn:
        total = int(conn.execute(count_query, count_params).fetchone()["total"])
        rows = conn.execute(query, params).fetchall()

    items = [json.loads(row["data_json"]) for row in rows]
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


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


# ---------------------------------------------------------------------------
# Analytics Query Aggregations
# ---------------------------------------------------------------------------


def get_risk_distribution() -> dict[str, Any]:
    """Compute risk score and risk category distribution from persisted orders."""
    orders = get_all_orders()
    total = len(orders)
    categories = {"LOW": 0, "MEDIUM": 0, "HIGH": 0, "CRITICAL": 0, "UNASSESSED": 0}
    bands = {"low": 0, "medium": 0, "high": 0}
    by_payment = {
        "COD": {"LOW": 0, "MEDIUM": 0, "HIGH": 0, "CRITICAL": 0},
        "PREPAID": {"LOW": 0, "MEDIUM": 0, "HIGH": 0, "CRITICAL": 0},
    }

    for o in orders:
        risk = o.get("risk", {})
        cat = risk.get("riskCategory") if isinstance(risk, dict) else None
        band = risk.get("tierBand") if isinstance(risk, dict) else None
        pay = o.get("paymentMethod", "COD")

        if cat in categories:
            categories[cat] += 1
            if pay in by_payment and cat in by_payment[pay]:
                by_payment[pay][cat] += 1
        else:
            categories["UNASSESSED"] += 1

        if band in bands:
            bands[band] += 1

    return {
        "total_orders": total,
        "categories": categories,
        "decision_bands": bands,
        "by_payment_method": by_payment,
    }


def get_prediction_trends() -> dict[str, Any]:
    """Retrieve chronological prediction history and distribution over time."""
    init_db()
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT date(created_at) as day,
                   count(*) as total_predictions,
                   avg(rto_probability) as avg_probability,
                   sum(case when action_label = 'BLOCK' then 1 else 0 end) as high_risk_count,
                   sum(case when action_label = 'REVIEW' then 1 else 0 end) as medium_risk_count,
                   sum(case when action_label = 'ALLOW' then 1 else 0 end) as low_risk_count,
                   sum(expected_loss_if_shipped_inr) as total_expected_loss
            FROM predictions
            GROUP BY date(created_at)
            ORDER BY day DESC
            LIMIT 30
            """
        ).fetchall()

    trends = [dict(r) for r in rows]
    return {
        "days_count": len(trends),
        "trends": trends,
    }


def get_shipping_loss_analytics() -> dict[str, Any]:
    """Aggregate shipping loss metrics and calculated prevention savings."""
    orders = get_all_orders()
    total_expected_loss = 0.0
    actual_rto_losses = 0.0
    prevented_loss_estimate = 0.0
    total_shipping_spend = 0.0

    for o in orders:
        fin = o.get("financials", {})
        fwd = float(fin.get("forwardShippingCost", 0.0))
        rev = float(fin.get("reverseLogisticsCost", 0.0))
        total_shipping_spend += fwd

        risk = o.get("risk", {})
        exp_loss = float(risk.get("expectedLossIfShippedInr", 0.0)) if isinstance(risk, dict) else 0.0
        total_expected_loss += exp_loss

        status = o.get("status")
        if status in ["RTO_DELIVERED", "RTO_INITIATED"]:
            actual_rto_losses += (fwd + rev)

        if isinstance(risk, dict) and risk.get("riskCategory") in ["HIGH", "CRITICAL"]:
            # If flagged and on hold or pre-verified, prevent reverse logistics + forward shipping loss
            prevented_loss_estimate += exp_loss

    return {
        "currency": "INR",
        "total_expected_shipping_loss": round(total_expected_loss, 2),
        "actual_rto_logistics_losses": round(actual_rto_losses, 2),
        "prevented_loss_estimate": round(prevented_loss_estimate, 2),
        "total_forward_shipping_spend": round(total_shipping_spend, 2),
        "shipping_loss_formula": "Expected Shipping Loss = P(RTO) * fn_cost_inr (Flat ₹200 logistics burn)",
    }


def get_orders_analytics() -> dict[str, Any]:
    """Aggregate orders analytics: statuses, payment methods, pincode tiers."""
    orders = get_all_orders()
    total = len(orders)
    status_counts: dict[str, int] = {}
    payment_counts: dict[str, int] = {}
    tier_counts: dict[str, dict[str, Any]] = {
        "TIER_1": {"total": 0, "rto": 0, "loss": 0.0},
        "TIER_2": {"total": 0, "rto": 0, "loss": 0.0},
        "TIER_3": {"total": 0, "rto": 0, "loss": 0.0},
    }

    for o in orders:
        st = o.get("status", "UNKNOWN")
        status_counts[st] = status_counts.get(st, 0) + 1

        pm = o.get("paymentMethod", "UNKNOWN")
        payment_counts[pm] = payment_counts.get(pm, 0) + 1

        tier = o.get("customer", {}).get("pincodeTier", "TIER_3")
        if tier not in tier_counts:
            tier_counts[tier] = {"total": 0, "rto": 0, "loss": 0.0}
        tier_counts[tier]["total"] += 1
        if st in ["RTO_DELIVERED", "RTO_INITIATED"]:
            tier_counts[tier]["rto"] += 1
            rev = float(o.get("financials", {}).get("reverseLogisticsCost", 0.0))
            tier_counts[tier]["loss"] += rev

    return {
        "total_orders": total,
        "status_distribution": status_counts,
        "payment_distribution": payment_counts,
        "pincode_tier_breakdown": tier_counts,
    }
