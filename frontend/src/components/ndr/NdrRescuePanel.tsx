import React, { useState } from 'react';
import {
  LifeBuoy,
  Clock,
  MapPin,
  Phone,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Truck,
  RotateCcw,
  ArrowRight,
  Loader2,
  FileText,
  AlertOctagon,
} from 'lucide-react';
import { Order, NdrReason } from '../../types';
import { formatCurrency, formatDate, formatTimeAgo, getNdrReasonLabel } from '../../utils/formatters';
import { PaymentBadge, StatusBadge } from '../common/Badge';

interface NdrRescuePanelProps {
  orders: Order[];
  onSelectOrder: (orderId: string) => void;
  onSubmitRecovery: (
    orderId: string,
    actionType: 'REATTEMPT_WITH_TIME' | 'UPDATE_ADDRESS' | 'ALTERNATE_PHONE' | 'APPROVE_RTO',
    data: {
      reattemptDate?: string;
      newAddress?: string;
      alternatePhone?: string;
      remarks?: string;
    }
  ) => Promise<void>;
}

export const NdrRescuePanel: React.FC<NdrRescuePanelProps> = ({
  orders,
  onSelectOrder,
  onSubmitRecovery,
}) => {
  // Filter orders that have NDR events or status
  const ndrOrders = orders.filter(
    o => o.status === 'NDR_PENDING' || o.status === 'RECOVERY_IN_PROGRESS' || o.ndr !== undefined
  );

  const [selectedNdrOrder, setSelectedNdrOrder] = useState<Order | null>(
    ndrOrders.find(o => o.status === 'NDR_PENDING') || ndrOrders[0] || null
  );

  // Recovery form states
  const [actionType, setActionType] = useState<
    'REATTEMPT_WITH_TIME' | 'UPDATE_ADDRESS' | 'ALTERNATE_PHONE' | 'APPROVE_RTO'
  >('REATTEMPT_WITH_TIME');
  const [reattemptDate, setReattemptDate] = useState('Tomorrow 10:00 AM - 02:00 PM');
  const [newAddress, setNewAddress] = useState('');
  const [alternatePhone, setAlternatePhone] = useState('');
  const [remarks, setRemarks] = useState('Customer confirmed availability for reattempt');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleOrderChange = (order: Order) => {
    setSelectedNdrOrder(order);
    setSuccessMsg(null);
    if (order.ndr?.ndrReason === 'INCOMPLETE_ADDRESS') {
      setActionType('UPDATE_ADDRESS');
      setNewAddress(order.customer.addressLine);
      setRemarks('Verified complete landmark with customer');
    } else if (order.ndr?.ndrReason === 'CUSTOMER_UNREACHABLE') {
      setActionType('REATTEMPT_WITH_TIME');
      setAlternatePhone('+91 98111 •••••');
      setRemarks('Customer answered alternate number; requested reattempt');
    } else {
      setActionType('REATTEMPT_WITH_TIME');
      setRemarks('Customer confirmed home presence tomorrow');
    }
  };

  const handleExecuteRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNdrOrder) return;

    try {
      setIsSubmitting(true);
      await onSubmitRecovery(selectedNdrOrder.id, actionType, {
        reattemptDate,
        newAddress,
        alternatePhone,
        remarks,
      });
      setSuccessMsg('Recovery instructions transmitted and logged on courier manifest!');
      setTimeout(() => setSuccessMsg(null), 5000);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-amber-950/80 to-slate-900 rounded-2xl p-6 text-white shadow-sm border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-400/30 flex items-center gap-1.5">
              <LifeBuoy className="w-3.5 h-3.5" />
              <span>Non-Delivery Recovery Desk</span>
            </span>
            <span className="text-xs text-slate-400 font-mono">
              Live Courier Exception Pipeline
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            NDR Rescue: Doorstep Exception Management
          </h1>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
            Every courier non-delivery failure costs an additional ₹160 in reverse logistics if unaddressed within 24 hours. Take structured recovery action to ensure second-attempt delivery.
          </p>
        </div>

        <div className="flex items-center gap-4 bg-slate-800/90 border border-slate-700 p-3 rounded-xl">
          <div>
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Active NDR Consignments</div>
            <div className="text-2xl font-bold font-mono text-amber-400">
              {ndrOrders.filter(o => o.status === 'NDR_PENDING').length}
            </div>
          </div>
          <div className="h-8 w-px bg-slate-700" />
          <div>
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Potential Loss Exposure</div>
            <div className="text-2xl font-bold font-mono text-rose-400">
              {formatCurrency(
                ndrOrders.reduce((sum, o) => sum + o.financials.reverseLogisticsCost, 0)
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Priority NDR Queue (5 Cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Pending NDR Consignments ({ndrOrders.length})
            </h2>
            <span className="text-[11px] text-slate-400">Select order to resolve</span>
          </div>

          <div className="space-y-2.5">
            {ndrOrders.map(order => {
              const isSelected = selectedNdrOrder?.id === order.id;
              const ndr = order.ndr;

              return (
                <div
                  key={order.id}
                  onClick={() => handleOrderChange(order)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-amber-50/50 border-amber-300 shadow-md ring-1 ring-amber-400/40'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-xs text-slate-900">
                        {order.orderNumber}
                      </span>
                      <PaymentBadge method={order.paymentMethod} />
                    </div>
                    <span className="font-bold text-xs text-slate-900">
                      {formatCurrency(order.orderValue)}
                    </span>
                  </div>

                  {ndr && (
                    <div className="mt-2.5 p-2 rounded bg-amber-100/60 border border-amber-200 text-amber-950 text-xs font-medium flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                      <div>
                        <div>{getNdrReasonLabel(ndr.ndrReason)}</div>
                        <div className="text-[10px] text-amber-800 font-normal mt-0.5">
                          Attempt {ndr.attemptNumber} of {ndr.maxAttemptsAllowed} · {ndr.courierName}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100">
                    <span>{order.customer.city} ({order.customer.pincode})</span>
                    <span className="font-semibold text-rose-600 font-mono">
                      ₹{order.financials.reverseLogisticsCost} reverse exposure
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Interactive Recovery Resolution Workspace (7 Cols) */}
        <div className="lg:col-span-7">
          {selectedNdrOrder ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
              {/* Header of selected NDR order */}
              <div className="flex items-start justify-between border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900 font-mono">
                      {selectedNdrOrder.orderNumber}
                    </h2>
                    <StatusBadge status={selectedNdrOrder.status} size="sm" />
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Customer: <strong className="text-slate-800">{selectedNdrOrder.customer.name}</strong> ({selectedNdrOrder.customer.phoneMasked})
                  </p>
                </div>

                <button
                  onClick={() => onSelectOrder(selectedNdrOrder.id)}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1"
                >
                  <span>Open Full Order</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Success alert message */}
              {successMsg && (
                <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl flex items-center gap-2 text-xs text-emerald-800 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* Courier Exception Detail Card */}
              {selectedNdrOrder.ndr && (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-xs space-y-2">
                  <div className="flex items-center justify-between font-bold text-slate-800">
                    <span className="flex items-center gap-1.5">
                      <Truck className="w-4 h-4 text-slate-600" />
                      <span>{selectedNdrOrder.ndr.courierName} Dispatch Exception</span>
                    </span>
                    <span className="font-mono text-slate-500 text-[11px]">
                      AWB: {selectedNdrOrder.ndr.courierAwb}
                    </span>
                  </div>

                  <p className="text-slate-700 italic bg-white p-2.5 rounded border border-slate-200 text-[11px]">
                    "{selectedNdrOrder.ndr.courierRemarks}"
                  </p>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                    <span>
                      Last attempt: {formatDate(selectedNdrOrder.ndr.lastAttemptAt)}
                    </span>
                    <span>
                      Attempts logged: {selectedNdrOrder.ndr.attemptNumber} /{' '}
                      {selectedNdrOrder.ndr.maxAttemptsAllowed}
                    </span>
                  </div>
                </div>
              )}

              {/* Recovery Form */}
              <form onSubmit={handleExecuteRecovery} className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Select Recovery Action to Transmit
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setActionType('REATTEMPT_WITH_TIME')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      actionType === 'REATTEMPT_WITH_TIME'
                        ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-500'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-bold text-slate-900">Schedule Reattempt</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Customer confirmed date/time slot for 2nd delivery attempt
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActionType('UPDATE_ADDRESS')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      actionType === 'UPDATE_ADDRESS'
                        ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-500'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-bold text-slate-900">Correct Address / Landmark</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Transmit enriched street & landmark details to courier
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActionType('ALTERNATE_PHONE')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      actionType === 'ALTERNATE_PHONE'
                        ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-500'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-bold text-slate-900">Add Alternate Phone</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Provide secondary contact number to courier delivery boy
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActionType('APPROVE_RTO')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      actionType === 'APPROVE_RTO'
                        ? 'border-rose-600 bg-rose-50/50 ring-1 ring-rose-500'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-bold text-rose-800">Approve RTO Return</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Cut losses immediately if customer firmly rejects order
                    </div>
                  </button>
                </div>

                {/* Conditional Fields depending on actionType */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
                  {actionType === 'REATTEMPT_WITH_TIME' && (
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Preferred Reattempt Date & Window
                      </label>
                      <input
                        type="text"
                        value={reattemptDate}
                        onChange={e => setReattemptDate(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-900 font-medium"
                      />
                    </div>
                  )}

                  {actionType === 'UPDATE_ADDRESS' && (
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Updated Street & Landmark Details
                      </label>
                      <textarea
                        rows={2}
                        value={newAddress}
                        onChange={e => setNewAddress(e.target.value)}
                        placeholder="Enter full clarified address with house/landmark..."
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-900 font-medium"
                      />
                    </div>
                  )}

                  {actionType === 'ALTERNATE_PHONE' && (
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Alternate Customer Mobile Number
                      </label>
                      <input
                        type="text"
                        value={alternatePhone}
                        onChange={e => setAlternatePhone(e.target.value)}
                        placeholder="+91 98XXXXXXXX"
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-900 font-medium font-mono"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Courier Manifest Instructions / Agent Remarks
                    </label>
                    <input
                      type="text"
                      value={remarks}
                      onChange={e => setRemarks(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-900"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div className="text-[11px] text-slate-500">
                    Transmits real-time webhook payload to carrier API
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50 ${
                      actionType === 'APPROVE_RTO'
                        ? 'bg-rose-600 hover:bg-rose-700'
                        : 'bg-indigo-600 hover:bg-indigo-700'
                    }`}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Transmitting to Carrier...</span>
                      </>
                    ) : (
                      <>
                        <span>Submit Recovery Instructions</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
              Select an order from the NDR queue to inspect and transmit recovery actions.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
