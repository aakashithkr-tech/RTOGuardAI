"""Automated tests for RTOGuardAI v1 Standalone Merchant API, Authentication, Origin Security, and SDK."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import pytest
from fastapi.testclient import TestClient

import database
from app import app
import api_keys
import src.serving as serving


@pytest.fixture
def client(tmp_path, monkeypatch):
    test_db = tmp_path / "test_merchant_v1.db"
    monkeypatch.setattr(database, "DEFAULT_DB_PATH", test_db)
    monkeypatch.setenv("DATABASE_PATH", str(test_db))
    monkeypatch.setenv("ADMIN_TOKEN", "admin_secret_token_999")
    monkeypatch.setenv("RATE_LIMIT_PER_MIN", "60")
    database.init_db()

    with TestClient(app) as test_client:
        yield test_client


def create_test_merchant(client, name="Test Merchant", allowed_domains=None, admin_token="admin_secret_token_999"):
    if allowed_domains is None:
        allowed_domains = ["https://mystore.example.com", "http://localhost:5173"]
    res = client.post(
        "/v1/admin/merchants",
        json={"name": name, "allowed_domains": allowed_domains, "mode": "test"},
        headers={"X-Admin-Token": admin_token},
    )
    assert res.status_code == 200, res.text
    return res.json()


# ---------------------------------------------------------------------------
# Test 1 & 2: Merchant & Key Generation, No Plaintext in DB
# ---------------------------------------------------------------------------


def test_merchant_creation_and_key_hashing(client):
    merchant = create_test_merchant(client, name="Acme Store")
    assert merchant["id"].startswith("merch_")
    assert merchant["name"] == "Acme Store"
    assert len(merchant["keys"]) == 2

    pub_key_obj = next(k for k in merchant["keys"] if k["type"] == "public")
    sec_key_obj = next(k for k in merchant["keys"] if k["type"] == "secret")

    assert pub_key_obj["key"].startswith("pk_test_")
    assert sec_key_obj["key"].startswith("sk_test_")

    # Verify plaintext keys are NOT stored in SQLite
    with database._connect() as conn:
        rows = conn.execute("SELECT key_hash, key_prefix, type FROM api_keys WHERE merchant_id = ?", (merchant["id"],)).fetchall()
        assert len(rows) == 2
        for r in rows:
            # Hash must be SHA-256 (64 hex characters)
            assert len(r["key_hash"]) == 64
            # Plaintext keys must not equal key_hash
            assert r["key_hash"] != pub_key_obj["key"]
            assert r["key_hash"] != sec_key_obj["key"]


# ---------------------------------------------------------------------------
# Test 3: Key Authentication, Revocation & Inactive Merchant
# ---------------------------------------------------------------------------


def test_api_key_lifecycle_and_validation(client):
    merchant = create_test_merchant(client, allowed_domains=["https://mystore.example.com"])
    pub_key = next(k for k in merchant["keys"] if k["type"] == "public")["key"]
    sec_key = next(k for k in merchant["keys"] if k["type"] == "secret")["key"]
    pub_key_id = next(k for k in merchant["keys"] if k["type"] == "public")["id"]

    sample_order = {
        "pincode": "560001",
        "address_line": "Cubbon Road, Bangalore",
        "order_value": 2499.0,
        "category": "fashion",
        "is_cod": True,
    }

    # 1. Valid Secret Key (no Origin required)
    r1 = client.post("/v1/score", json=sample_order, headers={"Authorization": f"Bearer {sec_key}"})
    assert r1.status_code == 200
    assert r1.json()["tier"] in ["ALLOW", "REVIEW", "BLOCK"]

    # 2. Invalid Key
    r_bad = client.post("/v1/score", json=sample_order, headers={"X-API-Key": "pk_test_completely_bogus"})
    assert r_bad.status_code == 401
    assert r_bad.json()["error"]["code"] == "invalid_api_key"

    # 3. Conflicting credentials in dual headers
    r_conflict = client.post(
        "/v1/score",
        json=sample_order,
        headers={"Authorization": f"Bearer {sec_key}", "X-API-Key": "sk_test_different_key"},
    )
    assert r_conflict.status_code == 401
    assert r_conflict.json()["error"]["code"] == "conflicting_credentials"

    # 4. Revoked Key
    rev = client.post(
        f"/v1/admin/merchants/{merchant['id']}/keys/{pub_key_id}/revoke",
        headers={"X-Admin-Token": "admin_secret_token_999"},
    )
    assert rev.status_code == 200

    r_revoked = client.post(
        "/v1/score",
        json=sample_order,
        headers={"X-API-Key": pub_key, "Origin": "https://mystore.example.com"},
    )
    assert r_revoked.status_code == 401
    assert r_revoked.json()["error"]["code"] == "invalid_api_key"

    # 5. Inactive Merchant
    deact = client.post(
        f"/v1/admin/merchants/{merchant['id']}/status",
        json={"active": False},
        headers={"X-Admin-Token": "admin_secret_token_999"},
    )
    assert deact.status_code == 200

    r_inactive = client.post("/v1/score", json=sample_order, headers={"X-API-Key": sec_key})
    assert r_inactive.status_code == 403
    assert r_inactive.json()["error"]["code"] == "inactive_merchant"


# ---------------------------------------------------------------------------
# Test 4 & 5: Public Key Origin Validation vs Secret Key
# ---------------------------------------------------------------------------


def test_public_key_origin_enforcement(client):
    merchant = create_test_merchant(client, allowed_domains=["https://shop.brand.com", "http://localhost:5173"])
    pub_key = next(k for k in merchant["keys"] if k["type"] == "public")["key"]
    sec_key = next(k for k in merchant["keys"] if k["type"] == "secret")["key"]

    sample_order = {
        "pincode": "110001",
        "address_line": "Connaught Place, Delhi",
        "order_value": 1499.0,
        "category": "fashion",
        "is_cod": True,
    }

    # Public key with valid Origin
    res_ok = client.post(
        "/v1/score",
        json=sample_order,
        headers={"X-API-Key": pub_key, "Origin": "https://shop.brand.com"},
    )
    assert res_ok.status_code == 200

    # Public key with missing Origin -> Rejected
    res_no_origin = client.post(
        "/v1/score",
        json=sample_order,
        headers={"X-API-Key": pub_key},
    )
    assert res_no_origin.status_code == 403
    assert res_no_origin.json()["error"]["code"] == "origin_not_allowed"

    # Public key with unauthorized Origin -> Rejected
    res_bad_origin = client.post(
        "/v1/score",
        json=sample_order,
        headers={"X-API-Key": pub_key, "Origin": "https://attacker.site"},
    )
    assert res_bad_origin.status_code == 403
    assert res_bad_origin.json()["error"]["code"] == "origin_not_allowed"

    # Public key with subdomain attack -> Rejected
    res_spoof = client.post(
        "/v1/score",
        json=sample_order,
        headers={"X-API-Key": pub_key, "Origin": "https://shop.brand.com.evil.com"},
    )
    assert res_spoof.status_code == 403

    # Secret key without Origin -> Approved
    res_sec = client.post(
        "/v1/score",
        json=sample_order,
        headers={"Authorization": f"Bearer {sec_key}"},
    )
    assert res_sec.status_code == 200


# ---------------------------------------------------------------------------
# Test 6: Rate Limiting & Retry-After Header
# ---------------------------------------------------------------------------


def test_rate_limiting_per_key(client, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_PER_MIN", "3")
    merchant = create_test_merchant(client)
    sec_key = next(k for k in merchant["keys"] if k["type"] == "secret")["key"]

    sample_order = {
        "pincode": "560001",
        "address_line": "Cubbon Road, Bangalore",
        "order_value": 1999.0,
        "category": "electronics",
        "is_cod": True,
    }

    # 3 allowed requests
    for _ in range(3):
        res = client.post("/v1/score", json=sample_order, headers={"X-API-Key": sec_key})
        assert res.status_code == 200

    # 4th request must be blocked
    res_blocked = client.post("/v1/score", json=sample_order, headers={"X-API-Key": sec_key})
    assert res_blocked.status_code == 429
    assert res_blocked.json()["error"]["code"] == "rate_limit_exceeded"
    assert "Retry-After" in res_blocked.headers
    retry_after = int(res_blocked.headers["Retry-After"])
    assert retry_after >= 1


# ---------------------------------------------------------------------------
# Test 7: Stable Response Contract & Validation
# ---------------------------------------------------------------------------


def test_v1_score_response_contract_and_validation(client):
    merchant = create_test_merchant(client)
    sec_key = next(k for k in merchant["keys"] if k["type"] == "secret")["key"]

    # 1. Validation rejection: 5-digit pincode
    bad_pin = client.post(
        "/v1/score",
        json={"pincode": "12345", "address_line": "Road 1", "order_value": 500, "category": "fashion"},
        headers={"X-API-Key": sec_key},
    )
    assert bad_pin.status_code == 422

    # 2. Validation rejection: negative order value
    bad_val = client.post(
        "/v1/score",
        json={"pincode": "110001", "address_line": "Road 1", "order_value": -100, "category": "fashion"},
        headers={"X-API-Key": sec_key},
    )
    assert bad_val.status_code == 422

    # 3. Successful score and stable response shape
    good_req = client.post(
        "/v1/score",
        json={
            "pincode": "110001",
            "address_line": "Connaught Place Central",
            "order_value": 2499.0,
            "category": "fashion",
            "is_cod": True,
            "customer_history": {
                "past_orders": 3,
                "past_rto_count": 0,
                "account_age_days": 90.0,
                "order_velocity_24h": 1,
            },
        },
        headers={"X-API-Key": sec_key},
    )
    assert good_req.status_code == 200
    data = good_req.json()

    assert data["api_version"] == "v1"
    assert data["request_id"].startswith("req_")
    assert data["tier"] in ["ALLOW", "REVIEW", "BLOCK"]
    assert isinstance(data["rto_probability"], float)
    assert isinstance(data["reasons"], list)
    assert isinstance(data["cod_available"], bool)
    assert isinstance(data["cod_fee_inr"], (int, float))
    assert isinstance(data["prepaid_discount_inr"], (int, float))
    assert isinstance(data["message"], str)
    assert isinstance(data["summary"], str)


# ---------------------------------------------------------------------------
# Test 8: Controlled Behavior When Model Unavailable
# ---------------------------------------------------------------------------


def test_model_unavailable_returns_controlled_503(client, monkeypatch):
    merchant = create_test_merchant(client)
    sec_key = next(k for k in merchant["keys"] if k["type"] == "secret")["key"]

    def fake_get_service():
        raise FileNotFoundError("models/final_model.joblib missing")

    monkeypatch.setattr(serving, "get_service", fake_get_service)

    res = client.post(
        "/v1/score",
        json={"pincode": "110001", "address_line": "Address", "order_value": 1000, "category": "fashion"},
        headers={"X-API-Key": sec_key},
    )
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "model_unavailable"


# ---------------------------------------------------------------------------
# Test 9: Merchant Usage Isolation
# ---------------------------------------------------------------------------


def test_merchant_usage_isolation(client):
    merch_a = create_test_merchant(client, name="Merchant Alpha")
    merch_b = create_test_merchant(client, name="Merchant Beta")

    key_a = next(k for k in merch_a["keys"] if k["type"] == "secret")["key"]
    key_b = next(k for k in merch_b["keys"] if k["type"] == "secret")["key"]

    order = {"pincode": "110001", "address_line": "Road 1", "order_value": 1000, "category": "fashion"}

    # Merchant A makes 2 scoring calls
    client.post("/v1/score", json=order, headers={"X-API-Key": key_a})
    client.post("/v1/score", json=order, headers={"X-API-Key": key_a})

    # Merchant B makes 1 scoring call
    client.post("/v1/score", json=order, headers={"X-API-Key": key_b})

    # Query usage for Merchant A
    usage_a = client.get("/v1/usage", headers={"X-API-Key": key_a}).json()
    assert usage_a["merchant_id"] == merch_a["id"]
    assert usage_a["total_requests"] == 2

    # Query usage for Merchant B
    usage_b = client.get("/v1/usage", headers={"X-API-Key": key_b}).json()
    assert usage_b["merchant_id"] == merch_b["id"]
    assert usage_b["total_requests"] == 1


# ---------------------------------------------------------------------------
# Test 10: CORS Preflight
# ---------------------------------------------------------------------------


def test_cors_preflight(client):
    create_test_merchant(client, allowed_domains=["https://mystore.example.com"])

    # 1. Approved origin preflight -> 200 OK with CORS headers
    res = client.options(
        "/v1/score",
        headers={
            "Origin": "https://mystore.example.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-API-Key, Content-Type",
        },
    )
    assert res.status_code == 200
    assert res.headers["Access-Control-Allow-Origin"] == "https://mystore.example.com"
    assert "Access-Control-Allow-Methods" in res.headers

    # 2. Unapproved origin preflight -> 403 Forbidden
    res_unapproved = client.options(
        "/v1/score",
        headers={
            "Origin": "https://unapproved-hacker.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-API-Key, Content-Type",
        },
    )
    assert res_unapproved.status_code == 403

    # 3. Admin preflight -> 403 Forbidden (no unrestricted CORS for admin)
    res_admin = client.options(
        "/v1/admin/merchants",
        headers={
            "Origin": "https://mystore.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert res_admin.status_code == 403


# ---------------------------------------------------------------------------
# Test 11: Admin Endpoints Reject Invalid Tokens & Fail Closed
# ---------------------------------------------------------------------------


def test_admin_token_protection(client, monkeypatch):
    # 1. Missing token
    r_missing = client.get("/v1/admin/merchants")
    assert r_missing.status_code == 401

    # 2. Incorrect token
    r_bad = client.get("/v1/admin/merchants", headers={"X-Admin-Token": "wrong_token"})
    assert r_bad.status_code == 401

    # 3. Unconfigured token fails closed
    monkeypatch.setenv("ADMIN_TOKEN", "")
    r_unconf = client.get("/v1/admin/merchants", headers={"X-Admin-Token": "any_token"})
    assert r_unconf.status_code == 401


# ---------------------------------------------------------------------------
# Test 12: WhatsApp Test Endpoint Protection
# ---------------------------------------------------------------------------


def test_whatsapp_test_endpoint_protection(client):
    # 1. Without admin token -> 401
    r1 = client.post("/api/v1/whatsapp/send-test", json={"to": "919999999999"})
    assert r1.status_code == 401

    # 2. With invalid admin token -> 401
    r2 = client.post(
        "/api/v1/whatsapp/send-test",
        json={"to": "919999999999"},
        headers={"X-Admin-Token": "invalid_token"},
    )
    assert r2.status_code == 401

    # 3. With valid admin token -> Passes admin authentication
    # (Will return 503 because WhatsApp credentials are not configured, confirming auth succeeded)
    r3 = client.post(
        "/api/v1/whatsapp/send-test",
        json={"to": "919999999999"},
        headers={"X-Admin-Token": "admin_secret_token_999"},
    )
    assert r3.status_code == 503
    assert "WhatsApp Cloud API credentials are not configured" in r3.json()["detail"]


# ---------------------------------------------------------------------------
# Test 13: Static SDK & Demo Availability
# ---------------------------------------------------------------------------


def test_sdk_and_demo_static_assets(client):
    r_sdk = client.get("/rtoguard.js")
    assert r_sdk.status_code == 200
    assert "application/javascript" in r_sdk.headers["content-type"]
    assert "RTOGuard" in r_sdk.text
    assert "score" in r_sdk.text

    r_demo = client.get("/integration-demo.html")
    assert r_demo.status_code == 200
    assert "text/html" in r_demo.headers["content-type"]
    assert "RTOGuardAI" in r_demo.text


# ---------------------------------------------------------------------------
# Test 14: Merchant Authentication (Signup, Login, Demo Login, Me, Keys)
# ---------------------------------------------------------------------------


def test_merchant_signup_and_login_flow(client):
    # 1. Signup
    signup_res = client.post(
        "/v1/auth/signup",
        json={
            "name": "Jane Merchant",
            "email": "jane@example.com",
            "password": "securepassword123",
            "store_name": "Jane Boutique",
            "allowed_domains": ["https://janeboutique.com"],
        },
    )
    assert signup_res.status_code == 201
    body = signup_res.json()
    assert "token" in body
    assert body["user"]["email"] == "jane@example.com"
    assert body["user"]["name"] == "Jane Merchant"
    assert "keys" in body
    assert len(body["keys"]) == 2
    session_token = body["token"]

    # 2. Get profile /v1/auth/me
    me_res = client.get(
        "/v1/auth/me",
        headers={"Authorization": f"Bearer {session_token}"},
    )
    assert me_res.status_code == 200
    assert me_res.json()["user"]["email"] == "jane@example.com"
    assert me_res.json()["merchant"]["name"] == "Jane Boutique"

    # 3. Duplicate email signup rejected
    dup_res = client.post(
        "/v1/auth/signup",
        json={
            "name": "Another Jane",
            "email": "jane@example.com",
            "password": "password999",
        },
    )
    assert dup_res.status_code == 400
    assert "already exists" in dup_res.json()["error"]["message"]

    # 4. Login with correct password
    login_res = client.post(
        "/v1/auth/login",
        json={"email": "jane@example.com", "password": "securepassword123"},
    )
    assert login_res.status_code == 200
    assert "token" in login_res.json()

    # 5. Login with invalid password
    bad_login = client.post(
        "/v1/auth/login",
        json={"email": "jane@example.com", "password": "wrongpassword"},
    )
    assert bad_login.status_code == 401


def test_demo_judge_login(client):
    # 1-click login for hackathon judges
    res = client.post("/v1/auth/demo-login")
    assert res.status_code == 200
    data = res.json()
    assert "token" in data
    assert data["user"]["email"] == "judge@rtoguard.ai"
    assert "keys" in data
    assert any(k["key"].startswith("pk_") for k in data["keys"])
    assert any(k["key"].startswith("sk_") for k in data["keys"])

    # Verify session works
    me_res = client.get(
        "/v1/auth/me",
        headers={"Authorization": f"Bearer {data['token']}"},
    )
    assert me_res.status_code == 200
    assert me_res.json()["user"]["email"] == "judge@rtoguard.ai"


def test_auth_key_generation(client):
    # Login as demo judge
    login_data = client.post("/v1/auth/demo-login").json()
    token = login_data["token"]

    # Request new keys
    gen_res = client.post(
        "/v1/auth/keys",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert gen_res.status_code == 201
    keys_data = gen_res.json()
    assert len(keys_data["keys"]) == 2
    assert keys_data["keys"][0]["key"].startswith("pk_")
    assert keys_data["keys"][1]["key"].startswith("sk_")

