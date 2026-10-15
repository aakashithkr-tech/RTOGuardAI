import React, { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  ArrowUpDown,
  RotateCcw,
  ExternalLink,
  Shield,
  CreditCard,
  MapPin,
  Calendar,
  AlertTriangle,
  Truck,
} from 'lucide-react';
import { Order, RiskCategory, OrderStatus, PaymentMethod } from '../../types';
import { RiskBadge, StatusBadge, PaymentBadge } from '../common/Badge';
import { formatCurrency, formatDate, formatTimeAgo } from '../../utils/formatters';

interface OrderDeskProps {
  orders: Order[];
  onSelectOrder: (orderId: string) => void;
  selectedOrderId?: string;
}

export const OrderDesk: React.FC<OrderDeskProps> = ({
  orders,
  onSelectOrder,
  selectedOrderId,
}) => {
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<string>('ALL');
  const [riskFilter, setRiskFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'RISK_DESC' | 'VALUE_DESC' | 'DATE_DESC'>('RISK_DESC');

  const filteredOrders = useMemo(() => {
    return orders
      .filter(order => {
        // Search filter
        if (search) {
          const s = search.toLowerCase();
          const matchId = order.orderNumber.toLowerCase().includes(s);
          const matchCust = order.customer.name.toLowerCase().includes(s);
          const matchCity = order.customer.city.toLowerCase().includes(s);
          const matchPin = order.customer.pincode.includes(s);
          const matchItem = order.items.some(i => i.name.toLowerCase().includes(s));
          if (!matchId && !matchCust && !matchCity && !matchPin && !matchItem) {
            return false;
          }
        }

        // Payment filter
        if (paymentFilter !== 'ALL' && order.paymentMethod !== paymentFilter) {
          return false;
        }

        // Risk filter
        if (riskFilter !== 'ALL' && order.risk.riskCategory !== riskFilter) {
          return false;
        }

        // Status filter
        if (statusFilter !== 'ALL') {
          if (statusFilter === 'NDR_ACTIVE') {
            if (order.status !== 'NDR_PENDING' && order.status !== 'RECOVERY_IN_PROGRESS') {
              return false;
            }
          } else if (order.status !== statusFilter) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'RISK_DESC') return b.risk.riskScore - a.risk.riskScore;
        if (sortBy === 'VALUE_DESC') return b.orderValue - a.orderValue;
        if (sortBy === 'DATE_DESC')
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        return 0;
      });
  }, [orders, search, paymentFilter, riskFilter, statusFilter, sortBy]);

  const resetFilters = () => {
    setSearch('');
    setPaymentFilter('ALL');
    setRiskFilter('ALL');
    setStatusFilter('ALL');
    setSortBy('RISK_DESC');
  };

  const isFiltered =
    search !== '' ||
    paymentFilter !== 'ALL' ||
    riskFilter !== 'ALL' ||
    statusFilter !== 'ALL';

  return (
    <div className="space-y-4">
      {/* Header and Controls */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Order Intelligence Desk</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Comprehensive merchant order roster with real-time risk scores and financial exposure.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">
              Showing <strong className="text-slate-900">{filteredOrders.length}</strong> of{' '}
              {orders.length} orders
            </span>
            {isFiltered && (
              <button
                onClick={resetFilters}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Filters</span>
              </button>
            )}
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Search */}
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search order ID, buyer, pincode, product..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800"
            />
          </div>

          {/* Payment Mode */}
          <div>
            <select
              value={paymentFilter}
              onChange={e => setPaymentFilter(e.target.value)}
              aria-label="Payment Mode Filter"
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
            >
              <option value="ALL">Payment: All Modes</option>
              <option value="COD">Cash on Delivery (COD)</option>
              <option value="PREPAID">Prepaid (UPI/Card)</option>
            </select>
          </div>

          {/* Risk Filter */}
          <div>
            <select
              value={riskFilter}
              onChange={e => setRiskFilter(e.target.value)}
              aria-label="Risk Level Filter"
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
            >
              <option value="ALL">Risk: All Levels</option>
              <option value="CRITICAL">Critical Risk (&gt;80)</option>
              <option value="HIGH">High Risk (60-80)</option>
              <option value="MEDIUM">Medium Risk (30-60)</option>
              <option value="LOW">Low Risk (&lt;30)</option>
            </select>
          </div>

          {/* Sort By */}
          <div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              aria-label="Sort Orders"
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
            >
              <option value="RISK_DESC">Sort: Highest Risk First</option>
              <option value="VALUE_DESC">Sort: Highest Value First</option>
              <option value="DATE_DESC">Sort: Most Recent First</option>
            </select>
          </div>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {filteredOrders.length === 0 ? (
          <div className="p-12 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-slate-900">No matching orders found</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              No orders correspond to current search & filter parameters. Try clearing the active filters.
            </p>
            <button
              onClick={resetFilters}
              className="mt-4 px-4 py-2 bg-indigo-50 text-indigo-700 font-semibold rounded-lg text-xs hover:bg-indigo-100 transition-colors"
            >
              Reset all filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 text-[11px]">
                <tr>
                  <th className="px-5 py-3.5">Order & Time</th>
                  <th className="px-4 py-3.5">Customer & Geo</th>
                  <th className="px-4 py-3.5">Items</th>
                  <th className="px-4 py-3.5">Value & Mode</th>
                  <th className="px-4 py-3.5">Risk Score</th>
                  <th className="px-4 py-3.5">Logistics & Tracking</th>
                  <th className="px-4 py-3.5">Expected Contribution</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredOrders.map(order => {
                  const isSelected = selectedOrderId === order.id;
                  const f = order.financials;

                  return (
                    <tr
                      key={order.id}
                      onClick={() => onSelectOrder(order.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-indigo-50/70 border-l-4 border-indigo-600'
                          : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="px-5 py-3.5">
                        <div className="font-bold text-slate-900 font-mono text-xs flex items-center gap-1.5">
                          <span>{order.orderNumber}</span>
                          {order.risk.riskScore >= 75 && (
                            <span className="w-2 h-2 rounded-full bg-rose-500" title="High risk attention required" />
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {formatTimeAgo(order.createdAt)}
                        </div>
                      </td>

                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-800">{order.customer.name}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>
                            {order.customer.city} · {order.customer.pincode}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 max-w-[200px]">
                        <div className="text-slate-800 font-medium truncate" title={order.items[0]?.name}>
                          {order.items[0]?.name}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Qty: {order.items[0]?.quantity} · SKU: {order.items[0]?.sku}
                        </div>
                      </td>

                      <td className="px-4 py-3.5">
                        <div className="font-bold text-slate-900">
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
                        <div className="text-[10px] text-slate-500 mt-0.5 truncate max-w-[150px]" title={order.risk.primaryReason}>
                          {order.risk.primaryReason}
                        </div>
                      </td>

                      <td className="px-4 py-3.5">
                        {order.tracking?.trackingNumber || order.ndr?.courierAwb ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-800 text-xs">
                                {order.tracking?.courierName || order.ndr?.courierName || 'Integrated Courier'}
                              </span>
                              {order.tracking?.trackingUrl && (
                                <a
                                  href={order.tracking.trackingUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  className="text-indigo-600 hover:text-indigo-800"
                                  title="Open courier tracking link"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500">
                              AWB: {order.tracking?.trackingNumber || order.ndr?.courierAwb}
                            </div>
                            {order.tracking?.estimatedDelivery && (
                              <div className="text-[10px] text-slate-400">
                                EDD: {new Date(order.tracking.estimatedDelivery).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400 flex items-center gap-1">
                            <Truck className="w-3.5 h-3.5 text-slate-300" />
                            <span>Pending Dispatch</span>
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        <div className={`font-semibold font-mono ${
                          f.expectedContribution > 0 ? 'text-emerald-700' : 'text-rose-600'
                        }`}>
                          {f.actualContribution !== undefined ? (
                            <span>{formatCurrency(f.actualContribution)} (Realized)</span>
                          ) : (
                            <span>{formatCurrency(f.expectedContribution)} (Est.)</span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Freight: ₹{f.forwardShippingCost} | Rev: ₹{f.reverseLogisticsCost}
                        </div>
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
                          className="px-3 py-1 bg-white hover:bg-indigo-50 text-indigo-600 border border-slate-200 hover:border-indigo-300 font-semibold rounded-lg text-xs transition-colors shadow-sm"
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
