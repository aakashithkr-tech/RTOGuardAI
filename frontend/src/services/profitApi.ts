import { Order, ScenarioComparison } from '../types';
import { generateScenarioComparisons } from '../utils/calculations';
import { getDataSourceMode, request } from './apiClient';

export async function fetchProfitScenarios(order: Order): Promise<ScenarioComparison[]> {
  const mode = getDataSourceMode();
  if (mode === 'LIVE_BACKEND') {
    try {
      return await request<ScenarioComparison[]>(`/profit/scenarios`, {
        method: 'POST',
        body: JSON.stringify({ orderId: order.id, financials: order.financials, riskScore: order.risk.riskScore }),
      });
    } catch (err) {
      console.warn('Backend profit calculation unavailable, falling back to deterministic math engine.', err);
    }
  }

  // Pure deterministic mathematical engine from src/utils/calculations
  return generateScenarioComparisons(order);
}
