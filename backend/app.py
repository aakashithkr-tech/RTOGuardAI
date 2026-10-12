"""RTOGuard AI — Integrated FastAPI Backend with Real CatBoost Inference & Persistent Storage.

Merges RTOGuardAI order operations with COD Return-Risk Scorer CatBoost ML pipeline.
Provides persistent SQLite storage, real-time ML scoring, SHAP explainability, and diagnostics.
"""

from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

# Ensure backend root is on sys.path so 'src' imports resolve cleanly
BACKEND_ROOT = Path(__file__).resolve().parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi import FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from database import (
    count_orders,
    count_predictions,
    get_all_orders,
    get_latest_prediction_for_order,
    get_order_by_id,
    init_db,
    list_predictions,
    save_prediction,
    upsert_order,
)
from src.interpret import GEMINI_MODEL, gemini_available
from src.serving import (
    UnknownPincode,
    get_service,
    sample_orders,
    score_order,
)

logger = logging.getLogger("rtoguard.backend")
logging.basicConfig(level=logging.INFO)

VALID_CATEGORIES = [
    "fashion",
    "footwear",
    "beauty",
    "accessories",
    "home_kitchen",
    "electronics",
]


# ---------------------------------------------------------------------------
# Pydantic Schemas for Request & Response
# ---------------------------------------------------------------------------


class CustomerHistoryIn(BaseModel):
    past_orders: int = Field(0, ge=0, le=10_000)
    past_rto_count: int = Field(0, ge=0, le=10_000)
    account_age_days: float = Field(0.0, ge=0.0, le=20_000.0)
    order_velocity_24h: int = Field(0, ge=0, le=100)

    @field_validator("past_rto_count")
    @classmethod
    def _rto_not_above_orders(cls, v: int, info) -> int:
        past = info.data.get("past_orders")
        if past is not None and v > past:
            raise ValueError(
                f"past_rto_count ({v}) cannot exceed past_orders ({past})"
            )
        return v


class OrderIn(BaseModel):
    pincode: str = Field(..., description="6-digit Indian pincode")
    address_line: str = Field(..., min_length=1, max_length=500)
    category: Literal[
        "fashion", "footwear", "beauty", "accessories", "home_kitchen", "electronics"
    ]
    order_value: float = Field(..., gt=0, le=1_000_000, description="INR")
    is_cod: bool

    order_id: str = Field("ord_adhoc", max_length=64)
    customer_id: str = Field("CUST_UNKNOWN", max_length=64)
    discount_pct: float = Field(0.0, ge=0.0, le=1.0, description="fraction, not %")
    is_festive: Optional[bool] = None
    is_alternate_address: bool = False
    delivery_days_est: Optional[float] = Field(None, gt=0, le=60)
    order_ts: Optional[datetime] = None
    customer_history: CustomerHistoryIn = Field(default_factory=CustomerHistoryIn)

    @field_validator("pincode")
    @classmethod
    def _six_digits(cls, v: str) -> str:
        v = v.strip()
        if not (len(v) == 6 and v.isdigit()):
            raise ValueError("pincode must be exactly 6 digits")
        return v


class ScoreOut(BaseModel):
    order_id: str
    rto_probability: float
    binary_threshold: float
    band: Literal["low", "medium", "high"]
    action: Literal["allow_cod", "charge_cod_fee", "disable_cod"]
    action_label: Literal["ALLOW", "REVIEW", "BLOCK"]
    reasons: list[str]
    expected_loss_if_shipped_inr: float
    flagged_at_binary_threshold: bool
    is_cod: bool
    resolved: dict[str, Any]
    plain_language_summary: Optional[str] = None
    summary_source: Optional[Literal["gemini", "template"]] = None


class DecisionRequest(BaseModel):
    order_id: str = Field(..., min_length=1)
    risk_probability: float = Field(..., ge=0, le=1)
    order_value: float = Field(..., ge=0)
    intervention_cost: float = Field(default=20, ge=0)


# ---------------------------------------------------------------------------
# Category Inference and Order-to-Payload Mapping
# ---------------------------------------------------------------------------


def infer_product_category(order: dict[str, Any]) -> str:
    """Infer one of the model's 6 categories from order items, SKU, or name."""
    items = order.get("items", [])
    text = ""
    for it in items:
        text += f" {it.get('name', '')} {it.get('sku', '')}".lower()

    if any(k in text for k in ["sneaker", "shoe", "boot", "footwear", "sandal", "run-blk"]):
        return "footwear"
    if any(k in text for k in ["earbud", "audio", "headphone", "elec", "tracker", "band", "watch", "phone"]):
        return "electronics"
    if any(k in text for k in ["roast", "coffee", "kitchen", "espresso", "hom-", "cook", "dining"]):
        return "home_kitchen"
    if any(k in text for k in ["bag", "sling", "leather", "acc-", "wallet", "belt"]):
        return "accessories"
    if any(k in text for k in ["beauty", "serum", "cream", "lotion", "cosmetic"]):
        return "beauty"
    if any(k in text for k in ["saree", "sari", "shirt", "t-shirt", "dress", "pant", "apparel", "lux-silk"]):
        return "fashion"

    raise ValueError(
        "Could not map the order items to a supported model category; "
        "provide an item name or SKU identifying fashion, footwear, beauty, "
        "accessories, home_kitchen, or electronics."
    )


def map_order_to_payload(order: dict[str, Any]) -> dict[str, Any]:
    """Extract and map RTOGuard order fields to the model's exact schema."""
    cust = order.get("customer", {})
    raw_pin = str(cust.get("pincode", "")).strip()
    if len(raw_pin) != 6 or not raw_pin.isdigit():
        raise ValueError(
            f"Order '{order.get('id', 'unknown')}' must contain a valid 6-digit "
            "customer pincode before model scoring."
        )

    address_line = str(cust.get("addressLine", "")).strip()
    if not address_line:
        raise ValueError(
            f"Order '{order.get('id', 'unknown')}' must contain a customer address "
            "before model scoring."
        )

    past_orders = int(cust.get("totalOrdersCount", 0))
    historical_rate = float(cust.get("historicalRtoRate", 0.0))
    past_rto = min(past_orders, max(0, round(past_orders * historical_rate)))

    order_val = float(order.get("orderValue", 0.0))
    if order_val <= 0:
        raise ValueError(
            f"Order '{order.get('id', 'unknown')}' must contain a positive orderValue."
        )
    is_cod = order.get("paymentMethod") == "COD"
    category = infer_product_category(order)

    return {
        "order_id": str(order.get("id", "ord_adhoc")),
        "customer_id": str(cust.get("name", "CUST_UNKNOWN")),
        "pincode": raw_pin,
        "address_line": address_line,
        "category": category,
        "order_value": max(1.0, order_val),
        "is_cod": is_cod,
        "discount_pct": 0.0,
        "is_alternate_address": False,
        "customer_history": {
            "past_orders": past_orders,
            "past_rto_count": past_rto,
            "account_age_days": float(cust.get("accountAgeDays", 0.0)),
            "order_velocity_24h": int(cust.get("orderVelocity24h", 0)),
        },
    }


def update_order_with_prediction(order: dict[str, Any], pred: dict[str, Any]) -> dict[str, Any]:
    """Inject real CatBoost prediction, expected loss, and SHAP factors into order."""
    now = datetime.now(timezone.utc).isoformat()
    p = float(pred["rto_probability"])
    score = int(round(p * 100))
    tier = str(pred["action_label"])  # "ALLOW", "REVIEW", "BLOCK"
    action_raw = str(pred["action"])

    category = (
        "CRITICAL" if tier == "BLOCK" or score >= 75
        else "HIGH" if tier == "REVIEW" or score >= 50
        else "MEDIUM" if score >= 25
        else "LOW"
    )

    recommended_action = (
        "HOLD_DISPATCH" if tier == "BLOCK"
        else "REQUEST_ADDRESS_VERIFICATION" if tier == "REVIEW"
        else "DISPATCH_STANDARD"
    )

    reasons = pred.get("reasons", [])
    primary_reason = (
        reasons[0] if reasons
        else f"Trained CatBoost model predicted {p*100:.1f}% RTO probability ({tier} tier)."
    )

    factors = []
    for i, r in enumerate(reasons[:4]):
        factors.append({
            "id": f"rf_model_{i + 1}",
            "factor": r.capitalize(),
            "impact": "CRITICAL" if tier == "BLOCK" else "WARNING" if tier == "REVIEW" else "POSITIVE",
            "explanation": f"Model feature attribution via TreeExplainer: {r}",
            "sourceMetric": "CatBoost SHAP Attribution",
        })

    loss_inr = float(pred["expected_loss_if_shipped_inr"])

    order["risk"] = {
        "riskScore": score,
        "riskCategory": category,
        "modelSource": "CatBoostClassifier (final_model.joblib)",
        "assessedAt": now,
        "confidence": round(abs(p - float(pred["binary_threshold"])) * 1.58, 2),
        "primaryReason": primary_reason,
        "factors": factors,
        "recommendedAction": recommended_action,
        "actionRationale": (
            f"Trained CatBoost prediction: {tier} ({action_raw}). "
            f"Expected shipping loss if dispatched on COD: ₹{loss_inr:.2f}."
        ),
        "isDemoAssessment": False,
        "modelProbability": p,
        "binaryThreshold": pred.get("binary_threshold"),
        "expectedLossIfShippedInr": loss_inr,
        "tierBand": pred.get("band", "medium"),
    }

    # Add audit event to order timeline
    timeline = order.setdefault("timeline", [])
    timeline.append({
        "id": f"evt_pred_{len(timeline) + 1}",
        "orderId": order["id"],
        "timestamp": now,
        "eventName": f"Real ML Prediction Generated: {tier} (Risk: {score}%)",
        "category": "RISK",
        "source": "AI_ENGINE",
        "details": (
            f"Evaluated via CatBoostClassifier. RTO Probability: {p*100:.1f}%. "
            f"Tier: {tier}. Expected shipping loss: ₹{loss_inr:.2f}."
        ),
        "outcome": "SUCCESS",
    })

    order["updatedAt"] = now
    return order


# ---------------------------------------------------------------------------
# Default Seed Orders Initializer
# ---------------------------------------------------------------------------


def create_initial_seed_orders() -> list[dict[str, Any]]:
    """Build the standard 6 hackathon seed orders across all typical scenarios."""
    now = datetime.now(timezone.utc).isoformat()
    return [
        {
            "id": "ord_101",
            "orderNumber": "RTO-9482",
            "createdAt": "2026-10-11T16:30:00Z",
            "updatedAt": now,
            "orderValue": 2499,
            "paymentMethod": "COD",
            "status": "PENDING",
            "deliveryAttempts": 0,
            "items": [{
                "sku": "AT-RUN-BLK-10",
                "name": "AeroPulse Pro Running Sneakers (Black/10)",
                "quantity": 1,
                "unitPrice": 2499,
            }],
            "customer": {
                "name": "Aditya S.",
                "phoneMasked": "+91 98765 •••••",
                "emailMasked": "adity***@gmail.com",
                "addressLine": "Near Shiv Mandir, Main Road, Tehsil Compound",
                "city": "Muzaffarnagar",
                "state": "Uttar Pradesh",
                "pincode": "251001",
                "pincodeTier": "TIER_3",
                "pincodeServiceable": True,
                "historicalRtoRate": 0.52,
                "totalOrdersCount": 2,
                "isHighValueCustomer": False,
            },
            "financials": {
                "orderValue": 2499,
                "productCost": 850,
                "forwardShippingCost": 130,
                "packagingCost": 45,
                "paymentGatewayFee": 0,
                "codCollectionFee": 55,
                "reverseLogisticsCost": 160,
                "verificationCost": 0,
                "incentiveDiscount": 0,
                "expectedContribution": 512,
                "currency": "INR",
            },
            "timeline": [],
        },
        {
            "id": "ord_102",
            "orderNumber": "RTO-9340",
            "createdAt": "2026-10-10T09:15:00Z",
            "updatedAt": now,
            "orderValue": 1850,
            "paymentMethod": "COD",
            "status": "NDR_PENDING",
            "deliveryAttempts": 1,
            "items": [{
                "sku": "ELEC-ANC-HD-WHT",
                "name": "Noise-Cancelling Wireless Earbuds (Ivory White)",
                "quantity": 1,
                "unitPrice": 1850,
            }],
            "customer": {
                "name": "Rohan K.",
                "phoneMasked": "+91 99100 •••••",
                "emailMasked": "rohan.k***@outlook.com",
                "addressLine": "Flat 402, Sector 62",
                "city": "Noida",
                "state": "Uttar Pradesh",
                "pincode": "201303",
                "pincodeTier": "TIER_1",
                "pincodeServiceable": True,
                "historicalRtoRate": 0.18,
                "totalOrdersCount": 4,
                "isHighValueCustomer": True,
            },
            "financials": {
                "orderValue": 1850,
                "productCost": 620,
                "forwardShippingCost": 110,
                "packagingCost": 40,
                "paymentGatewayFee": 0,
                "codCollectionFee": 45,
                "reverseLogisticsCost": 140,
                "verificationCost": 0,
                "incentiveDiscount": 0,
                "expectedContribution": 290,
                "currency": "INR",
            },
            "ndr": {
                "ndrReason": "CUSTOMER_UNREACHABLE",
                "attemptNumber": 1,
                "maxAttemptsAllowed": 3,
                "lastAttemptAt": "2026-10-11T14:30:00Z",
                "courierName": "BlueDart Express",
                "courierRemarks": "Recipient phone switched off / ringing unanswered.",
                "courierAwb": "BD-882941029",
                "recoveryStatus": "PENDING_ACTION",
            },
            "timeline": [],
        },
        {
            "id": "ord_103",
            "orderNumber": "RTO-9204",
            "createdAt": "2026-10-09T11:20:00Z",
            "updatedAt": now,
            "orderValue": 3199,
            "paymentMethod": "PREPAID",
            "status": "DELIVERED",
            "deliveryAttempts": 1,
            "items": [{
                "sku": "HOM-ROAST-PRM-1KG",
                "name": "Artisan Espresso Beans Roast Selection (1kg)",
                "quantity": 2,
                "unitPrice": 1599.5,
            }],
            "customer": {
                "name": "Pooja M.",
                "phoneMasked": "+91 98200 •••••",
                "emailMasked": "pooja.m***@gmail.com",
                "addressLine": "B-304, Cubbon Road",
                "city": "Bengaluru",
                "state": "Karnataka",
                "pincode": "560001",
                "pincodeTier": "TIER_1",
                "pincodeServiceable": True,
                "historicalRtoRate": 0.04,
                "totalOrdersCount": 6,
                "isHighValueCustomer": True,
            },
            "financials": {
                "orderValue": 3199,
                "productCost": 1100,
                "forwardShippingCost": 105,
                "packagingCost": 50,
                "paymentGatewayFee": 64,
                "codCollectionFee": 0,
                "reverseLogisticsCost": 0,
                "verificationCost": 0,
                "incentiveDiscount": 0,
                "actualContribution": 1880,
                "expectedContribution": 1880,
                "currency": "INR",
            },
            "timeline": [],
        },
        {
            "id": "ord_104",
            "orderNumber": "RTO-9118",
            "createdAt": "2026-10-05T14:10:00Z",
            "updatedAt": now,
            "orderValue": 1450,
            "paymentMethod": "COD",
            "status": "RTO_DELIVERED",
            "deliveryAttempts": 3,
            "items": [{
                "sku": "ACC-LT-BAG-BRN",
                "name": "Genuine Leather Crossbody Sling Bag (Tan Brown)",
                "quantity": 1,
                "unitPrice": 1450,
            }],
            "customer": {
                "name": "Vikas T.",
                "phoneMasked": "+91 97112 •••••",
                "emailMasked": "vikas***@yahoo.com",
                "addressLine": "Near Old Bus Stand, Post Office Gali",
                "city": "Rohtak",
                "state": "Haryana",
                "pincode": "124001",
                "pincodeTier": "TIER_3",
                "pincodeServiceable": True,
                "historicalRtoRate": 0.64,
                "totalOrdersCount": 1,
                "isHighValueCustomer": False,
            },
            "financials": {
                "orderValue": 1450,
                "productCost": 450,
                "forwardShippingCost": 125,
                "packagingCost": 45,
                "paymentGatewayFee": 0,
                "codCollectionFee": 0,
                "reverseLogisticsCost": 155,
                "verificationCost": 0,
                "incentiveDiscount": 0,
                "actualContribution": -325,
                "expectedContribution": -325,
                "currency": "INR",
            },
            "ndr": {
                "ndrReason": "DELIVERY_REJECTED",
                "attemptNumber": 3,
                "maxAttemptsAllowed": 3,
                "lastAttemptAt": "2026-10-08T16:00:00Z",
                "courierName": "Delhivery Surface",
                "courierRemarks": "Recipient stated: did not order / not interested anymore.",
                "courierAwb": "DLV-993817412",
                "recoveryStatus": "RTO_APPROVED",
            },
            "timeline": [],
        },
        {
            "id": "ord_105",
            "orderNumber": "RTO-9501",
            "createdAt": "2026-10-11T17:10:00Z",
            "updatedAt": now,
            "orderValue": 4200,
            "paymentMethod": "COD",
            "status": "PENDING",
            "deliveryAttempts": 0,
            "items": [{
                "sku": "LUX-SILK-SARI-RED",
                "name": "Handcrafted Banarasi Silk Saree (Crimson Red)",
                "quantity": 1,
                "unitPrice": 4200,
            }],
            "customer": {
                "name": "Sunita D.",
                "phoneMasked": "+91 94120 •••••",
                "emailMasked": "sunita***@gmail.com",
                "addressLine": "H.No 14, Rambagh area",
                "city": "Jaipur",
                "state": "Rajasthan",
                "pincode": "302005",
                "pincodeTier": "TIER_2",
                "pincodeServiceable": True,
                "historicalRtoRate": 0.38,
                "totalOrdersCount": 1,
                "isHighValueCustomer": True,
            },
            "financials": {
                "orderValue": 4200,
                "productCost": 1650,
                "forwardShippingCost": 160,
                "packagingCost": 75,
                "paymentGatewayFee": 0,
                "codCollectionFee": 90,
                "reverseLogisticsCost": 190,
                "verificationCost": 0,
                "incentiveDiscount": 0,
                "expectedContribution": 1140,
                "currency": "INR",
            },
            "timeline": [],
        },
        {
            "id": "ord_106",
            "orderNumber": "RTO-9410",
            "createdAt": "2026-10-10T14:00:00Z",
            "updatedAt": now,
            "orderValue": 1299,
            "paymentMethod": "PREPAID",
            "status": "IN_TRANSIT",
            "deliveryAttempts": 0,
            "items": [{
                "sku": "FIT-BAND-BLK",
                "name": "Smart Fitness Tracker with Heart Rate Monitor",
                "quantity": 1,
                "unitPrice": 1299,
            }],
            "customer": {
                "name": "Karan V.",
                "phoneMasked": "+91 98991 •••••",
                "emailMasked": "karan***@gmail.com",
                "addressLine": "Flat 201, Khairatabad",
                "city": "Hyderabad",
                "state": "Telangana",
                "pincode": "500004",
                "pincodeTier": "TIER_1",
                "pincodeServiceable": True,
                "historicalRtoRate": 0.08,
                "totalOrdersCount": 3,
                "isHighValueCustomer": False,
            },
            "financials": {
                "orderValue": 1299,
                "productCost": 480,
                "forwardShippingCost": 95,
                "packagingCost": 35,
                "paymentGatewayFee": 26,
                "codCollectionFee": 0,
                "reverseLogisticsCost": 0,
                "verificationCost": 0,
                "incentiveDiscount": 0,
                "expectedContribution": 663,
                "currency": "INR",
            },
            "timeline": [],
        },
    ]


# ---------------------------------------------------------------------------
# Lifespan Context Manager
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database and load trained CatBoost model pipeline."""
    init_db()
    # Preload and verify model artifact
    try:
        service = get_service()
        logger.info(f"Loaded trained CatBoost model pipeline: {service.describe()['model_key']}")
    except Exception as exc:
        logger.error(f"Failed to load trained model: {exc}")

    # Seed initial orders if database is fresh
    if count_orders() == 0:
        logger.info("Database is empty. Seeding initial orders with real CatBoost predictions...")
        seed_orders = create_initial_seed_orders()
        for ord_data in seed_orders:
            try:
                payload = map_order_to_payload(ord_data)
                result = score_order(payload, interpret=False)
                save_prediction(result)
                updated = update_order_with_prediction(ord_data, result)
                upsert_order(updated)
            except Exception as e:
                logger.warning(f"Error scoring seed order {ord_data['id']}: {e}")
                # Save base order
                upsert_order(ord_data)

    yield


# ---------------------------------------------------------------------------
# FastAPI Application Configuration
# ---------------------------------------------------------------------------


app = FastAPI(
    title="RTOGuard AI & COD Return-Risk Scorer Backend",
    description="Integrated full-stack order intelligence and CatBoost RTO-risk prediction engine.",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS configuration
CORS_ORIGINS = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if "*" in CORS_ORIGINS else CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(UnknownPincode)
async def _unknown_pincode_handler(request, exc: UnknownPincode) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


# ---------------------------------------------------------------------------
# Health & Model Diagnostics Endpoints
# ---------------------------------------------------------------------------


@app.get("/health", tags=["system"])
@app.get("/api/health", tags=["system"])
def health():
    """Distinguish between backend service availability and real ML model loading."""
    model_loaded = False
    model_details = {}
    try:
        service = get_service()
        model_loaded = True
        model_details = service.describe()
    except Exception as exc:
        model_details = {"error": str(exc)}

    return {
        "status": "healthy",
        "service": "RTOGuard AI Unified Engine",
        "trained_model_loaded": model_loaded,
        "model_details": model_details,
        "database": {
            "orders_count": count_orders(),
            "predictions_count": count_predictions(),
        },
        "plain_language_layer": {
            "configured": gemini_available(),
            "model": GEMINI_MODEL,
        },
    }


# ---------------------------------------------------------------------------
# Order Retrieval Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/orders", tags=["orders"])
def get_orders():
    """Retrieve all orders from SQLite with latest model risk assessments."""
    return get_all_orders()


@app.get("/api/orders/{order_id}", tags=["orders"])
def get_order(order_id: str):
    """Retrieve an order by ID or orderNumber."""
    order = get_order_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail=f"Order '{order_id}' not found")
    return order


# ---------------------------------------------------------------------------
# Real ML Scoring Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/orders/{order_id}/score", tags=["scoring"])
def score_existing_order(order_id: str, explain_plainly: bool = False):
    """Score an existing order using the real trained CatBoostClassifier.

    1. Retrieves the order from SQLite.
    2. Maps order fields to the exact feature schema required by the fitted pipeline.
    3. Runs inference through CatBoostClassifier with frozen threshold 0.37.
    4. Computes SHAP explainability reasons and expected shipping loss.
    5. Saves prediction persistently to the predictions table.
    6. Updates order risk assessment, appends audit timeline event, and saves to SQLite.
    """
    order = get_order_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail=f"Order '{order_id}' not found")

    try:
        payload = map_order_to_payload(order)
        result = score_order(payload, interpret=explain_plainly)
        save_prediction(result)
        updated_order = update_order_with_prediction(order, result)
        upsert_order(updated_order)
        return updated_order
    except UnknownPincode as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.error(f"Inference failure on order {order_id}: {exc}")
        raise HTTPException(
            status_code=500, detail=f"Model inference failed: {str(exc)}"
        )


@app.post("/score", response_model=ScoreOut, tags=["scoring"])
@app.post("/api/score", response_model=ScoreOut, tags=["scoring"])
def score_raw(order: OrderIn, explain_plainly: bool = False):
    """Score one raw order payload with CatBoostClassifier, return decision, and persist."""
    payload = order.model_dump()
    payload["customer_history"] = order.customer_history.model_dump()
    try:
        result = score_order(payload, interpret=explain_plainly)
        save_prediction(result)
        return result
    except UnknownPincode as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Validation or feature error: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Model scoring error: {exc}")


@app.post("/decision", tags=["legacy"])
def legacy_decision(data: DecisionRequest):
    """Backward compatibility endpoint for decision requests."""
    p = data.risk_probability
    service = get_service()
    threshold = service.threshold  # 0.37
    level = "HIGH" if p >= threshold else "LOW"
    action = "Priority review" if p >= threshold else "Standard processing"

    return {
        "order_id": data.order_id,
        "risk_probability": p,
        "risk_level": level,
        "recommended_action": action,
        "order_value": data.order_value,
        "intervention_cost": data.intervention_cost,
        "model_status": "evaluated_against_frozen_threshold",
    }


# ---------------------------------------------------------------------------
# Prediction History Endpoints
# ---------------------------------------------------------------------------


@app.get("/predictions", tags=["history"])
@app.get("/api/predictions", tags=["history"])
def get_prediction_history(limit: int = Query(default=20, ge=1, le=100)):
    """Retrieve newest persistent scoring records."""
    records = list_predictions(limit=limit)
    return {"count": len(records), "predictions": records}


@app.get("/api/predictions/{order_id}", tags=["history"])
def get_prediction_by_order(order_id: str):
    """Retrieve the latest persistent prediction for a specific order."""
    pred = get_latest_prediction_for_order(order_id)
    if not pred:
        raise HTTPException(status_code=404, detail=f"No prediction found for order '{order_id}'")
    return pred


# ---------------------------------------------------------------------------
# Sample Orders for Testing / Evaluation
# ---------------------------------------------------------------------------


@app.get("/sample_orders", tags=["demo"])
@app.get("/api/sample_orders", tags=["demo"])
def get_sample_orders(n_per_tier: int = 2):
    """Return real validation-split sample orders spanning ALLOW, REVIEW, and BLOCK."""
    if not 1 <= n_per_tier <= 5:
        raise HTTPException(422, "n_per_tier must be between 1 and 5")
    return sample_orders(n_per_tier=n_per_tier)


# ---------------------------------------------------------------------------
# Dashboard Analytics Summary
# ---------------------------------------------------------------------------


@app.get("/api/dashboard/summary", tags=["dashboard"])
def dashboard_summary():
    """Compute aggregate dashboard metrics from persistent SQLite orders."""
    orders = get_all_orders()
    total = len(orders)
    cod_count = sum(o.get("paymentMethod") == "COD" for o in orders)
    prepaid_count = sum(o.get("paymentMethod") == "PREPAID" for o in orders)
    delivered_count = sum(o.get("status") == "DELIVERED" for o in orders)
    transit_count = sum(
        o.get("status") in [
            "PENDING", "CONFIRMED", "DISPATCHED", "IN_TRANSIT", "OUT_FOR_DELIVERY"
        ]
        for o in orders
    )
    rto_count = sum(
        o.get("status") in ["RTO_DELIVERED", "RTO_INITIATED"] for o in orders
    )
    at_risk_count = sum(
        o.get("risk", {}).get("riskScore", 0) >= 60 for o in orders
    )
    total_val = sum(o.get("orderValue", 0) for o in orders)
    est_contrib = sum(
        o.get("financials", {}).get("expectedContribution", 0) for o in orders
    )
    ndr_active = sum(
        o.get("status") in ["NDR_PENDING", "RECOVERY_IN_PROGRESS"] for o in orders
    )

    return {
        "totalOrders": total,
        "codOrdersCount": cod_count,
        "prepaidOrdersCount": prepaid_count,
        "deliveredOrdersCount": delivered_count,
        "pendingOrTransitCount": transit_count,
        "rtoOrdersCount": rto_count,
        "ordersAtRiskCount": at_risk_count,
        "totalOrderValue": total_val,
        "estimatedContribution": est_contrib,
        "recordedDeliveryCosts": sum(
            o.get("financials", {}).get("forwardShippingCost", 0) for o in orders
        ),
        "preventedRtoLossEstimated": sum(
            o.get("risk", {}).get("expectedLossIfShippedInr", 0)
            for o in orders
            if o.get("risk", {}).get("riskCategory") in ["HIGH", "CRITICAL"]
        ),
        "ndrActiveCount": ndr_active,
        "activeMode": "LIVE",
    }


# ---------------------------------------------------------------------------
# Merchant Actions, Lifecycle Events & NDR Recovery
# ---------------------------------------------------------------------------


@app.post("/api/orders/{order_id}/actions", tags=["actions"])
def record_action(order_id: str, data: dict[str, Any]):
    """Record an operational merchant action on an order and persist."""
    order = get_order_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    timeline = order.setdefault("timeline", [])
    now = datetime.now(timezone.utc).isoformat()
    action_name = str(data.get("action", "Action recorded"))
    notes = str(data.get("notes", "Merchant action executed"))

    timeline.append({
        "id": f"evt_act_{len(timeline) + 1}",
        "orderId": order["id"],
        "timestamp": now,
        "eventName": action_name,
        "category": "ACTION",
        "source": "MERCHANT_MANUAL",
        "details": notes,
        "outcome": "SUCCESS",
    })

    order["updatedAt"] = now
    upsert_order(order)
    return order


@app.post("/api/orders/{order_id}/events", tags=["lifecycle"])
def record_event(order_id: str, data: dict[str, Any]):
    """Record a courier or lifecycle event and persist."""
    order = get_order_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    new_status = data.get("newStatus")
    if new_status:
        order["status"] = new_status

    timeline = order.setdefault("timeline", [])
    now = datetime.now(timezone.utc).isoformat()
    event_name = str(data.get("eventName", "Order event"))
    details = str(data.get("details", ""))

    timeline.append({
        "id": f"evt_life_{len(timeline) + 1}",
        "orderId": order["id"],
        "timestamp": now,
        "eventName": event_name,
        "category": "LIFECYCLE",
        "source": data.get("source", "MERCHANT_MANUAL"),
        "details": details,
        "outcome": "SUCCESS",
    })

    order["updatedAt"] = now
    upsert_order(order)
    return order


@app.post("/api/orders/{order_id}/ndr/recovery", tags=["ndr"])
def ndr_recovery(order_id: str, data: dict[str, Any]):
    """Transmit NDR recovery instruction, update courier status, and persist."""
    order = get_order_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    action_type = str(data.get("actionType", "REATTEMPT_WITH_TIME"))
    remarks = str(data.get("remarks", "NDR recovery instruction recorded"))
    now = datetime.now(timezone.utc).isoformat()

    timeline = order.setdefault("timeline", [])
    timeline.append({
        "id": f"evt_ndr_{len(timeline) + 1}",
        "orderId": order["id"],
        "timestamp": now,
        "eventName": f"NDR Recovery Action: {action_type}",
        "category": "RECOVERY",
        "source": "MERCHANT_MANUAL",
        "details": remarks,
        "outcome": "SUCCESS",
        "metadata": {k: str(v) for k, v in data.items() if v is not None},
    })

    if action_type == "APPROVE_RTO":
        order["status"] = "RTO_INITIATED"
        if order.get("ndr"):
            order["ndr"]["recoveryStatus"] = "RTO_APPROVED"
    else:
        order["status"] = "RECOVERY_IN_PROGRESS"
        if order.get("ndr"):
            order["ndr"]["recoveryStatus"] = (
                "REATTEMPT_SCHEDULED" if action_type == "REATTEMPT_WITH_TIME" else "ACTION_SENT"
            )

    order["updatedAt"] = now
    upsert_order(order)
    return order


# ---------------------------------------------------------------------------
# Static Files Mount for Production Deployment
# ---------------------------------------------------------------------------

FRONTEND_DIST = BACKEND_ROOT.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
else:
    @app.get("/")
    def index():
        return {
            "project": "RTOGuard AI",
            "message": "Backend API is active. Real CatBoost model loaded.",
            "docs": "/docs",
            "health": "/health",
        }
