"""Decoupled Billing Provider Abstraction for RTOGuardAI Platform Subscriptions.

Merchants on ANY e-commerce platform (Shopify, WooCommerce, custom) consume RTOGuardAI RTO
scoring services independently of their own store checkout gateway.

This billing layer is strictly for merchants subscribing to RTOGuardAI plans (Free vs. Premium).
Supports Razorpay, Simulated/Sandbox testing, and is designed to easily plug in Stripe or other providers.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from abc import ABC, abstractmethod
from typing import Any, Optional

import integrations.razorpay as rzp

logger = logging.getLogger("rtoguard.billing")


class BillingProvider(ABC):
    """Abstract interface for RTOGuardAI platform subscription payments."""

    @abstractmethod
    def get_provider_name(self) -> str:
        """Return provider identifier (e.g. 'razorpay', 'simulated')."""
        pass

    @abstractmethod
    def create_subscription_order(
        self,
        merchant_id: str,
        plan_name: str,
        amount_inr: float,
        receipt: Optional[str] = None,
    ) -> dict[str, Any]:
        """Create a payment order for merchant subscription."""
        pass

    @abstractmethod
    def verify_payment(
        self,
        order_id: str,
        payment_id: str,
        signature: str,
    ) -> tuple[bool, Optional[str]]:
        """Verify the cryptographic payment confirmation.
        
        Returns:
            (is_valid: bool, error_message: Optional[str])
        """
        pass


class RazorpayBillingProvider(BillingProvider):
    """Razorpay billing adapter for collecting subscription fees."""

    def get_provider_name(self) -> str:
        return "razorpay"

    def create_subscription_order(
        self,
        merchant_id: str,
        plan_name: str,
        amount_inr: float,
        receipt: Optional[str] = None,
    ) -> dict[str, Any]:
        rec = receipt or f"sub_{merchant_id}_{int(time.time())}"
        notes = {
            "merchant_id": merchant_id,
            "plan": plan_name,
            "purpose": "rtoguard_subscription",
        }
        order_result = rzp.create_razorpay_order(
            amount_inr=amount_inr,
            receipt=rec,
            notes=notes,
            currency="INR",
        )
        return {
            "provider": "razorpay",
            "order_id": order_result["id"],
            "plan": plan_name,
            "amount": order_result.get("amount", int(amount_inr * 100)),
            "amount_inr": amount_inr,
            "amount_paise": order_result.get("amount", int(amount_inr * 100)),
            "currency": order_result.get("currency", "INR"),
            "key_id": rzp.RAZORPAY_KEY_ID or "rzp_test_simulation",
            "mode": order_result.get("mode", "simulated"),
        }

    def verify_payment(
        self,
        order_id: str,
        payment_id: str,
        signature: str,
    ) -> tuple[bool, Optional[str]]:
        if not rzp.is_razorpay_configured():
            # In simulated mode, verify presence of simulation signature format
            if signature and (signature.startswith("sim_sig_") or len(signature) >= 16):
                return True, None
            return False, "Invalid test signature format."

        valid = rzp.verify_payment_signature(
            razorpay_order_id=order_id,
            razorpay_payment_id=payment_id,
            razorpay_signature=signature,
        )
        if valid:
            return True, None
        return False, "Razorpay payment signature mismatch."


class SimulatedBillingProvider(BillingProvider):
    """Zero-credential sandbox provider for deterministic local testing."""

    def get_provider_name(self) -> str:
        return "simulated"

    def create_subscription_order(
        self,
        merchant_id: str,
        plan_name: str,
        amount_inr: float,
        receipt: Optional[str] = None,
    ) -> dict[str, Any]:
        mock_order_id = f"order_sim_{uuid.uuid4().hex[:12]}"
        return {
            "provider": "simulated",
            "order_id": mock_order_id,
            "plan": plan_name,
            "amount": int(amount_inr * 100),
            "amount_inr": amount_inr,
            "amount_paise": int(amount_inr * 100),
            "currency": "INR",
            "key_id": "sim_key_free_test",
            "mode": "simulated",
        }

    def verify_payment(
        self,
        order_id: str,
        payment_id: str,
        signature: str,
    ) -> tuple[bool, Optional[str]]:
        if order_id and payment_id:
            return True, None
        return False, "Order ID and Payment ID are required."


def get_billing_provider() -> BillingProvider:
    """Return active billing provider. Defaults to Razorpay if configured or simulated."""
    provider_override = os.environ.get("BILLING_PROVIDER", "").strip().lower()
    if provider_override == "simulated":
        return SimulatedBillingProvider()
    return RazorpayBillingProvider()
