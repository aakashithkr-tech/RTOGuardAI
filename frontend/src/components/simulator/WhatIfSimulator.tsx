import React, { useState, useMemo } from 'react';
import {
  SlidersHorizontal,
  RotateCcw,
  Sparkles,
  Info,
  TrendingUp,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { calculateExpectedContribution } from '../../utils/calculations';
import { formatCurrency } from '../../utils/formatters';

interface SimulatorState {
  orderValue: number;
  productCost: number;
  forwardShippingCost: number;
  reverseLogisticsCost: number;
  packagingCost: number;
  codCollectionFee: number;
  // Baseline assumptions
  baselineDeliveryProb: number; // e.g. 0.45
  // Alternative Intervention assumptions
  interventionDeliveryProb: number; // e.g. 0.85
  verificationCost: number; // e.g. 8
  prepaidIncentiveDiscount: number; // e.g. 75
  isConvertedToPrepaid: boolean;
}

const DEFAULT_SIMULATOR_STATE: SimulatorState = {
  orderValue: 2499,
  productCost: 850,
  forwardShippingCost: 130,
  reverseLogisticsCost: 160,
  packagingCost: 45,
  codCollectionFee: 55,
  baselineDeliveryProb: 0.45,
  interventionDeliveryProb: 0.82,
  verificationCost: 8,
  prepaidIncentiveDiscount: 0,
  isConvertedToPrepaid: false,
};

export const WhatIfSimulator: React.FC = () => {
  const [params, setParams] = useState<SimulatorState>(DEFAULT_SIMULATOR_STATE);

  const resetToDefaults = () => {
    setParams(DEFAULT_SIMULATOR_STATE);
  };

  const loadPreset = (presetType: 'HIGH_COD' | 'LOW_MARGIN' | 'REMOTE_RTO') => {
    if (presetType === 'HIGH_COD') {
      setParams({
        ...DEFAULT_SIMULATOR_STATE,
        orderValue: 3999,
        productCost: 1400,
        baselineDeliveryProb: 0.38,
        interventionDeliveryProb: 0.92,
        verificationCost: 14,
        prepaidIncentiveDiscount: 100,
        isConvertedToPrepaid: true,
      });
    } else if (presetType === 'LOW_MARGIN') {
      setParams({
        ...DEFAULT_SIMULATOR_STATE,
        orderValue: 999,
        productCost: 650,
        forwardShippingCost: 95,
        reverseLogisticsCost: 140,
        baselineDeliveryProb: 0.60,
        interventionDeliveryProb: 0.88,
        verificationCost: 6,
        prepaidIncentiveDiscount: 0,
        isConvertedToPrepaid: false,
      });
    } else if (presetType === 'REMOTE_RTO') {
      setParams({
        ...DEFAULT_SIMULATOR_STATE,
        orderValue: 2199,
        productCost: 750,
        forwardShippingCost: 180,
        reverseLogisticsCost: 220,
        baselineDeliveryProb: 0.35,
        interventionDeliveryProb: 0.75,
        verificationCost: 12,
        prepaidIncentiveDiscount: 0,
        isConvertedToPrepaid: false,
      });
    }
  };

  // Baseline Contribution
  const baselineProfit = useMemo(() => {
    return calculateExpectedContribution({
      orderValue: params.orderValue,
      productCost: params.productCost,
      forwardShippingCost: params.forwardShippingCost,
      packagingCost: params.packagingCost,
      codCollectionFee: params.codCollectionFee,
      paymentGatewayFee: 0,
      reverseLogisticsCost: params.reverseLogisticsCost,
      deliveryProbability: params.baselineDeliveryProb,
      verificationCost: 0,
      incentiveDiscount: 0,
      isPrepaid: false,
    });
  }, [params]);

  // Intervened Alternative Contribution
  const intervenedProfit = useMemo(() => {
    return calculateExpectedContribution({
      orderValue: params.orderValue,
      productCost: params.productCost,
      forwardShippingCost: params.forwardShippingCost,
      packagingCost: params.packagingCost,
      codCollectionFee: params.isConvertedToPrepaid ? 0 : params.codCollectionFee,
      paymentGatewayFee: params.isConvertedToPrepaid ? Math.round(params.orderValue * 0.02) : 0,
      reverseLogisticsCost: params.reverseLogisticsCost,
      deliveryProbability: params.interventionDeliveryProb,
      verificationCost: params.verificationCost,
      incentiveDiscount: params.prepaidIncentiveDiscount,
      isPrepaid: params.isConvertedToPrepaid,
    });
  }, [params]);

  const netAdvantage = intervenedProfit - baselineProfit;

  // Analysis of key driver
  const primaryDriverText = useMemo(() => {
    const probDiff = (params.interventionDeliveryProb - params.baselineDeliveryProb) * 100;
    const revSavings = (params.reverseLogisticsCost + params.forwardShippingCost) * (probDiff / 100);

    if (netAdvantage > 0) {
      return `A +${probDiff.toFixed(0)}% delivery uplift saves an estimated ₹${Math.round(revSavings)} in avoided reverse logistics and unrecovered freight, easily surpassing the ₹${params.verificationCost + params.prepaidIncentiveDiscount} intervention cost.`;
    } else {
      return `The verification/incentive cost of ₹${params.verificationCost + params.prepaidIncentiveDiscount} outweighs the small delivery probability gain. Standard dispatch or strict hold is preferred.`;
    }
  }, [params, netAdvantage]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1 rounded bg-indigo-50 text-indigo-700">
                <SlidersHorizontal className="w-4 h-4" />
              </span>
              <h1 className="text-lg font-bold text-slate-900">
                Interactive What-If Profit Simulator
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Test assumptions dynamically. See breakeven delivery uplift and expected merchant profit before deploying policies.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-1 rounded-full">
              Simulation — Not Actual Savings
            </span>
            <button
              onClick={resetToDefaults}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Defaults</span>
            </button>
          </div>
        </div>

        {/* Quick Presets */}
        <div className="pt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400 font-medium">Quick Presets:</span>
          <button
            onClick={() => loadPreset('HIGH_COD')}
            className="px-3 py-1 rounded-lg border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/40 text-slate-700 font-medium transition-colors"
          >
            High-Ticket COD (₹3,999) + Prepaid Conversion
          </button>
          <button
            onClick={() => loadPreset('LOW_MARGIN')}
            className="px-3 py-1 rounded-lg border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/40 text-slate-700 font-medium transition-colors"
          >
            Low-Margin Fast Mover (₹999)
          </button>
          <button
            onClick={() => loadPreset('REMOTE_RTO')}
            className="px-3 py-1 rounded-lg border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/40 text-slate-700 font-medium transition-colors"
          >
            Tier 3 / Remote Heavy Freight (₹220 Rev)
          </button>
        </div>
      </div>

      {/* Main Grid: Inputs on Left, Real-time Comparison on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Input Parameters Controls (7 Cols) */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
          <div>
            <h2 className="text-sm font-bold text-slate-900 mb-3">Order Unit Economics (₹)</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Order Retail Value: ₹{params.orderValue}
                </label>
                <input
                  type="range"
                  min={500}
                  max={8000}
                  step={50}
                  value={params.orderValue}
                  onChange={e => setParams({ ...params, orderValue: Number(e.target.value) })}
                  className="w-full accent-indigo-600 cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Product Cost (COGS): ₹{params.productCost}
                </label>
                <input
                  type="range"
                  min={100}
                  max={4000}
                  step={50}
                  value={params.productCost}
                  onChange={e => setParams({ ...params, productCost: Number(e.target.value) })}
                  className="w-full accent-indigo-600 cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Forward Freight Cost: ₹{params.forwardShippingCost}
                </label>
                <input
                  type="range"
                  min={50}
                  max={300}
                  step={5}
                  value={params.forwardShippingCost}
                  onChange={e =>
                    setParams({ ...params, forwardShippingCost: Number(e.target.value) })
                  }
                  className="w-full accent-indigo-600 cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Reverse Logistics (RTO) Surcharge: ₹{params.reverseLogisticsCost}
                </label>
                <input
                  type="range"
                  min={80}
                  max={350}
                  step={5}
                  value={params.reverseLogisticsCost}
                  onChange={e =>
                    setParams({ ...params, reverseLogisticsCost: Number(e.target.value) })
                  }
                  className="w-full accent-indigo-600 cursor-pointer"
                />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 mb-3">
              Delivery Probability Assumptions (%)
            </h2>
            <div className="space-y-4 text-xs">
              <div>
                <div className="flex justify-between text-[11px] font-semibold text-slate-700 mb-1">
                  <span>Baseline Delivery Probability (Status Quo):</span>
                  <span className="font-mono text-rose-600">
                    {(params.baselineDeliveryProb * 100).toFixed(0)}% (RTO:{' '}
                    {((1 - params.baselineDeliveryProb) * 100).toFixed(0)}%)
                  </span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={0.95}
                  step={0.05}
                  value={params.baselineDeliveryProb}
                  onChange={e =>
                    setParams({ ...params, baselineDeliveryProb: Number(e.target.value) })
                  }
                  className="w-full accent-slate-600 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] font-semibold text-slate-700 mb-1">
                  <span>Post-Intervention Delivery Probability (Target):</span>
                  <span className="font-mono text-emerald-600">
                    {(params.interventionDeliveryProb * 100).toFixed(0)}% (RTO:{' '}
                    {((1 - params.interventionDeliveryProb) * 100).toFixed(0)}%)
                  </span>
                </div>
                <input
                  type="range"
                  min={0.2}
                  max={0.99}
                  step={0.01}
                  value={params.interventionDeliveryProb}
                  onChange={e =>
                    setParams({ ...params, interventionDeliveryProb: Number(e.target.value) })
                  }
                  className="w-full accent-emerald-600 cursor-pointer"
                />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 mb-3">
              Intervention Costs & Policy Switches
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Verification / Call / Bot Cost: ₹{params.verificationCost}
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={params.verificationCost}
                  onChange={e =>
                    setParams({ ...params, verificationCost: Number(e.target.value) })
                  }
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Prepaid Cash Discount / Incentive: ₹{params.prepaidIncentiveDiscount}
                </label>
                <input
                  type="number"
                  min={0}
                  max={300}
                  value={params.prepaidIncentiveDiscount}
                  onChange={e =>
                    setParams({ ...params, prepaidIncentiveDiscount: Number(e.target.value) })
                  }
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-mono text-xs"
                />
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                type="checkbox"
                id="prepaid_switch"
                checked={params.isConvertedToPrepaid}
                onChange={e =>
                  setParams({ ...params, isConvertedToPrepaid: e.target.checked })
                }
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              />
              <label htmlFor="prepaid_switch" className="text-xs text-slate-700 font-medium cursor-pointer">
                Simulate full conversion from COD to Prepaid (Removes COD collection fee)
              </label>
            </div>
          </div>
        </div>

        {/* Real-time Side-by-Side Comparison Card (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-md border border-slate-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">
              Live Comparative Output
            </span>
            <h3 className="text-base font-bold text-white mt-1">
              Baseline vs Intervened Model
            </h3>

            <div className="mt-5 space-y-3">
              {/* Baseline Result */}
              <div className="p-3.5 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400 font-medium">Standard Dispatch (Baseline)</div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    P(Delv): {(params.baselineDeliveryProb * 100).toFixed(0)}%
                  </div>
                </div>
                <div
                  className={`text-lg font-bold font-mono ${
                    baselineProfit > 0 ? 'text-slate-200' : 'text-rose-400'
                  }`}
                >
                  {formatCurrency(baselineProfit)}
                </div>
              </div>

              {/* Intervened Result */}
              <div className="p-3.5 rounded-xl bg-indigo-950/70 border border-indigo-500/50 flex items-center justify-between">
                <div>
                  <div className="text-xs text-indigo-300 font-bold flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    <span>With RTOGuard Action</span>
                  </div>
                  <div className="text-[11px] text-indigo-400 font-mono">
                    P(Delv): {(params.interventionDeliveryProb * 100).toFixed(0)}%
                  </div>
                </div>
                <div
                  className={`text-xl font-extrabold font-mono ${
                    intervenedProfit > 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatCurrency(intervenedProfit)}
                </div>
              </div>

              {/* Protection Delta */}
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-center">
                <span className="text-[11px] font-semibold text-emerald-300">
                  Estimated Financial Protection Advantage
                </span>
                <div className="text-3xl font-extrabold font-mono text-emerald-400 mt-1">
                  {netAdvantage >= 0 ? `+₹${netAdvantage.toLocaleString('en-IN')}` : `-₹${Math.abs(netAdvantage).toLocaleString('en-IN')}`}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  Per order treated with this operational policy
                </div>
              </div>
            </div>
          </div>

          {/* Explanation of Driver */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm text-xs">
            <div className="flex items-center gap-1.5 font-bold text-slate-900 mb-1">
              <TrendingUp className="w-4 h-4 text-indigo-600" />
              <span>Assumption Driver Explanation</span>
            </div>
            <p className="text-slate-600 leading-relaxed text-[11px] mt-2">
              {primaryDriverText}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
