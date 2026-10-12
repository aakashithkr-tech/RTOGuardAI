import { DashboardSummary } from '../types';
import { getDataSourceMode, request } from './apiClient';
import { demoAdapter } from './demoAdapter';

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const mode = getDataSourceMode();
  if (mode === 'LIVE_BACKEND') {
    const data = await request<DashboardSummary>('/dashboard/summary');
    return { ...data, activeMode: 'LIVE' };
  }

  // Deterministic mock demo adapter with simulated realistic network delay
  await new Promise(r => setTimeout(r, 120));
  return demoAdapter.getDashboardSummary();
}
