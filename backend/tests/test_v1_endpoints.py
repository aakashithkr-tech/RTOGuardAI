"""Comprehensive automated tests for RTOGuardAI v1 endpoints, analytics, and business logic."""

from __future__ import annotations

import json
import hashlib
import hmac
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

import database
from app import app
import src.serving as serving
import integrations.razorpay as razorpay
from services.profit import (
    calculate_expected_shipping_loss,
    evaluate_what_if_scenario,
    generate_scenario_comparisons,
)


@pytest.fixture
def client(tmp_path, monkeypatch):
    test_db = tmp_path / "test_v1_rtoguard.db"
    monkeypatch.setattr(database, "DEFAULT_DB_PATH", test_db)
    monkeypatch.setenv("DATABASE_PATH", str(test_db))
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", "test_webhook_secret")
    monkeypatch.setattr(razorpay, "RAZORPAY_KEY_ID", "")
    monkeypatch.setattr(razorpay, "RAZORPAY_KEY_SECRET", "")
    database.init_db()

    with TestClient(app) as test_client:
        yield test_client


def test_ready_endpoint(client):
    r = client.get("/ready")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ready"
    assert data["model_loaded"] is True
    assert data["database_connected"] is True


def test_model_status_endpoint(client):
    r = client.get("/api/v1/model/status")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "operational"
    assert data["estimator"] == "CatBoostClassifier"
    assert data["frozen_threshold"] == pytest.approx(0.37, abs=0.01)
    assert data["tier_cuts"]["low_cut"] == pytest.approx(0.05, abs=0.01)
    assert data["tier_cuts"]["high_cut"] == pytest.approx(0.40, abs=0.01)
    assert data["cost_params_inr"]["fn_cost_inr"] == 200.0


def test_model_metrics_endpoint(client):
    r = client.get("/api/v1/model/metrics")
    assert r.status_code == 200
    data = r.json()
    assert "test_set_evaluation" in data
    assert "validation_set_evaluation" in data
    test_metrics = data["test_set_evaluation"]
    assert test_metrics["n"] == 10000
    assert test_metrics["pr_auc"] == pytest.approx(0.3858, abs=0.01)
    assert test_metrics["roc_auc"] == pytest.approx(0.8060, abs=0.01)
    assert test_metrics["base_rate"] == pytest.approx(0.1473, abs=0.01)


def test_order_crud_lifecycle(client):
    # 1. Create order
    new_order_payload = {
        "id": "ord_v1_test_99",
        "orderNumber": "RTO-TEST-99",
        "orderValue": 1999.0,
        "paymentMethod": "COD",
        "status": "PENDING",
        "deliveryAttempts": 0,
        "items": [{
            "sku": "FASH-DRESS-BLU",
            "name": "Floral Summer Dress (Blue/M)",
            "quantity": 1,
            "unitPrice": 1999.0,
        }],
        "customer": {
            "name": "Ananya Roy",
            "phoneMasked": "+91 98300 •••••",
            "emailMasked": "ananya***@gmail.com",
            "addressLine": "Flat 3B, Lake View Apartments, Southern Avenue",
            "city": "Kolkata",
            "state": "West Bengal",
            "pincode": "700029",
            "pincodeTier": "TIER_1",
            "historicalRtoRate": 0.10,
            "totalOrdersCount": 3,
            "accountAgeDays": 60.0,
            "orderVelocity24h": 1,
        },
        "runPredictionImmediately": True,
    }
    r = client.post("/api/v1/orders", json=new_order_payload)
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["id"] == "ord_v1_test_99"
    assert created["risk"]["modelSource"] == "CatBoostClassifier (final_model.joblib)"
    assert "riskScore" in created["risk"]

    # 2. Duplicate order creation fails with 409
    dup = client.post("/api/v1/orders", json=new_order_payload)
    assert dup.status_code == 409

    # 3. Retrieve single order
    get_res = client.get("/api/v1/orders/ord_v1_test_99")
    assert get_res.status_code == 200
    assert get_res.json()["orderNumber"] == "RTO-TEST-99"

    # 4. Patch order
    patch_res = client.patch(
        "/api/v1/orders/ord_v1_test_99",
        json={"status": "CONFIRMED", "deliveryAttempts": 1},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["status"] == "CONFIRMED"
    assert patch_res.json()["deliveryAttempts"] == 1

    # 5. Delete order
    del_res = client.delete("/api/v1/orders/ord_v1_test_99")
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "deleted"

    # 6. Verify deleted
    get_after = client.get("/api/v1/orders/ord_v1_test_99")
    assert get_after.status_code == 404


def test_batch_predictions_endpoint(client):
    batch_payload = {
        "orders": [
            {
                "order_id": "ord_batch_1",
                "customer_id": "Cust 1",
                "pincode": "110001",
                "address_line": "Connaught Place, New Delhi",
                "category": "electronics",
                "order_value": 1500.0,
                "is_cod": True,
            },
            {
                "order_id": "ord_batch_2",
                "customer_id": "Cust 2",
                "pincode": "560001",
                "address_line": "MG Road, Bengaluru",
                "category": "fashion",
                "order_value": 2200.0,
                "is_cod": False,
            },
        ]
    }
    r = client.post("/api/v1/predictions/batch", json=batch_payload)
    assert r.status_code == 200
    data = r.json()
    assert data["count"] == 2
    assert len(data["predictions"]) == 2
    for pred in data["predictions"]:
        assert "rto_probability" in pred
        assert "action_label" in pred
        assert pred["binary_threshold"] == pytest.approx(0.37, abs=0.01)


def test_batch_predictions_limit(client):
    # Batch exceeding 100 items should be rejected with 422
    too_large = {
        "orders": [
            {
                "order_id": f"ord_large_{i}",
                "pincode": "110001",
                "address_line": "1 Main St",
                "category": "fashion",
                "order_value": 100.0,
                "is_cod": True,
            }
            for i in range(101)
        ]
    }
    r = client.post("/api/v1/predictions/batch", json=too_large)
    assert r.status_code == 422


def test_analytics_endpoints(client):
    # 1. Risk distribution
    r = client.get("/api/v1/analytics/risk-distribution")
    assert r.status_code == 200
    data = r.json()
    assert "categories" in data
    assert "decision_bands" in data

    # 2. Prediction trends
    r = client.get("/api/v1/analytics/prediction-trends")
    assert r.status_code == 200
    data = r.json()
    assert "trends" in data

    # 3. Shipping loss analytics
    r = client.get("/api/v1/analytics/shipping-loss")
    assert r.status_code == 200
    data = r.json()
    assert "total_expected_shipping_loss" in data
    assert "actual_rto_logistics_losses" in data

    # 4. Orders analytics
    r = client.get("/api/v1/analytics/orders")
    assert r.status_code == 200
    data = r.json()
    assert "status_distribution" in data
    assert "pincode_tier_breakdown" in data


def test_profit_intelligence_endpoints(client):
    # 1. Expected shipping loss estimate
    r = client.post("/api/v1/profit/estimate", json={
        "rto_probability": 0.45,
        "order_value": 2500.0,
        "forward_shipping_cost": 120.0,
        "reverse_logistics_cost": 160.0,
        "packaging_cost": 40.0,
    })
    assert r.status_code == 200
    data = r.json()
    expected_loss = 0.45 * (120.0 + 160.0 + 40.0)
    assert data["expected_shipping_loss_inr"] == pytest.approx(expected_loss, abs=0.1)

    # 2. What-If simulator endpoint
    r = client.post("/api/v1/profit/what-if", json={
        "order_value": 2000.0,
        "rto_probability": 0.50,
        "intervention_type": "prepaid_discount",
        "incentive_discount": 60.0,
        "verification_cost": 8.0,
    })
    assert r.status_code == 200
    sim = r.json()
    assert "baseline" in sim
    assert "simulated" in sim
    assert "impact" in sim
    assert sim["impact"]["expected_shipping_loss_reduction_inr"] > 0

    # 3. Frontend scenarios endpoint
    r = client.post("/profit/scenarios", json={
        "orderId": "ord_101",
    })
    assert r.status_code == 200
    scenarios = r.json()
    assert isinstance(scenarios, list)
    assert len(scenarios) >= 4
    action_keys = {s["actionKey"] for s in scenarios}
    assert "DISPATCH_STANDARD" in action_keys
    assert "REQUEST_ADDRESS_VERIFICATION" in action_keys
    assert "OFFER_PREPAID_INCENTIVE" in action_keys
    assert "HOLD_DISPATCH" in action_keys


def test_ndr_recovery_and_listing(client):
    # List active NDR orders
    r = client.get("/api/v1/ndr/orders")
    assert r.status_code == 200
    ndr_orders = r.json()
    assert isinstance(ndr_orders, list)
    assert any(o["id"] == "ord_102" for o in ndr_orders)

    # Execute recovery action on ord_102
    act_res = client.post("/api/v1/ndr/ord_102/action", json={
        "actionType": "REATTEMPT_WITH_TIME",
        "reattemptDate": "2026-10-14T10:00:00Z",
        "remarks": "Customer requested reattempt on Wednesday morning",
    })
    assert act_res.status_code == 200
    updated = act_res.json()
    assert updated["status"] == "RECOVERY_IN_PROGRESS"
    assert updated["ndr"]["recoveryStatus"] == "REATTEMPT_SCHEDULED"


def test_cors_headers_present(client):
    r = client.options("/api/v1/orders", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
    assert r.status_code == 200
    assert "access-control-allow-origin" in r.headers


def test_model_unavailable_returns_503(client, monkeypatch):
    def fake_get_service():
        raise FileNotFoundError("Simulated missing final_model.joblib")

    monkeypatch.setattr("app.get_service", fake_get_service)

    # 1. /ready must return 503
    ready_res = client.get("/ready")
    assert ready_res.status_code == 503
    assert "unavailable" in ready_res.text.lower() or "readiness failed" in ready_res.text.lower()

    # 2. /api/v1/model/status must return 503
    status_res = client.get("/api/v1/model/status")
    assert status_res.status_code == 503

    # 3. /api/v1/predictions must return 503
    pred_res = client.post("/api/v1/predictions", json={
        "pincode": "110001",
        "address_line": "Connaught Place",
        "category": "fashion",
        "order_value": 1500.0,
        "is_cod": True,
    })
    assert pred_res.status_code == 503


def test_risk_boundary_conditions():
    from src.costs import apply_tiers, ALLOW, FEE, BLOCK

    low_cut = 0.05
    high_cut = 0.40

    # Below 0.05 -> ALLOW
    assert apply_tiers([0.049], low_cut, high_cut)[0] == ALLOW
    # Between 0.05 and 0.40 -> FEE (REVIEW)
    assert apply_tiers([0.050], low_cut, high_cut)[0] == FEE
    assert apply_tiers([0.370], low_cut, high_cut)[0] == FEE
    assert apply_tiers([0.399], low_cut, high_cut)[0] == FEE
    # 0.40 and above -> BLOCK
    assert apply_tiers([0.400], low_cut, high_cut)[0] == BLOCK
    assert apply_tiers([0.850], low_cut, high_cut)[0] == BLOCK


def test_order_pagination_and_filtering(client):
    res_page_1 = client.get("/api/v1/orders?limit=2&offset=0")
    assert res_page_1.status_code == 200
    orders_1 = res_page_1.json()
    assert len(orders_1) <= 2

    res_cod = client.get("/api/v1/orders?payment_method=COD")
    assert res_cod.status_code == 200
    cod_orders = res_cod.json()
    assert all(o["paymentMethod"] == "COD" for o in cod_orders)


def test_multilingual_translation_endpoint(client):
    r = client.post("/api/v1/multilingual/translate", json={
        "text": "Your order is ready. Please confirm your delivery address.",
        "target_language": "hi",
        "template_type": "address_verification",
    })
    assert r.status_code == 200
    data = r.json()
    assert "translated_text" in data
    assert data["target_language"] == "hi"


def test_razorpay_checkout_gate_and_orders(client):
    # 1. Test checkout gate
    gate_res = client.post("/api/v1/razorpay/checkout-gate", json={
        "pincode": "560001",
        "address_line": "Cubbon Park Road, Bengaluru",
        "category": "home_kitchen",
        "order_value": 2499.0,
        "customer_history": {
            "past_orders": 5,
            "past_rto_count": 0,
            "account_age_days": 180.0,
        },
    })
    assert gate_res.status_code == 200, gate_res.text
    gate_data = gate_res.json()
    assert "tier" in gate_data
    assert "action" in gate_data
    assert gate_data["razorpay_mode"] == "simulated"
    assert "rto_probability" in gate_data

    # 2. Test Razorpay create-order
    ord_res = client.post("/api/v1/razorpay/create-order", json={
        "amount_inr": 1500.0,
        "order_id": "ord_101",
    })
    assert ord_res.status_code == 200
    ord_data = ord_res.json()
    assert ord_data["amount"] == 150000
    assert "id" in ord_data
    assert ord_data["mode"] == "simulated"
    assert ord_data["key_id"] is None

    # 3. Test Razorpay payment-link
    link_res = client.post("/api/v1/razorpay/payment-link", json={
        "order_id": "ord_101",
        "amount_inr": 2499.0,
        "customer_name": "Aditya Sharma",
    })
    assert link_res.status_code == 200
    link_data = link_res.json()
    assert link_data["mode"] == "simulated"
    assert link_data["short_url"] is None

    # 4. Test Razorpay webhook updates order
    webhook_payload = {
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_test_998822",
                    "amount": 249900,
                    "status": "captured",
                    "notes": {"order_id": "ord_101"},
                }
            }
        }
    }
    raw_payload = json.dumps(webhook_payload).encode("utf-8")
    signature = hmac.new(
        b"test_webhook_secret", raw_payload, hashlib.sha256
    ).hexdigest()
    hook_res = client.post(
        "/api/v1/razorpay/webhook",
        content=raw_payload,
        headers={
            "Content-Type": "application/json",
            "X-Razorpay-Signature": signature,
        },
    )
    assert hook_res.status_code == 200

    # Verify ord_101 status updated in db
    updated_ord = client.get("/api/v1/orders/ord_101").json()
    assert updated_ord["status"] == "CONFIRMED"
    assert updated_ord["paymentMethod"] == "PREPAID"
    timeline_names = [e["eventName"] for e in updated_ord["timeline"]]
    assert any("Razorpay Payment Captured" in name for name in timeline_names)

    invalid_hook = client.post("/api/v1/razorpay/webhook", json=webhook_payload)
    assert invalid_hook.status_code == 401

    # A local simulation is distinct from a signed Razorpay webhook.
    demo_res = client.post("/api/v1/razorpay/demo-payment", json={"order_id": "ord_101"})
    assert demo_res.status_code == 200
    assert demo_res.json()["status"] == "simulated"


def test_razorpay_standard_checkout_signature_verification(client, monkeypatch):
    monkeypatch.setattr(razorpay, "RAZORPAY_KEY_ID", "rzp_test_fixture")
    monkeypatch.setattr(razorpay, "RAZORPAY_KEY_SECRET", "fixture_checkout_secret")
    database.save_razorpay_order(
        order_id="ord_101",
        razorpay_order_id="order_gateway_fixture",
        amount_paise=249900,
        mode="test",
    )
    payment_id = "pay_fixture"
    signature = hmac.new(
        b"fixture_checkout_secret",
        b"order_gateway_fixture|pay_fixture",
        hashlib.sha256,
    ).hexdigest()

    verified = client.post("/api/v1/razorpay/verify-payment", json={
        "order_id": "ord_101",
        "razorpay_order_id": "order_gateway_fixture",
        "razorpay_payment_id": payment_id,
        "razorpay_signature": signature,
    })
    assert verified.status_code == 200, verified.text
    assert verified.json()["status"] == "verified"
    updated = client.get("/api/v1/orders/ord_101").json()
    assert updated["status"] == "CONFIRMED"
    assert updated["paymentMethod"] == "PREPAID"

    forged = client.post("/api/v1/razorpay/verify-payment", json={
        "order_id": "ord_101",
        "razorpay_order_id": "order_gateway_fixture",
        "razorpay_payment_id": payment_id,
        "razorpay_signature": "invalid",
    })
    assert forged.status_code == 400


def test_batch_csv_upload_and_scoring(client):
    csv_sample = (
        "id,pincode,address,order_value,category,is_cod,past_orders,past_rto_count\n"
        "ORD_CSV_1,110001,Connaught Place Delhi,1500,electronics,1,2,0\n"
        "ORD_CSV_2,560001,Brigade Road Bangalore,2200,fashion,0,5,0\n"
        "ORD_CSV_3,124001,Old Bus Stand Rohtak,1200,footwear,1,1,1\n"
    )
    files = {"file": ("test_orders.csv", csv_sample.encode("utf-8"), "text/csv")}
    r = client.post("/api/v1/predictions/csv", files=files)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "summary" in data
    assert data["summary"]["total_orders"] == 3
    assert "records" in data
    assert len(data["records"]) == 3
    assert "csv_data" in data

    # Verify columns in enriched records
    rec = data["records"][0]
    assert "rto_probability" in rec
    assert "action_tier" in rec
    assert "expected_loss_inr" in rec
