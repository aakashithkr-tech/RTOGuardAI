"""Merchant management, API key generation, verification, origin checks, and rate limiting."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import secrets
import sqlite3
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Literal, Optional
from fastapi import Header, HTTPException, Request, status
from pydantic import BaseModel, Field

import database

logger = logging.getLogger("rtoguard.api_keys")

DEFAULT_RATE_LIMIT_PER_MIN = 60


def get_rate_limit_per_min() -> int:
    try:
        return int(os.environ.get("RATE_LIMIT_PER_MIN", str(DEFAULT_RATE_LIMIT_PER_MIN)))
    except (ValueError, TypeError):
        return DEFAULT_RATE_LIMIT_PER_MIN


def get_admin_token() -> str:
    return os.environ.get("ADMIN_TOKEN", "").strip()


def hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.strip().encode("utf-8")).hexdigest()


DEFAULT_FREE_QUOTA = 100
DEFAULT_PREMIUM_QUOTA = int(os.environ.get("PREMIUM_MONTHLY_QUOTA", "5000"))
DEFAULT_PREMIUM_PRICE_INR = float(os.environ.get("PREMIUM_PRICE_INR", "2499.0"))

PLAN_CONFIGS = {
    "free": {
        "name": "Free",
        "monthly_quota": DEFAULT_FREE_QUOTA,
        "rate_limit_per_min": 60,
        "max_active_keys": 1,
        "price_inr": 0.0,
        "features": [
            "100 API requests / month",
            "1 active key pair",
            "CatBoost ML RTO scoring",
            "Standard rate limit (60 req/min)",
            "Basic usage statistics",
        ],
    },
    "premium": {
        "name": "Premium Pro",
        "monthly_quota": DEFAULT_PREMIUM_QUOTA,
        "rate_limit_per_min": 300,
        "max_active_keys": 5,
        "price_inr": DEFAULT_PREMIUM_PRICE_INR,
        "features": [
            f"{DEFAULT_PREMIUM_QUOTA:,} API requests / month",
            "Up to 5 active key pairs (Dev, Staging, Prod)",
            "CatBoost ML + SHAP feature explanations",
            "High rate limit (300 req/min)",
            "24-hour key rotation overlap grace period",
            "Full audit logs & usage analytics",
            "Priority developer support",
        ],
    },
}


def mask_secret_key(prefix_or_raw: str) -> str:
    """Mask secret key for safe UI display: sk_test_••••••••••••1234"""
    clean = str(prefix_or_raw or "").strip()
    suffix = clean[-4:] if len(clean) >= 4 else "0000"
    mode = "live" if "_live_" in clean else "test"
    return f"sk_{mode}_{'•' * 12}{suffix}"


def generate_key_prefix(raw_key: str) -> str:
    """Generate displayable prefix preserving last 4 characters for masking."""
    clean = raw_key.strip()
    prefix = clean[:8]
    suffix = clean[-4:] if len(clean) >= 4 else "0000"
    return f"{prefix}...{suffix}"


def generate_secure_key(key_type: Literal["public", "secret"], mode: Literal["test", "live"] = "test") -> str:
    prefix = "pk" if key_type == "public" else "sk"
    env_tag = "live" if mode == "live" else "test"
    random_part = secrets.token_urlsafe(24).replace("-", "").replace("_", "")[:32]
    return f"{prefix}_{env_tag}_{random_part}"


class MerchantCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    allowed_domains: list[str] = Field(default_factory=list)
    mode: Literal["test", "live"] = "test"


class MerchantStatusIn(BaseModel):
    active: bool


def create_merchant(
    name: str,
    allowed_domains: list[str],
    mode: Literal["test", "live"] = "test",
) -> dict[str, Any]:
    """Create a merchant and issue one public and one secret key atomically.
    
    The plaintext keys are returned ONLY in the result of this function.
    They are never stored or retrievable again.
    """
    database.init_db()
    merchant_id = f"merch_{secrets.token_hex(8)}"
    now = datetime.now(timezone.utc).isoformat()

    pub_key_id = f"key_{secrets.token_hex(8)}"
    pub_plain = generate_secure_key("public", mode)
    pub_hash = hash_key(pub_plain)
    pub_prefix = generate_key_prefix(pub_plain)

    sec_key_id = f"key_{secrets.token_hex(8)}"
    sec_plain = generate_secure_key("secret", mode)
    sec_hash = hash_key(sec_plain)
    sec_prefix = generate_key_prefix(sec_plain)

    domains_json = json.dumps(allowed_domains)

    with database._connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute(
                """
                INSERT INTO merchants (id, name, allowed_domains, created_at, active)
                VALUES (?, ?, ?, ?, 1)
                """,
                (merchant_id, name.strip(), domains_json, now),
            )
            conn.execute(
                """
                INSERT INTO api_keys (id, merchant_id, key_hash, key_prefix, type, created_at, revoked)
                VALUES (?, ?, ?, ?, 'public', ?, 0)
                """,
                (pub_key_id, merchant_id, pub_hash, pub_prefix, now),
            )
            conn.execute(
                """
                INSERT INTO api_keys (id, merchant_id, key_hash, key_prefix, type, created_at, revoked)
                VALUES (?, ?, ?, ?, 'secret', ?, 0)
                """,
                (sec_key_id, merchant_id, sec_hash, sec_prefix, now),
            )
            conn.commit()
        except Exception as exc:
            conn.rollback()
            logger.error("Failed to create merchant atomically: %s", exc)
            raise RuntimeError("Database error creating merchant credentials") from exc

    return {
        "id": merchant_id,
        "name": name.strip(),
        "allowed_domains": allowed_domains,
        "created_at": now,
        "active": True,
        "keys": [
            {
                "id": pub_key_id,
                "type": "public",
                "key": pub_plain,
                "prefix": pub_prefix,
                "created_at": now,
            },
            {
                "id": sec_key_id,
                "type": "secret",
                "key": sec_plain,
                "prefix": sec_prefix,
                "created_at": now,
            },
        ],
    }


def list_merchants() -> list[dict[str, Any]]:
    """List merchant metadata with safe key metadata, never plaintext keys or key hashes."""
    database.init_db()
    with database._connect() as conn:
        merchants_cur = conn.execute(
            "SELECT id, name, allowed_domains, created_at, active FROM merchants ORDER BY created_at DESC"
        )
        merchants = []
        for m_row in merchants_cur.fetchall():
            m_id = m_row["id"]
            keys_cur = conn.execute(
                """
                SELECT id, type, key_prefix, created_at, revoked
                FROM api_keys
                WHERE merchant_id = ?
                ORDER BY created_at ASC
                """,
                (m_id,),
            )
            keys = [
                {
                    "id": k["id"],
                    "type": k["type"],
                    "prefix": k["key_prefix"],
                    "created_at": k["created_at"],
                    "revoked": bool(k["revoked"]),
                }
                for k in keys_cur.fetchall()
            ]
            try:
                domains = json.loads(m_row["allowed_domains"])
            except Exception:
                domains = []

            merchants.append({
                "id": m_id,
                "name": m_row["name"],
                "allowed_domains": domains,
                "created_at": m_row["created_at"],
                "active": bool(m_row["active"]),
                "keys": keys,
            })
        return merchants


def get_merchant_by_id(merchant_id: str) -> Optional[dict[str, Any]]:
    database.init_db()
    with database._connect() as conn:
        row = conn.execute(
            """
            SELECT id, name, allowed_domains, created_at, active, plan, monthly_quota, billing_status, plan_expires_at
            FROM merchants WHERE id = ?
            """,
            (merchant_id,),
        ).fetchone()
        if not row:
            return None
        keys_cur = conn.execute(
            """
            SELECT id, type, key_prefix, created_at, revoked, name, expires_at, revoked_at, last_used_at
            FROM api_keys
            WHERE merchant_id = ?
            ORDER BY created_at DESC
            """,
            (merchant_id,),
        )
        keys = []
        now_dt = datetime.now(timezone.utc)
        for k in keys_cur.fetchall():
            k_type = k["type"]
            k_prefix = k["key_prefix"]
            is_revoked = bool(k["revoked"])
            expires_at = k["expires_at"]
            if is_revoked:
                status = "revoked"
            elif expires_at:
                try:
                    exp_dt = datetime.fromisoformat(expires_at)
                    status = "expired" if now_dt > exp_dt else "expiring"
                except Exception:
                    status = "expired"
            else:
                status = "active"

            display_key = k_prefix if k_type == "public" else mask_secret_key(k_prefix)

            keys.append({
                "id": k["id"],
                "type": k_type,
                "name": k["name"] or ("Public Client Key" if k_type == "public" else "Server Secret Key"),
                "prefix": k_prefix,
                "key": display_key,
                "display_key": display_key,
                "created_at": k["created_at"],
                "expires_at": expires_at,
                "revoked": is_revoked,
                "revoked_at": k["revoked_at"],
                "last_used_at": k["last_used_at"],
                "status": status,
            })

        try:
            domains = json.loads(row["allowed_domains"])
        except Exception:
            domains = []

        plan = row["plan"] if "plan" in row.keys() and row["plan"] else "free"
        quota = row["monthly_quota"] if "monthly_quota" in row.keys() and row["monthly_quota"] else 100
        billing_status = row["billing_status"] if "billing_status" in row.keys() and row["billing_status"] else "active"
        plan_expires_at = row["plan_expires_at"] if "plan_expires_at" in row.keys() else None

        return {
            "id": row["id"],
            "name": row["name"],
            "allowed_domains": domains,
            "created_at": row["created_at"],
            "active": bool(row["active"]),
            "plan": plan,
            "monthly_quota": quota,
            "billing_status": billing_status,
            "plan_expires_at": plan_expires_at,
            "keys": keys,
        }


def revoke_key(merchant_id: str, key_id: str, actor_id: str = "system") -> bool:
    database.init_db()
    now_iso = datetime.now(timezone.utc).isoformat()
    with database._connect() as conn:
        cur = conn.execute(
            "UPDATE api_keys SET revoked = 1, revoked_at = ? WHERE id = ? AND merchant_id = ? AND revoked = 0",
            (now_iso, key_id, merchant_id),
        )
        conn.commit()
        success = cur.rowcount > 0

    if success:
        record_audit_log(
            merchant_id=merchant_id,
            actor_id=actor_id,
            action="key.revoked",
            resource_type="api_key",
            resource_id=key_id,
            details={"revoked_at": now_iso},
        )
    return success


def set_merchant_status(merchant_id: str, active: bool) -> bool:
    database.init_db()
    with database._connect() as conn:
        cur = conn.execute(
            "UPDATE merchants SET active = ? WHERE id = ?",
            (1 if active else 0, merchant_id),
        )
        conn.commit()
        return cur.rowcount > 0


def verify_api_key(raw_key: str) -> tuple[Optional[dict[str, Any]], Optional[str]]:
    """Verify an API key using constant-time hash comparison and checks expiration/revocation."""
    if not raw_key or not isinstance(raw_key, str):
        return None, "invalid_api_key"

    target_hash = hash_key(raw_key)
    database.init_db()

    with database._connect() as conn:
        row = conn.execute(
            """
            SELECT k.id AS key_id, k.merchant_id, k.key_hash, k.key_prefix, k.type, k.revoked, k.expires_at,
                   m.id AS m_id, m.name AS merchant_name, m.allowed_domains, m.active AS merchant_active,
                   m.plan, m.monthly_quota
            FROM api_keys k
            JOIN merchants m ON k.merchant_id = m.id
            WHERE k.key_hash = ?
            """,
            (target_hash,),
        ).fetchone()

        if not row:
            return None, "invalid_api_key"

        # Constant-time comparison
        if not hmac.compare_digest(row["key_hash"], target_hash):
            return None, "invalid_api_key"

        if row["revoked"]:
            return None, "revoked_api_key"

        if "expires_at" in row.keys() and row["expires_at"]:
            try:
                exp_dt = datetime.fromisoformat(row["expires_at"])
                if datetime.now(timezone.utc) > exp_dt:
                    return None, "revoked_api_key"
            except Exception:
                return None, "revoked_api_key"

        if not row["merchant_active"]:
            return None, "inactive_merchant"

        try:
            domains = json.loads(row["allowed_domains"])
        except Exception:
            domains = []

        now_iso = datetime.now(timezone.utc).isoformat()
        try:
            conn.execute("UPDATE api_keys SET last_used_at = ? WHERE id = ?", (now_iso, row["key_id"]))
            conn.commit()
        except Exception:
            pass

        return {
            "key_id": row["key_id"],
            "merchant_id": row["merchant_id"],
            "merchant_name": row["merchant_name"],
            "key_prefix": row["key_prefix"],
            "key_type": row["type"],
            "allowed_domains": domains,
            "mode": "live" if "_live_" in row["key_prefix"] else "test",
            "plan": row["plan"] if "plan" in row.keys() and row["plan"] else "free",
            "monthly_quota": row["monthly_quota"] if "monthly_quota" in row.keys() and row["monthly_quota"] else 100,
        }, None


def normalize_origin(origin: str) -> Optional[str]:
    """Parse and normalize scheme, hostname, and port for exact origin matching."""
    origin = origin.strip()
    if not origin:
        return None

    # Handle cases where client provided just host/domain vs full URL
    if not (origin.startswith("http://") or origin.startswith("https://")):
        origin = f"https://{origin}"

    try:
        parsed = urllib.parse.urlparse(origin)
        scheme = parsed.scheme.lower()
        if scheme not in ("http", "https"):
            return None
        hostname = (parsed.hostname or "").lower()
        if not hostname:
            return None
        port = parsed.port
        # Default ports omitted
        if (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
            port = None

        if port:
            return f"{scheme}://{hostname}:{port}"
        return f"{scheme}://{hostname}"
    except Exception:
        return None


def validate_origin(origin_header: Optional[str], allowed_domains: list[str]) -> bool:
    """Validate that the request Origin header exactly matches an approved domain.
    
    Rejects missing origins, malformed origins, wildcards, and substring matches.
    """
    if not origin_header:
        return False

    norm_req_origin = normalize_origin(origin_header)
    if not norm_req_origin:
        return False

    parsed_req = urllib.parse.urlparse(norm_req_origin)
    req_host = (parsed_req.hostname or "").lower()

    for item in allowed_domains:
        if not item or not isinstance(item, str):
            continue
        item_str = item.strip()
        norm_item = normalize_origin(item_str)
        if norm_item and norm_req_origin == norm_item:
            return True

        # Also permit exact hostname matching if the merchant configured just hostname e.g. "localhost" or "myshop.com"
        clean_item = item_str.lower().split("/")[0].split(":")[0]
        if clean_item and clean_item == req_host:
            # If item specified port, ensure port matches
            if ":" in item_str:
                parts = item_str.lower().split(":")
                try:
                    expected_port = int(parts[1].split("/")[0])
                    if parsed_req.port == expected_port:
                        return True
                except ValueError:
                    pass
            elif parsed_req.port is None or (parsed_req.scheme == "http" and parsed_req.port == 80) or (parsed_req.scheme == "https" and parsed_req.port == 443):
                return True

    return False


def is_approved_merchant_origin(origin_header: Optional[str]) -> bool:
    """Check if the given origin is approved across any active merchant."""
    if not origin_header:
        return False
    database.init_db()
    with database._connect() as conn:
        rows = conn.execute("SELECT allowed_domains FROM merchants WHERE active = 1").fetchall()
        for r in rows:
            try:
                domains = json.loads(r["allowed_domains"])
                if validate_origin(origin_header, domains):
                    return True
            except Exception:
                pass
    return False


def check_and_record_rate_limit(key_hash: str, limit_per_min: int) -> tuple[bool, int]:
    """Check rate limit for the API key using SQLite minute-buckets.
    
    Returns:
        (is_allowed: bool, retry_after_seconds: int)
    """
    now = datetime.now(timezone.utc)
    minute_bucket = now.strftime("%Y-%m-%dT%H:%M")
    retry_after = max(1, 60 - now.second)

    database.init_db()
    with database._connect() as conn:
        # Atomic upsert and increment
        conn.execute(
            """
            INSERT INTO api_key_rate_limits (key_hash, minute_bucket, request_count)
            VALUES (?, ?, 1)
            ON CONFLICT(key_hash, minute_bucket) DO UPDATE SET request_count = request_count + 1
            """,
            (key_hash, minute_bucket),
        )
        row = conn.execute(
            "SELECT request_count FROM api_key_rate_limits WHERE key_hash = ? AND minute_bucket = ?",
            (key_hash, minute_bucket),
        ).fetchone()
        conn.commit()

        if row and row["request_count"] > limit_per_min:
            return False, retry_after

        # Clean up older buckets (keep last 10 minutes)
        if now.second < 2:  # Occasional cleanup
            ten_mins_ago = (now.timestamp() - 600)
            ten_mins_bucket = datetime.fromtimestamp(ten_mins_ago, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M")
            conn.execute("DELETE FROM api_key_rate_limits WHERE minute_bucket < ?", (ten_mins_bucket,))
            conn.commit()

        return True, 0


def record_usage(merchant_id: str, api_key_id: str, endpoint: str, status_code: int) -> None:
    now = datetime.now(timezone.utc).isoformat()
    try:
        with database._connect() as conn:
            conn.execute(
                """
                INSERT INTO merchant_usage (merchant_id, api_key_id, endpoint, status_code, timestamp)
                VALUES (?, ?, ?, ?, ?)
                """,
                (merchant_id, api_key_id, endpoint, status_code, now),
            )
            conn.commit()
    except Exception as exc:
        logger.warning("Failed to record usage tracking: %s", exc)


def get_merchant_usage_stats(merchant_id: str) -> dict[str, Any]:
    database.init_db()
    with database._connect() as conn:
        total = conn.execute(
            "SELECT COUNT(*) AS c FROM merchant_usage WHERE merchant_id = ?",
            (merchant_id,),
        ).fetchone()["c"]
        success = conn.execute(
            "SELECT COUNT(*) AS c FROM merchant_usage WHERE merchant_id = ? AND status_code < 400",
            (merchant_id,),
        ).fetchone()["c"]
        recent_rows = conn.execute(
            """
            SELECT endpoint, status_code, timestamp
            FROM merchant_usage
            WHERE merchant_id = ?
            ORDER BY id DESC LIMIT 10
            """,
            (merchant_id,),
        ).fetchall()

        recent = [
            {
                "endpoint": r["endpoint"],
                "status_code": r["status_code"],
                "timestamp": r["timestamp"],
            }
            for r in recent_rows
        ]

        return {
            "merchant_id": merchant_id,
            "total_requests": total,
            "successful_requests": success,
            "rate_limit_per_min": get_rate_limit_per_min(),
            "recent_activity": recent,
        }


def authenticate_admin_request(x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token")) -> str:
    """Dependency for protecting admin routes. Fails closed if ADMIN_TOKEN is not configured."""
    expected_token = get_admin_token()
    if not expected_token:
        # Fail closed: admin endpoints must not become publicly accessible when unconfigured
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": {"code": "admin_disabled", "message": "Admin API token is not configured on this server."}},
        )

    if not x_admin_token or not hmac.compare_digest(x_admin_token.strip(), expected_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": {"code": "unauthorized_admin", "message": "Invalid or missing X-Admin-Token header."}},
        )

    return x_admin_token


# ---------------------------------------------------------------------------
# Merchant User Authentication (Signup & Login)
# ---------------------------------------------------------------------------


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    kdf = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
    return f"{salt.hex()}${kdf.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        salt_hex, hash_hex = password_hash.split("$")
        salt = bytes.fromhex(salt_hex)
        kdf = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
        return hmac.compare_digest(kdf.hex(), hash_hex)
    except Exception:
        return False


def register_merchant_account(
    name: str,
    email: str,
    password: str,
    store_name: Optional[str] = None,
    allowed_domains: Optional[list[str]] = None,
) -> dict[str, Any]:
    """Register a new merchant user account and generate initial API keys."""
    email_clean = email.strip().lower()
    if not email_clean or "@" not in email_clean:
        raise ValueError("A valid email address is required.")
    if len(password) < 6:
        raise ValueError("Password must be at least 6 characters.")

    database.init_db()
    with database._connect() as conn:
        existing = conn.execute("SELECT id FROM users WHERE email = ?", (email_clean,)).fetchone()
        if existing:
            raise ValueError("An account with this email address already exists.")

    display_store = (store_name or f"{name.strip()}'s Store").strip()
    domains = allowed_domains or ["http://localhost:5173", "http://localhost:8000"]

    # Provision merchant and key pair
    merchant = create_merchant(name=display_store, allowed_domains=domains, mode="test")
    user_id = f"usr_{secrets.token_hex(8)}"
    p_hash = hash_password(password)
    now = datetime.now(timezone.utc).isoformat()

    # Session token
    token = secrets.token_hex(32)
    expires = (datetime.now(timezone.utc).timestamp() + 30 * 86400)
    expires_str = datetime.fromtimestamp(expires, tz=timezone.utc).isoformat()

    with database._connect() as conn:
        conn.execute(
            """
            INSERT INTO users (id, merchant_id, email, password_hash, name, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user_id, merchant["id"], email_clean, p_hash, name.strip(), now),
        )
        conn.execute(
            """
            INSERT INTO user_sessions (token, user_id, merchant_id, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (token, user_id, merchant["id"], now, expires_str),
        )
        conn.commit()

    secret_key_plain = next((k["key"] for k in merchant.get("keys", []) if k.get("type") == "secret"), None)
    return {
        "token": token,
        "user": {
            "id": user_id,
            "name": name.strip(),
            "email": email_clean,
            "merchant_id": merchant["id"],
        },
        "merchant": merchant,
        "keys": merchant["keys"],
        "secret_key_revealed": secret_key_plain,
        "warning": "Copy your secret key now. RTOGuardAI never displays it again.",
    }


def login_merchant_account(email: str, password: str) -> dict[str, Any]:
    """Authenticate an existing merchant user and issue a new session token."""
    email_clean = email.strip().lower()
    database.init_db()
    with database._connect() as conn:
        user = conn.execute(
            "SELECT id, merchant_id, email, password_hash, name FROM users WHERE email = ?",
            (email_clean,),
        ).fetchone()

        if not user or not verify_password(password, user["password_hash"]):
            raise ValueError("Invalid email or password.")

        user_id = user["id"]
        merchant_id = user["merchant_id"]
        token = secrets.token_hex(32)
        now = datetime.now(timezone.utc).isoformat()
        expires = (datetime.now(timezone.utc).timestamp() + 30 * 86400)
        expires_str = datetime.fromtimestamp(expires, tz=timezone.utc).isoformat()

        conn.execute(
            """
            INSERT INTO user_sessions (token, user_id, merchant_id, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (token, user_id, merchant_id, now, expires_str),
        )
        conn.commit()

    merchant = get_merchant_by_id(merchant_id)
    return {
        "token": token,
        "user": {
            "id": user_id,
            "name": user["name"],
            "email": user["email"],
            "merchant_id": merchant_id,
        },
        "merchant": merchant,
    }


def get_user_session(token: str) -> Optional[dict[str, Any]]:
    if not token:
        return None
    database.init_db()
    now_iso = datetime.now(timezone.utc).isoformat()
    with database._connect() as conn:
        session = conn.execute(
            """
            SELECT s.token, s.user_id, s.merchant_id, u.name, u.email
            FROM user_sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ? AND s.expires_at > ?
            """,
            (token, now_iso),
        ).fetchone()

        if not session:
            return None

        merchant = get_merchant_by_id(session["merchant_id"])
        return {
            "token": session["token"],
            "user": {
                "id": session["user_id"],
                "name": session["name"],
                "email": session["email"],
                "merchant_id": session["merchant_id"],
            },
            "merchant": merchant,
        }


def create_key_pair(
    merchant_id: str,
    name: str = "Default Key Pair",
    mode: Literal["test", "live"] = "test",
    actor_id: str = "system",
) -> list[dict[str, Any]]:
    """Create a new public/secret key pair for a merchant and return initial plaintext keys.
    
    Enforces active key limits based on merchant plan tier (Free: 1, Premium: 5).
    """
    database.init_db()
    with database._connect() as conn:
        m_row = conn.execute("SELECT plan FROM merchants WHERE id = ?", (merchant_id,)).fetchone()
        plan_name = m_row["plan"] if m_row and "plan" in m_row.keys() and m_row["plan"] else "free"
        plan_cfg = PLAN_CONFIGS.get(plan_name, PLAN_CONFIGS["free"])
        max_keys = plan_cfg["max_active_keys"]

        active_count = conn.execute(
            "SELECT COUNT(DISTINCT id) AS c FROM api_keys WHERE merchant_id = ? AND type = 'secret' AND revoked = 0",
            (merchant_id,),
        ).fetchone()["c"]

        if active_count >= max_keys:
            raise ValueError(
                f"Active key pair limit reached for plan '{plan_name}' (max {max_keys}). "
                f"Revoke an unused key, use key rotation, or upgrade to Premium for up to 5 pairs."
            )

    pub_plain = generate_secure_key("public", mode)
    pub_hash = hash_key(pub_plain)
    pub_prefix = generate_key_prefix(pub_plain)

    sec_plain = generate_secure_key("secret", mode)
    sec_hash = hash_key(sec_plain)
    sec_prefix = generate_key_prefix(sec_plain)

    pub_key_id = f"key_{secrets.token_hex(8)}"
    sec_key_id = f"key_{secrets.token_hex(8)}"
    now = datetime.now(timezone.utc).isoformat()

    with database._connect() as conn:
        conn.execute(
            """
            INSERT INTO api_keys (id, merchant_id, type, key_hash, key_prefix, created_at, revoked, name)
            VALUES (?, ?, 'public', ?, ?, ?, 0, ?)
            """,
            (pub_key_id, merchant_id, pub_hash, pub_prefix, now, f"{name} (Browser)"),
        )
        conn.execute(
            """
            INSERT INTO api_keys (id, merchant_id, type, key_hash, key_prefix, created_at, revoked, name)
            VALUES (?, ?, 'secret', ?, ?, ?, 0, ?)
            """,
            (sec_key_id, merchant_id, sec_hash, sec_prefix, now, f"{name} (Server)"),
        )
        conn.commit()

    record_audit_log(
        merchant_id=merchant_id,
        actor_id=actor_id,
        action="key.created",
        resource_type="api_key",
        resource_id=sec_key_id,
        details={"name": name, "public_key_id": pub_key_id, "secret_key_id": sec_key_id},
    )

    return [
        {
            "id": pub_key_id,
            "type": "public",
            "key": pub_plain,
            "prefix": pub_prefix,
            "created_at": now,
        },
        {
            "id": sec_key_id,
            "type": "secret",
            "key": sec_plain,
            "prefix": sec_prefix,
            "created_at": now,
        },
    ]


def rotate_key_pair(
    merchant_id: str,
    key_id: str,
    overlap_hours: int = 24,
    actor_id: str = "system",
) -> dict[str, Any]:
    """Rotate an existing key pair. Returns new plaintext keys once with an optional overlap grace period."""
    database.init_db()
    with database._connect() as conn:
        target = conn.execute(
            "SELECT id, type, merchant_id, revoked FROM api_keys WHERE id = ? AND merchant_id = ?",
            (key_id, merchant_id),
        ).fetchone()
        if not target:
            raise ValueError("Target API key not found.")
        if target["revoked"]:
            raise ValueError("Cannot rotate a revoked API key.")

    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat()

    if overlap_hours > 0:
        expires_at = datetime.fromtimestamp(now_dt.timestamp() + overlap_hours * 3600, tz=timezone.utc).isoformat()
    else:
        expires_at = now_iso

    mode = "test"
    pub_plain = generate_secure_key("public", mode)
    pub_hash = hash_key(pub_plain)
    pub_prefix = generate_key_prefix(pub_plain)
    pub_key_id = f"key_{secrets.token_hex(8)}"

    sec_plain = generate_secure_key("secret", mode)
    sec_hash = hash_key(sec_plain)
    sec_prefix = generate_key_prefix(sec_plain)
    sec_key_id = f"key_{secrets.token_hex(8)}"

    with database._connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            if overlap_hours > 0:
                conn.execute(
                    "UPDATE api_keys SET expires_at = ? WHERE id = ? AND merchant_id = ?",
                    (expires_at, key_id, merchant_id),
                )
            else:
                conn.execute(
                    "UPDATE api_keys SET revoked = 1, revoked_at = ? WHERE id = ? AND merchant_id = ?",
                    (now_iso, key_id, merchant_id),
                )

            conn.execute(
                """
                INSERT INTO api_keys (id, merchant_id, type, key_hash, key_prefix, created_at, revoked, name)
                VALUES (?, ?, 'public', ?, ?, ?, 0, 'Rotated Key (Browser)')
                """,
                (pub_key_id, merchant_id, pub_hash, pub_prefix, now_iso),
            )
            conn.execute(
                """
                INSERT INTO api_keys (id, merchant_id, type, key_hash, key_prefix, created_at, revoked, name)
                VALUES (?, ?, 'secret', ?, ?, ?, 0, 'Rotated Key (Server)')
                """,
                (sec_key_id, merchant_id, sec_hash, sec_prefix, now_iso),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    record_audit_log(
        merchant_id=merchant_id,
        actor_id=actor_id,
        action="key.rotated",
        resource_type="api_key",
        resource_id=key_id,
        details={
            "old_key_id": key_id,
            "new_public_key_id": pub_key_id,
            "new_secret_key_id": sec_key_id,
            "overlap_hours": overlap_hours,
            "old_key_expires_at": expires_at,
        },
    )

    return {
        "status": "rotated",
        "overlap_hours": overlap_hours,
        "old_key_expires_at": expires_at,
        "overlap_expires_at": expires_at,
        "new_secret_key": sec_plain,
        "secret_key_revealed": sec_plain,
        "keys": [
            {
                "id": pub_key_id,
                "type": "public",
                "key": pub_plain,
                "prefix": pub_prefix,
                "created_at": now_iso,
            },
            {
                "id": sec_key_id,
                "type": "secret",
                "key": sec_plain,
                "prefix": sec_prefix,
                "created_at": now_iso,
            },
        ],
    }


def record_audit_log(
    merchant_id: str,
    actor_id: str,
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
    ip_address: Optional[str] = None,
) -> None:
    """Record an immutable audit log entry for security and compliance."""
    now_iso = datetime.now(timezone.utc).isoformat()
    log_id = f"aud_{secrets.token_hex(8)}"
    det_json = json.dumps(details or {})
    try:
        database.init_db()
        with database._connect() as conn:
            conn.execute(
                """
                INSERT INTO audit_logs (id, merchant_id, actor_id, action, resource_type, resource_id, details, ip_address, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (log_id, merchant_id, actor_id, action, resource_type, resource_id, det_json, ip_address, now_iso),
            )
            conn.commit()
    except Exception as exc:
        logger.warning("Audit log recording failed: %s", exc)


def get_merchant_audit_logs(merchant_id: str, limit: int = 50) -> list[dict[str, Any]]:
    """Retrieve recent security audit logs for the authenticated merchant."""
    database.init_db()
    with database._connect() as conn:
        rows = conn.execute(
            """
            SELECT id, merchant_id, actor_id, action, resource_type, resource_id, details, ip_address, timestamp
            FROM audit_logs
            WHERE merchant_id = ?
            ORDER BY timestamp DESC
            LIMIT ?
            """,
            (merchant_id, limit),
        ).fetchall()
        logs = []
        for r in rows:
            try:
                det = json.loads(r["details"])
            except Exception:
                det = {}
            logs.append({
                "id": r["id"],
                "merchant_id": r["merchant_id"],
                "actor_id": r["actor_id"],
                "action": r["action"],
                "resource_type": r["resource_type"],
                "resource_id": r["resource_id"],
                "details": det,
                "ip_address": r["ip_address"],
                "timestamp": r["timestamp"],
            })
        return logs


def check_and_record_monthly_quota(merchant_id: str) -> tuple[bool, int, int, str]:
    """Atomically checks and increments monthly usage for billable requests.
    
    Returns:
        (is_allowed: bool, used_count: int, quota: int, reset_date_iso: str)
    """
    database.init_db()
    now = datetime.now(timezone.utc)
    month_bucket = now.strftime("%Y-%m")

    year = now.year + (1 if now.month == 12 else 0)
    month = 1 if now.month == 12 else now.month + 1
    reset_date = datetime(year, month, 1, 0, 0, 0, tzinfo=timezone.utc).isoformat()

    with database._connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            m_row = conn.execute("SELECT plan, monthly_quota FROM merchants WHERE id = ?", (merchant_id,)).fetchone()
            quota = m_row["monthly_quota"] if m_row else DEFAULT_FREE_QUOTA

            conn.execute(
                """
                INSERT INTO merchant_usage_monthly (merchant_id, month_bucket, billable_count)
                VALUES (?, ?, 1)
                ON CONFLICT(merchant_id, month_bucket) DO UPDATE SET billable_count = billable_count + 1
                """,
                (merchant_id, month_bucket),
            )

            row = conn.execute(
                "SELECT billable_count FROM merchant_usage_monthly WHERE merchant_id = ? AND month_bucket = ?",
                (merchant_id, month_bucket),
            ).fetchone()
            used = row["billable_count"] if row else 1
            conn.commit()

            if used > quota:
                return False, used, quota, reset_date
            return True, used, quota, reset_date
        except Exception:
            conn.rollback()
            raise


def get_merchant_plan_and_usage(merchant_id: str) -> dict[str, Any]:
    """Get complete subscription, quota, remaining requests, and masked key metadata."""
    merchant = get_merchant_by_id(merchant_id)
    if not merchant:
        raise ValueError("Merchant not found.")

    now = datetime.now(timezone.utc)
    month_bucket = now.strftime("%Y-%m")
    year = now.year + (1 if now.month == 12 else 0)
    month = 1 if now.month == 12 else now.month + 1
    reset_date = datetime(year, month, 1, 0, 0, 0, tzinfo=timezone.utc).isoformat()

    database.init_db()
    with database._connect() as conn:
        row = conn.execute(
            "SELECT billable_count FROM merchant_usage_monthly WHERE merchant_id = ? AND month_bucket = ?",
            (merchant_id, month_bucket),
        ).fetchone()
        used = row["billable_count"] if row else 0

    plan_name = merchant.get("plan", "free")
    plan_cfg = PLAN_CONFIGS.get(plan_name, PLAN_CONFIGS["free"])
    quota = merchant.get("monthly_quota", plan_cfg["monthly_quota"])
    remaining = max(0, quota - used)
    percentage = min(100.0, round((used / quota) * 100.0, 1)) if quota > 0 else 0.0

    return {
        "merchant_id": merchant_id,
        "merchant_name": merchant["name"],
        "plan": plan_name,
        "plan_name": plan_cfg["name"],
        "plan_display_name": plan_cfg["name"],
        "billing_status": merchant.get("billing_status", "active"),
        "status": merchant.get("billing_status", "active"),
        "plan_expires_at": merchant.get("plan_expires_at"),
        "monthly_quota": quota,
        "requests_used": used,
        "used_this_month": used,
        "requests_remaining": remaining,
        "remaining": remaining,
        "usage_percentage": percentage,
        "quota_percentage": percentage,
        "reset_date": reset_date,
        "reset_at": reset_date,
        "days_until_reset": max(1, (datetime.fromisoformat(reset_date) - now).days),
        "rate_limit_per_min": plan_cfg["rate_limit_per_min"],
        "max_active_keys": plan_cfg["max_active_keys"],
        "max_keys": plan_cfg["max_active_keys"],
        "active_keys_count": len([k for k in merchant.get("keys", []) if k.get("status") in ("active", "expiring")]),
        "keys_count": len([k for k in merchant.get("keys", []) if k.get("status") in ("active", "expiring")]),
        "can_rotate_with_overlap": plan_name == "premium",
        "keys": merchant.get("keys", []),
        "plans_available": PLAN_CONFIGS,
    }


def upgrade_merchant_plan(
    merchant_id: str,
    new_plan: str = "premium",
    duration_days: int = 30,
    actor_id: str = "system",
    payment_details: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Upgrade a merchant's plan tier, update quota and expiration, and record audit log."""
    if new_plan not in PLAN_CONFIGS:
        raise ValueError(f"Unknown plan: {new_plan}")

    plan_cfg = PLAN_CONFIGS[new_plan]
    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat()
    expires_at = datetime.fromtimestamp(now_dt.timestamp() + duration_days * 86400, tz=timezone.utc).isoformat()

    database.init_db()
    with database._connect() as conn:
        conn.execute(
            """
            UPDATE merchants
            SET plan = ?, monthly_quota = ?, plan_expires_at = ?, billing_status = 'active'
            WHERE id = ?
            """,
            (new_plan, plan_cfg["monthly_quota"], expires_at, merchant_id),
        )
        if payment_details:
            sub_id = f"sub_{secrets.token_hex(8)}"
            conn.execute(
                """
                INSERT INTO subscriptions (id, merchant_id, plan, provider, provider_order_id, provider_payment_id, amount_inr, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
                """,
                (
                    sub_id,
                    merchant_id,
                    new_plan,
                    payment_details.get("provider", "simulated"),
                    payment_details.get("order_id"),
                    payment_details.get("payment_id"),
                    payment_details.get("amount_inr", plan_cfg["price_inr"]),
                    now_iso,
                    now_iso,
                ),
            )
        conn.commit()

    record_audit_log(
        merchant_id=merchant_id,
        actor_id=actor_id,
        action="plan.upgraded",
        resource_type="merchant",
        resource_id=merchant_id,
        details={
            "plan": new_plan,
            "monthly_quota": plan_cfg["monthly_quota"],
            "plan_expires_at": expires_at,
            "payment": payment_details,
        },
    )

    return get_merchant_plan_and_usage(merchant_id)


def demo_judge_login() -> dict[str, Any]:
    """1-Click login designed for hackathon judges and evaluators."""
    email = "judge@rtoguard.ai"
    database.init_db()
    with database._connect() as conn:
        user = conn.execute("SELECT id, merchant_id, name, email FROM users WHERE email = ?", (email,)).fetchone()

    if not user:
        reg = register_merchant_account(
            name="Hackathon Evaluator",
            email=email,
            password="judge-demo-pass-rtoguard",
            store_name="Demo Flagship Store",
            allowed_domains=["http://localhost:5173", "http://localhost:8000", "*"],
        )
        m_id = reg["merchant"]["id"]
        upgrade_merchant_plan(m_id, "premium", actor_id="judge_system")
        reg["merchant"] = get_merchant_by_id(m_id)
        return reg

    user_id = user["id"]
    merchant_id = user["merchant_id"]
    token = secrets.token_hex(32)
    now = datetime.now(timezone.utc).isoformat()
    expires = (datetime.now(timezone.utc).timestamp() + 30 * 86400)
    expires_str = datetime.fromtimestamp(expires, tz=timezone.utc).isoformat()

    with database._connect() as conn:
        conn.execute(
            """
            INSERT INTO user_sessions (token, user_id, merchant_id, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (token, user_id, merchant_id, now, expires_str),
        )
        conn.commit()

    merchant = get_merchant_by_id(merchant_id)
    # Ensure judge has at least one active pair
    active_keys = [k for k in merchant.get("keys", []) if k.get("status") in ("active", "expiring")]
    if not active_keys:
        keys = create_key_pair(merchant_id, name="Judge Test Key", mode="test")
    else:
        keys = []
    return {
        "token": token,
        "user": {
            "id": user_id,
            "name": user["name"],
            "email": user["email"],
            "merchant_id": merchant_id,
        },
        "merchant": merchant,
        "keys": keys,
    }

