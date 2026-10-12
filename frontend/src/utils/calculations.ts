import { Order, ScenarioComparison, RecommendedActionType } from '../types';

export interface CalculationParams {
  orderValue: number;
  productCost: number;
  forwardShippingCost: number;
  packagingCost: number;
  codCollectionFee: number;
  paymentGatewayFee: number;
  reverseLogisticsCost: number;
  deliveryProbability: number; // 0 to 1
  verificationCost: number;
  incentiveDiscount: number;
  isPrepaid: boolean;
}

/**
 * Calculates expected merchant contribution (profit) using probability-weighted delivery vs RTO outcomes:
 *
 * Outcome A: DELIVERED (probability = P)
 *   Revenue = orderValue - incentiveDiscount
 *   Costs = productCost + forwardShippingCost + packagingCost + (isPrepaid ? paymentGatewayFee : codCollectionFee) + verificationCost
 *   Contribution_A = Revenue - Costs
 *
 * Outcome B: RTO (probability = 1 - P)
 *   Revenue = 0 (for COD, product returned). Product returned to inventory so product cost is not lost,
 *             though restocking/depreciation can be noted. Here inventory is preserved.
 *   Costs = forwardShippingCost + reverseLogisticsCost + packagingCost + verificationCost
 *   Contribution_B = -Costs (pure loss on logistics and handling)
 *
 * Expected Contribution = P * Contribution_A + (1 - P) * Contribution_B
 */
export function calculateExpectedContribution(params: CalculationParams): number {
  const p = Math.max(0, Math.min(1, params.deliveryProbability));
  const rtoP = 1 - p;

  const paymentFee = params.isPrepaid ? params.paymentGatewayFee : params.codCollectionFee;

  // If delivered:
  const deliveredRevenue = params.orderValue - params.incentiveDiscount;
  const deliveredCosts =
    params.productCost +
    params.forwardShippingCost +
    params.packagingCost +
    paymentFee +
    params.verificationCost;
  const deliveredContribution = deliveredRevenue - deliveredCosts;

  // If RTO:
  const rtoLoss =
    params.forwardShippingCost +
    params.reverseLogisticsCost +
    params.packagingCost +
    params.verificationCost;
  const rtoContribution = -rtoLoss;

  const expectedVal = p * deliveredContribution + rtoP * rtoContribution;
  return Math.round(expectedVal);
}

/**
 * Generates transparent scenario comparisons for an order across candidate actions.
 */
export function generateScenarioComparisons(order: Order): ScenarioComparison[] {
  const f = order.financials;
  const isCod = order.paymentMethod === 'COD';
  const baselineP = isCod
    ? Math.max(0.1, 1 - (order.risk.riskScore / 100))
    : 0.94; // Prepaid baseline historically higher

  const baselineContribution = calculateExpectedContribution({
    orderValue: f.orderValue,
    productCost: f.productCost,
    forwardShippingCost: f.forwardShippingCost,
    packagingCost: f.packagingCost,
    codCollectionFee: f.codCollectionFee,
    paymentGatewayFee: f.paymentGatewayFee,
    reverseLogisticsCost: f.reverseLogisticsCost,
    deliveryProbability: baselineP,
    verificationCost: 0,
    incentiveDiscount: 0,
    isPrepaid: !isCod,
  });

  const scenarios: ScenarioComparison[] = [
    {
      actionKey: 'DISPATCH_STANDARD',
      title: '1. Standard Dispatch (Baseline)',
      description: 'Proceed with existing address and COD terms without proactive intervention.',
      isRecommended: order.risk.riskCategory === 'LOW',
      deliveryProbability: baselineP,
      rtoProbability: 1 - baselineP,
      forwardShippingCost: f.forwardShippingCost,
      reverseLogisticsCost: f.reverseLogisticsCost,
      verificationCost: 0,
      incentiveCost: 0,
      expectedContribution: baselineContribution,
      deltaFromBaseline: 0,
      financialAdvantageLabel: 'Baseline scenario',
      majorTradeOff: 'Zero upfront communication friction, but bears full exposure to RTO reverse logistics and courier penalty.',
      keyUncertainty: 'Customer intent at doorstep remains unverified.',
      assumptions: [
        `Base delivery probability modeled at ${(baselineP * 100).toFixed(0)}% based on current risk profile.`,
        `COD collection fee of ₹${f.codCollectionFee} applies on delivery.`,
        `Reverse logistics cost of ₹${f.reverseLogisticsCost} incurred if returned.`
      ]
    },
    {
      actionKey: 'REQUEST_ADDRESS_VERIFICATION',
      title: '2. Proactive Address & Pincode Verification',
      description: 'Send automated WhatsApp/SMS interactive address enrichment to clarify house/landmark before dispatch.',
      isRecommended: order.risk.riskCategory === 'HIGH' && order.risk.primaryReason.toLowerCase().includes('address'),
      deliveryProbability: Math.min(0.88, baselineP + 0.28),
      rtoProbability: Math.max(0.12, 1 - (baselineP + 0.28)),
      forwardShippingCost: f.forwardShippingCost,
      reverseLogisticsCost: f.reverseLogisticsCost,
      verificationCost: 8, // ~₹8 WhatsApp API / BOT interactive session
      incentiveCost: 0,
      expectedContribution: 0,
      deltaFromBaseline: 0,
      financialAdvantageLabel: '',
      majorTradeOff: 'Adds 2-6 hour dispatch delay while waiting for customer response.',
      keyUncertainty: 'Customer response rate to address enrichment message (~65-75% industry benchmark).',
      assumptions: [
        'Interactive address bot cost estimated at ₹8 per session.',
        'Address correction historically lifts successful first-attempt delivery by +28%.',
        'Prevents NDR due to invalid landmark or incomplete street details.'
      ]
    },
    {
      actionKey: 'OFFER_PREPAID_INCENTIVE',
      title: '3. Convert to Prepaid with Smart Discount',
      description: 'Offer instant 5% UPI cashback / ₹75 prepaid discount via payment link to secure upfront commitment.',
      isRecommended: isCod && order.orderValue >= 1200 && order.risk.riskScore >= 60,
      deliveryProbability: 0.96, // Prepaid delivery rate is consistently >95%
      rtoProbability: 0.04,
      forwardShippingCost: f.forwardShippingCost,
      reverseLogisticsCost: f.reverseLogisticsCost,
      verificationCost: 4, // payment gateway link notification
      incentiveCost: Math.min(100, Math.round(order.orderValue * 0.05)),
      expectedContribution: 0,
      deltaFromBaseline: 0,
      financialAdvantageLabel: '',
      majorTradeOff: 'Margin reduction by the discount amount offered to customer.',
      keyUncertainty: 'Customer willingness to switch from COD to UPI payment before shipping.',
      assumptions: [
        `Cashback incentive capped at ₹${Math.min(100, Math.round(order.orderValue * 0.05))}.`,
        'Prepaid conversion practically eliminates doorstep rejection (96% delivery rate).',
        `Eliminates ₹${f.codCollectionFee} COD collection charge, replacing with ₹${f.paymentGatewayFee} PG fee.`
      ]
    },
    {
      actionKey: 'CUSTOMER_CONFIRMATION_CALL',
      title: '4. Voice / IVR Intent Confirmation',
      description: 'Deploy 1-click automated IVR call or operations team confirmation to verify purchase intent.',
      isRecommended: order.risk.riskCategory === 'CRITICAL' || (isCod && order.orderValue > 2500),
      deliveryProbability: Math.min(0.84, baselineP + 0.22),
      rtoProbability: Math.max(0.16, 1 - (baselineP + 0.22)),
      forwardShippingCost: f.forwardShippingCost,
      reverseLogisticsCost: f.reverseLogisticsCost,
      verificationCost: 14, // IVR / tele-call cost
      incentiveCost: 0,
      expectedContribution: 0,
      deltaFromBaseline: 0,
      financialAdvantageLabel: '',
      majorTradeOff: 'Requires merchant call budget; intrusive for high-intent buyers.',
      keyUncertainty: 'Unanswered calls require fallback handling or hold queue.',
      assumptions: [
        'Automated IVR call costs ₹14 per answered trigger.',
        'Confirmed buyer orders experience a +22% uplift in doorstep acceptance.',
        'Orders unconfirmed after 24h are escalated or placed on hold.'
      ]
    },
    {
      actionKey: 'ESCALATE_HUMAN_REVIEW',
      title: '5. Manual Operations Review & Hold',
      description: 'Hold order dispatch temporarily for operations specialist to cross-reference fraud signals and call buyer.',
      isRecommended: order.risk.riskCategory === 'CRITICAL',
      deliveryProbability: 0.78,
      rtoProbability: 0.22,
      forwardShippingCost: f.forwardShippingCost,
      reverseLogisticsCost: f.reverseLogisticsCost,
      verificationCost: 35, // Ops human time cost
      incentiveCost: 0,
      expectedContribution: 0,
      deltaFromBaseline: 0,
      financialAdvantageLabel: '',
      majorTradeOff: 'Highest operational handling cost (manual agent touchpoint).',
      keyUncertainty: 'Potential delivery SLA breach if dispatch is held longer than 12 hours.',
      assumptions: [
        'Estimated operations specialist cost of ₹35 per order review.',
        'Prevents catastrophic loss on suspect bulk or fraudulent high-value COD orders.'
      ]
    }
  ];

  // Calculate actual numbers for each scenario
  return scenarios.map(sc => {
    if (sc.actionKey === 'DISPATCH_STANDARD') {
      return sc;
    }

    const isPrepaidScenario = sc.actionKey === 'OFFER_PREPAID_INCENTIVE';
    const expCont = calculateExpectedContribution({
      orderValue: f.orderValue,
      productCost: f.productCost,
      forwardShippingCost: sc.forwardShippingCost,
      packagingCost: f.packagingCost,
      codCollectionFee: isPrepaidScenario ? 0 : f.codCollectionFee,
      paymentGatewayFee: isPrepaidScenario ? f.paymentGatewayFee : 0,
      reverseLogisticsCost: sc.reverseLogisticsCost,
      deliveryProbability: sc.deliveryProbability,
      verificationCost: sc.verificationCost,
      incentiveDiscount: sc.incentiveCost,
      isPrepaid: isPrepaidScenario || !isCod,
    });

    const delta = expCont - baselineContribution;

    return {
      ...sc,
      expectedContribution: expCont,
      deltaFromBaseline: delta,
      financialAdvantageLabel:
        delta > 0
          ? `+₹${delta.toLocaleString('en-IN')} estimated contribution protection`
          : delta === 0
          ? 'Neutral financial impact'
          : `-₹${Math.abs(delta).toLocaleString('en-IN')} net cost reduction`,
    };
  });
}
