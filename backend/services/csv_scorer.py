"""Batch CSV Order Scoring Service for Merchants.

Parses arbitrary merchant CSV exports, normalizes columns to CatBoost feature schemas,
scores every row in real-time with TreeExplainer reasons, and exports an enriched CSV.
"""

from __future__ import annotations

import io
import logging
from typing import Any

import pandas as pd

from src.serving import UnknownPincode, get_service, score_order

logger = logging.getLogger("rtoguard.csv_scorer")


def score_merchant_csv(csv_content: str | bytes) -> dict[str, Any]:
    """Parse, validate, score, and enrich a merchant CSV file."""
    if isinstance(csv_content, bytes):
        text = csv_content.decode("utf-8", errors="replace")
    else:
        text = str(csv_content)

    df = pd.read_csv(io.StringIO(text))
    if df.empty:
        raise ValueError("The provided CSV file contains no order rows.")

    # Normalize column names to lowercase with underscores
    df.columns = [c.strip().lower().replace(" ", "_").replace("-", "_") for c in df.columns]

    # Map candidate column names
    col_map = {
        "id": "order_id",
        "ordernumber": "order_id",
        "order_no": "order_id",
        "postal_code": "pincode",
        "zip": "pincode",
        "zipcode": "pincode",
        "address": "address_line",
        "addressline": "address_line",
        "street": "address_line",
        "value": "order_value",
        "amount": "order_value",
        "total": "order_value",
        "payment": "payment_mode",
        "payment_method": "payment_mode",
    }
    df = df.rename(columns={c: col_map[c] for c in df.columns if c in col_map})

    required = ["pincode", "address_line", "order_value"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"CSV missing mandatory columns: {', '.join(missing)}")

    service = get_service()
    scored_rows = []
    enriched_records = []

    low_count = 0
    med_count = 0
    high_count = 0
    total_expected_loss = 0.0
    prevented_loss = 0.0

    for idx, row in df.iterrows():
        order_id = str(row.get("order_id") or f"ord_csv_{idx + 1}")
        raw_pin = str(row.get("pincode", "110001")).strip()
        if len(raw_pin) > 6:
            raw_pin = raw_pin[:6]
        elif len(raw_pin) < 6:
            raw_pin = raw_pin.zfill(6)

        address = str(row.get("address_line", "Main Street"))
        order_val = max(1.0, float(row.get("order_value", 1000.0)))
        category = str(row.get("category", "fashion")).lower()
        if category not in ["fashion", "footwear", "beauty", "accessories", "home_kitchen", "electronics"]:
            category = "fashion"

        pay_mode = str(row.get("payment_mode", "COD")).upper()
        is_cod = bool(row.get("is_cod", True if pay_mode == "COD" else False))

        history = {
            "past_orders": int(row.get("past_orders", 0)),
            "past_rto_count": int(row.get("past_rto_count", 0)),
            "account_age_days": float(row.get("account_age_days", 0.0)),
            "order_velocity_24h": int(row.get("order_velocity_24h", 0)),
        }

        payload = {
            "order_id": order_id,
            "pincode": raw_pin,
            "address_line": address,
            "category": category,
            "order_value": order_val,
            "is_cod": is_cod,
            "customer_history": history,
        }

        try:
            res = score_order(payload, service=service, explain=True, interpret=False)
            prob = float(res["rto_probability"])
            band = res["band"]
            action = res["action_label"]
            loss = float(res["expected_loss_if_shipped_inr"])
            reasons = res.get("reasons", [])
            primary_reason = reasons[0] if reasons else "Model feature evaluation"
        except UnknownPincode:
            # Fallback for unrecognized pincode: assign medium tier baseline
            prob = 0.25
            band = "medium"
            action = "REVIEW"
            loss = 50.0
            primary_reason = f"Pincode {raw_pin} not in India Post directory; manual review suggested."
        except Exception as exc:
            prob = 0.20
            band = "medium"
            action = "REVIEW"
            loss = 40.0
            primary_reason = f"Scoring exception: {exc}"

        if action == "ALLOW":
            low_count += 1
            recommended = "DISPATCH_STANDARD"
        elif action == "REVIEW":
            med_count += 1
            recommended = "REQUEST_ADDRESS_VERIFICATION"
        else:
            high_count += 1
            recommended = "BLOCK_COD_OFFER_PREPAID"
            prevented_loss += loss

        total_expected_loss += loss

        record = {
            "order_id": order_id,
            "pincode": raw_pin,
            "category": category,
            "order_value": order_val,
            "is_cod": is_cod,
            "rto_probability": round(prob, 4),
            "risk_score": int(round(prob * 100)),
            "risk_band": band,
            "action_tier": action,
            "recommended_action": recommended,
            "expected_loss_inr": round(loss, 2),
            "primary_reason": primary_reason,
        }
        enriched_records.append(record)

    enriched_df = pd.DataFrame(enriched_records)
    output_buf = io.StringIO()
    enriched_df.to_csv(output_buf, index=False)
    csv_string = output_buf.getvalue()

    return {
        "summary": {
            "total_orders": len(enriched_records),
            "low_risk_count": low_count,
            "medium_risk_count": med_count,
            "high_risk_count": high_count,
            "total_expected_loss_inr": round(total_expected_loss, 2),
            "prevented_loss_inr": round(prevented_loss, 2),
        },
        "records": enriched_records[:100],  # preview top 100 in response
        "csv_data": csv_string,
    }
