"""Versioned Merchant-facing Public Scoring API (v1).

Provides:
- Merchant administration endpoints (protected by ADMIN_TOKEN).
- POST /v1/score for real-time RTO risk scoring and dynamic checkout policy.
- GET /v1/usage for per-merchant usage inspection.
- Strict authentication (Authorization Bearer / X-API-Key), origin security for public keys, and per-key rate limiting.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Literal, Optional
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from api_keys import (
    PLAN_CONFIGS,
    MerchantCreateIn,
    MerchantStatusIn,
    authenticate_admin_request,
    check_and_record_monthly_quota,
    check_and_record_rate_limit,
    create_key_pair,
    create_merchant,
    demo_judge_login,
    get_admin_token,
    get_merchant_audit_logs,
    get_merchant_by_id,
    get_merchant_plan_and_usage,
    get_merchant_usage_stats,
    get_rate_limit_per_min,
    get_user_session,
    hash_key,
    list_merchants,
    login_merchant_account,
    record_usage,
    register_merchant_account,
    revoke_key,
    rotate_key_pair,
    set_merchant_status,
    upgrade_merchant_plan,
    validate_origin,
    verify_api_key,
)
from integrations.razorpay import evaluate_dynamic_checkout
from schemas import CustomerHistoryIn
from services.billing import get_billing_provider
from src.serving import UnknownPincode, get_service, score_order

logger = logging.getLogger("rtoguard.v1")

v1_router = APIRouter(prefix="/v1")


# ---------------------------------------------------------------------------
# Consistent Error Helper
# ---------------------------------------------------------------------------


def make_error_response(status_code: int, code: str, message: str, headers: Optional[dict[str, str]] = None) -> JSONResponse:
    content = {
        "error": {
            "code": code,
            "message": message,
        }
    }
    return JSONResponse(status_code=status_code, content=content, headers=headers)


# ---------------------------------------------------------------------------
# Request and Response Schemas
# ---------------------------------------------------------------------------


class V1ScoreRequest(BaseModel):
    pincode: str = Field(..., description="6-digit Indian Postal PIN code")
    address_line: str = Field(..., min_length=1, max_length=500, description="Customer delivery address line")
    order_value: float = Field(..., gt=0, le=1_000_000, description="Order total in INR (must be positive)")
    category: Literal[
        "fashion", "footwear", "beauty", "accessories", "home_kitchen", "electronics"
    ]
    is_cod: bool = Field(True, description="Whether Cash on Delivery is requested")
    customer_history: Optional[CustomerHistoryIn] = Field(
        default_factory=CustomerHistoryIn,
        description="Historical customer behavior data if available",
    )
    order_id: Optional[str] = Field("ord_v1_adhoc", max_length=64)
    customer_id: Optional[str] = Field("CUST_UNKNOWN", max_length=64)

    @field_validator("pincode")
    @classmethod
    def _validate_pincode(cls, v: str) -> str:
        v = str(v).strip()
        if not (len(v) == 6 and v.isdigit()):
            raise ValueError("pincode must be exactly 6 digits")
        return v

    @field_validator("address_line")
    @classmethod
    def _validate_address(cls, v: str) -> str:
        v = str(v).strip()
        if not v:
            raise ValueError("address_line cannot be empty")
        return v


class V1ScoreResponse(BaseModel):
    api_version: str = "v1"
    request_id: str
    tier: Literal["ALLOW", "REVIEW", "BLOCK"]
    rto_probability: float
    reasons: list[str]
    recommended_action: str
    cod_available: bool
    cod_fee_inr: float
    prepaid_discount_inr: float
    message: str
    summary: str


# ---------------------------------------------------------------------------
# Merchant Authentication & Security Dependency
# ---------------------------------------------------------------------------


def authenticate_merchant(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    origin: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Authenticate calling merchant via Secret Key (server) or Public Key (browser).
    
    Rules:
    - Accepts Authorization: Bearer <key> OR X-API-Key: <key>.
    - Rejects conflicting credentials if both are supplied.
    - Public keys require an Origin matching merchant's allowed_domains.
    - Secret keys do not require Origin and can score directly from server.
    - Rate limit enforced per key.
    """
    auth_bearer_key: Optional[str] = None
    if authorization:
        parts = authorization.strip().split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            auth_bearer_key = parts[1].strip()
        elif len(parts) == 1:
            auth_bearer_key = parts[0].strip()

    header_api_key = x_api_key.strip() if x_api_key else None

    # Handle dual headers
    if auth_bearer_key and header_api_key:
        if auth_bearer_key != header_api_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"error": {"code": "conflicting_credentials", "message": "Conflicting API keys provided in headers."}},
            )
        resolved_key = auth_bearer_key
    elif auth_bearer_key:
        resolved_key = auth_bearer_key
    elif header_api_key:
        resolved_key = header_api_key
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": {"code": "invalid_api_key", "message": "Missing API key in Authorization or X-API-Key header."}},
        )

    creds, err_code = verify_api_key(resolved_key)
    if err_code == "revoked_api_key":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": {"code": "invalid_api_key", "message": "The API key is invalid or revoked."}},
        )
    elif err_code == "inactive_merchant":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": {"code": "inactive_merchant", "message": "The merchant account is currently inactive."}},
        )
    elif not creds or err_code == "invalid_api_key":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": {"code": "invalid_api_key", "message": "The API key is invalid or revoked."}},
        )

    key_hash = hash_key(resolved_key)
    creds["key_hash"] = key_hash

    # Public key origin validation
    if creds["key_type"] == "public":
        if not origin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"error": {"code": "origin_not_allowed", "message": "Public keys require an approved Origin header."}},
            )
        if not validate_origin(origin, creds["allowed_domains"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"error": {"code": "origin_not_allowed", "message": "Origin is not in the merchant's allowed domains."}},
            )

    # Per-key rate limiting
    limit_per_min = get_rate_limit_per_min()
    is_allowed, retry_after = check_and_record_rate_limit(key_hash, limit_per_min)
    if not is_allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            headers={"Retry-After": str(retry_after)},
            detail={"error": {"code": "rate_limit_exceeded", "message": f"Rate limit exceeded ({limit_per_min}/min). Try again later."}},
        )

    return creds


# ---------------------------------------------------------------------------
# Admin Endpoints (/v1/admin/*)
# ---------------------------------------------------------------------------


@v1_router.post(
    "/admin/merchants",
    tags=["v1-admin"],
    summary="Create a merchant and issue API keys",
)
def admin_create_merchant(
    data: MerchantCreateIn,
    _admin: str = Depends(authenticate_admin_request),
):
    """Create a new merchant and generate one public and one secret API key.
    
    The plaintext keys are returned ONLY ONCE in this response.
    """
    result = create_merchant(
        name=data.name,
        allowed_domains=data.allowed_domains,
        mode=data.mode,
    )
    return result


@v1_router.get(
    "/admin/merchants",
    tags=["v1-admin"],
    summary="List merchants with safe key metadata",
)
def admin_list_merchants(_admin: str = Depends(authenticate_admin_request)):
    """List all merchants with safe metadata. Plaintext keys are never returned."""
    return {"merchants": list_merchants()}


@v1_router.get(
    "/admin/merchants/{merchant_id}",
    tags=["v1-admin"],
    summary="Get merchant details",
)
def admin_get_merchant(merchant_id: str, _admin: str = Depends(authenticate_admin_request)):
    merchant = get_merchant_by_id(merchant_id)
    if not merchant:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found", "message": "Merchant not found"}})
    return merchant


@v1_router.post(
    "/admin/merchants/{merchant_id}/keys/{key_id}/revoke",
    tags=["v1-admin"],
    summary="Revoke an API key",
)
def admin_revoke_key(
    merchant_id: str,
    key_id: str,
    _admin: str = Depends(authenticate_admin_request),
):
    success = revoke_key(merchant_id, key_id)
    if not success:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found", "message": "Merchant or key not found"}})
    return {"status": "revoked", "merchant_id": merchant_id, "key_id": key_id}


@v1_router.post(
    "/admin/merchants/{merchant_id}/status",
    tags=["v1-admin"],
    summary="Activate or deactivate a merchant",
)
def admin_set_status(
    merchant_id: str,
    data: MerchantStatusIn,
    _admin: str = Depends(authenticate_admin_request),
):
    success = set_merchant_status(merchant_id, data.active)
    if not success:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found", "message": "Merchant not found"}})
    return {"status": "updated", "merchant_id": merchant_id, "active": data.active}


# ---------------------------------------------------------------------------
# Public Scoring Endpoints (/v1/score)
# ---------------------------------------------------------------------------


@v1_router.options("/score", tags=["v1-public"])
def score_options(request: Request):
    """Handle CORS preflight requests for /v1/score."""
    origin = request.headers.get("origin", "*")
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, X-API-Key, Content-Type, Origin",
            "Access-Control-Max-Age": "86400",
        },
    )


@v1_router.post(
    "/score",
    response_model=V1ScoreResponse,
    tags=["v1-public"],
    summary="Score an order for RTO risk & dynamic checkout recommendation",
)
def v1_score_order(
    body: V1ScoreRequest,
    request: Request,
    creds: dict[str, Any] = Depends(authenticate_merchant),
):
    """Evaluate order return risk using the trained CatBoost model pipeline.
    
    Produces:
    - ALLOW: Standard COD approved, 0 INR fee.
    - REVIEW: COD enabled with 50 INR fee, or instant 50 INR prepaid discount.
    - BLOCK: COD disabled. Prepaid only with instant UPI/Card discount.
    """
    request_id = f"req_{uuid.uuid4().hex[:16]}"

    # Server-side monthly usage quota check
    quota_allowed, used, quota, reset_date = check_and_record_monthly_quota(creds["merchant_id"])
    if not quota_allowed:
        record_usage(creds["merchant_id"], creds["key_id"], "/v1/score", 429)
        plan_name = creds.get("plan", "free")
        return make_error_response(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            code="quota_exceeded",
            message=f"Monthly API request quota exceeded ({used}/{quota}) for plan '{plan_name}'. Upgrade to Premium for higher limits.",
            headers={"Retry-After": "86400", "X-Quota-Reset": reset_date},
        )

    # Verify model availability
    try:
        service = get_service()
    except Exception as exc:
        logger.error("Scoring model unavailable: %s", exc)
        record_usage(creds["merchant_id"], creds["key_id"], "/v1/score", 503)
        return make_error_response(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="model_unavailable",
            message="The RTO risk scoring model is currently unavailable.",
        )

    # Map request features to model serving schema
    cust_hist = body.customer_history or CustomerHistoryIn()
    scoring_payload = {
        "order_id": body.order_id or "ord_v1_adhoc",
        "customer_id": body.customer_id or "CUST_UNKNOWN",
        "pincode": body.pincode,
        "address_line": body.address_line,
        "category": body.category,
        "order_value": max(1.0, float(body.order_value)),
        "is_cod": body.is_cod,
        "discount_pct": 0.0,
        "is_alternate_address": False,
        "customer_history": {
            "past_orders": cust_hist.past_orders,
            "past_rto_count": cust_hist.past_rto_count,
            "account_age_days": cust_hist.account_age_days,
            "order_velocity_24h": cust_hist.order_velocity_24h,
        },
    }

    try:
        score_res = score_order(scoring_payload, interpret=False)
    except UnknownPincode as exc:
        record_usage(creds["merchant_id"], creds["key_id"], "/v1/score", 422)
        return make_error_response(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_pincode",
            message=str(exc),
        )
    except ValueError as exc:
        record_usage(creds["merchant_id"], creds["key_id"], "/v1/score", 422)
        return make_error_response(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_request_data",
            message=str(exc),
        )
    except Exception as exc:
        logger.error("Scoring inference failed: %s", exc)
        record_usage(creds["merchant_id"], creds["key_id"], "/v1/score", 503)
        return make_error_response(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="model_unavailable",
            message="Model inference failed; please retry shortly.",
        )

    p = float(score_res["rto_probability"])
    checkout_eval = evaluate_dynamic_checkout(
        rto_probability=p,
        order_value=body.order_value,
        threshold=service.threshold,
        low_cut=service.low_cut,
        high_cut=service.high_cut,
    )

    tier = checkout_eval["tier"]
    reasons = score_res.get("reasons", [])
    if not reasons:
        reasons = [f"Model predicted {p*100:.1f}% return probability based on customer and order profile."]

    recommended_action = "allow" if tier == "ALLOW" else "review" if tier == "REVIEW" else "block"
    summary_text = (
        f"{tier} risk tier: {round(p * 100, 1)}% RTO probability. "
        + ("COD is available." if checkout_eval["cod_available"] else "Prepaid payment recommended.")
    )

    record_usage(creds["merchant_id"], creds["key_id"], "/v1/score", 200)

    response_data = {
        "api_version": "v1",
        "request_id": request_id,
        "tier": tier,
        "rto_probability": round(p, 4),
        "reasons": reasons,
        "recommended_action": recommended_action,
        "cod_available": checkout_eval["cod_available"],
        "cod_fee_inr": checkout_eval["cod_fee_inr"],
        "prepaid_discount_inr": checkout_eval["prepaid_discount_inr"],
        "message": checkout_eval["recommended_message"],
        "summary": summary_text,
    }

    # Add CORS header if origin was provided and validated
    origin = request.headers.get("origin")
    headers = {}
    if origin and creds["key_type"] == "public":
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"

    return JSONResponse(status_code=200, content=response_data, headers=headers)


# ---------------------------------------------------------------------------
# Public Usage Endpoint (/v1/usage)
# ---------------------------------------------------------------------------


@v1_router.options("/usage", tags=["v1-public"])
def usage_options(request: Request):
    origin = request.headers.get("origin", "*")
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, X-API-Key, Content-Type, Origin",
            "Access-Control-Max-Age": "86400",
        },
    )


@v1_router.get(
    "/usage",
    tags=["v1-public"],
    summary="Get API usage metrics for the authenticated merchant",
)
def v1_get_usage(
    request: Request,
    creds: dict[str, Any] = Depends(authenticate_merchant),
):
    """Return usage statistics only for the authenticated calling merchant."""
    stats = get_merchant_usage_stats(creds["merchant_id"])
    origin = request.headers.get("origin")
    headers = {}
    if origin and creds["key_type"] == "public":
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"
    return JSONResponse(status_code=200, content=stats, headers=headers)


# ---------------------------------------------------------------------------
# Merchant Authentication Endpoints (/v1/auth)
# ---------------------------------------------------------------------------


class SignupRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=3, max_length=150)
    password: str = Field(..., min_length=6, max_length=128)
    store_name: Optional[str] = Field(None, max_length=100)
    allowed_domains: Optional[list[str]] = None


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=150)
    password: str = Field(..., min_length=1, max_length=128)


def get_current_user_session(
    authorization: Optional[str] = Header(None, alias="Authorization"),
) -> dict[str, Any]:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": {"code": "unauthorized", "message": "Missing authorization session token."}},
        )
    token = authorization.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    session = get_user_session(token)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": {"code": "invalid_session", "message": "Invalid or expired session. Please sign in again."}},
        )
    return session


@v1_router.options("/auth/{action:path}", tags=["v1-auth"])
def auth_options(request: Request, action: str):
    origin = request.headers.get("origin", "*")
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type, Origin",
            "Access-Control-Max-Age": "86400",
        },
    )


@v1_router.post("/auth/signup", tags=["v1-auth"], summary="Merchant self-service registration")
def v1_auth_signup(payload: SignupRequest):
    try:
        data = register_merchant_account(
            name=payload.name,
            email=payload.email,
            password=payload.password,
            store_name=payload.store_name,
            allowed_domains=payload.allowed_domains,
        )
        return JSONResponse(status_code=201, content=data)
    except ValueError as exc:
        return make_error_response(400, "signup_failed", str(exc))
    except Exception as exc:
        logger.error("Signup error: %s", exc)
        return make_error_response(500, "internal_error", "Account creation failed.")


@v1_router.post("/auth/login", tags=["v1-auth"], summary="Merchant login")
def v1_auth_login(payload: LoginRequest):
    try:
        data = login_merchant_account(payload.email, payload.password)
        return JSONResponse(status_code=200, content=data)
    except ValueError as exc:
        return make_error_response(401, "invalid_credentials", str(exc))
    except Exception as exc:
        logger.error("Login error: %s", exc)
        return make_error_response(500, "internal_error", "Sign in failed.")


@v1_router.post("/auth/demo-login", tags=["v1-auth"], summary="1-Click Judge & Demo login for hackathon evaluation")
def v1_auth_demo_login():
    try:
        data = demo_judge_login()
        return JSONResponse(status_code=200, content=data)
    except Exception as exc:
        logger.error("Demo login error: %s", exc)
        return make_error_response(500, "internal_error", "Demo login failed.")


@v1_router.get("/auth/me", tags=["v1-auth"], summary="Get authenticated merchant session profile")
def v1_auth_me(session: dict[str, Any] = Depends(get_current_user_session)):
    return JSONResponse(
        status_code=200,
        content={
            "user": session["user"],
            "merchant": session["merchant"],
        },
    )


class CreateKeyIn(BaseModel):
    name: Optional[str] = Field("Production Key", max_length=100)


class KeyRotateIn(BaseModel):
    key_id: Optional[str] = None
    old_key_id: Optional[str] = None
    overlap_hours: int = Field(24, ge=0, le=168, description="Grace period in hours before retiring old key")

    @model_validator(mode="before")
    @classmethod
    def resolve_key_id(cls, data: Any):
        if isinstance(data, dict):
            if not data.get("key_id") and data.get("old_key_id"):
                data["key_id"] = data["old_key_id"]
        return data


class CreateBillingOrderIn(BaseModel):
    plan: str = Field("premium", description="Plan identifier (free or premium)")


class VerifyBillingPaymentIn(BaseModel):
    order_id: str
    payment_id: str
    signature: str
    plan: str = Field("premium", description="Plan identifier")


@v1_router.post("/auth/keys", tags=["v1-auth"], summary="Generate a fresh key pair for authenticated merchant")
def v1_auth_generate_keys(payload: Optional[CreateKeyIn] = None, session: dict[str, Any] = Depends(get_current_user_session)):
    merchant_id = session["merchant"]["id"]
    key_name = payload.name if payload and payload.name else "Production Key"
    try:
        keys = create_key_pair(merchant_id, name=key_name, mode="test", actor_id=session["user"]["email"])
        return JSONResponse(
            status_code=201,
            content={
                "merchant_id": merchant_id,
                "keys": keys,
            },
        )
    except ValueError as exc:
        return make_error_response(400, "key_limit_reached", str(exc))


@v1_router.post("/auth/keys/rotate", tags=["v1-auth"], summary="Rotate an existing API key pair with overlap grace period")
def v1_auth_rotate_key(payload: KeyRotateIn, session: dict[str, Any] = Depends(get_current_user_session)):
    merchant_id = session["merchant"]["id"]
    try:
        res = rotate_key_pair(
            merchant_id=merchant_id,
            key_id=payload.key_id,
            overlap_hours=payload.overlap_hours,
            actor_id=session["user"]["email"],
        )
        return JSONResponse(status_code=200, content=res)
    except ValueError as exc:
        return make_error_response(400, "rotation_failed", str(exc))


@v1_router.post("/auth/keys/{key_id}/revoke", tags=["v1-auth"], summary="Immediately revoke an API key")
def v1_auth_revoke_key(key_id: str, session: dict[str, Any] = Depends(get_current_user_session)):
    merchant_id = session["merchant"]["id"]
    success = revoke_key(merchant_id=merchant_id, key_id=key_id, actor_id=session["user"]["email"])
    if not success:
        return make_error_response(404, "key_not_found", "API key not found or already revoked.")
    return JSONResponse(
        status_code=200,
        content={"ok": True, "status": "revoked", "key_id": key_id, "revoked_key_id": key_id, "message": f"API key {key_id} has been permanently revoked."},
    )


@v1_router.get("/auth/audit-logs", tags=["v1-auth"], summary="Get security audit logs for merchant")
def v1_auth_audit_logs(limit: int = 50, session: dict[str, Any] = Depends(get_current_user_session)):
    merchant_id = session["merchant"]["id"]
    logs = get_merchant_audit_logs(merchant_id, limit=min(100, max(1, limit)))
    return JSONResponse(status_code=200, content={"audit_logs": logs})


# ---------------------------------------------------------------------------
# Platform Subscription & Billing Endpoints (/v1/billing/*)
# ---------------------------------------------------------------------------


@v1_router.get("/billing/plans", tags=["v1-billing"], summary="Get available platform subscription plans")
def v1_billing_plans():
    return JSONResponse(status_code=200, content={"plans": PLAN_CONFIGS})


@v1_router.get("/billing/usage", tags=["v1-billing"], summary="Get merchant quota, remaining requests, and billing status")
def v1_billing_usage(session: dict[str, Any] = Depends(get_current_user_session)):
    try:
        usage = get_merchant_plan_and_usage(session["merchant"]["id"])
        return JSONResponse(status_code=200, content=usage)
    except Exception as exc:
        return make_error_response(500, "internal_error", str(exc))


@v1_router.post("/billing/create-order", tags=["v1-billing"], summary="Create a subscription payment order")
def v1_billing_create_order(payload: CreateBillingOrderIn, session: dict[str, Any] = Depends(get_current_user_session)):
    if payload.plan not in PLAN_CONFIGS:
        return make_error_response(400, "invalid_plan", f"Unknown plan: {payload.plan}")

    plan_cfg = PLAN_CONFIGS[payload.plan]
    amount = plan_cfg["price_inr"]
    provider = get_billing_provider()
    order_data = provider.create_subscription_order(
        merchant_id=session["merchant"]["id"],
        plan_name=payload.plan,
        amount_inr=amount,
    )
    return JSONResponse(status_code=200, content=order_data)


@v1_router.post("/billing/verify", tags=["v1-billing"], summary="Verify payment and activate Premium plan")
def v1_billing_verify(payload: VerifyBillingPaymentIn, session: dict[str, Any] = Depends(get_current_user_session)):
    provider = get_billing_provider()
    is_valid, err = provider.verify_payment(payload.order_id, payload.payment_id, payload.signature)
    if not is_valid:
        return make_error_response(400, "verification_failed", err or "Invalid payment confirmation signature.")

    updated_profile = upgrade_merchant_plan(
        merchant_id=session["merchant"]["id"],
        new_plan=payload.plan,
        actor_id=session["user"]["email"],
        payment_details={
            "provider": provider.get_provider_name(),
            "order_id": payload.order_id,
            "payment_id": payload.payment_id,
            "amount_inr": PLAN_CONFIGS.get(payload.plan, {}).get("price_inr", 2499.0),
        },
    )
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "status": "activated",
            "plan": updated_profile.get("plan", payload.plan),
            "monthly_quota": updated_profile.get("monthly_quota", 5000),
            "message": f"Subscription upgraded to {payload.plan.capitalize()} successfully!",
            "merchant": updated_profile,
        },
    )


