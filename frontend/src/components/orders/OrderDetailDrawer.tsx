import React, { useState } from 'react';
import {
  X,
  ShieldAlert,
  Coins,
  MapPin,
  Clock,
  Sparkles,
  Phone,
  Mail,
  Package,
  Truck,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  BrainCircuit,
  Loader2,
  FileText,
  UserCheck,
} from 'lucide-react';
import { Order, RecommendedActionType, OrderStatus, TimelineEvent } from '../../types';
import { RiskBadge, StatusBadge, PaymentBadge } from '../common/Badge';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { OrderTimeline } from './OrderTimeline';

interface OrderDetailDrawerProps {
  order: Order;
  onClose: () => void;
  onOpenProfitBrain: (orderId: string) => void;
  onScoreOrder?: (orderId: string) => Promise<void>;
  onRecordAction: (
    action: RecommendedActionType,
    notes?: string,
    additionalData?: Record<string, any>
  ) => Promise<void>;
  onRecordEvent: (
    eventName: string,
    newStatus?: OrderStatus,
    details?: string,
    source?: TimelineEvent['source']
  ) => Promise<void>;
}

export const OrderDetailDrawer: React.FC<OrderDetailDrawerProps> = ({
  order,
  onClose,
  onOpenProfitBrain,
  onScoreOrder,
  onRecordAction,
  onRecordEvent,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'financials' | 'risk' | 'timeline'>('overview');
  const [isActing, setIsActing] = useState(false);
  const [isScoring, setIsScoring] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [scoringErrorMsg, setScoringErrorMsg] = useState<string | null>(null);

  // Address correction modal state inside drawer
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [editedAddress, setEditedAddress] = useState(order.customer.addressLine);

  const f = order.financials;

  const handleScoreModelClick = async () => {
    if (!onScoreOrder) return;
    try {
      setIsScoring(true);
      setActionSuccessMsg(null);
      setScoringErrorMsg(null);
      await onScoreOrder(order.id);
      setActionSuccessMsg(`Order ${order.orderNumber} re-evaluated by trained CatBoost model.`);
      setTimeout(() => setActionSuccessMsg(null), 4000);
    } catch (error) {
      setScoringErrorMsg(
        error instanceof Error ? error.message : 'Trained model scoring failed.'
      );
      setTimeout(() => setScoringErrorMsg(null), 6000);
    } finally {
      setIsScoring(false);
    }
  };

  const handleActionClick = async (
    action: RecommendedActionType,
    notes?: string,
    additionalData?: Record<string, any>
  ) => {
    try {
      setIsActing(true);
      setActionSuccessMsg(null);
      await onRecordAction(action, notes, additionalData);
      setActionSuccessMsg(`Action recorded successfully: ${action.replace(/_/g, ' ')}`);
      setTimeout(() => setActionSuccessMsg(null), 4000);
    } finally {
      setIsActing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-3xl bg-white shadow-2xl flex flex-col border-l border-slate-200">
          {/* Top Header */}
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-base font-bold text-slate-900">
                    {order.orderNumber}
                  </span>
                  <StatusBadge status={order.status} size="sm" />
                  <PaymentBadge method={order.paymentMethod} />
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Placed {formatDate(order.createdAt)} · ID: {order.id}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleScoreModelClick}
                disabled={isScoring}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm transition-colors disabled:opacity-50"
                title="Run inference using actual trained CatBoost model"
              >
                {isScoring ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Scoring...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
                    <span>Score with Trained Model</span>
                  </>
                )}
              </button>
              <button
                onClick={() => onOpenProfitBrain(order.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-sm transition-colors"
              >
                <BrainCircuit className="w-3.5 h-3.5" />
                <span>Simulate in Profit Brain</span>
              </button>
              <button
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Action alert message */}
          {actionSuccessMsg && (
            <div className="bg-emerald-50 border-b border-emerald-200 px-6 py-2.5 flex items-center gap-2 text-xs text-emerald-800 font-medium animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{actionSuccessMsg}</span>
            </div>
          )}
          {scoringErrorMsg && (
            <div className="bg-rose-50 border-b border-rose-200 px-6 py-2.5 flex items-center gap-2 text-xs text-rose-800 font-medium animate-fadeIn">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{scoringErrorMsg}</span>
            </div>
          )}

          {/* Navigation Tabs */}
          <div className="px-6 border-b border-slate-200 bg-white flex gap-6 text-xs font-semibold">
            <button
              onClick={() => setActiveTab('overview')}
              className={`py-3 border-b-2 transition-colors ${
                activeTab === 'overview'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Order & Buyer
            </button>
            <button
              onClick={() => setActiveTab('risk')}
              className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'risk'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>Risk Intelligence</span>
              <RiskBadge risk={order.risk.riskCategory} size="sm" />
            </button>
            <button
              onClick={() => setActiveTab('financials')}
              className={`py-3 border-b-2 transition-colors ${
                activeTab === 'financials'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Financial Breakdown
            </button>
            <button
              onClick={() => setActiveTab('timeline')}
              className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'timeline'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>Audit Timeline</span>
              <span className="px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 text-[10px]">
                {order.timeline.length}
              </span>
            </button>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* TAB: OVERVIEW */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Recommended action callout */}
                <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200/80">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-800 bg-white px-2 py-0.5 rounded border border-indigo-200">
                      Recommended Action
                    </span>
                    <span className="text-xs font-semibold text-indigo-900">
                      Confidence {(order.risk.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">
                    {order.risk.recommendedAction.replace(/_/g, ' ')}
                  </h4>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    {order.risk.actionRationale}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() =>
                        handleActionClick(
                          order.risk.recommendedAction,
                          'Executed primary AI recommended action.'
                        )
                      }
                      disabled={isActing}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isActing ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Processing...</span>
                        </>
                      ) : (
                        <>
                          <span>Execute Recommended Action</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => onOpenProfitBrain(order.id)}
                      className="px-3.5 py-2 bg-white hover:bg-slate-50 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-semibold transition-colors"
                    >
                      View Financial Scenarios
                    </button>
                  </div>
                </div>

                {/* Items in Order */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Cart Items ({order.items.length})
                  </h4>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">
                    {order.items.map(item => (
                      <div key={item.sku} className="p-3.5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
                            <Package className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-slate-900">{item.name}</div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              SKU: {item.sku} · Qty: {item.quantity}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-bold text-slate-900">
                            {formatCurrency(item.unitPrice * item.quantity)}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            ₹{item.unitPrice} each
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Buyer Profile & Delivery Destination */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Customer Profile
                      </h4>
                      {order.customer.isHighValueCustomer && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                          VIP Buyer
                        </span>
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900">{order.customer.name}</div>
                      <div className="text-xs text-slate-600 flex items-center gap-1.5 mt-1">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-mono">{order.customer.phoneMasked}</span>
                      </div>
                      <div className="text-xs text-slate-600 flex items-center gap-1.5 mt-1">
                        <Mail className="w-3.5 h-3.5 text-slate-400" />
                        <span>{order.customer.emailMasked}</span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500 flex justify-between">
                      <span>Total Lifetime Orders:</span>
                      <strong className="text-slate-800">{order.customer.totalOrdersCount}</strong>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Destination & Route
                      </h4>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 font-semibold">
                        {order.customer.pincodeTier}
                      </span>
                    </div>

                    <div className="text-xs text-slate-700">
                      <div className="font-medium text-slate-900">{order.customer.addressLine}</div>
                      <div className="mt-1 text-slate-500">
                        {order.customer.city}, {order.customer.state} -{' '}
                        <strong className="text-slate-800 font-mono">{order.customer.pincode}</strong>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">Carrier Serviceability:</span>
                      <span className="text-emerald-700 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Confirmed
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action quick buttons */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Merchant Action Operations
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      onClick={() => setShowAddressModal(true)}
                      className="p-3 text-left rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all"
                    >
                      <div className="font-semibold text-xs text-slate-900">
                        Address Enrichment & Edit
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Update missing house or landmark before printing shipping label
                      </div>
                    </button>

                    <button
                      onClick={() =>
                        handleActionClick(
                          'OFFER_PREPAID_INCENTIVE',
                          'Offered ₹75 UPI cashback link to convert COD to Prepaid.'
                        )
                      }
                      className="p-3 text-left rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all"
                    >
                      <div className="font-semibold text-xs text-slate-900">
                        Convert to Prepaid (5% Discount)
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Trigger automated WhatsApp UPI payment link with ₹75 instant off
                      </div>
                    </button>

                    <button
                      onClick={() =>
                        handleActionClick(
                          'CUSTOMER_CONFIRMATION_CALL',
                          'Initiated automated IVR purchase confirmation.'
                        )
                      }
                      className="p-3 text-left rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all"
                    >
                      <div className="font-semibold text-xs text-slate-900">
                        IVR Voice Confirmation Call
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Automated Hindi/English call to verify delivery availability
                      </div>
                    </button>

                    <button
                      onClick={() =>
                        handleActionClick(
                          'ESCALATE_HUMAN_REVIEW',
                          'Placed on manual security hold for agent verification.'
                        )
                      }
                      className="p-3 text-left rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all"
                    >
                      <div className="font-semibold text-xs text-slate-900">
                        Escalate for Human Review
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Put dispatch on hold for warehouse manager approval
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: RISK INTELLIGENCE */}
            {activeTab === 'risk' && (
              <div className="space-y-6">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Overall Risk Score & Probability
                    </span>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-3xl font-extrabold text-slate-900 font-mono">
                        {order.risk.riskScore}
                      </span>
                      <span className="text-slate-400 text-xs">/ 100</span>
                      <RiskBadge risk={order.risk.riskCategory} />
                      {order.risk.modelProbability !== undefined && (
                        <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">
                          P(RTO) = {(order.risk.modelProbability * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600 mt-1">
                      Model source: <strong className="text-slate-800">{order.risk.modelSource}</strong>
                    </div>
                  </div>

                  <div className="text-right sm:border-l sm:border-slate-200 sm:pl-4 space-y-1">
                    <div className="text-[11px] text-slate-500">Expected Shipping Loss (COD)</div>
                    <div className="text-xl font-bold font-mono text-rose-600">
                      {order.risk.expectedLossIfShippedInr !== undefined
                        ? `₹${order.risk.expectedLossIfShippedInr.toFixed(2)}`
                        : 'Not available'}
                    </div>
                    {order.risk.binaryThreshold !== undefined && (
                      <div className="text-[10px] text-slate-400">
                        Model decision threshold: {order.risk.binaryThreshold}
                      </div>
                    )}
                  </div>
                </div>

                {/* Real Model Scoring Trigger Card */}
                <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-200 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-indigo-600" />
                      <span>Live CatBoost Inference Engine</span>
                    </div>
                    <p className="text-[11px] text-indigo-800 mt-0.5">
                      Re-evaluate order signals against trained model artifact, recompute SHAP attributions, and persist record.
                    </p>
                  </div>
                  <button
                    onClick={handleScoreModelClick}
                    disabled={isScoring}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                  >
                    {isScoring ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Scoring...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Score with Trained Model</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Primary Reason */}
                <div className="p-4 rounded-xl bg-amber-50/60 border border-amber-200/80">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900 uppercase tracking-wider">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span>Primary Risk Driver</span>
                  </div>
                  <p className="text-xs text-amber-950 mt-1.5 font-medium leading-relaxed">
                    {order.risk.primaryReason}
                  </p>
                </div>
                
{/* Gemini Plain-Language Explanation */}
{order.plain_language_summary && (
  <div className="p-4 rounded-xl bg-violet-50 border border-violet-200">
    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-violet-900">
      <Sparkles className="w-4 h-4 text-violet-600" />
      <span>Gemini AI Explanation</span>
      {order.summary_source === 'gemini' && (
        <span className="ml-auto px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px]">
          LIVE GEMINI
        </span>
      )}
    </div>
    <p className="text-sm text-violet-950 mt-2 leading-relaxed">
      {order.plain_language_summary}
    </p>
  </div>
)}


                {/* Detailed Factor Contributions */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                    Explainable Risk Signals ({order.risk.factors.length})
                  </h4>
                  <div className="space-y-2.5">
                    {order.risk.factors.map(factor => {
                      const isNeg = (factor.scoreContribution ?? 0) > 0;
                      return (
                        <div
                          key={factor.id}
                          className="p-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50/70 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-xs text-slate-900">
                                  {factor.factor}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  [{factor.sourceMetric}]
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                                {factor.explanation}
                              </p>
                            </div>

                            {factor.scoreContribution !== undefined && (
                              <span
                                className={`px-2 py-0.5 rounded text-xs font-mono font-bold shrink-0 ${
                                  isNeg
                                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                }`}
                              >
                                {isNeg ? `+${factor.scoreContribution}` : factor.scoreContribution} pts
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* TAB: FINANCIALS */}
            {activeTab === 'financials' && (
              <div className="space-y-6">
                <div className="p-4 rounded-xl bg-slate-900 text-white flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Expected Order Contribution
                    </span>
                    <div className="text-2xl font-bold font-mono text-emerald-400 mt-0.5">
                      {f.actualContribution !== undefined
                        ? formatCurrency(f.actualContribution)
                        : formatCurrency(f.expectedContribution)}
                    </div>
                    <div className="text-xs text-slate-300 mt-0.5">
                      Net profit after forward freight, COGS, packaging & probability-adjusted RTO exposure
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400">Order Gross Value</div>
                    <div className="text-lg font-bold font-mono">{formatCurrency(order.orderValue)}</div>
                  </div>
                </div>

                {/* Line Item Cost Breakdown Table */}
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                  <div className="p-3 bg-slate-50 text-xs font-bold text-slate-700 border-b border-slate-200">
                    Transparent Financial Cost Model
                  </div>
                  <table className="w-full text-xs text-left">
                    <tbody className="divide-y divide-slate-100">
                      <tr>
                        <td className="px-4 py-2.5 text-slate-600">Product Cost of Goods (COGS)</td>
                        <td className="px-4 py-2.5 font-mono text-right font-medium text-slate-900">
                          -₹{f.productCost}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 text-slate-600">Forward Shipping Freight</td>
                        <td className="px-4 py-2.5 font-mono text-right font-medium text-slate-900">
                          -₹{f.forwardShippingCost}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 text-slate-600">Packaging & Labeling Material</td>
                        <td className="px-4 py-2.5 font-mono text-right font-medium text-slate-900">
                          -₹{f.packagingCost}
                        </td>
                      </tr>
                      {order.paymentMethod === 'COD' && (
                        <tr>
                          <td className="px-4 py-2.5 text-slate-600">COD Cash Handling Charge</td>
                          <td className="px-4 py-2.5 font-mono text-right font-medium text-slate-900">
                            -₹{f.codCollectionFee}
                          </td>
                        </tr>
                      )}
                      {order.paymentMethod === 'PREPAID' && (
                        <tr>
                          <td className="px-4 py-2.5 text-slate-600">Payment Gateway Fee (2%)</td>
                          <td className="px-4 py-2.5 font-mono text-right font-medium text-slate-900">
                            -₹{f.paymentGatewayFee}
                          </td>
                        </tr>
                      )}
                      {f.verificationCost > 0 && (
                        <tr>
                          <td className="px-4 py-2.5 text-slate-600">Verification / API Bot Cost</td>
                          <td className="px-4 py-2.5 font-mono text-right font-medium text-indigo-700">
                            -₹{f.verificationCost}
                          </td>
                        </tr>
                      )}
                      {f.incentiveDiscount > 0 && (
                        <tr>
                          <td className="px-4 py-2.5 text-slate-600">Prepaid Incentive Discount</td>
                          <td className="px-4 py-2.5 font-mono text-right font-medium text-amber-700">
                            -₹{f.incentiveDiscount}
                          </td>
                        </tr>
                      )}
                      <tr className="bg-rose-50/50">
                        <td className="px-4 py-2.5 text-rose-800 font-medium">
                          Reverse Logistics Freight (if RTO occurs)
                        </td>
                        <td className="px-4 py-2.5 font-mono text-right font-bold text-rose-700">
                          -₹{f.reverseLogisticsCost}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-500 leading-relaxed">
                  <strong>Important Accounting Rule:</strong> Revenue does NOT equal profit. If an order returns to origin (RTO), merchant loses forward freight, reverse logistics freight, and packaging, while the product returns to inventory.
                </div>
              </div>
            )}

            {/* TAB: TIMELINE */}
            {activeTab === 'timeline' && (
              <OrderTimeline order={order} onRecordEvent={onRecordEvent} />
            )}
          </div>
        </div>
      </div>

      {/* Address Correction Sub-Modal */}
      {showAddressModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <h3 className="text-sm font-bold text-slate-900">Correct & Enrich Buyer Address</h3>
            <p className="text-xs text-slate-500 mt-1">
              Add landmark or missing flat number verified with customer.
            </p>

            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Full Delivery Street Address
              </label>
              <textarea
                rows={3}
                value={editedAddress}
                onChange={e => setEditedAddress(e.target.value)}
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowAddressModal(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowAddressModal(false);
                  await handleActionClick(
                    'REQUEST_ADDRESS_VERIFICATION',
                    `Merchant enriched address: "${editedAddress}"`,
                    { verifiedAddress: editedAddress }
                  );
                }}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm"
              >
                Save & Update Address
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
