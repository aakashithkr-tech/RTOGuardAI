export type RiskCategory = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type PaymentMethod = 'COD' | 'PREPAID' | 'PARTIAL_COD';

export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'DISPATCHED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'NDR_PENDING'
  | 'RECOVERY_IN_PROGRESS'
  | 'RTO_INITIATED'
  | 'RTO_DELIVERED';

export type NdrReason =
  | 'INCOMPLETE_ADDRESS'
  | 'CUSTOMER_UNREACHABLE'
  | 'CUSTOMER_UNAVAILABLE'
  | 'DELIVERY_REJECTED'
  | 'DOORSTEP_RESCHEDULE';

export interface FinancialBreakdown {
  orderValue: number;
  productCost: number;
  forwardShippingCost: number;
  packagingCost: number;
  paymentGatewayFee: number;
  codCollectionFee: number;
  reverseLogisticsCost: number;
  verificationCost: number;
  incentiveDiscount: number;
  actualContribution?: number; // realized profit if completed
  expectedContribution: number; // probability-weighted
  currency: string;
}

export interface RiskFactor {
  id: string;
  factor: string;
  impact: 'POSITIVE' | 'NEUTRAL' | 'WARNING' | 'CRITICAL';
  scoreContribution?: number;
  explanation: string;
  sourceMetric: string;
}

export interface RiskAssessment {
  riskScore: number; // 0-100
  riskCategory: RiskCategory;
  modelSource: 'RTOGuard-v2.4-Ensemble' | 'Deterministic-Heuristics (Demo)' | 'Merchant-Rule-Engine' | 'CatBoostClassifier (final_model.joblib)' | string;
  assessedAt: string;
  confidence: number; // 0-1
  primaryReason: string;
  factors: RiskFactor[];
  recommendedAction: RecommendedActionType;
  actionRationale: string;
  isDemoAssessment: boolean;
  modelProbability?: number;
  binaryThreshold?: number;
  expectedLossIfShippedInr?: number;
  tierBand?: string;
}

export type RecommendedActionType =
  | 'DISPATCH_STANDARD'
  | 'REQUEST_ADDRESS_VERIFICATION'
  | 'CUSTOMER_CONFIRMATION_CALL'
  | 'OFFER_PREPAID_INCENTIVE'
  | 'ESCALATE_HUMAN_REVIEW'
  | 'HOLD_DISPATCH'
  | 'REATTEMPT_NDR'
  | 'SCHEDULE_RTO';

export interface TimelineEvent {
  id: string;
  orderId: string;
  timestamp: string;
  eventName: string;
  category: 'LIFECYCLE' | 'RISK' | 'ACTION' | 'COURIER' | 'NDR' | 'RECOVERY' | 'FINANCIAL';
  source: 'INTEGRATED_COURIER' | 'AI_ENGINE' | 'MERCHANT_MANUAL' | 'DEMO_SIMULATOR';
  details: string;
  actor?: string;
  outcome?: 'SUCCESS' | 'PENDING' | 'FAILED' | 'RESOLVED';
  metadata?: Record<string, string | number | boolean>;
}

export interface CustomerProfile {
  name: string;
  phoneMasked: string;
  emailMasked: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  pincodeTier: 'TIER_1' | 'TIER_2' | 'TIER_3' | 'REMOTE';
  pincodeServiceable: boolean;
  historicalRtoRate: number; // e.g. 0.45
  totalOrdersCount: number;
  isHighValueCustomer: boolean;
}

export interface NdrDetails {
  ndrReason: NdrReason;
  attemptNumber: number;
  maxAttemptsAllowed: number;
  lastAttemptAt: string;
  courierName: string;
  courierRemarks: string;
  courierAwb: string;
  recoveryActionTaken?: string;
  recoveryStatus: 'PENDING_ACTION' | 'ACTION_SENT' | 'REATTEMPT_SCHEDULED' | 'RESOLVED' | 'RTO_APPROVED';
}

export interface OrderItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  imageUrl?: string;
}

export interface Order {
  id: string;
  orderNumber: string; // e.g. RTO-9482
  createdAt: string;
  orderValue: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  items: OrderItem[];
  customer: CustomerProfile;
  financials: FinancialBreakdown;
  risk: RiskAssessment;
  plain_language_summary?: string;
  summary_source?: string;
  ndr?: NdrDetails;
  deliveryAttempts: number;
  timeline: TimelineEvent[];
  updatedAt: string;
}

export interface ScenarioComparison {
  actionKey: RecommendedActionType;
  title: string;
  description: string;
  isRecommended: boolean;
  deliveryProbability: number;
  rtoProbability: number;
  forwardShippingCost: number;
  reverseLogisticsCost: number;
  verificationCost: number;
  incentiveCost: number;
  expectedContribution: number;
  deltaFromBaseline: number;
  financialAdvantageLabel: string;
  majorTradeOff: string;
  keyUncertainty: string;
  assumptions: string[];
}

export interface DashboardSummary {
  totalOrders: number;
  codOrdersCount: number;
  prepaidOrdersCount: number;
  deliveredOrdersCount: number;
  pendingOrTransitCount: number;
  rtoOrdersCount: number;
  ordersAtRiskCount: number;
  totalOrderValue: number;
  estimatedContribution: number;
  recordedDeliveryCosts: number;
  preventedRtoLossEstimated: number;
  ndrActiveCount: number;
  activeMode: 'DEMO' | 'HYBRID' | 'LIVE';
}
