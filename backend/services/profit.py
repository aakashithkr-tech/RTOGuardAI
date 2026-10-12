"""Profit Intelligence and Explainable Expected Loss Services.

Calculates:
1. Expected shipping loss from probability of return and shipping costs.
2. Net unit contribution under delivered vs RTO outcomes.
3. Scenario comparisons across merchant interventions (Prepaid conversion, Address bot, Hold dispatch).
4. Sensitivity what-if simulations based on customizable commercial assumptions.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional


@dataclass(frozen=True)
class ContributionParams:
    order_value: float
    product_cost: float
    forward_shipping_cost: float
    packaging_cost: float
    cod_collection_fee: float
    payment_gateway_fee: float
    reverse_logistics_cost: float
    delivery_probability: float  # 0.0 to 1.0
    verification_cost: float = 0.0
    incentive_discount: float = 0.0
    is_prepaid: bool = False


def calculate_expected_shipping_loss(
    probability: float,
    forward_shipping_cost: Optional[float] = None,
    reverse_logistics_cost: Optional[float] = None,
    packaging_cost: Optional[float] = None,
    default_fn_cost_inr: float = 200.0,
) -> float:
    """Expected shipping burn incurred on an unprevented RTO order.

    Expected Loss = P(RTO) * applicable_shipping_cost
    If detailed costs exist: applicable_shipping_cost = forward + reverse + packaging.
    Otherwise falls back to the validated baseline ₹200 (evidence.yaml).
    """
    p = max(0.0, min(1.0, float(probability)))
    if (
        forward_shipping_cost is not None
        and reverse_logistics_cost is not None
        and packaging_cost is not None
        and (forward_shipping_cost + reverse_logistics_cost) > 0
    ):
        rto_cost = forward_shipping_cost + reverse_logistics_cost + packaging_cost
    else:
        rto_cost = default_fn_cost_inr

    return round(p * rto_cost, 2)


def calculate_expected_contribution(params: ContributionParams) -> int:
    """Calculate expected rupee contribution using probability-weighted outcomes.

    Outcome 1: DELIVERED (Probability P)
      Revenue = order_value - incentive_discount
      Costs = product_cost + forward_shipping + packaging + payment_fee + verification_cost
      Delivered Contribution = Revenue - Costs

    Outcome 2: RTO (Probability 1 - P)
      Revenue = 0 (Inventory returns to warehouse)
      Costs = forward_shipping + reverse_logistics + packaging + verification_cost
      RTO Contribution = -Costs (pure logistics loss)

    Expected Contribution = P * Delivered Contribution + (1 - P) * RTO Contribution
    """
    p = max(0.0, min(1.0, float(params.delivery_probability)))
    rto_p = 1.0 - p

    payment_fee = (
        params.payment_gateway_fee if params.is_prepaid else params.cod_collection_fee
    )

    # Delivered scenario
    delivered_revenue = params.order_value - params.incentive_discount
    delivered_costs = (
        params.product_cost
        + params.forward_shipping_cost
        + params.packaging_cost
        + payment_fee
        + params.verification_cost
    )
    delivered_contrib = delivered_revenue - delivered_costs

    # RTO scenario
    rto_costs = (
        params.forward_shipping_cost
        + params.reverse_logistics_cost
        + params.packaging_cost
        + params.verification_cost
    )
    rto_contrib = -rto_costs

    expected_val = (p * delivered_contrib) + (rto_p * rto_contrib)
    return int(round(expected_val))


def generate_scenario_comparisons(
    order_id: str,
    order_value: float,
    financials: dict[str, Any],
    risk_score: float,
    is_cod: bool = True,
    risk_category: str = "MEDIUM",
) -> list[dict[str, Any]]:
    """Generate deterministic scenario comparisons across 4 operational actions."""
    f_val = float(financials.get("orderValue", order_value))
    p_cost = float(financials.get("productCost", f_val * 0.35))
    fwd_cost = float(financials.get("forwardShippingCost", 120.0))
    pack_cost = float(financials.get("packagingCost", 40.0))
    cod_fee = float(financials.get("codCollectionFee", 50.0))
    pg_fee = float(financials.get("paymentGatewayFee", f_val * 0.02))
    rev_cost = float(financials.get("reverseLogisticsCost", 150.0))

    score_pct = max(0.0, min(100.0, float(risk_score)))
    baseline_deliv_prob = (
        max(0.10, 1.0 - (score_pct / 100.0)) if is_cod else 0.94
    )

    baseline_contrib = calculate_expected_contribution(
        ContributionParams(
            order_value=f_val,
            product_cost=p_cost,
            forward_shipping_cost=fwd_cost,
            packaging_cost=pack_cost,
            cod_collection_fee=cod_fee,
            payment_gateway_fee=pg_fee,
            reverse_logistics_cost=rev_cost,
            delivery_probability=baseline_deliv_prob,
            verification_cost=0.0,
            incentive_discount=0.0,
            is_prepaid=not is_cod,
        )
    )

    scenarios = []

    # Scenario 1: Standard Dispatch (Baseline)
    scenarios.append({
        "actionKey": "DISPATCH_STANDARD",
        "title": "1. Standard Dispatch (Baseline)",
        "description": "Proceed with standard logistics without upfront intervention.",
        "isRecommended": risk_category == "LOW",
        "deliveryProbability": round(baseline_deliv_prob, 2),
        "rtoProbability": round(1.0 - baseline_deliv_prob, 2),
        "forwardShippingCost": fwd_cost,
        "reverseLogisticsCost": rev_cost,
        "verificationCost": 0.0,
        "incentiveCost": 0.0,
        "expectedContribution": baseline_contrib,
        "deltaFromBaseline": 0,
        "financialAdvantageLabel": "Baseline scenario",
        "majorTradeOff": "Zero communication friction, but bears full exposure to RTO reverse logistics burn.",
        "keyUncertainty": "Customer intent at doorstep remains unverified.",
        "assumptions": [
            f"Base delivery probability modeled at {int(baseline_deliv_prob * 100)}% based on trained ML score.",
            f"COD collection fee of ₹{cod_fee:.0f} applies on successful delivery.",
            f"Reverse logistics cost of ₹{rev_cost:.0f} incurred if returned.",
        ],
    })

    # Scenario 2: Proactive Address & Pincode Verification
    addr_p = min(0.88, baseline_deliv_prob + 0.28)
    addr_contrib = calculate_expected_contribution(
        ContributionParams(
            order_value=f_val,
            product_cost=p_cost,
            forward_shipping_cost=fwd_cost,
            packaging_cost=pack_cost,
            cod_collection_fee=cod_fee,
            payment_gateway_fee=pg_fee,
            reverse_logistics_cost=rev_cost,
            delivery_probability=addr_p,
            verification_cost=8.0,
            incentive_discount=0.0,
            is_prepaid=not is_cod,
        )
    )
    scenarios.append({
        "actionKey": "REQUEST_ADDRESS_VERIFICATION",
        "title": "2. Proactive Address & Pincode Verification",
        "description": "Send automated WhatsApp/SMS interactive address enrichment to confirm landmark before dispatch.",
        "isRecommended": risk_category in ["MEDIUM", "HIGH"],
        "deliveryProbability": round(addr_p, 2),
        "rtoProbability": round(1.0 - addr_p, 2),
        "forwardShippingCost": fwd_cost,
        "reverseLogisticsCost": rev_cost,
        "verificationCost": 8.0,
        "incentiveCost": 0.0,
        "expectedContribution": addr_contrib,
        "deltaFromBaseline": addr_contrib - baseline_contrib,
        "financialAdvantageLabel": f"+₹{addr_contrib - baseline_contrib} net contribution lift",
        "majorTradeOff": "Adds 2-6 hour dispatch delay while awaiting customer response.",
        "keyUncertainty": "Customer response rate to WhatsApp enrichment message (~70% benchmark).",
        "assumptions": [
            "Interactive address verification bot cost estimated at ₹8 per session.",
            "Address enrichment historically lifts first-attempt delivery rate by +28%.",
            "Eliminates consignee untraceable NDR status.",
        ],
    })

    # Scenario 3: Convert to Prepaid with Smart Discount
    prepaid_p = 0.96
    discount_val = min(100.0, round(f_val * 0.05))
    prepaid_contrib = calculate_expected_contribution(
        ContributionParams(
            order_value=f_val,
            product_cost=p_cost,
            forward_shipping_cost=fwd_cost,
            packaging_cost=pack_cost,
            cod_collection_fee=0.0,
            payment_gateway_fee=pg_fee,
            reverse_logistics_cost=rev_cost,
            delivery_probability=prepaid_p,
            verification_cost=4.0,
            incentive_discount=discount_val,
            is_prepaid=True,
        )
    )
    scenarios.append({
        "actionKey": "OFFER_PREPAID_INCENTIVE",
        "title": "3. Convert to Prepaid with Smart Discount",
        "description": "Offer instant 5% cashback / discount via payment link to secure upfront payment.",
        "isRecommended": is_cod and f_val >= 1200 and score_pct >= 50,
        "deliveryProbability": round(prepaid_p, 2),
        "rtoProbability": round(1.0 - prepaid_p, 2),
        "forwardShippingCost": fwd_cost,
        "reverseLogisticsCost": rev_cost,
        "verificationCost": 4.0,
        "incentiveCost": discount_val,
        "expectedContribution": prepaid_contrib,
        "deltaFromBaseline": prepaid_contrib - baseline_contrib,
        "financialAdvantageLabel": f"+₹{prepaid_contrib - baseline_contrib} net contribution lift",
        "majorTradeOff": f"Margin reduced by ₹{discount_val:.0f} customer payment discount.",
        "keyUncertainty": "Customer willingness to pay online via UPI (45% benchmark conversion).",
        "assumptions": [
            f"Prepaid discount incentive capped at ₹{discount_val:.0f}.",
            "Prepaid delivery rate reaches 96% due to monetary commitment.",
            f"Saves ₹{cod_fee:.0f} COD collection charge, incurring only ₹{pg_fee:.0f} PG fee.",
        ],
    })

    # Scenario 4: Hold Dispatch for High-Risk Tele-verification
    tele_p = min(0.85, baseline_deliv_prob + 0.35)
    tele_contrib = calculate_expected_contribution(
        ContributionParams(
            order_value=f_val,
            product_cost=p_cost,
            forward_shipping_cost=fwd_cost,
            packaging_cost=pack_cost,
            cod_collection_fee=cod_fee,
            payment_gateway_fee=pg_fee,
            reverse_logistics_cost=rev_cost,
            delivery_probability=tele_p,
            verification_cost=15.0,
            incentive_discount=0.0,
            is_prepaid=not is_cod,
        )
    )
    scenarios.append({
        "actionKey": "HOLD_DISPATCH",
        "title": "4. Hold Dispatch for Tele-verification",
        "description": "Place dispatch hold and trigger prioritized call-center agent verification.",
        "isRecommended": risk_category == "CRITICAL" or score_pct >= 75,
        "deliveryProbability": round(tele_p, 2),
        "rtoProbability": round(1.0 - tele_p, 2),
        "forwardShippingCost": fwd_cost,
        "reverseLogisticsCost": rev_cost,
        "verificationCost": 15.0,
        "incentiveCost": 0.0,
        "expectedContribution": tele_contrib,
        "deltaFromBaseline": tele_contrib - baseline_contrib,
        "financialAdvantageLabel": f"+₹{tele_contrib - baseline_contrib} net contribution lift",
        "majorTradeOff": "Operational cost of tele-calling team and dispatch lead time delay.",
        "keyUncertainty": "Phone reachability during business hours.",
        "assumptions": [
            "Tele-calling operational agent cost estimated at ₹15 per order.",
            "High-risk confirmation weeds out fraudulent or impulsive orders.",
            "Prevents guaranteed ₹200+ reverse logistics loss on rejected orders.",
        ],
    })

    return scenarios


def evaluate_what_if_scenario(
    order_value: float,
    rto_probability: float,
    forward_shipping_cost: float = 120.0,
    reverse_logistics_cost: float = 150.0,
    product_cost_ratio: float = 0.35,
    is_cod: bool = True,
    intervention_type: str = "prepaid_discount",
    incentive_discount: float = 50.0,
    verification_cost: float = 10.0,
    conversion_rate: float = 0.45,
) -> dict[str, Any]:
    """Evaluate interactive what-if scenarios with adjustable sliders."""
    p_rto = max(0.0, min(1.0, float(rto_probability)))
    p_deliv = 1.0 - p_rto
    product_cost = order_value * product_cost_ratio

    # Baseline calculations
    baseline_expected_loss = calculate_expected_shipping_loss(
        p_rto, forward_shipping_cost, reverse_logistics_cost, 40.0
    )
    baseline_contrib = calculate_expected_contribution(
        ContributionParams(
            order_value=order_value,
            product_cost=product_cost,
            forward_shipping_cost=forward_shipping_cost,
            packaging_cost=40.0,
            cod_collection_fee=50.0 if is_cod else 0.0,
            payment_gateway_fee=order_value * 0.02,
            reverse_logistics_cost=reverse_logistics_cost,
            delivery_probability=p_deliv,
            verification_cost=0.0,
            incentive_discount=0.0,
            is_prepaid=not is_cod,
        )
    )

    # Simulated intervention scenario
    if intervention_type == "prepaid_discount":
        simulated_deliv_p = 0.96
        simulated_loss = calculate_expected_shipping_loss(
            0.04, forward_shipping_cost, reverse_logistics_cost, 40.0
        )
        simulated_contrib = calculate_expected_contribution(
            ContributionParams(
                order_value=order_value,
                product_cost=product_cost,
                forward_shipping_cost=forward_shipping_cost,
                packaging_cost=40.0,
                cod_collection_fee=0.0,
                payment_gateway_fee=order_value * 0.02,
                reverse_logistics_cost=reverse_logistics_cost,
                delivery_probability=simulated_deliv_p,
                verification_cost=verification_cost,
                incentive_discount=incentive_discount,
                is_prepaid=True,
            )
        )
    elif intervention_type == "address_verification":
        simulated_deliv_p = min(0.90, p_deliv + 0.28)
        simulated_loss = calculate_expected_shipping_loss(
            1.0 - simulated_deliv_p, forward_shipping_cost, reverse_logistics_cost, 40.0
        )
        simulated_contrib = calculate_expected_contribution(
            ContributionParams(
                order_value=order_value,
                product_cost=product_cost,
                forward_shipping_cost=forward_shipping_cost,
                packaging_cost=40.0,
                cod_collection_fee=50.0 if is_cod else 0.0,
                payment_gateway_fee=order_value * 0.02,
                reverse_logistics_cost=reverse_logistics_cost,
                delivery_probability=simulated_deliv_p,
                verification_cost=verification_cost,
                incentive_discount=0.0,
                is_prepaid=not is_cod,
            )
        )
    else:  # cancel / block
        simulated_deliv_p = 0.0
        simulated_loss = 0.0
        # If canceled, merchant loses no shipping, but loses potential profit on false positives
        simulated_contrib = 0

    net_saving = max(0.0, baseline_expected_loss - simulated_loss)
    contribution_delta = simulated_contrib - baseline_contrib

    return {
        "intervention_type": intervention_type,
        "order_value": order_value,
        "baseline": {
            "rto_probability": round(p_rto, 4),
            "delivery_probability": round(p_deliv, 4),
            "expected_shipping_loss_inr": baseline_expected_loss,
            "expected_contribution_inr": baseline_contrib,
        },
        "simulated": {
            "delivery_probability": round(simulated_deliv_p, 4),
            "expected_shipping_loss_inr": simulated_loss,
            "expected_contribution_inr": simulated_contrib,
        },
        "impact": {
            "expected_shipping_loss_reduction_inr": round(net_saving, 2),
            "net_contribution_delta_inr": contribution_delta,
            "estimated_intervention_cost_inr": verification_cost + incentive_discount,
            "is_financially_viable": contribution_delta > 0 or net_saving > (verification_cost + incentive_discount),
        },
        "formula": "Contribution = P(Delivered)*[Revenue - Costs] + P(RTO)*[-Shipping_Loss]",
    }
