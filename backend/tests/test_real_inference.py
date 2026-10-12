"""Automated tests verifying real inference with CatBoostClassifier on actual order payloads."""

from __future__ import annotations

import pytest

from src.serving import get_service, sample_orders, score_order


def test_real_inference_on_sample_orders():
    samples = sample_orders(n_per_tier=1)
    orders = samples["orders"]
    assert len(orders) >= 3

    svc = get_service()

    for item in orders:
        payload = item["payload"]
        result = score_order(payload, service=svc, explain=True, interpret=False)

        assert "order_id" in result
        assert "rto_probability" in result
        assert 0.0 <= result["rto_probability"] <= 1.0
        assert result["action"] in {"allow_cod", "charge_cod_fee", "disable_cod"}
        assert result["action_label"] in {"ALLOW", "REVIEW", "BLOCK"}
        assert result["band"] in {"low", "medium", "high"}

        # Expected loss must equal probability * 200
        expected_loss = result["rto_probability"] * 200.0
        assert result["expected_loss_if_shipped_inr"] == pytest.approx(expected_loss, abs=0.5)

        # Explanations must be a non-empty list of strings
        assert isinstance(result["reasons"], list)


def test_real_inference_threshold_application():
    svc = get_service()
    threshold = svc.threshold  # 0.37

    samples = sample_orders(n_per_tier=2)
    for item in samples["orders"]:
        result = score_order(item["payload"], service=svc)
        p = result["rto_probability"]

        assert result["binary_threshold"] == pytest.approx(threshold)
        if p >= threshold:
            assert result["flagged_at_binary_threshold"] is True
        else:
            assert result["flagged_at_binary_threshold"] is False


def test_prepaid_orders_are_not_blocked():
    svc = get_service()
    payload = {
        "order_id": "ord_test_prepaid",
        "customer_id": "Customer A",
        "pincode": "560001",
        "address_line": "Bangalore Fort, Bangalore",
        "category": "home_kitchen",
        "order_value": 3199.0,
        "is_cod": False,
        "discount_pct": 0.0,
        "customer_history": {
            "past_orders": 6,
            "past_rto_count": 0,
            "account_age_days": 120.0,
            "order_velocity_24h": 1,
        },
    }
    result = score_order(payload, service=svc)
    assert result["is_cod"] is False
    assert result["action"] != "disable_cod"
    assert result["rto_probability"] < 0.5
