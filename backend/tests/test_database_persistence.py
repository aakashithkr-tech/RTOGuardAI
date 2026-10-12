"""Automated tests verifying SQLite database persistence across process operations."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys

import pytest

import database


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    test_db_path = tmp_path / "test_rtoguard.db"
    monkeypatch.setattr(database, "DEFAULT_DB_PATH", test_db_path)
    monkeypatch.setenv("DATABASE_PATH", str(test_db_path))
    database.init_db()
    return test_db_path


def test_init_db_creates_tables(temp_db):
    assert temp_db.exists()
    assert database.count_orders() == 0
    assert database.count_predictions() == 0


def test_save_and_retrieve_prediction(temp_db):
    prediction = {
        "order_id": "ord_test_01",
        "rto_probability": 0.7245,
        "band": "high",
        "action": "disable_cod",
        "action_label": "BLOCK",
        "expected_loss_if_shipped_inr": 144.90,
        "is_cod": True,
        "reasons": ["Incomplete address", "High value COD"],
    }

    pred_id = database.save_prediction(prediction)
    assert pred_id >= 1
    assert database.count_predictions() == 1

    records = database.list_predictions(limit=10)
    assert len(records) == 1
    rec = records[0]
    assert rec["order_id"] == "ord_test_01"
    assert rec["rto_probability"] == pytest.approx(0.7245, abs=0.001)
    assert rec["action_label"] == "BLOCK"
    assert rec["expected_loss_if_shipped_inr"] == pytest.approx(144.90, abs=0.01)

    latest = database.get_latest_prediction_for_order("ord_test_01")
    assert latest is not None
    assert latest["order_id"] == "ord_test_01"


def test_rescoring_replaces_latest_prediction_without_duplicate(temp_db):
    prediction = {
        "order_id": "ord_repeat_score",
        "rto_probability": 0.42,
        "band": "medium",
        "action": "charge_cod_fee",
        "action_label": "REVIEW",
        "expected_loss_if_shipped_inr": 84.0,
        "is_cod": True,
        "reasons": ["Initial reasons"],
    }

    first_id = database.save_prediction(prediction)
    prediction["rto_probability"] = 0.61
    prediction["expected_loss_if_shipped_inr"] = 122.0
    prediction["reasons"] = ["Updated reasons"]
    second_id = database.save_prediction(prediction)

    assert second_id == first_id
    assert database.count_predictions() == 1
    latest = database.get_latest_prediction_for_order("ord_repeat_score")
    assert latest is not None
    assert latest["rto_probability"] == pytest.approx(0.61)
    assert latest["details"]["reasons"] == ["Updated reasons"]


def test_order_persistence_and_update(temp_db):
    order = {
        "id": "ord_101",
        "orderNumber": "RTO-9482",
        "orderValue": 2499,
        "paymentMethod": "COD",
        "status": "PENDING",
        "deliveryAttempts": 0,
        "risk": {"riskScore": 75, "riskCategory": "HIGH"},
        "timeline": [],
    }

    database.upsert_order(order)
    assert database.count_orders() == 1

    loaded = database.get_order_by_id("ord_101")
    assert loaded is not None
    assert loaded["orderNumber"] == "RTO-9482"
    assert loaded["orderValue"] == 2499

    # Update order with model prediction without duplicating row
    order["risk"]["riskScore"] = 78
    order["risk"]["modelSource"] = "CatBoostClassifier (final_model.joblib)"
    database.upsert_order(order)

    assert database.count_orders() == 1
    reloaded = database.get_order_by_id("RTO-9482")
    assert reloaded["risk"]["riskScore"] == 78
    assert reloaded["risk"]["modelSource"] == "CatBoostClassifier (final_model.joblib)"


def test_persistence_across_restart(tmp_path):
    """Verify orders and predictions survive an actual backend process restart."""
    persist_db = tmp_path / "persistent_rtoguard.db"
    backend_dir = Path(database.__file__).resolve().parent
    child_env = os.environ.copy()
    child_env["DATABASE_PATH"] = str(persist_db)

    writer = """
from database import init_db, save_prediction, upsert_order
init_db()
upsert_order({
    "id": "ord_restart_test",
    "orderNumber": "RTO-RESTART",
    "orderValue": 1999,
    "paymentMethod": "COD",
    "status": "PENDING",
})
save_prediction({
    "order_id": "ord_restart_test",
    "rto_probability": 0.42,
    "band": "medium",
    "action": "charge_cod_fee",
    "action_label": "REVIEW",
    "expected_loss_if_shipped_inr": 84.0,
    "is_cod": True,
    "reasons": ["Moderate risk pincode"],
})
"""
    subprocess.run(
        [sys.executable, "-c", writer],
        cwd=backend_dir,
        env=child_env,
        check=True,
        capture_output=True,
        text=True,
    )

    reader = """
from database import get_latest_prediction_for_order, get_order_by_id, init_db
init_db()
order = get_order_by_id("ord_restart_test")
prediction = get_latest_prediction_for_order("ord_restart_test")
assert order is not None and order["orderNumber"] == "RTO-RESTART"
assert prediction is not None and prediction["action_label"] == "REVIEW"
assert abs(prediction["rto_probability"] - 0.42) < 0.001
"""
    subprocess.run(
        [sys.executable, "-c", reader],
        cwd=backend_dir,
        env=child_env,
        check=True,
        capture_output=True,
        text=True,
    )
