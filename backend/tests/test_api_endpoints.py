"""Automated tests verifying all FastAPI REST endpoints, scoring pipeline, and error handling."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import database
from app import app
from app import infer_product_category, map_order_to_payload
from src.serving import sample_orders


@pytest.fixture
def client(tmp_path, monkeypatch):
    test_db = tmp_path / "test_api_rtoguard.db"
    monkeypatch.setattr(database, "DEFAULT_DB_PATH", test_db)
    monkeypatch.setenv("DATABASE_PATH", str(test_db))
    database.init_db()

    with TestClient(app) as test_client:
        yield test_client


def test_health_endpoint_reports_model_loaded(client):
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "healthy"
    assert data["trained_model_loaded"] is True
    assert data["model_details"]["estimator"] == "CatBoostClassifier"
    assert "frozen_threshold" in data["model_details"]


def test_get_orders_returns_list(client):
    r = client.get("/api/orders")
    assert r.status_code == 200
    orders = r.json()
    assert isinstance(orders, list)
    assert len(orders) >= 6


def test_all_seed_orders_can_be_scored(client):
    orders_response = client.get("/api/orders")
    assert orders_response.status_code == 200

    for order in orders_response.json():
        response = client.post(f"/api/orders/{order['id']}/score")
        assert response.status_code == 200, f"{order['id']}: {response.text}"
        assert response.json()["risk"]["modelSource"] == "CatBoostClassifier (final_model.joblib)"


def test_score_existing_order_updates_risk(client):
    # Score ord_101
    r = client.post("/api/orders/ord_101/score")
    assert r.status_code == 200, r.text
    order = r.json()

    assert order["id"] == "ord_101"
    risk = order["risk"]
    assert risk["modelSource"] == "CatBoostClassifier (final_model.joblib)"
    assert risk["isDemoAssessment"] is False
    assert risk["binaryThreshold"] == pytest.approx(0.37, abs=0.01)
    assert 0 <= risk["riskScore"] <= 100
    assert "expectedLossIfShippedInr" in risk
    assert risk["expectedLossIfShippedInr"] >= 0
    assert isinstance(risk["factors"], list)

    # Verify timeline event added
    events = [e for e in order["timeline"] if "CatBoostClassifier" in e["details"]]
    assert len(events) >= 1

    # Verify prediction history has record
    p_res = client.get("/api/predictions")
    assert p_res.status_code == 200
    p_data = p_res.json()
    assert p_data["count"] >= 1
    assert any(p["order_id"] == "ord_101" for p in p_data["predictions"])

    repeated = client.post("/api/orders/ord_101/score")
    assert repeated.status_code == 200, repeated.text
    repeated_history = client.get("/api/predictions").json()
    matching_records = [
        prediction for prediction in repeated_history["predictions"]
        if prediction["order_id"] == "ord_101"
    ]
    assert repeated_history["count"] == p_data["count"]
    assert len(matching_records) == 1


def test_raw_score_endpoint(client):
    payload = {
        "order_id": "ord_custom_99",
        "customer_id": "Aditya Sharma",
        "pincode": "251001",
        "address_line": "Near Shiv Mandir, Main Road, Tehsil Compound",
        "category": "footwear",
        "order_value": 2499.0,
        "is_cod": True,
        "discount_pct": 0.0,
        "customer_history": {
            "past_orders": 2,
            "past_rto_count": 1,
            "account_age_days": 45.0,
            "order_velocity_24h": 1,
        },
    }
    r = client.post("/score", json=payload)
    assert r.status_code == 200, r.text
    result = r.json()

    assert result["order_id"] == "ord_custom_99"
    assert 0.0 <= result["rto_probability"] <= 1.0
    assert result["binary_threshold"] == pytest.approx(0.37, abs=0.01)
    assert result["action"] in {"allow_cod", "charge_cod_fee", "disable_cod"}
    assert result["action_label"] in {"ALLOW", "REVIEW", "BLOCK"}
    assert isinstance(result["reasons"], list)
    assert result["expected_loss_if_shipped_inr"] >= 0


def test_invalid_input_returns_422(client):
    # Invalid 2-digit pincode
    r = client.post("/score", json={
        "order_id": "ord_bad",
        "pincode": "99",
        "address_line": "Bad Address",
        "category": "fashion",
        "order_value": 1000.0,
        "is_cod": True,
    })
    assert r.status_code == 422

    # Negative order value
    r = client.post("/score", json={
        "order_id": "ord_bad_val",
        "pincode": "110001",
        "address_line": "Bad Address",
        "category": "fashion",
        "order_value": -50.0,
        "is_cod": True,
    })
    assert r.status_code == 422


def test_order_mapping_rejects_missing_or_unknown_model_features():
    with pytest.raises(ValueError, match="valid 6-digit customer pincode"):
        map_order_to_payload({
            "id": "ord_missing_pin",
            "orderValue": 1000,
            "paymentMethod": "COD",
            "items": [{"name": "Running sneakers"}],
            "customer": {"addressLine": "1 Main Road"},
        })

    with pytest.raises(ValueError, match="Could not map the order items"):
        infer_product_category({"items": [{"name": "Unclassified product"}]})


def test_dashboard_summary_endpoint(client):
    r = client.get("/api/dashboard/summary")
    assert r.status_code == 200
    summary = r.json()

    assert "totalOrders" in summary
    assert "codOrdersCount" in summary
    assert "ordersAtRiskCount" in summary
    assert "estimatedContribution" in summary
    assert summary["activeMode"] == "LIVE"
