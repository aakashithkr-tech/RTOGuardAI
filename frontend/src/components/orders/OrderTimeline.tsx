import React, { useState } from 'react';
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  Truck,
  Sparkles,
  User,
  Shield,
  LifeBuoy,
  PlusCircle,
  Loader2,
} from 'lucide-react';
import { Order, TimelineEvent, OrderStatus } from '../../types';
import { formatDate } from '../../utils/formatters';

interface OrderTimelineProps {
  order: Order;
  onRecordEvent: (
    eventName: string,
    newStatus?: OrderStatus,
    details?: string,
    source?: TimelineEvent['source']
  ) => Promise<void>;
}

export const OrderTimeline: React.FC<OrderTimelineProps> = ({ order, onRecordEvent }) => {
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventName, setEventName] = useState('Courier Delivery Attempt Failed');
  const [targetStatus, setTargetStatus] = useState<OrderStatus>('NDR_PENDING');
  const [eventDetails, setEventDetails] = useState('Doorstep attempt failed: Customer phone switched off.');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventName.trim()) return;

    try {
      setIsSubmitting(true);
      await onRecordEvent(eventName, targetStatus, eventDetails, 'DEMO_SIMULATOR');
      setShowEventForm(false);
      setEventDetails('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getSourceBadge = (source: TimelineEvent['source']) => {
    switch (source) {
      case 'INTEGRATED_COURIER':
        return {
          label: 'Integrated Courier',
          bg: 'bg-sky-50 text-sky-700 border-sky-200',
        };
      case 'AI_ENGINE':
        return {
          label: 'RTOGuard AI',
          bg: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        };
      case 'MERCHANT_MANUAL':
        return {
          label: 'Merchant Ops',
          bg: 'bg-amber-50 text-amber-700 border-amber-200',
        };
      case 'DEMO_SIMULATOR':
        return {
          label: 'Simulated Event',
          bg: 'bg-purple-50 text-purple-700 border-purple-200',
        };
    }
  };

  const getCategoryIcon = (category: TimelineEvent['category']) => {
    switch (category) {
      case 'COURIER':
        return <Truck className="w-4 h-4 text-sky-600" />;
      case 'RISK':
        return <Sparkles className="w-4 h-4 text-indigo-600" />;
      case 'ACTION':
        return <User className="w-4 h-4 text-amber-600" />;
      case 'NDR':
      case 'RECOVERY':
        return <LifeBuoy className="w-4 h-4 text-rose-600" />;
      default:
        return <Clock className="w-4 h-4 text-slate-500" />;
    }
  };

  return (
    <div className="space-y-4">
      {/* Event simulator control bar */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Chronological Audit Trail
          </h3>
          <p className="text-[11px] text-slate-400">
            {order.timeline.length} verified events from carrier and risk systems
          </p>
        </div>

        <button
          onClick={() => setShowEventForm(!showEventForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs border border-indigo-200 transition-colors shadow-sm"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span>{showEventForm ? 'Cancel Event' : 'Simulate Lifecycle Event'}</span>
        </button>
      </div>

      {/* Simulated Event Creator Form */}
      {showEventForm && (
        <form
          onSubmit={handleSubmit}
          className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800">
              Record Simulated Lifecycle Event
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold">
              Demo Simulation Mode
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Event Preset
              </label>
              <select
                value={eventName}
                onChange={e => {
                  setEventName(e.target.value);
                  if (e.target.value.includes('Dispatched')) {
                    setTargetStatus('DISPATCHED');
                    setEventDetails('Dispatched from Bhiwandi Hub via BlueDart (AWB BD-8829104).');
                  } else if (e.target.value.includes('Failed')) {
                    setTargetStatus('NDR_PENDING');
                    setEventDetails('Delivery attempt failed at doorstep: Customer phone unreachable.');
                  } else if (e.target.value.includes('Delivered Successfully')) {
                    setTargetStatus('DELIVERED');
                    setEventDetails('Customer signed and accepted package at doorstep.');
                  } else if (e.target.value.includes('RTO Returned')) {
                    setTargetStatus('RTO_DELIVERED');
                    setEventDetails('Consignment returned to warehouse after failed attempts.');
                  }
                }}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-800 font-medium"
              >
                <option value="Shipment Dispatched from Warehouse">Shipment Dispatched</option>
                <option value="Courier Delivery Attempt Failed">Courier Delivery Attempt Failed (NDR)</option>
                <option value="Delivered Successfully to Customer">Delivered Successfully (Realize Profit)</option>
                <option value="RTO Returned to Merchant Hub">RTO Returned to Hub (Realize Loss)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Resulting Order Status
              </label>
              <select
                value={targetStatus}
                onChange={e => setTargetStatus(e.target.value as OrderStatus)}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-800 font-medium"
              >
                <option value="DISPATCHED">DISPATCHED</option>
                <option value="IN_TRANSIT">IN_TRANSIT</option>
                <option value="NDR_PENDING">NDR_PENDING</option>
                <option value="DELIVERED">DELIVERED</option>
                <option value="RTO_DELIVERED">RTO_DELIVERED</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Event Details & Audit Notes
            </label>
            <input
              type="text"
              value={eventDetails}
              onChange={e => setEventDetails(e.target.value)}
              placeholder="e.g. Courier note, driver remark, or customer confirmation info"
              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowEventForm(false)}
              className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded-lg font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Recording...</span>
                </>
              ) : (
                <span>Confirm & Record Event</span>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Timeline items list */}
      <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
        {order.timeline.map((evt, idx) => {
          const sBadge = getSourceBadge(evt.source);

          return (
            <div key={evt.id || idx} className="relative group">
              {/* Dot Icon */}
              <div className="absolute -left-6 top-0.5 w-5 h-5 rounded-full bg-white border-2 border-indigo-600 flex items-center justify-center shadow-sm">
                <div className="w-2 h-2 rounded-full bg-indigo-600" />
              </div>

              {/* Event Card */}
              <div className="bg-slate-50/70 hover:bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1">
                  <div className="flex items-center gap-2">
                    <span className="p-1 rounded bg-white border border-slate-200 shadow-2xs">
                      {getCategoryIcon(evt.category)}
                    </span>
                    <h4 className="text-xs font-bold text-slate-900">{evt.eventName}</h4>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${sBadge.bg}`}
                    >
                      {sBadge.label}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {formatDate(evt.timestamp)}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-slate-600 mt-1 leading-relaxed">{evt.details}</p>

                {evt.outcome && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px]">
                    <span className="text-slate-400">Result:</span>
                    <span
                      className={`font-semibold ${
                        evt.outcome === 'SUCCESS'
                          ? 'text-emerald-700'
                          : evt.outcome === 'RESOLVED'
                          ? 'text-indigo-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {evt.outcome}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
