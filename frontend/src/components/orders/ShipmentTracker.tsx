/**
 * ShipmentTracker — Live shipment tracking panel for RTOGuardAI.
 *
 * Displays:
 *  - Courier name, tracking number, live status badge
 *  - Estimated delivery date
 *  - Direct carrier tracking URL link
 *  - Full checkpoint / event history timeline
 *  - Register tracking form (if no tracking is yet registered)
 *  - Refresh / advance simulation button
 *  - Live vs Simulated mode badge
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Package,
  RefreshCw,
  Truck,
  XCircle,
  Zap,
} from 'lucide-react';

import { Order } from '../../types';
import {
  CourierInfo,
  ShipmentEvent,
  ShipmentStatus,
  ShipmentTracking,
  fetchOrderTrackingHistory,
  fetchSupportedCouriers,
  registerOrderTracking,
  refreshOrderTracking,
} from '../../services/trackingApi';

// ─── Helper: status badge config ─────────────────────────────────────────────

interface StatusConfig {
  label: string;
  color: string;
  icon: React.ReactNode;
}

function getStatusConfig(status: ShipmentStatus): StatusConfig {
  switch (status) {
    case 'ORDER_CREATED':
      return { label: 'Order Created', color: 'bg-slate-100 text-slate-700 border-slate-300', icon: <Package className="w-3.5 h-3.5" /> };
    case 'IN_TRANSIT':
      return { label: 'In Transit', color: 'bg-sky-50 text-sky-700 border-sky-300', icon: <Truck className="w-3.5 h-3.5" /> };
    case 'OUT_FOR_DELIVERY':
      return { label: 'Out for Delivery', color: 'bg-amber-50 text-amber-700 border-amber-300', icon: <Truck className="w-3.5 h-3.5" /> };
    case 'DELIVERED':
      return { label: 'Delivered', color: 'bg-emerald-50 text-emerald-700 border-emerald-300', icon: <CheckCircle2 className="w-3.5 h-3.5" /> };
    case 'FAILED_ATTEMPT':
      return { label: 'Failed Attempt', color: 'bg-orange-50 text-orange-700 border-orange-300', icon: <AlertCircle className="w-3.5 h-3.5" /> };
    case 'RTO_INITIATED':
      return { label: 'RTO Initiated', color: 'bg-rose-50 text-rose-700 border-rose-300', icon: <XCircle className="w-3.5 h-3.5" /> };
    case 'RTO_DELIVERED':
      return { label: 'RTO Delivered', color: 'bg-red-50 text-red-700 border-red-300', icon: <XCircle className="w-3.5 h-3.5" /> };
    case 'EXCEPTION':
      return { label: 'Exception', color: 'bg-purple-50 text-purple-700 border-purple-300', icon: <AlertCircle className="w-3.5 h-3.5" /> };
    default:
      return { label: status, color: 'bg-slate-100 text-slate-600 border-slate-200', icon: <Package className="w-3.5 h-3.5" /> };
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch {
    return iso;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ShipmentStatus }) {
  const cfg = getStatusConfig(status);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function EventRow({ event, isLast }: { event: ShipmentEvent; isLast: boolean }) {
  const cfg = getStatusConfig(event.status);
  return (
    <div className="flex gap-3">
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${cfg.color}`}>
          {cfg.icon}
        </div>
        {!isLast && <div className="w-px flex-1 bg-slate-200 mt-1" />}
      </div>

      {/* Event content */}
      <div className={`pb-4 flex-1 min-w-0 ${isLast ? '' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-slate-900">{event.message}</p>
            {event.location && (
              <p className="text-[11px] text-slate-500 mt-0.5">📍 {event.location}</p>
            )}
            {event.substatus && event.substatus !== event.status && (
              <p className="text-[11px] text-slate-400 mt-0.5 font-mono">{event.substatus}</p>
            )}
          </div>
          <time className="text-[10px] text-slate-400 shrink-0 text-right">
            {formatDate(event.timestamp)}
          </time>
        </div>
      </div>
    </div>
  );
}

// ─── Register Tracking Form ───────────────────────────────────────────────────

interface RegisterFormProps {
  orderId: string;
  couriers: CourierInfo[];
  onRegistered: (tracking: ShipmentTracking) => void;
}

function RegisterTrackingForm({ orderId, couriers, onRegistered }: RegisterFormProps) {
  const [awb, setAwb] = useState('');
  const [courierCode, setCourierCode] = useState('delhivery');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!awb.trim()) { setError('Tracking number (AWB) is required.'); return; }
    setError(null);
    setIsLoading(true);
    try {
      const result = await registerOrderTracking(orderId, {
        tracking_number: awb.trim(),
        courier_code: courierCode,
      });
      onRegistered(result);
    } catch (err: any) {
      setError(err.message || 'Failed to register tracking.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 border border-dashed border-slate-300 rounded-xl bg-slate-50">
      <div className="flex items-center gap-2 mb-3">
        <Truck className="w-4 h-4 text-slate-400" />
        <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Register Shipment Tracking</span>
      </div>
      <p className="text-[11px] text-slate-500 mb-4">
        Enter the courier AWB / tracking number assigned by your logistics partner to start live tracking.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
            Courier Partner
          </label>
          <select
            value={courierCode}
            onChange={e => setCourierCode(e.target.value)}
            className="w-full text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          >
            {couriers.map(c => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
            AWB / Tracking Number
          </label>
          <input
            type="text"
            value={awb}
            onChange={e => setAwb(e.target.value)}
            placeholder="e.g. DLV-993817412 or BD-882941029"
            className="w-full text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 font-mono"
          />
        </div>

        {error && (
          <p className="text-[11px] text-rose-600 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Registering...</> : <><Package className="w-3.5 h-3.5" /> Register & Track</>}
        </button>
      </form>
    </div>
  );
}

// ─── Main ShipmentTracker component ──────────────────────────────────────────

interface ShipmentTrackerProps {
  order: Order;
}

export const ShipmentTracker: React.FC<ShipmentTrackerProps> = ({ order }) => {
  const [tracking, setTracking] = useState<ShipmentTracking | null>(null);
  const [events, setEvents] = useState<ShipmentEvent[]>([]);
  const [couriers, setCouriers] = useState<CourierInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllEvents, setShowAllEvents] = useState(false);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [history, courierList] = await Promise.all([
        fetchOrderTrackingHistory(order.id).catch(() => null),
        fetchSupportedCouriers().catch(() => []),
      ]);
      if (history) {
        setTracking(history.tracking);
        setEvents(history.events);
      }
      setCouriers(courierList);
    } catch (err: any) {
      setError(err.message || 'Failed to load tracking data.');
    } finally {
      setIsLoading(false);
    }
  }, [order.id]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      const updated = await refreshOrderTracking(order.id);
      setTracking(updated);
      // Re-fetch history to get updated events
      const history = await fetchOrderTrackingHistory(order.id).catch(() => null);
      if (history) setEvents(history.events);
    } catch (err: any) {
      setError(err.message || 'Failed to refresh tracking.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRegistered = (newTracking: ShipmentTracking) => {
    setTracking(newTracking);
    loadHistory();
  };

  // ── Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
        <span className="text-xs">Loading shipment data…</span>
      </div>
    );
  }

  const visibleEvents = showAllEvents ? events : events.slice(-4);

  return (
    <div className="space-y-5">
      {/* Error banner */}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* ── No tracking registered yet ── */}
      {!tracking ? (
        <RegisterTrackingForm
          orderId={order.id}
          couriers={couriers.length ? couriers : [
            { code: 'delhivery', name: 'Delhivery', aftership_slug: 'delhivery', tracking_url_template: '', default_service: '', description: '' },
            { code: 'bluedart', name: 'Blue Dart Express', aftership_slug: 'bluedart', tracking_url_template: '', default_service: '', description: '' },
            { code: 'dtdc', name: 'DTDC Express', aftership_slug: 'dtdc', tracking_url_template: '', default_service: '', description: '' },
            { code: 'ecom-express', name: 'Ecom Express', aftership_slug: 'ecom-express', tracking_url_template: '', default_service: '', description: '' },
            { code: 'xpressbees', name: 'Xpressbees', aftership_slug: 'xpressbees', tracking_url_template: '', default_service: '', description: '' },
            { code: 'india-post', name: 'India Post', aftership_slug: 'india-post', tracking_url_template: '', default_service: '', description: '' },
            { code: 'shadowfax', name: 'Shadowfax', aftership_slug: 'shadowfax', tracking_url_template: '', default_service: '', description: '' },
            { code: 'ekart', name: 'Ekart Logistics', aftership_slug: 'ekart', tracking_url_template: '', default_service: '', description: '' },
          ]}
          onRegistered={handleRegistered}
        />
      ) : (
        <>
          {/* ── Tracking header card ── */}
          <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-4">
            {/* Row 1: status + mode badge */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <StatusBadge status={tracking.current_status} />
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                  tracking.mode === 'live'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                    : 'bg-amber-50 text-amber-600 border-amber-300'
                }`}>
                  <Zap className="w-2.5 h-2.5" />
                  {tracking.mode === 'live' ? 'LIVE' : 'SIMULATED'}
                </span>
                <button
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  title="Refresh / advance tracking status"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Row 2: courier + AWB */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Courier</div>
                <div className="text-sm font-bold text-slate-900">{tracking.courier_name}</div>
                <div className="text-[10px] text-slate-500 font-mono mt-0.5">{tracking.courier_code}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Tracking Number (AWB)</div>
                <div className="text-sm font-bold text-slate-900 font-mono">{tracking.tracking_number}</div>
              </div>
            </div>

            {/* Row 3: route */}
            {(tracking.origin_city || tracking.destination_city) && (
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className="font-medium">{tracking.origin_city || '—'}</span>
                <ChevronRight className="w-3 h-3 text-slate-400" />
                <span className="font-medium">{tracking.destination_city || '—'}</span>
              </div>
            )}

            {/* Row 4: EDD + last update */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Est. Delivery</div>
                <div className="text-xs font-semibold text-slate-800">
                  {tracking.estimated_delivery
                    ? new Date(tracking.estimated_delivery).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                    : 'Not available'}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Last Update</div>
                <div className="text-xs font-semibold text-slate-800">
                  {formatDate(tracking.last_checkpoint_time)}
                </div>
              </div>
            </div>

            {/* Status details */}
            {tracking.status_details && (
              <p className="text-[11px] text-slate-600 bg-slate-50 rounded-lg px-3 py-2 leading-relaxed">
                {tracking.status_details}
              </p>
            )}

            {/* Carrier tracking link */}
            {tracking.tracking_url && tracking.mode === 'live' && (
              <a
                href={tracking.tracking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-semibold transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Track on {tracking.courier_name} website
              </a>
            )}
          </div>

          {/* ── Events / Checkpoints timeline ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Delivery Checkpoints ({events.length})
              </h4>
              {events.length > 4 && (
                <button
                  onClick={() => setShowAllEvents(v => !v)}
                  className="flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold"
                >
                  {showAllEvents ? <><ChevronDown className="w-3 h-3" /> Show recent</> : <><ChevronRight className="w-3 h-3" /> Show all {events.length}</>}
                </button>
              )}
            </div>

            {events.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-xs">
                No tracking checkpoints yet. Refresh to fetch latest status.
              </div>
            ) : (
              <div className="space-y-0">
                {[...visibleEvents].reverse().map((ev, i) => (
                  <EventRow
                    key={ev.id}
                    event={ev}
                    isLast={i === visibleEvents.length - 1}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Register new tracking ── */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Update Tracking</h4>
            <RegisterTrackingForm
              orderId={order.id}
              couriers={couriers.length ? couriers : [
                { code: 'delhivery', name: 'Delhivery', aftership_slug: 'delhivery', tracking_url_template: '', default_service: '', description: '' },
              ]}
              onRegistered={handleRegistered}
            />
          </div>
        </>
      )}
    </div>
  );
};
