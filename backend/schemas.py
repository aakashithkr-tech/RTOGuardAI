"""Pydantic schemas for RTOGuardAI request validation and response models."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field, field_validator


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


class BatchPredictionIn(BaseModel):
    orders: list[OrderIn] = Field(..., min_length=1, max_length=100)


class CustomerInfoIn(BaseModel):
    name: str = Field(..., min_length=1)
    phoneMasked: Optional[str] = None
    emailMasked: Optional[str] = None
    addressLine: str = Field(..., min_length=1)
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: str = Field(..., description="6-digit pincode")
    pincodeTier: Optional[str] = "TIER_3"
    historicalRtoRate: float = Field(0.0, ge=0.0, le=1.0)
    totalOrdersCount: int = Field(0, ge=0)
    accountAgeDays: float = Field(0.0, ge=0.0)
    orderVelocity24h: int = Field(0, ge=0)


class OrderItemIn(BaseModel):
    sku: Optional[str] = None
    name: str = Field(..., min_length=1)
    quantity: int = Field(1, ge=1)
    unitPrice: float = Field(..., ge=0)


class FinancialsIn(BaseModel):
    orderValue: float = Field(..., gt=0)
    productCost: Optional[float] = None
    forwardShippingCost: Optional[float] = 120.0
    packagingCost: Optional[float] = 40.0
    paymentGatewayFee: Optional[float] = 0.0
    codCollectionFee: Optional[float] = 50.0
    reverseLogisticsCost: Optional[float] = 150.0
    verificationCost: Optional[float] = 0.0
    incentiveDiscount: Optional[float] = 0.0
    currency: str = "INR"


class OrderCreateIn(BaseModel):
    id: Optional[str] = None
    orderNumber: Optional[str] = None
    orderValue: float = Field(..., gt=0)
    paymentMethod: Literal["COD", "PREPAID"]
    status: Optional[str] = "PENDING"
    deliveryAttempts: int = Field(0, ge=0)
    items: list[OrderItemIn] = Field(..., min_length=1)
    customer: CustomerInfoIn
    financials: Optional[FinancialsIn] = None
    runPredictionImmediately: bool = True


class OrderUpdateIn(BaseModel):
    status: Optional[str] = None
    orderValue: Optional[float] = Field(None, gt=0)
    paymentMethod: Optional[Literal["COD", "PREPAID"]] = None
    deliveryAttempts: Optional[int] = Field(None, ge=0)
    customer: Optional[dict[str, Any]] = None
    financials: Optional[dict[str, Any]] = None
    ndr: Optional[dict[str, Any]] = None
    items: Optional[list[dict[str, Any]]] = None


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
    prediction_timestamp: Optional[str] = None
    model_version: Optional[str] = "CatBoost 1.2.8"


class BatchScoreOut(BaseModel):
    count: int
    predictions: list[ScoreOut]


class DecisionRequest(BaseModel):
    order_id: str = Field(..., min_length=1)
    risk_probability: float = Field(..., ge=0, le=1)
    order_value: float = Field(..., ge=0)
    intervention_cost: float = Field(default=20, ge=0)


class ProfitEstimateIn(BaseModel):
    rto_probability: float = Field(..., ge=0.0, le=1.0)
    order_value: float = Field(..., gt=0.0)
    forward_shipping_cost: Optional[float] = None
    reverse_logistics_cost: Optional[float] = None
    packaging_cost: Optional[float] = None
    default_fn_cost_inr: float = 200.0


class WhatIfIn(BaseModel):
    order_value: float = Field(..., gt=0)
    rto_probability: float = Field(..., ge=0.0, le=1.0)
    forward_shipping_cost: float = Field(120.0, ge=0)
    reverse_logistics_cost: float = Field(150.0, ge=0)
    product_cost_ratio: float = Field(0.35, ge=0.0, le=1.0)
    is_cod: bool = True
    intervention_type: Literal["prepaid_discount", "address_verification", "block_cod"] = "prepaid_discount"
    incentive_discount: float = Field(50.0, ge=0)
    verification_cost: float = Field(10.0, ge=0)
    conversion_rate: float = Field(0.45, ge=0.0, le=1.0)


class ProfitScenariosIn(BaseModel):
    orderId: str = Field(..., min_length=1)
    financials: Optional[dict[str, Any]] = None
    riskScore: Optional[float] = None


# ---------------------------------------------------------------------------
# Shipment Tracking Schemas
# ---------------------------------------------------------------------------


class TrackingRegisterIn(BaseModel):
    tracking_number: str = Field(
        ..., min_length=3, max_length=100, description="Courier tracking number or AWB"
    )
    courier_code: str = Field(
        "delhivery",
        description="Courier partner code e.g. delhivery, bluedart, dtdc, xpressbees, ecom-express",
    )
    courier_name: Optional[str] = None
    estimated_delivery: Optional[str] = None
    origin_city: Optional[str] = None
    destination_city: Optional[str] = None
    notify_customer: bool = False


class TrackingUpdateIn(BaseModel):
    status: Optional[str] = None
    status_details: Optional[str] = None
    location: Optional[str] = None
    checkpoint_time: Optional[str] = None


class ShipmentTrackingOut(BaseModel):
    order_id: str
    tracking_number: str
    courier_code: str
    courier_name: str
    current_status: str
    status_details: Optional[str] = None
    estimated_delivery: Optional[str] = None
    origin_city: Optional[str] = None
    destination_city: Optional[str] = None
    last_checkpoint_time: Optional[str] = None
    updated_at: Optional[str] = None
    tracking_url: Optional[str] = None
    mode: str = "simulated"
    events_count: int = 0


class ShipmentHistoryOut(BaseModel):
    order_id: str
    tracking: Optional[ShipmentTrackingOut] = None
    events: list[dict[str, Any]] = []


class CourierInfoOut(BaseModel):
    code: str
    name: str
    aftership_slug: str
    tracking_url_template: str
    default_service: str
    description: str

