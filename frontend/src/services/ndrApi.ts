import { Order } from '../types';
import { getDataSourceMode, request } from './apiClient';
import { demoAdapter } from './demoAdapter';

export async function submitNdrRecovery(
  orderId: string,
  actionType: 'REATTEMPT_WITH_TIME' | 'UPDATE_ADDRESS' | 'ALTERNATE_PHONE' | 'APPROVE_RTO',
  payload: {
    reattemptDate?: string;
    newAddress?: string;
    alternatePhone?: string;
    remarks?: string;
  }
): Promise<Order> {
  const mode = getDataSourceMode();
  if (mode === 'LIVE_BACKEND') {
    return await request<Order>(`/orders/${orderId}/ndr/recovery`, {
      method: 'POST',
      body: JSON.stringify({ actionType, ...payload }),
    });
  }

  await new Promise(r => setTimeout(r, 260));
  return demoAdapter.recordNdrRecovery(orderId, actionType, payload);
}
