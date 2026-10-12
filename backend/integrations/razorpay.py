"""Razorpay Integration Module for RTOGuardAI.

Provides test-mode Razorpay checkout integration, dynamic COD-gate decisioning,
prepaid payment link generation, and webhook verification for Razorpay Buildathon 2026.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
import uuid
from typing import Any, Optional

import httpx

logger = logging.getLogger("rtoguard.razorpay")

RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
RAZORPAY_API_BASE = "https://api.razorpay.com/v1"


def is_razorpay_configured() -> bool:
    """Return whether a real Razorpay API key pair is configured."""
    return bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)


def has_razorpay_credentials() -> bool:
    """Return whether any Razorpay credential is set, including partial configuration."""
    return bool(RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET)


def is_live_credentials() -> bool:
    """Backward-compatible check for configured Razorpay API credentials."""
    return is_razorpay_configured()


def razorpay_mode() -> str:
    if not is_razorpay_configured():
        return "simulated"
    return "test" if RAZORPAY_KEY_ID.startswith("rzp_test_") else "live"


def create_razorpay_order(
    amount_inr: float,
    receipt: Optional[str] = None,
    notes: Optional[dict[str, Any]] = None,
    currency: str = "INR",
) -> dict[str, Any]:
    """Create a Razorpay order in paise.

    If live/valid Razorpay credentials exist, calls the official API.
    Without credentials, returns a clearly marked simulation order for local demos.
    """
    amount_paise = int(round(amount_inr * 100))
    receipt_id = receipt or f"rcpt_{int(time.time()*1000)}"

    if has_razorpay_credentials() and not is_razorpay_configured():
        raise RuntimeError("Both RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be configured.")

    if is_live_credentials():
        try:
            with httpx.Client(timeout=8.0) as client:
                res = client.post(
                    f"{RAZORPAY_API_BASE}/orders",
                    auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET),
                    json={
                        "amount": amount_paise,
                        "currency": currency,
                        "receipt": receipt_id,
                        "notes": notes or {},
                    },
                )
                res.raise_for_status()
                result = res.json()
                result["key_id"] = RAZORPAY_KEY_ID
                result["mode"] = razorpay_mode()
                return result
        except Exception as exc:
            logger.error("Razorpay order creation failed: %s", exc)
            raise RuntimeError("Razorpay order creation failed; check credentials and API availability.") from exc

    # Local simulation only; this is not a Razorpay order.
    mock_order_id = f"order_rzp_{uuid.uuid4().hex[:14]}"
    return {
        "id": mock_order_id,
        "entity": "order",
        "amount": amount_paise,
        "amount_paid": 0,
        "amount_due": amount_paise,
        "currency": currency,
        "receipt": receipt_id,
        "status": "created",
        "attempts": 0,
        "notes": notes or {},
        "created_at": int(time.time()),
        "key_id": None,
        "mode": "simulated",
    }


def create_payment_link(
    order_id: str,
    amount_inr: float,
    customer_name: str,
    customer_phone: Optional[str] = None,
    customer_email: Optional[str] = None,
    description: Optional[str] = None,
) -> dict[str, Any]:
    """Generate a Razorpay Payment Link to send to customers via WhatsApp or SMS."""
    amount_paise = int(round(amount_inr * 100))
    desc = description or f"RTOGuard Verified Prepayment for Order #{order_id}"

    if has_razorpay_credentials() and not is_razorpay_configured():
        raise RuntimeError("Both RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be configured.")

    if is_razorpay_configured():
        try:
            with httpx.Client(timeout=8.0) as client:
                res = client.post(
                    f"{RAZORPAY_API_BASE}/payment_links",
                    auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET),
                    json={
                        "amount": amount_paise,
                        "currency": "INR",
                        "description": desc,
                        "customer": {
                            "name": customer_name,
                            "contact": customer_phone or "+919999999999",
                            "email": customer_email or "customer@example.com",
                        },
                        "notify": {"sms": bool(customer_phone), "email": bool(customer_email)},
                        "reference_id": str(order_id),
                    },
                )
                res.raise_for_status()
                result = res.json()
                result["mode"] = razorpay_mode()
                return result
        except Exception as exc:
            logger.error("Razorpay payment-link creation failed: %s", exc)
            raise RuntimeError("Razorpay payment-link creation failed; check credentials and API availability.") from exc

    # Local simulation only; never present a fake URL as a payable link.
    link_id = f"plink_{uuid.uuid4().hex[:12]}"
    return {
        "id": link_id,
        "short_url": None,
        "amount": amount_paise,
        "amount_inr": amount_inr,
        "currency": "INR",
        "order_id": order_id,
        "description": desc,
        "status": "created",
        "customer": {
            "name": customer_name,
            "contact": customer_phone,
            "email": customer_email,
        },
        "mode": "simulated",
    }


def verify_webhook_signature(
    body_bytes: bytes,
    signature: str,
    secret: Optional[str] = None,
) -> bool:
    """Verify Razorpay webhook HMAC SHA-256 signature."""
    sec = secret if secret is not None else os.environ.get(
        "RAZORPAY_WEBHOOK_SECRET", RAZORPAY_WEBHOOK_SECRET
    )
    if not sec or not signature:
        return False
    computed = hmac.new(sec.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(computed, signature)


def verify_payment_signature(
    order_id: str,
    payment_id: str,
    signature: str,
) -> bool:
    """Verify the signature returned by Razorpay Standard Checkout."""
    if not RAZORPAY_KEY_SECRET or not signature:
        return False
    message = f"{order_id}|{payment_id}".encode("utf-8")
    computed = hmac.new(
        RAZORPAY_KEY_SECRET.encode("utf-8"), message, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(computed, signature)


def evaluate_dynamic_checkout(
    rto_probability: float,
    order_value: float,
    threshold: float = 0.37,
    low_cut: float = 0.05,
    high_cut: float = 0.40,
) -> dict[str, Any]:
    """Razorpay Dynamic Checkout Policy:

    - ALLOW (p < low_cut): Standard COD with zero surcharge.
    - REVIEW (low_cut <= p < high_cut): COD enabled with ₹50 confirmation fee, or Prepaid with ₹50 instant discount.
    - BLOCK (p >= high_cut): COD disabled. Prepaid only with ₹75 UPI discount.
    """
    p = max(0.0, min(1.0, float(rto_probability)))

    if p < low_cut:
        tier = "ALLOW"
        action = "ALLOW_COD"
        cod_available = True
        cod_fee_inr = 0.0
        prepaid_discount_inr = 0.0
        recommended_message = (
            "Standard Cash on Delivery is approved. Zero additional checkout friction."
        )
    elif p < high_cut:
        tier = "REVIEW"
        action = "CHARGE_COD_FEE"
        cod_available = True
        cod_fee_inr = 50.0
        prepaid_discount_inr = 50.0
        recommended_message = (
            "Medium return probability detected. COD requires ₹50 advance delivery confirmation "
            "fee, or pay online now with instant ₹50 discount."
        )
    else:
        tier = "BLOCK"
        action = "BLOCK_COD_OFFER_PREPAID"
        cod_available = False
        cod_fee_inr = 0.0
        prepaid_discount_inr = min(100.0, max(50.0, round(order_value * 0.05)))
        recommended_message = (
            "High return probability detected. Cash on Delivery is disabled for this address. "
            f"Pay securely online via Razorpay (UPI/Cards) to get ₹{prepaid_discount_inr:.0f} instant discount."
        )

    final_cod_amount = order_value + cod_fee_inr if cod_available else None
    final_prepaid_amount = max(1.0, order_value - prepaid_discount_inr)

    return {
        "tier": tier,
        "action": action,
        "rto_probability": round(p, 4),
        "binary_threshold": threshold,
        "flagged_at_binary_threshold": p >= threshold,
        "cod_available": cod_available,
        "cod_fee_inr": cod_fee_inr,
        "prepaid_discount_inr": prepaid_discount_inr,
        "original_order_value": order_value,
        "final_cod_amount": final_cod_amount,
        "final_prepaid_amount": final_prepaid_amount,
        "recommended_message": recommended_message,
        "razorpay_mode": razorpay_mode(),
    }
