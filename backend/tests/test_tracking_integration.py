"""Unit tests for Online Order and Shipment Tracking API Integration.

Tests cover:
- Supported couriers list and tracking URL generation
- Tracking provider status and configuration inspection
- Registering / updating tracking numbers on orders
- Retrieving live status and chronological checkpoint history
- Refreshing tracking milestones (mock simulation & live fallback)
- Webhook signature verification (HMAC-SHA256 & generic secret)
- Webhook callbacks triggering order transitions, NDR flagging, and RTO risk updates
- Multi-carrier database persistence in SQLite (shipment_trackings & shipment_events)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import pytest
from fastapi.testclient import TestClient

import database
from app import app
from integrations.tracking import (
    NORMALIZED_STATUS_MAP,
    SUPPORTED_COURIERS,
    build_tracking_url,
    get_supported_couriers,
    normalize_shipment_status,
    resolve_courier,
    verify_aftership_webhook_signature,
    verify_generic_webhook_signature,
)


@pytest.fixture
def client(tmp_path, monkeypatch):
    test_db = tmp_path / "test_tracking_rtoguard.db"
    monkeypatch.setattr(database, "DEFAULT_DB_PATH", test_db)
    monkeypatch.setenv("DATABASE_PATH", str(test_db))
    database.init_db()

    with TestClient(app) as test_client:
        yield test_client


def test_supported_couriers(client):
    """Verify major Indian e-commerce couriers are registered."""
    couriers = get_supported_couriers()
    codes = [c["code"] for c in couriers]
    assert "delhivery" in codes
    assert "bluedart" in codes
    assert "dtdc" in codes
    assert "ecom-express" in codes
    assert "xpressbees" in codes
    assert "india-post" in codes

    # Test direct courier resolution
    delhivery = resolve_courier("delhivery")
    assert delhivery["name"] == "Delhivery"
    assert "delhivery.com" in build_tracking_url("delhivery", "DEL12345")


def test_status_normalization():
    """Verify vendor-specific status strings normalize into canonical statuses."""
    assert normalize_shipment_status("OutForDelivery") == "OUT_FOR_DELIVERY"
    assert normalize_shipment_status("AttemptFail") == "FAILED_ATTEMPT"
    assert normalize_shipment_status("Delivered") == "DELIVERED"
    assert normalize_shipment_status("InTransit") == "IN_TRANSIT"
    assert normalize_shipment_status("RTO Initiated") == "RTO_INITIATED"


def test_tracking_status_endpoint(client):
    """Test GET /api/tracking/status diagnostic endpoint."""
    res = client.get("/api/tracking/status")
    assert res.status_code == 200
    data = res.json()
    assert "provider" in data
    assert "is_live" in data
    assert "supported_couriers" in data
    assert "delhivery" in data["supported_couriers"]


def test_tracking_couriers_endpoint(client):
    """Test GET /api/tracking/couriers endpoint."""
    res = client.get("/api/tracking/couriers")
    assert res.status_code == 200
    couriers = res.json()
    assert len(couriers) >= 6
    names = [c["name"] for c in couriers]
    assert "Delhivery" in names
    assert "Blue Dart Express" in names


def test_register_and_get_tracking(client):
    """Test registering tracking on an existing order and querying it."""
    order_id = "ord_101"
    res = client.post(
        f"/api/orders/{order_id}/tracking",
        json={
            "tracking_number": "DEL-TEST-998811",
            "courier_code": "delhivery",
            "estimated_delivery": "2026-10-18T18:00:00Z",
        },
    )
    assert res.status_code == 200, res.text
    track = res.json()
    assert track["tracking_number"] == "DEL-TEST-998811"
    assert track["courier_code"] == "delhivery"
    assert "delhivery.com" in track["tracking_url"]
    assert track["events_count"] > 0

    # Query latest tracking
    get_res = client.get(f"/api/orders/{order_id}/tracking")
    assert get_res.status_code == 200
    get_data = get_res.json()
    assert get_data["tracking_number"] == "DEL-TEST-998811"

    # Query database directly
    db_track = database.get_shipment_tracking(order_id)
    assert db_track is not None
    assert db_track["tracking_number"] == "DEL-TEST-998811"

    # Query tracking history
    hist_res = client.get(f"/api/orders/{order_id}/tracking/history")
    assert hist_res.status_code == 200
    hist_data = hist_res.json()
    assert len(hist_data["events"]) > 0


def test_refresh_tracking_advances_status(client):
    """Test that POST /api/orders/{order_id}/tracking/refresh updates milestone."""
    order_id = "ord_101"
    # Ensure tracking registered first
    client.post(
        f"/api/orders/{order_id}/tracking",
        json={
            "tracking_number": "DEL-TEST-998811",
            "courier_code": "delhivery",
        },
    )

    res = client.post(f"/api/orders/{order_id}/tracking/refresh")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["order_id"] == order_id
    assert "current_status" in data


def test_tracking_webhook_transitions_ndr(client):
    """Test that an external webhook indicating FAILED_ATTEMPT flags NDR and elevates RTO risk."""
    order_id = "ord_101"
    # Ensure tracking registered first
    client.post(
        f"/api/orders/{order_id}/tracking",
        json={
            "tracking_number": "BD-NDR-776655",
            "courier_code": "bluedart",
        },
    )

    # Post webhook simulation
    webhook_payload = {
        "event": "tracking_update",
        "msg": {
            "order_id": order_id,
            "tracking_number": "BD-NDR-776655",
            "slug": "bluedart",
            "tag": "AttemptFail",
            "subtag_message": "Customer door locked / phone unanswered",
            "location": "Muzaffarnagar",
        },
    }
    res = client.post(
        "/api/tracking/webhook",
        json=webhook_payload,
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["status"] == "success"
    assert data["current_status"] == "FAILED_ATTEMPT"

    # Verify order transitioned to NDR_PENDING in database
    updated_order = database.get_order_by_id(order_id)
    assert updated_order["status"] == "NDR_PENDING"
    assert updated_order["deliveryAttempts"] >= 1
    assert updated_order.get("ndr") is not None
    assert updated_order["ndr"]["courierAwb"] == "BD-NDR-776655"
    assert updated_order["ndr"]["recoveryStatus"] == "PENDING_ACTION"

    # Verify timeline event added
    timeline_events = [e["eventName"] for e in updated_order["timeline"]]
    assert any("Failed" in ev and "NDR" in ev for ev in timeline_events)


def test_tracking_webhook_signature_verification():
    """Test AfterShip HMAC-SHA256 signature verification."""
    secret = "test_webhook_secret_key"
    payload = json.dumps({"event": "tracking_update", "msg": {"order_id": "ord_101"}}).encode("utf-8")
    expected_sig = base64.b64encode(
        hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()
    ).decode("utf-8")

    # Valid signature
    assert verify_aftership_webhook_signature(payload, expected_sig, secret_override=secret) is True

    # Tampered signature
    assert verify_aftership_webhook_signature(payload, "invalid_sig_value", secret_override=secret) is False


def test_v1_router_tracking_endpoints(client):
    """Test /v1 versioned tracking endpoints."""
    # List couriers
    res = client.get("/v1/tracking/couriers")
    assert res.status_code == 200
    assert len(res.json()) >= 6

    # Register tracking via v1
    order_id = "ord_105"
    res = client.post(
        f"/v1/orders/{order_id}/tracking",
        json={
            "tracking_number": "XPB-V1-445566",
            "courier_code": "xpressbees",
        },
    )
    assert res.status_code == 200, res.text
    assert res.json()["tracking_number"] == "XPB-V1-445566"

    # Get tracking via v1
    res = client.get(f"/v1/orders/{order_id}/tracking")
    assert res.status_code == 200, res.text
    assert res.json()["tracking_number"] == "XPB-V1-445566"
