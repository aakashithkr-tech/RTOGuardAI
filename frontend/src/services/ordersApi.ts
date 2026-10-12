import { Order, RecommendedActionType, OrderStatus, TimelineEvent } from '../types';
import { getDataSourceMode, request } from './apiClient';
import { demoAdapter } from './demoAdapter';

export async function fetchAllOrders(): Promise<Order[]> {
  const mode = getDataSourceMode();
  if (mode === 'LIVE_BACKEND') {
    return await request<Order[]>('/orders');
  }

  await new Promise(r => setTimeout(r, 100));
  return demoAdapter.getAllOrders();
}

export async function fetchOrderById(orderId: string): Promise<Order | undefined> {
  const mode = getDataSourceMode();
  if (mode === 'LIVE_BACKEND') {
    return await request<Order>(`/orders/${orderId}`);
  }

  await new Promise(r => setTimeout(r, 80));
  return demoAdapter.getOrderById(orderId);
}

export async function recordOrderAction(
  orderId: string,
  action: RecommendedActionType,
  notes?: string,
  additionalData?: Record<string, any>
): Promise<Order> {
  const mode = getDataSourceMode();
  if (mode === 'LIVE_BACKEND') {
    return await request<Order>(`/orders/${orderId}/actions`, {
      method: 'POST',
      body: JSON.stringify({ action, notes, additionalData }),
    });
  }

  // Realistic mock processing delay
  await new Promise(r => setTimeout(r, 250));
  return demoAdapter.recordOrderAction(orderId, action, notes, additionalData);
}

export async function recordOrderLifecycleEvent(
  orderId: string,
  eventName: string,
  newStatus?: OrderStatus,
  details?: string,
  source?: TimelineEvent['source']
): Promise<Order> {
  const mode = getDataSourceMode();
  if (mode === 'LIVE_BACKEND') {
    return await request<Order>(`/orders/${orderId}/events`, {
      method: 'POST',
      body: JSON.stringify({ eventName, newStatus, details, source }),
    });
  }

  await new Promise(r => setTimeout(r, 200));
  return demoAdapter.recordLifecycleEvent(orderId, eventName, newStatus, details, source);
}

export async function scoreOrderWithModel(orderId: string): Promise<Order> {
  const mode = getDataSourceMode();
  if (mode === 'LIVE_BACKEND') {
    return await request<Order>(`/orders/${orderId}/score`, {
      method: 'POST',
    });
  }

  throw new Error(
    'Trained model scoring is only available in Live Backend mode. Switch to Live Backend API to run real inference.'
  );
}

export async function fetchPredictionHistory(limit: number = 20): Promise<{ count: number; predictions: any[] }> {
  const mode = getDataSourceMode();
  if (mode === 'LIVE_BACKEND') {
    return await request<{ count: number; predictions: any[] }>(`/predictions?limit=${limit}`);
  }
  return { count: 0, predictions: [] };
}

export async function fetchModelHealth(): Promise<any> {
  const mode = getDataSourceMode();
  if (mode === 'LIVE_BACKEND') {
    return await request<any>('/health');
  }
  return {
    status: 'healthy',
    trained_model_loaded: false,
    message: 'Demo Simulation Mode (Switch to Live Backend API in Settings to query CatBoost model)',
  };
}
