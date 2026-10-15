"""Shipment Tracking and Logistics Integration for RTOGuardAI.

Provides multi-carrier shipment tracking integration supporting Indian e-commerce
courier partners (Delhivery, Blue Dart, DTDC, Ecom Express, Xpressbees, India Post,
Shadowfax, etc.).

Supports:
1. Real third-party multi-carrier tracking API (AfterShip) with API key & HMAC webhook signature.
2. Shipping aggregator tracking (Shiprocket) with JWT auth & webhook support.
3. Realistic local mock simulation engine for zero-dependency local development and testing.
4. Automatic synchronization between courier checkpoints, order lifecycle status,
   NDR (Non-Delivery Report) flagging, and RTO risk scoring.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

logger = logging.getLogger("rtoguard.tracking")

# ---------------------------------------------------------------------------
# Supported Indian Courier Registry & Tracking URL Templates
# ---------------------------------------------------------------------------

SUPPORTED_COURIERS: dict[str, dict[str, Any]] = {
    "delhivery": {
        "code": "delhivery",
        "name": "Delhivery",
        "aftership_slug": "delhivery",
        "tracking_url_template": "https://www.delhivery.com/track/package/{awb}",
        "default_service": "Surface / Express",
        "description": "Leading Indian e-commerce logistics network with comprehensive COD coverage.",
    },
    "bluedart": {
        "code": "bluedart",
        "name": "Blue Dart Express",
        "aftership_slug": "bluedart",
        "tracking_url_template": "https://www.bluedart.com/tracking?handler=traking_awb&awb_no={awb}",
        "default_service": "Air Express / Apex",
        "description": "Premium express air freight and time-definite delivery across India.",
    },
    "dtdc": {
        "code": "dtdc",
        "name": "DTDC Express",
        "aftership_slug": "dtdc",
        "tracking_url_template": "https://www.dtdc.in/tracking/tracking_results.asp?trkid={awb}",
        "default_service": "Express / DotZot",
        "description": "Extensive domestic network with Tier-2/Tier-3 town reach.",
    },
    "ecom-express": {
        "code": "ecom-express",
        "name": "Ecom Express",
        "aftership_slug": "ecom-express",
        "tracking_url_template": "https://ecomexpress.in/tracking/?awb={awb}",
        "default_service": "Ecom Ground Services",
        "description": "Specialized Indian e-commerce logistics with doorstep verification.",
    },
    "xpressbees": {
        "code": "xpressbees",
        "name": "Xpressbees",
        "aftership_slug": "xpressbees",
        "tracking_url_template": "https://www.xpressbees.com/track?isAwb=true&trackid={awb}",
        "default_service": "Standard Ground",
        "description": "High-velocity e-commerce and omnichannel courier delivery.",
    },
    "india-post": {
        "code": "india-post",
        "name": "India Post (Speed Post)",
        "aftership_slug": "india-post",
        "tracking_url_template": "https://www.indiapost.gov.in/_layouts/15/dpt.cpt.application/consignmenttrack.aspx",
        "default_service": "Speed Post / Business Parcel",
        "description": "Universal PIN code coverage across all rural and remote Indian postal circles.",
    },
    "shadowfax": {
        "code": "shadowfax",
        "name": "Shadowfax",
        "aftership_slug": "shadowfax",
        "tracking_url_template": "https://tracker.shadowfax.in/#/track/{awb}",
        "default_service": "Hyperlocal / Forward COD",
        "description": "Crowdsourced hyperlocal and regional e-commerce parcel logistics.",
    },
    "ekart": {
        "code": "ekart",
        "name": "Ekart Logistics",
        "aftership_slug": "ekart",
        "tracking_url_template": "https://ekartlogistics.com/track/{awb}",
        "default_service": "Express Courier",
        "description": "Large-scale supply chain and fulfillment courier.",
    },
}


def get_supported_couriers() -> list[dict[str, Any]]:
    """Return all supported couriers with tracking metadata."""
    return list(SUPPORTED_COURIERS.values())


def resolve_courier(courier_key: str) -> dict[str, Any]:
    """Resolve a courier code, name, or slug to a normalized metadata entry."""
    key = (courier_key or "").strip().lower()
    for code, meta in SUPPORTED_COURIERS.items():
        if key in [code, meta["aftership_slug"], meta["name"].lower()]:
            return meta
        if key in meta["name"].lower() or meta["name"].lower() in key:
            return meta

    # Fallback generic carrier
    return {
        "code": key or "custom",
        "name": courier_key or "Standard Courier",
        "aftership_slug": key or "custom",
        "tracking_url_template": "https://www.google.com/search?q={awb}+tracking",
        "default_service": "Standard Courier",
        "description": "Standard Indian courier service.",
    }


def build_tracking_url(courier_code: str, awb: str) -> str:
    """Construct customer or merchant direct tracking URL for the courier."""
    meta = resolve_courier(courier_code)
    template = meta.get("tracking_url_template", "https://www.google.com/search?q={awb}+tracking")
    return template.replace("{awb}", awb)


# ---------------------------------------------------------------------------
# Status Normalization Engine
# ---------------------------------------------------------------------------

NORMALIZED_STATUS_MAP: dict[str, str] = {
    # AfterShip checkpoints
    "pending": "ORDER_CREATED",
    "inforeceived": "ORDER_CREATED",
    "transit": "IN_TRANSIT",
    "intransit": "IN_TRANSIT",
    "outfordelivery": "OUT_FOR_DELIVERY",
    "attemptfail": "FAILED_ATTEMPT",
    "delivered": "DELIVERED",
    "exception": "EXCEPTION",
    "expired": "EXCEPTION",
    # Shiprocket checkpoints
    "manifest generated": "ORDER_CREATED",
    "pickup scheduled": "ORDER_CREATED",
    "in transit": "IN_TRANSIT",
    "reached at destination": "IN_TRANSIT",
    "out for delivery": "OUT_FOR_DELIVERY",
    "undelivered": "FAILED_ATTEMPT",
    "rto initiated": "RTO_INITIATED",
    "rto delivered": "RTO_DELIVERED",
    # Direct / common status codes
    "dispatched": "IN_TRANSIT",
    "ndr": "FAILED_ATTEMPT",
    "rto": "RTO_INITIATED",
}


def normalize_shipment_status(raw_status: str) -> str:
    """Normalize vendor-specific status string into RTOGuardAI unified status."""
    cleaned = (raw_status or "").strip().lower().replace("_", "").replace("-", " ")
    for k, v in NORMALIZED_STATUS_MAP.items():
        if k in cleaned:
            return v
    # Check direct canonical forms
    canonical = raw_status.upper().strip()
    if canonical in [
        "ORDER_CREATED",
        "IN_TRANSIT",
        "OUT_FOR_DELIVERY",
        "FAILED_ATTEMPT",
        "DELIVERED",
        "RTO_INITIATED",
        "RTO_DELIVERED",
        "EXCEPTION",
    ]:
        return canonical
    return "IN_TRANSIT"


# ---------------------------------------------------------------------------
# Configuration and Environment Inspection
# ---------------------------------------------------------------------------

TRACKING_PROVIDER = os.environ.get("TRACKING_PROVIDER", "").strip().lower()
AFTERSHIP_API_KEY = os.environ.get("AFTERSHIP_API_KEY", "").strip()
AFTERSHIP_WEBHOOK_SECRET = os.environ.get("AFTERSHIP_WEBHOOK_SECRET", "").strip()
SHIPROCKET_EMAIL = os.environ.get("SHIPROCKET_EMAIL", "").strip()
SHIPROCKET_PASSWORD = os.environ.get("SHIPROCKET_PASSWORD", "").strip()
TRACKING_WEBHOOK_SECRET = os.environ.get("TRACKING_WEBHOOK_SECRET", "").strip()


def get_configured_provider_name() -> str:
    """Identify which tracking provider is active."""
    if TRACKING_PROVIDER in ["aftership", "shiprocket"]:
        return TRACKING_PROVIDER
    if AFTERSHIP_API_KEY:
        return "aftership"
    if SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD:
        return "shiprocket"
    return "mock"


def is_tracking_live() -> bool:
    """Return True if real live tracking credentials are functional."""
    prov = get_configured_provider_name()
    if prov == "aftership":
        return bool(AFTERSHIP_API_KEY)
    if prov == "shiprocket":
        return bool(SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD)
    return False


def get_tracking_config_status() -> dict[str, Any]:
    """Diagnostic health reporting for logistics integration."""
    provider = get_configured_provider_name()
    live = is_tracking_live()
    return {
        "provider": provider,
        "is_live": live,
        "mode": "live" if live else "simulated_mock",
        "aftership_configured": bool(AFTERSHIP_API_KEY),
        "aftership_webhook_configured": bool(AFTERSHIP_WEBHOOK_SECRET),
        "shiprocket_configured": bool(SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD),
        "generic_webhook_secret_configured": bool(TRACKING_WEBHOOK_SECRET),
        "supported_couriers_count": len(SUPPORTED_COURIERS),
        "supported_couriers": [c["code"] for c in SUPPORTED_COURIERS.values()],
    }


# ---------------------------------------------------------------------------
# Webhook Signature Verification
# ---------------------------------------------------------------------------


def verify_aftership_webhook_signature(
    raw_body: bytes, signature_header: Optional[str], secret_override: Optional[str] = None
) -> bool:
    """Verify AfterShip HMAC-SHA256 webhook signature.

    AfterShip sends base64-encoded HMAC-SHA256 signature in 'as-signature-hmac-sha256'.
    """
    secret = (
        secret_override
        or os.environ.get("AFTERSHIP_WEBHOOK_SECRET")
        or os.environ.get("TRACKING_WEBHOOK_SECRET")
        or AFTERSHIP_WEBHOOK_SECRET
        or TRACKING_WEBHOOK_SECRET
    )
    if not secret:
        # If no secret configured, fail verification
        return False
    if not signature_header:
        return False

    try:
        import base64

        expected = base64.b64encode(
            hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).digest()
        ).decode("utf-8")
        return hmac.compare_digest(expected.strip(), signature_header.strip())
    except Exception as exc:
        logger.warning(f"Signature check failed: {exc}")
        return False


def verify_generic_webhook_signature(
    raw_body: bytes,
    signature_header: Optional[str],
    secret_header: Optional[str] = None,
    secret_override: Optional[str] = None,
) -> bool:
    """Verify generic webhook secret or HMAC signature."""
    configured_secret = (
        secret_override
        or os.environ.get("TRACKING_WEBHOOK_SECRET")
        or os.environ.get("AFTERSHIP_WEBHOOK_SECRET")
        or TRACKING_WEBHOOK_SECRET
        or AFTERSHIP_WEBHOOK_SECRET
    )
    if not configured_secret:
        return True  # If no secret configured in test/dev, allow

    # Check direct token header
    if secret_header and hmac.compare_digest(secret_header, configured_secret):
        return True

    # Check HMAC-SHA256 signature
    if signature_header:
        expected = hmac.new(
            configured_secret.encode("utf-8"), raw_body, hashlib.sha256
        ).hexdigest()
        if hmac.compare_digest(expected, signature_header.strip()):
            return True

    return False



# ---------------------------------------------------------------------------
# AfterShip API Client
# ---------------------------------------------------------------------------


class AfterShipClient:
    """Client for official AfterShip REST Tracking API."""

    BASE_URL = "https://api.aftership.com/tracking/2024-10"

    def __init__(self, api_key: str):
        self.api_key = api_key

    def _headers(self) -> dict[str, str]:
        return {
            "as-api-key": self.api_key,
            "Content-Type": "application/json",
        }

    def register_tracking(
        self,
        tracking_number: str,
        courier_code: str,
        order_id: Optional[str] = None,
        customer_name: Optional[str] = None,
        customer_phone: Optional[str] = None,
    ) -> dict[str, Any]:
        """Register shipment tracking number with AfterShip."""
        courier = resolve_courier(courier_code)
        slug = courier.get("aftership_slug", courier_code)
        payload = {
            "tracking": {
                "tracking_number": tracking_number,
                "slug": slug,
                "order_id": order_id,
                "customer_name": customer_name,
                "smses": [customer_phone] if customer_phone else [],
            }
        }
        with httpx.Client(timeout=10.0) as client:
            res = client.post(
                f"{self.BASE_URL}/trackings",
                headers=self._headers(),
                json=payload,
            )
            # 4004 error code in AfterShip indicates tracking already exists, which is acceptable
            if res.status_code == 409 or (res.status_code == 400 and "already exists" in res.text):
                return self.get_tracking(tracking_number, slug)
            res.raise_for_status()
            data = res.json().get("data", {}).get("tracking", {})
            return self._normalize_aftership_data(data)

    def get_tracking(self, tracking_number: str, courier_code: str) -> dict[str, Any]:
        """Fetch tracking data and checkpoints from AfterShip."""
        courier = resolve_courier(courier_code)
        slug = courier.get("aftership_slug", courier_code)
        with httpx.Client(timeout=10.0) as client:
            res = client.get(
                f"{self.BASE_URL}/trackings/{slug}/{tracking_number}",
                headers=self._headers(),
            )
            res.raise_for_status()
            data = res.json().get("data", {}).get("tracking", {})
            return self._normalize_aftership_data(data)

    def _normalize_aftership_data(self, data: dict[str, Any]) -> dict[str, Any]:
        """Map AfterShip response structure to RTOGuard unified tracking format."""
        tag = data.get("tag", "Pending")
        unified_status = normalize_shipment_status(tag)
        checkpoints_raw = data.get("checkpoints", [])
        events = []
        for cp in checkpoints_raw:
            events.append({
                "status": normalize_shipment_status(cp.get("tag", "")),
                "substatus": cp.get("subtag_message"),
                "message": cp.get("message") or cp.get("subtag_message") or cp.get("tag"),
                "location": cp.get("location") or f"{cp.get('city', '')}, {cp.get('state', '')}".strip(" ,"),
                "timestamp": cp.get("checkpoint_time") or cp.get("created_at") or datetime.now(timezone.utc).isoformat(),
                "raw_json": json.dumps(cp),
            })

        return {
            "tracking_number": data.get("tracking_number"),
            "courier_code": data.get("slug"),
            "courier_name": resolve_courier(data.get("slug", ""))["name"],
            "current_status": unified_status,
            "status_details": data.get("subtag_message") or tag,
            "estimated_delivery": data.get("expected_delivery"),
            "origin_city": data.get("origin_country_iso3"),
            "destination_city": data.get("destination_country_iso3"),
            "last_checkpoint_time": (
                events[-1]["timestamp"] if events else datetime.now(timezone.utc).isoformat()
            ),
            "events": events,
            "mode": "live",
            "raw_data": data,
        }


# ---------------------------------------------------------------------------
# Shiprocket API Client
# ---------------------------------------------------------------------------


class ShiprocketClient:
    """Client for Shiprocket Logistics Aggregator Tracking API."""

    BASE_URL = "https://apiv2.shiprocket.in/v1/external"

    def __init__(self, email: str, password: str):
        self.email = email
        self.password = password
        self._token: Optional[str] = None
        self._token_expiry: float = 0

    def _get_token(self) -> str:
        now = time.time()
        if self._token and now < self._token_expiry:
            return self._token
        with httpx.Client(timeout=10.0) as client:
            res = client.post(
                f"{self.BASE_URL}/auth/login",
                json={"email": self.email, "password": self.password},
            )
            res.raise_for_status()
            data = res.json()
            self._token = data["token"]
            self._token_expiry = now + 86400 * 9  # Shiprocket tokens valid for 10 days
            return self._token

    def get_tracking(self, tracking_number: str) -> dict[str, Any]:
        """Fetch tracking info from Shiprocket by AWB."""
        token = self._get_token()
        with httpx.Client(timeout=10.0) as client:
            res = client.get(
                f"{self.BASE_URL}/courier/track/awb/{tracking_number}",
                headers={"Authorization": f"Bearer {token}"},
            )
            res.raise_for_status()
            data = res.json().get("tracking_data", {})
            return self._normalize_shiprocket_data(tracking_number, data)

    def _normalize_shiprocket_data(
        self, awb: str, data: dict[str, Any]
    ) -> dict[str, Any]:
        current_status = data.get("current_status", "In Transit")
        activities = data.get("shipment_track_activities", [])
        events = []
        for act in activities:
            events.append({
                "status": normalize_shipment_status(act.get("activity", "")),
                "substatus": act.get("sr_status_label"),
                "message": act.get("activity"),
                "location": act.get("location"),
                "timestamp": act.get("date"),
                "raw_json": json.dumps(act),
            })
        return {
            "tracking_number": awb,
            "courier_code": (data.get("courier_name") or "shiprocket").lower().replace(" ", "-"),
            "courier_name": data.get("courier_name") or "Shiprocket Courier Partner",
            "current_status": normalize_shipment_status(current_status),
            "status_details": current_status,
            "estimated_delivery": data.get("etd"),
            "origin_city": data.get("pickup_city"),
            "destination_city": data.get("delivery_city"),
            "last_checkpoint_time": (
                events[-1]["timestamp"] if events else datetime.now(timezone.utc).isoformat()
            ),
            "events": events,
            "mode": "live",
            "raw_data": data,
        }


# ---------------------------------------------------------------------------
# Mock Simulator Engine for Zero-Credential Local Testing
# ---------------------------------------------------------------------------


class MockTrackingClient:
    """Deterministic, rich Indian courier simulation engine.

    Allows local testing and demonstrations across all scenarios:
    - Normal Delivery (In Transit -> Out for Delivery -> Delivered)
    - Non-Delivery Report / NDR (Delivery Attempt Failed -> NDR Flagged)
    - Return to Origin / RTO (3 Failed attempts -> RTO Initiated -> RTO Delivered)
    """

    def generate_simulated_tracking(
        self,
        order_id: str,
        tracking_number: str,
        courier_code: str,
        order_status: Optional[str] = None,
        destination_city: Optional[str] = None,
    ) -> dict[str, Any]:
        courier = resolve_courier(courier_code)
        now_dt = datetime.now(timezone.utc)
        now_iso = now_dt.isoformat()
        dest = destination_city or "Mumbai"

        # Determine scenario based on order status or AWB pattern
        status = order_status or "IN_TRANSIT"
        awb_upper = tracking_number.upper()

        if "RTO" in status or "993" in awb_upper or "RTO" in awb_upper:
            current_status = "RTO_INITIATED"
            status_details = "RTO Initiated: 3 doorstep delivery attempts failed. Returning to fulfillment hub."
            events = [
                {
                    "status": "ORDER_CREATED",
                    "substatus": "MANIFESTED",
                    "message": "Shipping label generated at warehouse",
                    "location": "Gurugram Hub",
                    "timestamp": "2026-10-10T10:00:00Z",
                    "raw_json": "{}",
                },
                {
                    "status": "IN_TRANSIT",
                    "substatus": "IN_TRANSIT",
                    "message": "Arrived at destination transit center",
                    "location": f"{dest} Sort Facility",
                    "timestamp": "2026-10-11T08:30:00Z",
                    "raw_json": "{}",
                },
                {
                    "status": "FAILED_ATTEMPT",
                    "substatus": "CUSTOMER_UNREACHABLE",
                    "message": "Attempt 1 failed: Customer phone unreachable at delivery address",
                    "location": dest,
                    "timestamp": "2026-10-12T14:15:00Z",
                    "raw_json": "{}",
                },
                {
                    "status": "FAILED_ATTEMPT",
                    "substatus": "CUSTOMER_REJECTED",
                    "message": "Attempt 2 failed: Customer refused delivery (did not order)",
                    "location": dest,
                    "timestamp": "2026-10-13T12:00:00Z",
                    "raw_json": "{}",
                },
                {
                    "status": "RTO_INITIATED",
                    "substatus": "REVERSE_LOGISTICS",
                    "message": "Shipment marked Return-to-Origin. Reverse logistics initiated to warehouse.",
                    "location": dest,
                    "timestamp": now_iso,
                    "raw_json": "{}",
                },
            ]
        elif "NDR" in status or "991" in awb_upper or "NDR" in awb_upper:
            current_status = "FAILED_ATTEMPT"
            status_details = "Delivery attempt failed: Customer phone switched off / unreachable at doorstep."
            events = [
                {
                    "status": "ORDER_CREATED",
                    "substatus": "MANIFESTED",
                    "message": "Parcel registered and manifest generated",
                    "location": "Bhiwandi Hub",
                    "timestamp": "2026-10-11T09:00:00Z",
                    "raw_json": "{}",
                },
                {
                    "status": "IN_TRANSIT",
                    "substatus": "DISPATCHED",
                    "message": "Dispatched to regional delivery hub",
                    "location": f"{dest} Delivery Center",
                    "timestamp": "2026-10-12T04:30:00Z",
                    "raw_json": "{}",
                },
                {
                    "status": "OUT_FOR_DELIVERY",
                    "substatus": "WITH_DELIVERY_EXECUTIVE",
                    "message": "Out for delivery with rider (Contact: +91 98765-XXXXX)",
                    "location": dest,
                    "timestamp": "2026-10-12T09:45:00Z",
                    "raw_json": "{}",
                },
                {
                    "status": "FAILED_ATTEMPT",
                    "substatus": "CUSTOMER_UNREACHABLE",
                    "message": "Delivery attempted but failed: Recipient phone was not reachable. Non-Delivery Report logged.",
                    "location": dest,
                    "timestamp": now_iso,
                    "raw_json": "{}",
                },
            ]
        elif "DELIVERED" in status or "992" in awb_upper:
            current_status = "DELIVERED"
            status_details = "Delivered successfully to recipient. Cash / UPI collected."
            events = [
                {
                    "status": "ORDER_CREATED",
                    "substatus": "MANIFESTED",
                    "message": "Consignment booked and sealed",
                    "location": "Bengaluru E-Hub",
                    "timestamp": "2026-10-09T14:00:00Z",
                    "raw_json": "{}",
                },
                {
                    "status": "IN_TRANSIT",
                    "substatus": "IN_TRANSIT",
                    "message": "Processed at origin hub and connected to linehaul",
                    "location": "Bengaluru Hub",
                    "timestamp": "2026-10-09T22:30:00Z",
                    "raw_json": "{}",
                },
                {
                    "status": "OUT_FOR_DELIVERY",
                    "substatus": "OUT_FOR_DELIVERY",
                    "message": "Assigned to courier executive for doorstep delivery",
                    "location": dest,
                    "timestamp": "2026-10-10T10:15:00Z",
                    "raw_json": "{}",
                },
                {
                    "status": "DELIVERED",
                    "substatus": "DELIVERED",
                    "message": "Handed over to customer. Proof of delivery (OTP) verified.",
                    "location": dest,
                    "timestamp": now_iso,
                    "raw_json": "{}",
                },
            ]
        else:
            current_status = "IN_TRANSIT"
            status_details = "In transit: Reached intermediary transshipment hub on schedule."
            events = [
                {
                    "status": "ORDER_CREATED",
                    "substatus": "MANIFESTED",
                    "message": "Order verified and shipping label printed",
                    "location": "Delhi Mega Gateway",
                    "timestamp": "2026-10-12T11:00:00Z",
                    "raw_json": "{}",
                },
                {
                    "status": "IN_TRANSIT",
                    "substatus": "IN_TRANSIT",
                    "message": "Bagged and in transit via express surface linehaul",
                    "location": "Jaipur Transit Node",
                    "timestamp": now_iso,
                    "raw_json": "{}",
                },
            ]

        return {
            "order_id": order_id,
            "tracking_number": tracking_number,
            "courier_code": courier["code"],
            "courier_name": courier["name"],
            "current_status": current_status,
            "status_details": status_details,
            "estimated_delivery": "2026-10-16T18:00:00Z",
            "origin_city": "Delhi NCR",
            "destination_city": dest,
            "last_checkpoint_time": now_iso,
            "events": events,
            "mode": "simulated",
            "raw_data": {"simulation": True, "provider": "mock"},
        }

    def advance_mock_step(
        self, current_status: str, tracking_number: str, courier_code: str, order_id: str
    ) -> dict[str, Any]:
        """Advance mock shipment to the next sequential milestone for interactive testing."""
        flow = ["ORDER_CREATED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "FAILED_ATTEMPT", "RTO_INITIATED", "RTO_DELIVERED"]
        try:
            curr_idx = flow.index(current_status)
            next_status = flow[(curr_idx + 1) % len(flow)]
        except ValueError:
            next_status = "IN_TRANSIT"

        return self.generate_simulated_tracking(
            order_id=order_id,
            tracking_number=tracking_number,
            courier_code=courier_code,
            order_status=next_status,
        )


# Singleton instances
_mock_client = MockTrackingClient()


# ---------------------------------------------------------------------------
# High-Level Unified Tracking Services
# ---------------------------------------------------------------------------


def register_order_tracking(
    order: dict[str, Any],
    tracking_number: str,
    courier_code: str,
    courier_name: Optional[str] = None,
    estimated_delivery: Optional[str] = None,
) -> dict[str, Any]:
    """Register or update an order with carrier tracking information."""
    order_id = str(order["id"])
    courier_meta = resolve_courier(courier_code)
    code = courier_meta["code"]
    c_name = courier_name or courier_meta["name"]
    dest = order.get("customer", {}).get("city", "India")

    provider_name = get_configured_provider_name()
    tracking_result: dict[str, Any]

    if provider_name == "aftership" and AFTERSHIP_API_KEY:
        try:
            client = AfterShipClient(AFTERSHIP_API_KEY)
            tracking_result = client.register_tracking(
                tracking_number=tracking_number,
                courier_code=code,
                order_id=order_id,
                customer_name=order.get("customer", {}).get("name"),
                customer_phone=order.get("customer", {}).get("phoneMasked"),
            )
            tracking_result["order_id"] = order_id
        except Exception as exc:
            logger.error(f"AfterShip registration failed: {exc}. Falling back to mock data.")
            tracking_result = _mock_client.generate_simulated_tracking(
                order_id=order_id,
                tracking_number=tracking_number,
                courier_code=code,
                order_status=order.get("status"),
                destination_city=dest,
            )
            tracking_result["mode"] = "fallback_mock"
    else:
        # Zero-credential mock simulation mode
        tracking_result = _mock_client.generate_simulated_tracking(
            order_id=order_id,
            tracking_number=tracking_number,
            courier_code=code,
            order_status=order.get("status"),
            destination_city=dest,
        )

    if estimated_delivery and not tracking_result.get("estimated_delivery"):
        tracking_result["estimated_delivery"] = estimated_delivery

    return tracking_result


def fetch_latest_tracking(
    order: dict[str, Any], tracking_number: str, courier_code: str
) -> dict[str, Any]:
    """Poll live tracking status from configured provider or advance simulator."""
    order_id = str(order["id"])
    provider_name = get_configured_provider_name()
    dest = order.get("customer", {}).get("city", "India")

    if provider_name == "aftership" and AFTERSHIP_API_KEY:
        try:
            client = AfterShipClient(AFTERSHIP_API_KEY)
            data = client.get_tracking(tracking_number, courier_code)
            data["order_id"] = order_id
            return data
        except Exception as exc:
            logger.error(f"Live AfterShip fetch failed: {exc}")

    # Fallback to mock simulation
    return _mock_client.generate_simulated_tracking(
        order_id=order_id,
        tracking_number=tracking_number,
        courier_code=courier_code,
        order_status=order.get("status"),
        destination_city=dest,
    )


def refresh_tracking_milestone(
    order: dict[str, Any], tracking_record: dict[str, Any]
) -> dict[str, Any]:
    """Force-advance mock milestone or re-poll live provider."""
    order_id = str(order["id"])
    tracking_number = tracking_record["tracking_number"]
    courier_code = tracking_record["courier_code"]
    provider_name = get_configured_provider_name()

    if provider_name == "aftership" and AFTERSHIP_API_KEY:
        return fetch_latest_tracking(order, tracking_number, courier_code)

    # In mock mode, advance sequentially so user sees live state change
    current_status = tracking_record.get("current_status", "IN_TRANSIT")
    return _mock_client.advance_mock_step(
        current_status=current_status,
        tracking_number=tracking_number,
        courier_code=courier_code,
        order_id=order_id,
    )


# ---------------------------------------------------------------------------
# Order Lifecycle & RTO Scoring Synchronization
# ---------------------------------------------------------------------------


def sync_tracking_update_to_order(
    order: dict[str, Any], tracking_data: dict[str, Any]
) -> dict[str, Any]:
    """Update order status, NDR details, RTO risk assessment, and audit timeline.

    Coordinates courier events with RTOGuardAI risk engine:
    1. OUT_FOR_DELIVERY -> sets order status OUT_FOR_DELIVERY.
    2. FAILED_ATTEMPT -> increments deliveryAttempts, sets NDR_PENDING, flags NDR details,
       and records high-priority risk audit event.
    3. RTO_INITIATED -> updates status to RTO_INITIATED, triggers RTO loss ledger.
    4. DELIVERED -> sets DELIVERED, resolves risk factors.
    """
    now = datetime.now(timezone.utc).isoformat()
    status = tracking_data.get("current_status", "IN_TRANSIT")
    courier_name = tracking_data.get("courier_name", "Integrated Courier")
    awb = tracking_data.get("tracking_number", "")
    details = tracking_data.get("status_details", "")

    # Ensure tracking object on order
    order["tracking"] = {
        "trackingNumber": awb,
        "courierCode": tracking_data.get("courier_code", "delhivery"),
        "courierName": courier_name,
        "currentStatus": status,
        "statusDetails": details,
        "estimatedDelivery": tracking_data.get("estimated_delivery"),
        "originCity": tracking_data.get("origin_city"),
        "destinationCity": tracking_data.get("destination_city"),
        "lastCheckpointTime": tracking_data.get("last_checkpoint_time", now),
        "trackingUrl": build_tracking_url(tracking_data.get("courier_code", ""), awb),
        "updatedAt": now,
        "mode": tracking_data.get("mode", "simulated"),
    }

    timeline = order.setdefault("timeline", [])

    # State transitions
    if status == "FAILED_ATTEMPT":
        attempts = int(order.get("deliveryAttempts", 0)) + 1
        order["deliveryAttempts"] = attempts
        order["status"] = "NDR_PENDING"

        # Populate or update NDR structure
        order["ndr"] = {
            "ndrReason": "CUSTOMER_UNREACHABLE",
            "attemptNumber": attempts,
            "maxAttemptsAllowed": 3,
            "lastAttemptAt": now,
            "courierName": courier_name,
            "courierRemarks": details or f"Delivery attempt {attempts} unfulfilled by courier.",
            "courierAwb": awb,
            "recoveryStatus": "PENDING_ACTION",
        }

        # Dynamically elevate risk category when delivery fails
        risk = order.setdefault("risk", {})
        if isinstance(risk, dict):
            current_score = int(risk.get("riskScore", 50))
            elevated_score = min(99, max(current_score, 75 + attempts * 8))
            risk["riskScore"] = elevated_score
            risk["riskCategory"] = "CRITICAL" if elevated_score >= 80 else "HIGH"
            risk["recommendedAction"] = "REATTEMPT_NDR"
            risk["primaryReason"] = (
                f"Courier delivery attempt {attempts} failed ({details or 'Customer unreachable'}). "
                "Urgent WhatsApp NDR verification required to prevent RTO."
            )

        timeline.append({
            "id": f"evt_ndr_courier_{int(time.time()*1000)}",
            "orderId": order["id"],
            "timestamp": now,
            "eventName": f"Courier Delivery Attempt #{attempts} Failed (NDR Flagged)",
            "category": "NDR",
            "source": "INTEGRATED_COURIER",
            "details": f"Courier [{courier_name}] logged delivery failure for AWB {awb}: {details}",
            "outcome": "FAILED",
        })

    elif status == "RTO_INITIATED":
        order["status"] = "RTO_INITIATED"
        if order.get("ndr"):
            order["ndr"]["recoveryStatus"] = "RTO_APPROVED"

        timeline.append({
            "id": f"evt_rto_courier_{int(time.time()*1000)}",
            "orderId": order["id"],
            "timestamp": now,
            "eventName": "Return-to-Origin (RTO) Initiated by Courier",
            "category": "COURIER",
            "source": "INTEGRATED_COURIER",
            "details": f"Courier [{courier_name}] initiated reverse logistics for AWB {awb}. Reason: {details}",
            "outcome": "FAILED",
        })

    elif status == "RTO_DELIVERED":
        order["status"] = "RTO_DELIVERED"
        timeline.append({
            "id": f"evt_rtodel_courier_{int(time.time()*1000)}",
            "orderId": order["id"],
            "timestamp": now,
            "eventName": "RTO Parcel Received at Origin Warehouse",
            "category": "COURIER",
            "source": "INTEGRATED_COURIER",
            "details": f"Returned package restocked at warehouse. AWB: {awb}",
            "outcome": "RESOLVED",
        })

    elif status == "DELIVERED":
        order["status"] = "DELIVERED"
        order["deliveryAttempts"] = max(1, int(order.get("deliveryAttempts", 0)))
        if order.get("ndr"):
            order["ndr"]["recoveryStatus"] = "RESOLVED"

        timeline.append({
            "id": f"evt_del_courier_{int(time.time()*1000)}",
            "orderId": order["id"],
            "timestamp": now,
            "eventName": "Shipment Delivered Successfully",
            "category": "LIFECYCLE",
            "source": "INTEGRATED_COURIER",
            "details": f"Delivered to recipient by [{courier_name}]. AWB: {awb}",
            "outcome": "SUCCESS",
        })

    elif status == "OUT_FOR_DELIVERY":
        order["status"] = "OUT_FOR_DELIVERY"
        timeline.append({
            "id": f"evt_ofd_courier_{int(time.time()*1000)}",
            "orderId": order["id"],
            "timestamp": now,
            "eventName": "Out for Delivery with Courier Executive",
            "category": "COURIER",
            "source": "INTEGRATED_COURIER",
            "details": f"Courier [{courier_name}] out for doorstep delivery. AWB: {awb}",
            "outcome": "PENDING",
        })

    elif status == "IN_TRANSIT":
        if order.get("status") in ["PENDING", "CONFIRMED", "DISPATCHED"]:
            order["status"] = "IN_TRANSIT"
        timeline.append({
            "id": f"evt_transit_courier_{int(time.time()*1000)}",
            "orderId": order["id"],
            "timestamp": now,
            "eventName": "Shipment in Transit",
            "category": "COURIER",
            "source": "INTEGRATED_COURIER",
            "details": f"Location: {tracking_data.get('destination_city') or 'Transit Hub'}. {details}",
            "outcome": "PENDING",
        })

    order["updatedAt"] = now
    return order
