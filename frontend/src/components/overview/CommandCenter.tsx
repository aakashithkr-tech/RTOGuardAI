import React from 'react';
import {
  Package,
  CreditCard,
  CheckCircle,
  Truck,
  AlertOctagon,
  ShieldAlert,
  Coins,
  TrendingDown,
  ArrowUpRight,
  LifeBuoy,
  ChevronRight,
  AlertTriangle,
  Sparkles,
  Info,
} from 'lucide-react';
import { DashboardSummary, Order } from '../../types';
import { MetricCard } from '../common/MetricCard';
import { RiskBadge, StatusBadge, PaymentBadge } from '../common/Badge';
import { formatCurrency, formatDate } from '../../utils/formatters';

interface CommandCenterProps {
  summary: DashboardSummary;
  orders: Order[];
  onSelectOrder: (orderId: string) => void;
  onNavigateTab: (tab: any) => void;
}

export const CommandCenter: React.FC<CommandCenterProps> = ({
  summary,
  orders,
  onSelectOrder,
  onNavigateTab,
}) => {
  // Sort attention queue by risk score descending
  const attentionOrders = orders
    .filter(o => o.risk.riskScore >= 60 || o.status === 'NDR_PENDING')
    .sort((a, b) => b.risk.riskScore - a.risk.riskScore);

  const riskCounts = {
    CRITICAL: orders.filter(o => o.risk.riskCategory === 'CRITICAL').length,
    HIGH: orders.filter(o => o.risk.riskCategory === 'HIGH').length,
    MEDIUM: orders.filter(o => o.risk.riskCategory === 'MEDIUM').length,
    LOW: orders.filter(o => o.risk.riskCategory === 'LOW').length,
  };

  const total = orders.length || 1;

  return (
    <div className="space-y-6">
      {/* Top Banner / Hero Context */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-6 text-white shadow-sm border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-500/30 text-indigo-300 border border-indigo-400/30">
              Merchant Operations
            </span>
            <span className="text-xs text-slate-400 font-mono">Real-time Order Monitoring</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Order Risk & Delivery Profit Command Centre
          </h1>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
            Continuously analyzing checkout signals, pincode reliability, and courier events. Turn risk predictions into concrete profit-protecting interventions.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => onNavigateTab('profit-brain')}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center gap-2"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Launch Profit Brain</span>
          </button>
          <button
            onClick={() => onNavigateTab('ndr')}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5"
          >
            <LifeBuoy className="w-3.5 h-3.5 text-amber-400" />
            <span>NDR Desk ({summary.ndrActiveCount})</span>
          </button>
        </div>
      </div>

      {/* KPI Grid (8 Cards covering facts, predictions, financial estimates) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Orders"
          value={summary.totalOrders}
          subValue={`${summary.codOrdersCount} COD (${Math.round((summary.codOrdersCount / total) * 100)}%) · ${summary.prepaidOrdersCount} Prepaid`}
          badgeText="Recorded Fact"
          badgeType="fact"
          icon={Package}
          iconBgColor="bg-slate-100"
          iconColor="text-slate-800"
          tooltip="Total orders processed in current reporting cycle from connected store."
        />

        <MetricCard
          label="Orders At Risk"
          value={summary.ordersAtRiskCount}
          subValue={`${riskCounts.CRITICAL} Critical · ${riskCounts.HIGH} High risk`}
          badgeText="ML Prediction"
          badgeType="prediction"
          icon={ShieldAlert}
          iconBgColor="bg-rose-50"
          iconColor="text-rose-600"
          tooltip="Orders evaluated by RTOGuard ensemble with risk score >= 60 requiring merchant intervention."
        />

        <MetricCard
          label="Est. Net Contribution"
          value={formatCurrency(summary.estimatedContribution)}
          subValue="Revenue - COGS - Freight - Fees"
          badgeText="Financial Estimate"
          badgeType="estimate"
          icon={Coins}
          iconBgColor="bg-emerald-50"
          iconColor="text-emerald-600"
          tooltip="Probability-weighted merchant contribution after deducting product cost, forward shipping, packaging, and potential reverse logistics."
        />

        <MetricCard
          label="Delivery Costs Incurred"
          value={formatCurrency(summary.recordedDeliveryCosts)}
          subValue={`Includes reverse freight: ₹${summary.rtoOrdersCount * 160}`}
          badgeText="Recorded Fact"
          badgeType="fact"
          icon={TrendingDown}
          iconBgColor="bg-amber-50"
          iconColor="text-amber-700"
          tooltip="Sum of billed forward shipping, reverse logistics freight, and packaging materials."
        />

        <MetricCard
          label="Delivered Fulfillments"
          value={summary.deliveredOrdersCount}
          subValue={`${Math.round((summary.deliveredOrdersCount / total) * 100)}% successful delivery rate`}
          badgeText="Recorded Fact"
          badgeType="fact"
          icon={CheckCircle}
          iconBgColor="bg-emerald-50"
          iconColor="text-emerald-700"
          tooltip="Consignments successfully delivered with confirmed recipient POD."
        />

        <MetricCard
          label="In Transit / Pending"
          value={summary.pendingOrTransitCount}
          subValue="Active on courier network"
          badgeText="Recorded Fact"
          badgeType="fact"
          icon={Truck}
          iconBgColor="bg-sky-50"
          iconColor="text-sky-700"
          tooltip="Shipments moving between sorting hubs or awaiting warehouse dispatch."
        />

        <MetricCard
          label="RTO Returns Recorded"
          value={summary.rtoOrdersCount}
          subValue={`${Math.round((summary.rtoOrdersCount / total) * 100)}% return-to-origin rate`}
          badgeText="Recorded Fact"
          badgeType="fact"
          icon={AlertOctagon}
          iconBgColor="bg-rose-50"
          iconColor="text-rose-700"
          tooltip="Orders returned to merchant warehouse after failed doorstep delivery attempts."
        />

        <MetricCard
          label="Protected Value"
          value={formatCurrency(summary.preventedRtoLossEstimated)}
          subValue="From proactive verifications"
          badgeText="Simulated Demo"
          badgeType="simulation"
          icon={Sparkles}
          iconBgColor="bg-purple-50"
          iconColor="text-purple-700"
          tooltip="Simulated estimate of saved reverse logistics and inventory lockup through proactive merchant intervention."
        />
      </div>

      {/* Middle Section: Risk Distribution & Operational Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Risk Distribution Breakdown */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Order Risk Distribution</h2>
              <p className="text-xs text-slate-500">Breakdown across 4 risk tiers</p>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium">
              Order Risk Bands
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs font-medium mb-1">
                <span className="text-rose-700 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  Critical Risk (&gt;80)
                </span>
                <span className="text-slate-700 font-semibold">
                  {riskCounts.CRITICAL} orders ({Math.round((riskCounts.CRITICAL / total) * 100)}%)
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-rose-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${(riskCounts.CRITICAL / total) * 100}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-medium mb-1">
                <span className="text-amber-700 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  High Risk (60-80)
                </span>
                <span className="text-slate-700 font-semibold">
                  {riskCounts.HIGH} orders ({Math.round((riskCounts.HIGH / total) * 100)}%)
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-amber-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${(riskCounts.HIGH / total) * 100}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-medium mb-1">
                <span className="text-blue-700 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  Medium Risk (30-60)
                </span>
                <span className="text-slate-700 font-semibold">
                  {riskCounts.MEDIUM} orders ({Math.round((riskCounts.MEDIUM / total) * 100)}%)
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${(riskCounts.MEDIUM / total) * 100}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-medium mb-1">
                <span className="text-emerald-700 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Low Risk (&lt;30)
                </span>
                <span className="text-slate-700 font-semibold">
                  {riskCounts.LOW} orders ({Math.round((riskCounts.LOW / total) * 100)}%)
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${(riskCounts.LOW / total) * 100}%` }}
                />
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500 flex items-center justify-between">
            <span>Model source: Behavioral + Geo Pincode</span>
            <span className="font-medium text-indigo-600">Deterministic Rules</span>
          </div>
        </div>

        {/* NDR & Delivery Health Pulse */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">NDR Recovery & Carrier Pulse</h2>
              <p className="text-xs text-slate-500">Live non-delivery events and carrier SLA</p>
            </div>
            <button
              onClick={() => onNavigateTab('ndr')}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1"
            >
              <span>View NDR Workspace</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-200/80">
              <div className="text-[11px] font-medium text-amber-800 uppercase tracking-wider">
                Pending NDR Action
              </div>
              <div className="text-xl font-bold text-amber-900 mt-1">
                {summary.ndrActiveCount} consignments
              </div>
              <div className="text-[11px] text-amber-700 mt-0.5">
                Require doorstep resolution
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-[11px] font-medium text-slate-600 uppercase tracking-wider">
                Avg. Reverse Freight
              </div>
              <div className="text-xl font-bold text-slate-900 mt-1">₹160 / order</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Delhivery / BlueDart SLA</div>
            </div>

            <div className="p-3 rounded-lg bg-indigo-50/70 border border-indigo-200/80">
              <div className="text-[11px] font-medium text-indigo-800 uppercase tracking-wider">
                Recovery Success Rate
              </div>
              <div className="text-xl font-bold text-indigo-900 mt-1">68.4%</div>
              <div className="text-[11px] text-indigo-700 mt-0.5">After WhatsApp / Call reattempt</div>
            </div>
          </div>

          {/* Quick Explanatory Callout */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
            <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <div className="text-[11px] leading-relaxed">
              <strong className="text-slate-800 font-semibold">Why this matters:</strong> Every failed COD attempt that turns into an RTO costs ₹130 forward + ₹160 reverse shipping + packaging. RTOGuard flags orders before dispatch and triggers same-day NDR recovery to salvage delivery.
            </div>
          </div>
        </div>
      </div>

      {/* Order Attention Queue */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Order Attention Queue</h2>
              <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-xs font-semibold">
                {attentionOrders.length} Urgent
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              High-priority orders where proactive merchant intervention preserves maximum contribution.
            </p>
          </div>

          <button
            onClick={() => onNavigateTab('orders')}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 self-start sm:self-auto"
          >
            <span>Open All Orders ({orders.length})</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 text-[11px]">
              <tr>
                <th className="px-5 py-3.5">Order</th>
                <th className="px-4 py-3.5">Value & Mode</th>
                <th className="px-4 py-3.5">Risk Score</th>
                <th className="px-4 py-3.5">Primary Reason</th>
                <th className="px-4 py-3.5">Exposure</th>
                <th className="px-4 py-3.5">Recommended Action</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {attentionOrders.map(order => {
                const exposure = order.financials.reverseLogisticsCost + order.financials.forwardShippingCost;
                return (
                  <tr
                    key={order.id}
                    onClick={() => onSelectOrder(order.id)}
                    className="hover:bg-indigo-50/40 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3.5">
                      <div className="font-bold text-slate-900 font-mono text-xs">
                        {order.orderNumber}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {order.customer.city}, {order.customer.state} ({order.customer.pincode})
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-slate-900">
                        {formatCurrency(order.orderValue)}
                      </div>
                      <div className="mt-0.5">
                        <PaymentBadge method={order.paymentMethod} />
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <RiskBadge risk={order.risk.riskCategory} size="sm" />
                        <span className="font-mono font-bold text-slate-800">
                          {order.risk.riskScore}/100
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3.5 max-w-xs">
                      <div className="text-slate-800 line-clamp-1 font-medium" title={order.risk.primaryReason}>
                        {order.risk.primaryReason}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {order.items[0]?.name}
                      </div>
                    </td>

                    <td className="px-4 py-3.5 font-semibold text-rose-600">
                      ₹{exposure} <span className="text-[10px] text-slate-400 font-normal">shipping at risk</span>
                    </td>

                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {order.risk.recommendedAction.replace(/_/g, ' ')}
                      </span>
                    </td>

                    <td className="px-4 py-3.5">
                      <StatusBadge status={order.status} size="sm" />
                    </td>

                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onSelectOrder(order.id);
                        }}
                        className="px-3 py-1 bg-white hover:bg-slate-50 text-indigo-600 border border-indigo-200 hover:border-indigo-300 font-semibold rounded-lg text-xs transition-colors shadow-sm"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
