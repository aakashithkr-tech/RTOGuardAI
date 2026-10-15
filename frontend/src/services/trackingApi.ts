/**
 * Tracking API service for RTOGuardAI.
 * Provides functions to register, fetch, refresh, and view history of
 * shipment tracking for orders. Respects LIVE_BACKEND / DEMO_MOCK mode.
 */

import { getDataSourceMode, request } from './apiClient';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ShipmentTracking {
  order_id: string;
  tracking_number: string;
  courier_code: string;
  courier_name: string;
  current_status: ShipmentStatus;
  status_details: string | null;
  estimated_delivery: string | null;
  origin_city: string | null;
  destination_city: string | null;
  last_checkpoint_time: string | null;
  updated_at: string | null;
  tracking_url: string | null;
  mode: 'live' | 'simulated' | 'fallback_mock';
  events_count: number;
}

export interface ShipmentEvent {
  id: number;
  order_id: string;
  tracking_number: string;
  status: ShipmentStatus;
  substatus: string | null;
  message: string;
  location: string | null;
  checkpoint_time: string;
  timestamp: string;
  created_at: string;
}

export interface ShipmentHistory {
  order_id: string;
  tracking: ShipmentTracking | null;
  events: ShipmentEvent[];
}

export type ShipmentStatus =
  | 'ORDER_CREATED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED_ATTEMPT'
  | 'RTO_INITIATED'
  | 'RTO_DELIVERED'
  | 'EXCEPTION';

export interface CourierInfo {
  code: string;
  name: string;
  aftership_slug: string;
  tracking_url_template: string;
  default_service: string;
  description: string;
}

export interface TrackingRegisterPayload {
  tracking_number: string;
  courier_code?: string;
  courier_name?: string;
  estimated_delivery?: string;
  origin_city?: string;
  destination_city?: string;
  notify_customer?: boolean;
}

export interface TrackingConfigStatus {
  provider: string;
  is_live: boolean;
  mode: 'live' | 'simulated_mock';
  aftership_configured: boolean;
  aftership_webhook_configured: boolean;
  shiprocket_configured: boolean;
  generic_webhook_secret_configured: boolean;
  supported_couriers_count: number;
  supported_couriers: string[];
}

// ─── Mock helpers (used in DEMO_MOCK mode) ──────────────────────────────────

function makeMockTracking(orderId: string): ShipmentTracking {
  return {
    order_id: orderId,
    tracking_number: `DEMO-${orderId.toUpperCase()}-9999`,
    courier_code: 'delhivery',
    courier_name: 'Delhivery',
    current_status: 'IN_TRANSIT',
    status_details: 'Demo simulation: in transit via express linehaul.',
    estimated_delivery: new Date(Date.now() + 2 * 86400000).toISOString(),
    origin_city: 'Delhi NCR',
    destination_city: 'Mumbai',
    last_checkpoint_time: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tracking_url: 'https://www.delhivery.com/track/package/DEMO-9999',
    mode: 'simulated',
    events_count: 2,
  };
}

function makeMockHistory(orderId: string): ShipmentHistory {
  const now = new Date().toISOString();
  return {
    order_id: orderId,
    tracking: makeMockTracking(orderId),
    events: [
      {
        id: 1,
        order_id: orderId,
        tracking_number: `DEMO-${orderId.toUpperCase()}-9999`,
        status: 'ORDER_CREATED',
        substatus: 'MANIFESTED',
        message: 'Shipping label generated at warehouse (Demo)',
        location: 'Delhi NCR',
        checkpoint_time: new Date(Date.now() - 86400000).toISOString(),
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        created_at: now,
      },
      {
        id: 2,
        order_id: orderId,
        tracking_number: `DEMO-${orderId.toUpperCase()}-9999`,
        status: 'IN_TRANSIT',
        substatus: 'IN_TRANSIT',
        message: 'Shipment in transit via express surface route (Demo)',
        location: 'Jaipur Transit Node',
        checkpoint_time: now,
        timestamp: now,
        created_at: now,
      },
    ],
  };
}

// ─── API functions ────────────────────────────────────────────────────────────

/** List all supported courier partners. */
export async function fetchSupportedCouriers(): Promise<CourierInfo[]> {
  if (getDataSourceMode() !== 'LIVE_BACKEND') {
    return [
      { code: 'delhivery', name: 'Delhivery', aftership_slug: 'delhivery', tracking_url_template: 'https://www.delhivery.com/track/package/{awb}', default_service: 'Surface / Express', description: 'Leading Indian e-commerce logistics.' },
      { code: 'bluedart', name: 'Blue Dart Express', aftership_slug: 'bluedart', tracking_url_template: 'https://www.bluedart.com/tracking?awb_no={awb}', default_service: 'Air Express', description: 'Premium express air freight.' },
      { code: 'dtdc', name: 'DTDC Express', aftership_slug: 'dtdc', tracking_url_template: 'https://www.dtdc.in/tracking/tracking_results.asp?trkid={awb}', default_service: 'Express / DotZot', description: 'Extensive domestic network.' },
      { code: 'ecom-express', name: 'Ecom Express', aftership_slug: 'ecom-express', tracking_url_template: 'https://ecomexpress.in/tracking/?awb={awb}', default_service: 'Ecom Ground Services', description: 'E-commerce specialized.' },
      { code: 'xpressbees', name: 'Xpressbees', aftership_slug: 'xpressbees', tracking_url_template: 'https://www.xpressbees.com/track?isAwb=true&trackid={awb}', default_service: 'Standard Ground', description: 'High-velocity courier.' },
    ];
  }
  return request<CourierInfo[]>('/tracking/couriers');
}

/** Get the current tracking provider configuration status (live vs mock). */
export async function fetchTrackingStatus(): Promise<TrackingConfigStatus> {
  if (getDataSourceMode() !== 'LIVE_BACKEND') {
    return {
      provider: 'mock',
      is_live: false,
      mode: 'simulated_mock',
      aftership_configured: false,
      aftership_webhook_configured: false,
      shiprocket_configured: false,
      generic_webhook_secret_configured: false,
      supported_couriers_count: 8,
      supported_couriers: ['delhivery', 'bluedart', 'dtdc', 'ecom-express', 'xpressbees', 'india-post', 'shadowfax', 'ekart'],
    };
  }
  return request<TrackingConfigStatus>('/tracking/status');
}

/** Register or update a courier AWB tracking number for an order. */
export async function registerOrderTracking(
  orderId: string,
  payload: TrackingRegisterPayload
): Promise<ShipmentTracking> {
  if (getDataSourceMode() !== 'LIVE_BACKEND') {
    await new Promise(r => setTimeout(r, 400));
    return makeMockTracking(orderId);
  }
  return request<ShipmentTracking>(`/orders/${orderId}/tracking`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Fetch the current shipment status for an order. */
export async function fetchOrderTracking(orderId: string): Promise<ShipmentTracking> {
  if (getDataSourceMode() !== 'LIVE_BACKEND') {
    await new Promise(r => setTimeout(r, 200));
    return makeMockTracking(orderId);
  }
  return request<ShipmentTracking>(`/orders/${orderId}/tracking`);
}

/** Fetch the complete tracking history (all checkpoints) for an order. */
export async function fetchOrderTrackingHistory(orderId: string): Promise<ShipmentHistory> {
  if (getDataSourceMode() !== 'LIVE_BACKEND') {
    await new Promise(r => setTimeout(r, 250));
    return makeMockHistory(orderId);
  }
  return request<ShipmentHistory>(`/orders/${orderId}/tracking/history`);
}

/** Poll live carrier API or advance mock simulator to the next checkpoint. */
export async function refreshOrderTracking(orderId: string): Promise<ShipmentTracking> {
  if (getDataSourceMode() !== 'LIVE_BACKEND') {
    await new Promise(r => setTimeout(r, 600));
    return { ...makeMockTracking(orderId), current_status: 'OUT_FOR_DELIVERY', status_details: 'Simulated: Out for delivery with courier executive.' };
  }
  return request<ShipmentTracking>(`/orders/${orderId}/tracking/refresh`, { method: 'POST' });
}
