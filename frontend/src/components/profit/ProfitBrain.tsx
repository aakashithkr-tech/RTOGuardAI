import React, { useState } from 'react';
import {
  BrainCircuit,
  ArrowRight,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Sparkles,
  Shield,
  Layers,
  ArrowUpRight,
  Info,
} from 'lucide-react';
import { Order, ScenarioComparison, RecommendedActionType } from '../../types';
import { generateScenarioComparisons } from '../../utils/calculations';
import { formatCurrency } from '../../utils/formatters';
import { RiskBadge, PaymentBadge } from '../common/Badge';

interface ProfitBrainProps {
  orders: Order[];
  selectedOrderId?: string;
  onSelectOrder: (orderId: string) => void;
  onExecuteAction: (orderId: string, actionKey: RecommendedActionType) => void;
}

export const ProfitBrain: React.FC<ProfitBrainProps> = ({
  orders,
  selectedOrderId,
  onSelectOrder,
  onExecuteAction,
}) => {
  const currentOrder =
    orders.find(o => o.id === selectedOrderId) ||
    orders.find(o => o.risk.riskCategory === 'HIGH' || o.risk.riskCategory === 'CRITICAL') ||
    orders[0];

  const scenarios: ScenarioComparison[] = currentOrder
    ? generateScenarioComparisons(currentOrder)
    : [];

  const recommendedScenario = scenarios.find(s => s.isRecommended) || scenarios[1] || scenarios[0];

  return (
    <div className="space-y-6">
      {/* Top Banner explaining Core Differentiator */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-6 text-white shadow-sm border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 flex items-center gap-1.5">
                <BrainCircuit className="w-3.5 h-3.5" />
                <span>The Core Differentiator</span>
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Explainable Financial Decision Engine
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">
              Profit Brain: Action-Aware Scenario Simulator
            </h1>
            <p className="text-xs text-slate-300 mt-1 max-w-3xl leading-relaxed">
              Most tools stop at predicting risk score. RTOGuard calculates the probability-weighted merchant contribution of each viable operational action so you know exactly which decision protects the most capital.
            </p>
          </div>

          {/* Order Selector */}
          <div className="bg-slate-800/90 border border-slate-700 p-3 rounded-xl shrink-0">
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              Analyzing Order:
            </label>
            <select
              value={currentOrder?.id}
              onChange={e => onSelectOrder(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {orders.map(o => (
                <option key={o.id} value={o.id}>
                  {o.orderNumber} ({formatCurrency(o.orderValue)} - {o.risk.riskCategory} Risk - {o.paymentMethod})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Selected Order Summary Strip */}
      {currentOrder && (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <div>
              <span className="text-slate-400 font-mono text-[11px]">Selected Consignment:</span>
              <div className="font-bold text-slate-900 text-sm font-mono flex items-center gap-2">
                <span>{currentOrder.orderNumber}</span>
                <PaymentBadge method={currentOrder.paymentMethod} />
                <RiskBadge risk={currentOrder.risk.riskCategory} size="sm" />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div>
              <div className="text-[10px] text-slate-400">Order Value</div>
              <div className="font-bold text-slate-900">{formatCurrency(currentOrder.orderValue)}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">COGS (Product)</div>
              <div className="font-medium text-slate-700">₹{currentOrder.financials.productCost}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">Forward Freight</div>
              <div className="font-medium text-slate-700">₹{currentOrder.financials.forwardShippingCost}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">Reverse Exposure</div>
              <div className="font-bold text-rose-600">₹{currentOrder.financials.reverseLogisticsCost}</div>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-900 max-w-sm">
            <span className="font-bold block text-[11px]">Primary Risk Signal:</span>
            <span className="text-[11px] text-indigo-800 line-clamp-1">{currentOrder.risk.primaryReason}</span>
          </div>
        </div>
      )}

      {/* Recommended Strategy Spotlight */}
      {recommendedScenario && (
        <div className="bg-gradient-to-r from-emerald-900 via-slate-900 to-indigo-950 rounded-2xl p-6 text-white border border-emerald-500/30 shadow-md">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-2 flex-1">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 text-[10px] font-bold tracking-wider uppercase flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-emerald-300" />
                  <span>Optimal Recommendation</span>
                </span>
                <span className="text-xs text-slate-400">
                  Estimated advantage:{' '}
                  <strong className="text-emerald-400 font-mono">
                    {recommendedScenario.financialAdvantageLabel}
                  </strong>
                </span>
              </div>

              <h2 className="text-lg font-extrabold text-white">
                {recommendedScenario.title}
              </h2>

              <p className="text-xs text-slate-300 leading-relaxed max-w-2xl">
                {recommendedScenario.description}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs">
                <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                  <div className="text-[10px] font-semibold text-slate-400 uppercase">
                    Operational Trade-Off
                  </div>
                  <div className="text-[11px] text-slate-200 mt-0.5">
                    {recommendedScenario.majorTradeOff}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                  <div className="text-[10px] font-semibold text-slate-400 uppercase">
                    Key Uncertainty
                  </div>
                  <div className="text-[11px] text-slate-200 mt-0.5">
                    {recommendedScenario.keyUncertainty}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/90 border border-emerald-500/30 rounded-xl p-5 text-center shrink-0 min-w-[220px]">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                Expected Contribution
              </span>
              <div className="text-3xl font-extrabold font-mono text-emerald-400 mt-1">
                {formatCurrency(recommendedScenario.expectedContribution)}
              </div>
              <div className="text-[11px] text-emerald-300 font-semibold mt-1">
                vs ₹{scenarios[0]?.expectedContribution} (Baseline)
              </div>

              <button
                onClick={() =>
                  currentOrder && onExecuteAction(currentOrder.id, recommendedScenario.actionKey)
                }
                className="mt-4 w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5"
              >
                <span>Execute Action</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Side-by-Side Scenario Cards Matrix */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Comparative Scenario Matrix
            </h2>
            <p className="text-xs text-slate-500">
              Transparent cost & probability model comparing all 5 viable operational options
            </p>
          </div>
          <span className="text-[11px] text-slate-400 font-medium">
            *Simulation estimates; not guaranteed savings
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {scenarios.map((sc, index) => {
            const isBaseline = sc.actionKey === 'DISPATCH_STANDARD';
            const isRec = sc.isRecommended;

            return (
              <div
                key={sc.actionKey}
                className={`rounded-xl border p-5 flex flex-col justify-between transition-all ${
                  isRec
                    ? 'bg-emerald-50/30 border-emerald-300 shadow-md ring-1 ring-emerald-400/40'
                    : isBaseline
                    ? 'bg-slate-50/70 border-slate-300'
                    : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-sm'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                        isRec
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : isBaseline
                          ? 'bg-slate-200 text-slate-700'
                          : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                      }`}
                    >
                      {isRec ? 'Recommended' : isBaseline ? 'Baseline' : `Option ${index + 1}`}
                    </span>

                    <span className="font-mono text-xs font-bold text-slate-700">
                      P(Delv): {(sc.deliveryProbability * 100).toFixed(0)}%
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-slate-900 leading-snug">{sc.title}</h3>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{sc.description}</p>

                  {/* Financial Breakdown for Scenario */}
                  <div className="mt-4 pt-3 border-t border-slate-200/80 space-y-1.5 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>Forward Freight:</span>
                      <span className="font-mono font-medium text-slate-900">
                        ₹{sc.forwardShippingCost}
                      </span>
                    </div>

                    <div className="flex justify-between text-slate-600">
                      <span>Verification / Bot Cost:</span>
                      <span className="font-mono font-medium text-indigo-600">
                        {sc.verificationCost > 0 ? `₹${sc.verificationCost}` : '₹0'}
                      </span>
                    </div>

                    {sc.incentiveCost > 0 && (
                      <div className="flex justify-between text-amber-700 font-medium">
                        <span>Prepaid Cashback/Discount:</span>
                        <span className="font-mono">₹{sc.incentiveCost}</span>
                      </div>
                    )}

                    <div className="flex justify-between text-slate-600">
                      <span>Reverse Exposure Risk:</span>
                      <span className="font-mono font-medium text-rose-600">
                        ₹{Math.round(sc.reverseLogisticsCost * sc.rtoProbability)} (weighted)
                      </span>
                    </div>

                    <div className="pt-2 border-t border-slate-200 flex justify-between items-baseline font-bold">
                      <span className="text-slate-900">Expected Profit:</span>
                      <span
                        className={`text-base font-mono ${
                          sc.expectedContribution > 0 ? 'text-emerald-700' : 'text-rose-600'
                        }`}
                      >
                        {formatCurrency(sc.expectedContribution)}
                      </span>
                    </div>

                    {!isBaseline && (
                      <div className="text-[11px] text-right font-medium text-indigo-700 font-mono">
                        {sc.deltaFromBaseline > 0
                          ? `+₹${sc.deltaFromBaseline} vs baseline`
                          : `${sc.deltaFromBaseline} vs baseline`}
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Action footer */}
                <div className="mt-5 pt-3 border-t border-slate-200/80">
                  <button
                    onClick={() =>
                      currentOrder && onExecuteAction(currentOrder.id, sc.actionKey)
                    }
                    className={`w-full py-2 rounded-lg text-xs font-semibold transition-all ${
                      isRec
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
                        : 'bg-white hover:bg-slate-100 text-slate-800 border border-slate-300'
                    }`}
                  >
                    Select this action
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Accounting & Formula Transparency Footer */}
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-2">
        <div className="flex items-center gap-1.5 font-bold text-slate-800">
          <Info className="w-4 h-4 text-indigo-600" />
          <span>Transparent Financial Calculation Formula</span>
        </div>
        <p className="font-mono text-[11px] bg-white p-2.5 rounded border border-slate-200 text-slate-800">
          Expected Contribution = P(Delivery) × [Order Value - Discount - COGS - Forward Freight - Packaging - Gateway Fee - Verification] + (1 - P(Delivery)) × [- Forward Freight - Reverse Logistics - Packaging - Verification]
        </p>
        <p className="text-[11px] text-slate-500">
          Notice that in an RTO event, COGS is not lost because physical inventory returns to warehouse, but forward and reverse logistics are permanently lost.
        </p>
      </div>
    </div>
  );
};
