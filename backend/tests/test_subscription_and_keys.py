"""Automated tests for RTOGuardAI Subscription Plans, Monthly Usage Metering,
Secure Key Lifecycle (One-time reveal, Rotation with Overlap, Instant Revocation),
and Decoupled Billing Provider.
"""

from __future__ import annotations

import datetime
import sqlite3
import pytest
from fastapi.testclient import TestClient

import database
from app import app
import api_keys
from services.billing import get_billing_provider, SimulatedBillingProvider


@pytest.fixture
def client(tmp_path, monkeypatch):
    test_db = tmp_path / "test_sub_keys.db"
    monkeypatch.setattr(database, "DEFAULT_DB_PATH", test_db)
    monkeypatch.setenv("DATABASE_PATH", str(test_db))
    monkeypatch.setenv("ADMIN_TOKEN", "test_admin_token_123")
    monkeypatch.setenv("BILLING_PROVIDER", "simulated")
    database.init_db()

    with TestClient(app) as test_client:
        yield test_client


def signup_merchant_user(client, email="merchant@example.com", password="SecurePassword123!", name="Test Merchant"):
    res = client.post(
        "/v1/auth/signup",
        json={
            "name": name,
            "email": email,
            "password": password,
            "store_name": f"{name} Store",
            "allowed_domains": ["http://localhost:5173", "https://mystore.com"],
        },
    )
    assert res.status_code in (200, 201), res.text
    return res.json()


# ---------------------------------------------------------------------------
# 1. One-Time Secret Key Reveal & Masking Invariant
# ---------------------------------------------------------------------------


def test_one_time_secret_reveal_and_masking(client):
    auth_data = signup_merchant_user(client, email="reveal@store.com")
    token = auth_data["token"]
    merchant = auth_data["merchant"]

    # Initial response must reveal the plaintext secret key once
    assert "secret_key_revealed" in auth_data
    secret_key_plain = auth_data["secret_key_revealed"]
    assert secret_key_plain.startswith("sk_test_")
    assert len(secret_key_plain) > 25

    # Subsequent GET /v1/auth/me MUST NOT return the plaintext secret key
    res = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    me_data = res.json()
    keys = me_data["merchant"]["keys"]

    sec_key_obj = next(k for k in keys if k["type"] == "secret")
    # Secret key must be masked with bullet characters
    assert "•" in sec_key_obj["key"]
    assert sec_key_obj["key"] != secret_key_plain
    assert sec_key_obj["key"].endswith(secret_key_plain[-4:])
    assert not sec_key_obj.get("is_revealed", False)


# ---------------------------------------------------------------------------
# 2. Key Rotation with Overlap Grace Period
# ---------------------------------------------------------------------------


def test_key_rotation_with_overlap(client):
    auth_data = signup_merchant_user(client, email="rotate@store.com")
    token = auth_data["token"]
    old_sk = auth_data["secret_key_revealed"]

    # Upgrade to premium so overlap grace periods are permitted
    api_keys.upgrade_merchant_plan(auth_data["user"]["merchant_id"], "premium")

    # Find the old secret key item ID
    me_res = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    old_sec_key_id = next(k["id"] for k in me_res.json()["merchant"]["keys"] if k["type"] == "secret")

    # Rotate key with 24 hours overlap
    rotate_res = client.post(
        "/v1/auth/keys/rotate",
        headers={"Authorization": f"Bearer {token}"},
        json={"old_key_id": old_sec_key_id, "overlap_hours": 24, "name": "Rotated Key Pair"},
    )
    assert rotate_res.status_code == 200, rotate_res.text
    rotate_data = rotate_res.json()

    new_sk = rotate_data.get("new_secret_key") or rotate_data.get("secret_key_revealed")
    assert new_sk.startswith("sk_test_")
    assert new_sk != old_sk
    assert rotate_data["overlap_expires_at"] is not None

    score_payload = {
        "pincode": "110001",
        "address_line": "Connaught Place, Delhi",
        "order_value": 1500.0,
        "category": "fashion",
        "is_cod": True,
    }

    # BOTH old key and new key must authenticate successfully during overlap
    res_old = client.post(
        "/v1/score",
        json=score_payload,
        headers={"Authorization": f"Bearer {old_sk}"},
    )
    assert res_old.status_code == 200, res_old.text

    res_new = client.post(
        "/v1/score",
        json=score_payload,
        headers={"Authorization": f"Bearer {new_sk}"},
    )
    assert res_new.status_code == 200, res_new.text


# ---------------------------------------------------------------------------
# 3. Instant Key Revocation
# ---------------------------------------------------------------------------


def test_instant_key_revocation(client):
    auth_data = signup_merchant_user(client, email="revoke@store.com")
    token = auth_data["token"]
    sk = auth_data["secret_key_revealed"]

    me_res = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    sec_key_id = next(k["id"] for k in me_res.json()["merchant"]["keys"] if k["type"] == "secret")

    score_payload = {
        "pincode": "560001",
        "address_line": "MG Road, Bangalore",
        "order_value": 2000.0,
        "category": "electronics",
        "is_cod": True,
    }

    # First verify key works
    res_before = client.post(
        "/v1/score",
        json=score_payload,
        headers={"Authorization": f"Bearer {sk}"},
    )
    assert res_before.status_code == 200

    # Revoke key
    revoke_res = client.post(
        f"/v1/auth/keys/{sec_key_id}/revoke",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert revoke_res.status_code == 200
    assert revoke_res.json()["ok"] is True

    # Immediate rejection with 401 Unauthorized
    res_after = client.post(
        "/v1/score",
        json=score_payload,
        headers={"Authorization": f"Bearer {sk}"},
    )
    assert res_after.status_code == 401
    assert res_after.json()["error"]["code"] == "invalid_api_key"


# ---------------------------------------------------------------------------
# 4. Server-Side Monthly Quota Enforcement (HTTP 429 quota_exceeded)
# ---------------------------------------------------------------------------


def test_monthly_quota_enforcement(client):
    auth_data = signup_merchant_user(client, email="quota@store.com")
    merchant_id = auth_data["user"]["merchant_id"]
    sk = auth_data["secret_key_revealed"]

    score_payload = {
        "pincode": "400001",
        "address_line": "Fort, Mumbai",
        "order_value": 999.0,
        "category": "fashion",
        "is_cod": True,
    }

    # Artificially set monthly usage to limit (Free limit = 100)
    month_bucket = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m")
    with database._connect() as conn:
        conn.execute(
            """
            INSERT INTO merchant_usage_monthly (merchant_id, month_bucket, billable_count)
            VALUES (?, ?, 100)
            ON CONFLICT(merchant_id, month_bucket) DO UPDATE SET billable_count = 100
            """,
            (merchant_id, month_bucket),
        )

    # Next scoring call must return 429 quota_exceeded
    res = client.post(
        "/v1/score",
        json=score_payload,
        headers={"Authorization": f"Bearer {sk}"},
    )
    assert res.status_code == 429, res.text
    err = res.json()["error"]
    assert err["code"] == "quota_exceeded"
    assert "quota" in err["message"].lower()


# ---------------------------------------------------------------------------
# 5. Plan Upgrade from Free to Premium & Quota Expansion
# ---------------------------------------------------------------------------


def test_plan_upgrade_expands_quota(client):
    auth_data = signup_merchant_user(client, email="upgrade@store.com")
    merchant_id = auth_data["user"]["merchant_id"]
    token = auth_data["token"]
    sk = auth_data["secret_key_revealed"]

    # Saturate free quota (100)
    month_bucket = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m")
    with database._connect() as conn:
        conn.execute(
            """
            INSERT INTO merchant_usage_monthly (merchant_id, month_bucket, billable_count)
            VALUES (?, ?, 100)
            ON CONFLICT(merchant_id, month_bucket) DO UPDATE SET billable_count = 100
            """,
            (merchant_id, month_bucket),
        )

    # Verify score is blocked on Free plan
    score_payload = {"pincode": "110001", "address_line": "CP, Delhi", "order_value": 1200.0, "category": "fashion", "is_cod": True}
    res_blocked = client.post("/v1/score", json=score_payload, headers={"Authorization": f"Bearer {sk}"})
    assert res_blocked.status_code == 429

    # Create billing order for Premium
    order_res = client.post("/v1/billing/create-order", json={"plan": "premium"}, headers={"Authorization": f"Bearer {token}"})
    assert order_res.status_code == 200
    order_data = order_res.json()
    assert order_data["plan"] == "premium"
    assert order_data["amount"] == 249900  # 2499 INR in paise

    # Verify payment (simulated provider)
    verify_res = client.post(
        "/v1/billing/verify",
        json={
            "order_id": order_data["order_id"],
            "payment_id": "pay_simulated_987",
            "signature": "sim_sig",
            "plan": "premium",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert verify_res.status_code == 200
    assert verify_res.json()["plan"] == "premium"
    assert verify_res.json()["monthly_quota"] == 5000

    # Now the score request must succeed because Premium quota is 5,000!
    res_unblocked = client.post("/v1/score", json=score_payload, headers={"Authorization": f"Bearer {sk}"})
    assert res_unblocked.status_code == 200
    assert res_unblocked.json()["tier"] in ["ALLOW", "REVIEW", "BLOCK"]

    # Verify usage endpoint reflects 5,000 quota
    usage_res = client.get("/v1/billing/usage", headers={"Authorization": f"Bearer {token}"})
    assert usage_res.status_code == 200
    usage_data = usage_res.json()
    assert usage_data["plan"] == "premium"
    assert usage_data["monthly_quota"] == 5000
    assert usage_data["max_keys"] == 5
    assert usage_data["can_rotate_with_overlap"] is True
