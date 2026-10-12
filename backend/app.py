"""RTOGuard AI â€” Production-Ready FastAPI Backend with Real CatBoost Inference & Persistent Storage.

Merges RTOGuardAI order operations with COD Return-Risk Scorer CatBoost ML pipeline.
Provides persistent SQLite storage, real-time ML scoring, SHAP explainability,
profit intelligence, analytics, NDR recovery, and system diagnostics.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# Ensure backend root is on sys.path so 'src' imports resolve cleanly
BACKEND_ROOT = Path(__file__).resolve().parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi import Body, FastAPI, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from database import (
    count_orders,
    count_predictions,
    create_order as db_create_order,
    delete_order as db_delete_order,
    get_all_orders,
    get_latest_prediction_for_order,
    get_order_by_id,
    get_orders_analytics,
    get_order_for_razorpay_reference,
    get_prediction_by_id,
    get_prediction_trends,
    get_risk_distribution,
    get_razorpay_order,
    get_shipping_loss_analytics,
    init_db,
    list_orders as db_list_orders,
    list_predictions as db_list_predictions,
    patch_order as db_patch_order,
    save_prediction,
    save_razorpay_order,
    upsert_order,
)
from integrations.whatsapp import router as whatsapp_router
from integrations.razorpay import (
    RAZORPAY_KEY_ID,
    create_payment_link,
    create_razorpay_order,
    evaluate_dynamic_checkout,
    has_razorpay_credentials,
    is_razorpay_configured,
    razorpay_mode,
    verify_payment_signature,
    verify_webhook_signature,
)
from schemas import (
    BatchPredictionIn,
    BatchScoreOut,
    DecisionRequest,
    OrderCreateIn,
    OrderIn,
    OrderUpdateIn,
    ProfitEstimateIn,
    ProfitScenariosIn,
    ScoreOut,
    WhatIfIn,
)
from services.csv_scorer import score_merchant_csv
from services.profit import (
    calculate_expected_shipping_loss,
    evaluate_what_if_scenario,
    generate_scenario_comparisons,
)
from src.bhashini import bhashini_configured, translate_text
from src.interpret import GEMINI_MODEL, gemini_available
from src.serving import (
    MODEL_PATH,
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
    """Extract and map RTOGuard order fields to the model's exact feature schema."""
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

    loss_inr = float(pred.get("expected_loss_if_shipped_inr", round(p * 200.0, 2)))

    order["risk"] = {
        "riskScore": score,
        "riskCategory": category,
        "modelSource": "CatBoostClassifier (final_model.joblib)",
        "assessedAt": now,
        "confidence": round(abs(p - float(pred.get("binary_threshold", 0.37))) * 1.58, 2),
        "primaryReason": primary_reason,
        "factors": factors,
        "recommendedAction": recommended_action,
        "actionRationale": (
            f"Trained CatBoost prediction: {tier} ({action_raw}). "
            f"Expected shipping loss if dispatched on COD: â‚¹{loss_inr:.2f}."
        ),
        "isDemoAssessment": False,
        "modelProbability": p,
        "binaryThreshold": pred.get("binary_threshold", 0.37),
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
            f"Tier: {tier}. Expected shipping loss: â‚¹{loss_inr:.2f}."
        ),
        "outcome": "SUCCESS",
    })

    order["updatedAt"] = now
    return order


# ---------------------------------------------------------------------------
# Initial Seed Orders
# ---------------------------------------------------------------------------


def create_initial_seed_orders() -> list[dict[str, Any]]:
    """Build standard representative orders across Indian e-commerce scenarios."""
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
                "phoneMasked": "+91 98765 â€¢â€¢â€¢â€¢â€¢",
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
                "phoneMasked": "+91 99100 â€¢â€¢â€¢â€¢â€¢",
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
                "phoneMasked": "+91 98200 â€¢â€¢â€¢â€¢â€¢",
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
                "phoneMasked": "+91 97112 â€¢â€¢â€¢â€¢â€¢",
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
                "phoneMasked": "+91 94120 â€¢â€¢â€¢â€¢â€¢",
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
                "phoneMasked": "+91 98991 â€¢â€¢â€¢â€¢â€¢",
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
    allow_origins=["*"] if "*" in CORS_ORIGINS else [o.strip() for o in CORS_ORIGINS if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(UnknownPincode)
async def _unknown_pincode_handler(request: Request, exc: UnknownPincode) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.exception_handler(ValueError)
async def _value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


# ---------------------------------------------------------------------------
# Health & Diagnostics Endpoints
# ---------------------------------------------------------------------------


@app.get("/health", tags=["system"])
@app.get("/api/health", tags=["system"])
def health():
    """Basic service health reporting model status and database count."""
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


@app.get("/ready", tags=["system"])
@app.get("/api/ready", tags=["system"])
def readiness():
    """Verify required services and model readiness. Returns 503 if model or db fails."""
    try:
        # Verify database
        n_orders = count_orders()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database readiness failed: {exc}",
        )

    try:
        service = get_service()
        if not service or not hasattr(service, "pipeline"):
            raise RuntimeError("Model pipeline missing in service bundle")
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Machine learning model readiness failed: {exc}",
        )

    return {
        "status": "ready",
        "model_loaded": True,
        "database_connected": True,
        "orders_count": n_orders,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/v1/model/status", tags=["model"])
def model_status():
    """Detailed model status, estimator, SHA-256 digest, and frozen operating threshold."""
    try:
        service = get_service()
        info = service.describe()
        return {
            "status": "operational",
            "model_key": info["model_key"],
            "estimator": info["estimator"],
            "sha256": info["model_sha256"],
            "seed": info["seed"],
            "frozen_threshold": info["frozen_threshold"],
            "tier_cuts": info["frozen_tier_cuts"],
            "cost_params_inr": info["cost_params_inr"],
            "n_features": info["n_feature_columns"],
            "source": info["source"],
            "model_path": str(MODEL_PATH),
        }
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Model unavailable: {exc}",
        )


@app.get("/api/v1/model/metrics", tags=["model"])
def model_metrics():
    """Verified evaluation metrics loaded directly from reports/results/05_final_metrics.json."""
    metrics_path = BACKEND_ROOT / "reports" / "results" / "05_final_metrics.json"
    if not metrics_path.exists():
        raise HTTPException(
            status_code=404,
            detail="Evaluation metrics artifact reports/results/05_final_metrics.json not found.",
        )
    try:
        data = json.loads(metrics_path.read_text(encoding="utf-8"))
        return {
            "final_model": data.get("final_model"),
            "frozen_operating_point": data.get("frozen_operating_point"),
            "test_set_evaluation": data.get("test"),
            "validation_set_evaluation": data.get("validation"),
            "cost_model_summary": {
                "fn_cost_inr": 200.0,
                "margin_rate": 0.25,
                "prepaid_conversion": 0.45,
                "cod_fee_inr": 50.0,
                "operating_threshold": 0.37,
            },
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed reading metrics artifact: {exc}")


# ---------------------------------------------------------------------------
# Orders CRUD & Pagination Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/orders", tags=["orders"])
@app.get("/api/v1/orders", tags=["orders"])
def list_orders(
    status: Optional[str] = None,
    payment_method: Optional[str] = None,
    risk_category: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """Retrieve orders with filtering, searching, and pagination.

    Backward compatible: if no query params supplied, returns the full list for existing frontend calls.
    """
    if status is None and payment_method is None and risk_category is None and search is None and limit == 50 and offset == 0:
        return get_all_orders()

    result = db_list_orders(
        status=status,
        payment_method=payment_method,
        risk_category=risk_category,
        search=search,
        limit=limit,
        offset=offset,
    )
    return result["items"]


@app.post("/api/orders", tags=["orders"], status_code=status.HTTP_201_CREATED)
@app.post("/api/v1/orders", tags=["orders"], status_code=status.HTTP_201_CREATED)
def create_order_endpoint(order_in: OrderCreateIn):
    """Create a new order in persistent SQLite storage and optionally score it immediately."""
    now = datetime.now(timezone.utc).isoformat()
    order_id = order_in.id or f"ord_{int(datetime.now(timezone.utc).timestamp()*1000)}"
    order_num = order_in.orderNumber or f"RTO-{order_id[-4:]}"

    financials_dict = (
        order_in.financials.model_dump()
        if order_in.financials
        else {
            "orderValue": order_in.orderValue,
            "productCost": round(order_in.orderValue * 0.35, 2),
            "forwardShippingCost": 120.0,
            "packagingCost": 40.0,
            "paymentGatewayFee": round(order_in.orderValue * 0.02, 2) if order_in.paymentMethod == "PREPAID" else 0.0,
            "codCollectionFee": 50.0 if order_in.paymentMethod == "COD" else 0.0,
            "reverseLogisticsCost": 150.0,
            "verificationCost": 0.0,
            "incentiveDiscount": 0.0,
            "expectedContribution": round(order_in.orderValue * 0.3, 2),
            "currency": "INR",
        }
    )

    new_order: dict[str, Any] = {
        "id": order_id,
        "orderNumber": order_num,
        "createdAt": now,
        "updatedAt": now,
        "orderValue": order_in.orderValue,
        "paymentMethod": order_in.paymentMethod,
        "status": order_in.status or "PENDING",
        "deliveryAttempts": order_in.deliveryAttempts,
        "items": [it.model_dump() for it in order_in.items],
        "customer": order_in.customer.model_dump(),
        "financials": financials_dict,
        "timeline": [
            {
                "id": f"evt_create_{order_id}",
                "orderId": order_id,
                "timestamp": now,
                "eventName": "Order Created",
                "category": "LIFECYCLE",
                "source": "MERCHANT_MANUAL",
                "details": f"Order received. Value: â‚¹{order_in.orderValue:.2f}, Payment: {order_in.paymentMethod}",
                "outcome": "SUCCESS",
            }
        ],
    }

    # Automatically score with CatBoost if requested
    if order_in.runPredictionImmediately:
        try:
            payload = map_order_to_payload(new_order)
            result = score_order(payload, interpret=False)
            save_prediction(result)
            new_order = update_order_with_prediction(new_order, result)
        except Exception as exc:
            logger.warning(f"Immediate scoring skipped for created order {order_id}: {exc}")

    try:
        saved = db_create_order(new_order)
        return saved
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@app.get("/api/orders/{order_id}", tags=["orders"])
@app.get("/api/v1/orders/{order_id}", tags=["orders"])
def get_order(order_id: str):
    """Retrieve an order by ID or orderNumber."""
    order = get_order_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail=f"Order '{order_id}' not found")
    return order


@app.patch("/api/orders/{order_id}", tags=["orders"])
@app.patch("/api/v1/orders/{order_id}", tags=["orders"])
def patch_order_endpoint(order_id: str, update: OrderUpdateIn):
    """Update permitted fields of an existing order."""
    patch_data = update.model_dump(exclude_unset=True)
    updated = db_patch_order(order_id, patch_data)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Order '{order_id}' not found")
    return updated


@app.delete("/api/orders/{order_id}", tags=["orders"])
@app.delete("/api/v1/orders/{order_id}", tags=["orders"])
def delete_order_endpoint(order_id: str):
    """Delete an order by ID."""
    order = get_order_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail=f"Order '{order_id}' not found")

    deleted = db_delete_order(order_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Order '{order_id}' could not be deleted")
    return {"status": "deleted", "order_id": order_id}


# ---------------------------------------------------------------------------
# Prediction & Inference Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/orders/{order_id}/score", tags=["scoring"])
@app.post("/api/v1/orders/{order_id}/predict", tags=["scoring"])
def score_existing_order(order_id: str, explain_plainly: bool = False):
    """Score an existing order using the real trained CatBoostClassifier."""
    order = get_order_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail=f"Order '{order_id}' not found")

    try:
        service = get_service()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"CatBoost model is unavailable: {exc}",
        )

    try:
        payload = map_order_to_payload(order)
        result = score_order(payload, service=service, interpret=explain_plainly)
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
        raise HTTPException(status_code=500, detail=f"Model inference failed: {str(exc)}")


@app.post("/score", response_model=ScoreOut, tags=["scoring"])
@app.post("/api/score", response_model=ScoreOut, tags=["scoring"])
@app.post("/api/v1/predictions", response_model=ScoreOut, tags=["scoring"])
def score_raw(order: OrderIn, explain_plainly: bool = False):
    """Score one raw order payload with CatBoostClassifier, return decision, and persist."""
    try:
        service = get_service()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"CatBoost model is unavailable: {exc}",
        )

    payload = order.model_dump()
    payload["customer_history"] = order.customer_history.model_dump()
    try:
        result = score_order(payload, service=service, interpret=explain_plainly)
        save_prediction(result)
        result["prediction_timestamp"] = datetime.now(timezone.utc).isoformat()
        result["model_version"] = "CatBoost 1.2.8"
        return result
    except UnknownPincode as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Validation or feature error: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Model scoring error: {exc}")


@app.post("/api/v1/predictions/batch", response_model=BatchScoreOut, tags=["scoring"])
def score_batch(batch: BatchPredictionIn, explain_plainly: bool = False):
    """Score a bounded batch of orders (up to 100) using CatBoostClassifier."""
    try:
        service = get_service()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"CatBoost model is unavailable: {exc}",
        )

    results: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc).isoformat()

    for item in batch.orders:
        payload = item.model_dump()
        payload["customer_history"] = item.customer_history.model_dump()
        try:
            res = score_order(payload, service=service, interpret=explain_plainly)
            save_prediction(res)
            res["prediction_timestamp"] = now
            res["model_version"] = "CatBoost 1.2.8"
            results.append(res)
        except Exception as exc:
            logger.warning(f"Batch scoring error on order {item.order_id}: {exc}")
            results.append({
                "order_id": item.order_id,
                "rto_probability": 0.0,
                "binary_threshold": 0.37,
                "band": "medium",
                "action": "charge_cod_fee",
                "action_label": "REVIEW",
                "reasons": [f"Scoring error: {exc}"],
                "expected_loss_if_shipped_inr": 0.0,
                "flagged_at_binary_threshold": False,
                "is_cod": item.is_cod,
                "resolved": {},
                "prediction_timestamp": now,
                "model_version": "CatBoost 1.2.8",
            })

    return {"count": len(results), "predictions": results}


@app.post("/decision", tags=["legacy"])
def legacy_decision(data: DecisionRequest):
    """Backward compatibility endpoint for decision requests."""
    p = data.risk_probability
    threshold = 0.37
    try:
        service = get_service()
        threshold = service.threshold
    except Exception:
        pass

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
@app.get("/api/v1/predictions", tags=["history"])
def get_prediction_history(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    order_id: Optional[str] = None,
    band: Optional[str] = None,
    min_probability: Optional[float] = None,
    max_probability: Optional[float] = None,
):
    """Retrieve newest persistent scoring records with filtering and pagination."""
    records = db_list_predictions(
        limit=limit,
        offset=offset,
        order_id=order_id,
        band=band,
        min_prob=min_probability,
        max_prob=max_probability,
    )
    return {"count": len(records), "predictions": records}


@app.get("/api/predictions/{order_id}", tags=["history"])
@app.get("/api/v1/predictions/{prediction_id}", tags=["history"])
def get_prediction_by_identifier(prediction_id: Optional[str] = None, order_id: Optional[str] = None):
    """Retrieve prediction by numeric id or order_id string."""
    identifier = prediction_id or order_id
    if not identifier:
        raise HTTPException(status_code=400, detail="Prediction identifier required")
    pred = get_prediction_by_id(identifier)
    if not pred:
        raise HTTPException(status_code=404, detail=f"No prediction found for '{identifier}'")
    return pred


@app.get("/sample_orders", tags=["demo"])
@app.get("/api/sample_orders", tags=["demo"])
@app.get("/api/v1/sample_orders", tags=["demo"])
def get_sample_orders(n_per_tier: int = 2):
    """Return real validation-split sample orders spanning ALLOW, REVIEW, and BLOCK."""
    if not 1 <= n_per_tier <= 5:
        raise HTTPException(422, "n_per_tier must be between 1 and 5")
    return sample_orders(n_per_tier=n_per_tier)


# ---------------------------------------------------------------------------
# Dashboard Analytics Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/dashboard/summary", tags=["dashboard"])
@app.get("/api/v1/dashboard/summary", tags=["dashboard"])
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


@app.get("/api/v1/analytics/risk-distribution", tags=["analytics"])
def analytics_risk_distribution():
    """Distribution of orders across risk categories and decision bands."""
    return get_risk_distribution()


@app.get("/api/v1/analytics/prediction-trends", tags=["analytics"])
def analytics_prediction_trends():
    """Chronological history of predictions and average probabilities."""
    return get_prediction_trends()


@app.get("/api/v1/analytics/shipping-loss", tags=["analytics"])
def analytics_shipping_loss():
    """Aggregate shipping loss metrics and calculated prevention savings."""
    return get_shipping_loss_analytics()


@app.get("/api/v1/analytics/orders", tags=["analytics"])
def analytics_orders():
    """Aggregate breakdown by order status, payment mode, and pincode tier."""
    return get_orders_analytics()


# ---------------------------------------------------------------------------
# Profit Intelligence & What-If Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/v1/profit/estimate", tags=["profit"])
def profit_estimate_endpoint(data: ProfitEstimateIn):
    """Estimate expected loss using validated model probability and available cost inputs."""
    loss = calculate_expected_shipping_loss(
        probability=data.rto_probability,
        forward_shipping_cost=data.forward_shipping_cost,
        reverse_logistics_cost=data.reverse_logistics_cost,
        packaging_cost=data.packaging_cost,
        default_fn_cost_inr=data.default_fn_cost_inr,
    )
    return {
        "rto_probability": data.rto_probability,
        "order_value": data.order_value,
        "expected_shipping_loss_inr": loss,
        "formula": "Expected Shipping Loss = P(RTO) * [Forward + Reverse + Packaging Cost]",
        "note": "Probabilities indicate estimated risk likelihood and do not guarantee an RTO outcome.",
    }


@app.post("/api/v1/profit/what-if", tags=["profit"])
def profit_what_if_endpoint(data: WhatIfIn):
    """Compare risk or cost scenarios using documented probability-weighted calculations."""
    return evaluate_what_if_scenario(
        order_value=data.order_value,
        rto_probability=data.rto_probability,
        forward_shipping_cost=data.forward_shipping_cost,
        reverse_logistics_cost=data.reverse_logistics_cost,
        product_cost_ratio=data.product_cost_ratio,
        is_cod=data.is_cod,
        intervention_type=data.intervention_type,
        incentive_discount=data.incentive_discount,
        verification_cost=data.verification_cost,
        conversion_rate=data.conversion_rate,
    )


@app.post("/profit/scenarios", tags=["profit"])
@app.post("/api/profit/scenarios", tags=["profit"])
def profit_scenarios_endpoint(data: ProfitScenariosIn):
    """Frontend-compatible endpoint generating transparent operational scenarios."""
    order = get_order_by_id(data.orderId)
    if not order:
        raise HTTPException(status_code=404, detail=f"Order '{data.orderId}' not found")

    order_val = float(order.get("orderValue", 1000.0))
    fin = data.financials or order.get("financials", {})
    score = (
        data.riskScore
        if data.riskScore is not None
        else order.get("risk", {}).get("riskScore", 50.0)
    )
    is_cod = order.get("paymentMethod") == "COD"
    cat = order.get("risk", {}).get("riskCategory", "MEDIUM")

    return generate_scenario_comparisons(
        order_id=data.orderId,
        order_value=order_val,
        financials=fin,
        risk_score=score,
        is_cod=is_cod,
        risk_category=cat,
    )


# ---------------------------------------------------------------------------
# NDR Rescue & Lifecycle Events
# ---------------------------------------------------------------------------


@app.get("/api/v1/ndr/orders", tags=["ndr"])
def list_ndr_orders():
    """Retrieve all orders currently in active NDR or recovery status."""
    orders = get_all_orders()
    ndr_orders = [
        o for o in orders if o.get("status") in ["NDR_PENDING", "RECOVERY_IN_PROGRESS"]
    ]
    return ndr_orders


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
@app.post("/api/v1/ndr/{order_id}/action", tags=["ndr"])
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
# Optional Multilingual / Bhashini Endpoint
# ---------------------------------------------------------------------------


@app.post("/api/v1/multilingual/translate", tags=["multilingual"])
async def translate_endpoint(
    text: str = Body(..., embed=True),
    target_language: str = Body("hi", embed=True),
    template_type: Optional[str] = Body(None, embed=True),
):
    """Optional multilingual translation service powered by BHASHINI with offline fallback."""
    result = await translate_text(
        text=text,
        target_language=target_language,
        template_type=template_type,
    )
    return result


# ---------------------------------------------------------------------------
# Razorpay Dynamic Checkout & Payment Integrations (Buildathon Track 02)
# ---------------------------------------------------------------------------


@app.post("/api/razorpay/checkout-gate", tags=["razorpay"])
@app.post("/api/v1/razorpay/checkout-gate", tags=["razorpay"])
def razorpay_checkout_gate(payload: dict[str, Any]):
    """Evaluate CatBoost RTO score in real-time and return dynamic Razorpay checkout policy."""
    try:
        service = get_service()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Risk scoring model unavailable: {exc}",
        )

    try:
        model_payload = {
            "order_id": payload.get("order_id", "cart_adhoc"),
            "customer_id": payload.get("customer_id", "CUST_CHECKOUT"),
            "pincode": str(payload["pincode"]).strip(),
            "address_line": str(payload["address_line"]).strip(),
            "category": str(payload.get("category", "fashion")),
            "order_value": float(payload["order_value"]),
            "is_cod": True,  # Evaluate assuming buyer selected COD
            "customer_history": payload.get("customer_history", {}),
        }
        pred = score_order(model_payload, service=service, explain=True, interpret=True)
        prob = float(pred["rto_probability"])
        threshold = float(pred.get("binary_threshold", 0.37))
        low_cut = float(service.low_cut)
        high_cut = float(service.high_cut)

        decision = evaluate_dynamic_checkout(
            rto_probability=prob,
            order_value=float(payload["order_value"]),
            threshold=threshold,
            low_cut=low_cut,
            high_cut=high_cut,
        )
        decision["reasons"] = pred.get("reasons", [])
        decision["plain_language_summary"] = pred.get("plain_language_summary")
        decision["expected_shipping_loss_inr"] = pred.get("expected_loss_if_shipped_inr", 0.0)
        return decision
    except UnknownPincode as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.error(f"Dynamic checkout gate failed: {exc}")
        raise HTTPException(status_code=422, detail=f"Checkout gate evaluation error: {exc}")


@app.post("/api/razorpay/create-order", tags=["razorpay"])
@app.post("/api/v1/razorpay/create-order", tags=["razorpay"])
def razorpay_create_order_endpoint(data: dict[str, Any]):
    """Create a test/live Razorpay order for prepayment or COD verification fee."""
    amount_inr = float(data.get("amount_inr", 0))
    if amount_inr <= 0:
        raise HTTPException(status_code=422, detail="amount_inr must be positive")
    receipt = str(data.get("order_id") or data.get("receipt") or f"rcpt_{int(datetime.now(timezone.utc).timestamp())}")
    notes = data.get("notes") or {}
    try:
        rzp_order = create_razorpay_order(amount_inr=amount_inr, receipt=receipt, notes=notes)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    save_razorpay_order(
        order_id=receipt,
        razorpay_order_id=str(rzp_order["id"]),
        amount_paise=int(rzp_order["amount"]),
        mode=str(rzp_order.get("mode", razorpay_mode())),
    )
    return rzp_order


@app.post("/api/razorpay/payment-link", tags=["razorpay"])
@app.post("/api/v1/razorpay/payment-link", tags=["razorpay"])
def razorpay_payment_link_endpoint(data: dict[str, Any]):
    """Create a Razorpay payment link for high-risk orders to send via WhatsApp/SMS."""
    order_id = str(data.get("order_id", "ord_adhoc"))
    amount_inr = float(data.get("amount_inr", 0))
    if amount_inr <= 0:
        raise HTTPException(status_code=422, detail="amount_inr must be positive")
    name = str(data.get("customer_name", "Customer"))
    phone = data.get("customer_phone")
    email = data.get("customer_email")
    desc = data.get("description")
    try:
        link = create_payment_link(
            order_id=order_id,
            amount_inr=amount_inr,
            customer_name=name,
            customer_phone=phone,
            customer_email=email,
            description=desc,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return link


@app.post("/api/razorpay/verify-payment", tags=["razorpay"])
@app.post("/api/v1/razorpay/verify-payment", tags=["razorpay"])
def razorpay_verify_payment_endpoint(data: dict[str, Any]):
    """Verify a Standard Checkout signature against its persisted local order."""
    order_id = str(data.get("order_id", ""))
    razorpay_order_id = str(data.get("razorpay_order_id", ""))
    payment_id = str(data.get("razorpay_payment_id", ""))
    signature = str(data.get("razorpay_signature", ""))
    gateway_order = get_razorpay_order(order_id) if order_id else None
    if not gateway_order or gateway_order["mode"] == "simulated":
        raise HTTPException(status_code=409, detail="No live Razorpay order exists for this checkout.")
    if gateway_order["razorpay_order_id"] != razorpay_order_id:
        raise HTTPException(status_code=400, detail="Payment does not match the order created for this checkout.")
    if not verify_payment_signature(razorpay_order_id, payment_id, signature):
        raise HTTPException(status_code=400, detail="Invalid Razorpay payment signature.")

    order = get_order_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Local order not found.")
    now = datetime.now(timezone.utc).isoformat()
    order["status"] = "CONFIRMED"
    order["paymentMethod"] = "PREPAID"
    order.setdefault("timeline", []).append({
        "id": f"evt_rzp_payment_{int(datetime.now(timezone.utc).timestamp() * 1000)}",
        "orderId": order_id,
        "timestamp": now,
        "eventName": "Razorpay Checkout Payment Verified",
        "category": "PAYMENT",
        "source": "RAZORPAY_CHECKOUT",
        "details": f"Payment ID: {payment_id}; Razorpay order ID: {razorpay_order_id}",
        "outcome": "SUCCESS",
    })
    order["updatedAt"] = now
    upsert_order(order)
    return {"status": "verified", "order_id": order_id}


@app.post("/api/razorpay/demo-payment", tags=["razorpay"])
@app.post("/api/v1/razorpay/demo-payment", tags=["razorpay"])
def razorpay_demo_payment_endpoint(data: dict[str, Any]):
    """Record an explicit local payment simulation when no Razorpay account is configured."""
    if has_razorpay_credentials():
        raise HTTPException(status_code=404, detail="Demo payment simulation is disabled when Razorpay credentials are configured.")
    order_id = str(data.get("order_id", ""))
    gateway_order = get_razorpay_order(order_id) if order_id else None
    if not gateway_order or gateway_order["mode"] != "simulated":
        raise HTTPException(status_code=404, detail="Simulated checkout order not found.")
    order = get_order_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Local order not found.")
    now = datetime.now(timezone.utc).isoformat()
    order["status"] = "CONFIRMED"
    order["paymentMethod"] = "PREPAID"
    order.setdefault("timeline", []).append({
        "id": f"evt_demo_payment_{int(datetime.now(timezone.utc).timestamp() * 1000)}",
        "orderId": order_id,
        "timestamp": now,
        "eventName": "Simulated Online Payment",
        "category": "PAYMENT",
        "source": "DEMO_SIMULATOR",
        "details": "Local demo confirmation only; no money was charged.",
        "outcome": "SUCCESS",
    })
    order["updatedAt"] = now
    upsert_order(order)
    return {"status": "simulated", "order_id": order_id}


@app.post("/api/razorpay/webhook", tags=["razorpay"])
@app.post("/api/v1/razorpay/webhook", tags=["razorpay"])
async def razorpay_webhook_endpoint(request: Request):
    """Receive and process Razorpay webhooks (payment.captured, order.paid, etc.)."""
    raw_body = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")
    if not os.environ.get("RAZORPAY_WEBHOOK_SECRET"):
        raise HTTPException(status_code=503, detail="Razorpay webhook secret is not configured.")
    if not verify_webhook_signature(raw_body, signature):
        raise HTTPException(status_code=401, detail="Invalid Razorpay webhook signature.")
    try:
        data = json.loads(raw_body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    event = data.get("event", "")
    payload = data.get("payload", {})
    entity = (
        payload.get("payment", {}).get("entity")
        or payload.get("order", {}).get("entity")
        or payload.get("payment_link", {}).get("entity")
        or {}
    )
    order_id = (
        entity.get("notes", {}).get("order_id")
        or entity.get("receipt")
        or entity.get("reference_id")
    )
    if not order_id:
        gateway_order_id = entity.get("order_id") or entity.get("id")
        gateway_order = (
            get_order_for_razorpay_reference(str(gateway_order_id))
            if gateway_order_id
            else None
        )
        order_id = gateway_order["order_id"] if gateway_order else None

    logger.info(f"Received Razorpay webhook event: {event} for order {order_id}")

    if order_id:
        existing = get_order_by_id(order_id)
        if existing:
            now = datetime.now(timezone.utc).isoformat()
            if event in ["payment.captured", "order.paid", "payment_link.paid"]:
                payment = payload.get("payment", {}).get("entity", entity)
                existing["status"] = "CONFIRMED"
                existing["paymentMethod"] = "PREPAID"
                timeline = existing.setdefault("timeline", [])
                timeline.append({
                    "id": f"evt_rzp_{len(timeline)+1}",
                    "orderId": order_id,
                    "timestamp": now,
                    "eventName": "Razorpay Payment Captured",
                    "category": "PAYMENT",
                    "source": "RAZORPAY_WEBHOOK",
                    "details": f"Payment ID: {payment.get('id', 'pay_test')}, Amount: â‚¹{payment.get('amount', 0)/100:.2f}",
                    "outcome": "SUCCESS",
                })
                existing["updatedAt"] = now
                upsert_order(existing)
            elif event in ["payment.failed", "payment_link.expired"]:
                timeline = existing.setdefault("timeline", [])
                timeline.append({
                    "id": f"evt_rzp_{len(timeline)+1}",
                    "orderId": order_id,
                    "timestamp": now,
                    "eventName": "Razorpay Payment Failed",
                    "category": "PAYMENT",
                    "source": "RAZORPAY_WEBHOOK",
                    "details": f"Gateway event: {event}",
                    "outcome": "FAILED",
                })
                existing["updatedAt"] = now
                upsert_order(existing)

    return {"status": "ok", "event": event, "order_id": order_id}


# ---------------------------------------------------------------------------
# Batch CSV Upload & Scoring Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/predictions/csv", tags=["batch"])
@app.post("/api/v1/predictions/csv", tags=["batch"])
async def upload_and_score_csv(file: UploadFile = File(...)):
    """Upload a merchant orders CSV, batch score with CatBoost, and return summary + enriched data."""
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files (.csv) are supported")

    content = await file.read()
    try:
        result = score_merchant_csv(content)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.error(f"CSV scoring failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed scoring CSV: {exc}")


@app.post("/api/predictions/csv/download", tags=["batch"])
@app.post("/api/v1/predictions/csv/download", tags=["batch"])
async def download_scored_csv(file: UploadFile = File(...)):
    """Upload CSV and immediately stream back the enriched CSV file."""
    content = await file.read()
    try:
        result = score_merchant_csv(content)
        return Response(
            content=result["csv_data"],
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=rtoguard_scored_orders.csv"},
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed processing CSV: {exc}")


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
            "version": "2.0.0",
        }

