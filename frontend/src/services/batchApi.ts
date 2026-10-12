import { getDataSourceMode } from './apiClient';

export interface BatchCsvSummary {
  total_orders: number;
  low_risk_count: number;
  medium_risk_count: number;
  high_risk_count: number;
  total_expected_loss_inr: number;
  prevented_loss_inr: number;
}

export interface BatchScoredRecord {
  order_id: string;
  pincode: string;
  category: string;
  order_value: number;
  is_cod: boolean;
  rto_probability: number;
  risk_score: number;
  risk_band: 'low' | 'medium' | 'high';
  action_tier: 'ALLOW' | 'REVIEW' | 'BLOCK';
  recommended_action: string;
  expected_loss_inr: number;
  primary_reason: string;
}

export interface BatchCsvResult {
  summary: BatchCsvSummary;
  records: BatchScoredRecord[];
  csv_data: string;
}

export const SAMPLE_MERCHANT_CSV = `order_id,pincode,address_line,category,order_value,payment_mode,past_orders,past_rto_count,account_age_days,order_velocity_24h
ORD_BATCH_101,110001,Flat 402 Barakhamba Road Connaught Place,fashion,2499,COD,5,0,320,1
ORD_BATCH_102,800001,Ward 4 near Station Road Patna,electronics,5800,COD,0,0,2,3
ORD_BATCH_103,560001,12 Brigade Road Bangalore,beauty,1250,PREPAID,8,0,450,1
ORD_BATCH_104,700001,9 BBD Bagh Kolkata,fashion,3100,COD,2,1,90,2
ORD_BATCH_105,400001,Nariman Point Mumbai,footwear,4500,COD,4,0,210,1
ORD_BATCH_106,208001,Civil Lines Kanpur,accessories,899,COD,0,0,5,4
ORD_BATCH_107,600001,Parrys Corner Chennai,home_kitchen,2200,PREPAID,6,0,180,1
ORD_BATCH_108,302001,MI Road Jaipur,fashion,1999,COD,1,1,30,1
ORD_BATCH_109,380001,Lal Darwaja Ahmedabad,electronics,6400,COD,0,0,1,5
ORD_BATCH_110,500001,Abids Hyderabad,footwear,3200,COD,3,0,140,1
ORD_BATCH_111,160017,Sector 17 Chandigarh,beauty,1750,PREPAID,9,0,500,1
ORD_BATCH_112,226001,Hazratganj Lucknow,fashion,2850,COD,1,0,60,1
ORD_BATCH_113,411001,Camp Pune,home_kitchen,1650,COD,2,0,110,1
ORD_BATCH_114,834001,Main Road Ranchi,fashion,3900,COD,0,0,7,2
ORD_BATCH_115,122001,DLF Cyber City Gurgaon,electronics,7200,PREPAID,12,0,620,1`;

export async function uploadAndScoreCsv(fileOrBlob: File | Blob, filename: string = 'orders.csv'): Promise<BatchCsvResult> {
  const mode = getDataSourceMode();
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';
  const rootUrl = apiBase.endsWith('/api') ? apiBase.slice(0, -4) : apiBase;

  if (mode === 'LIVE_BACKEND') {
    const formData = new FormData();
    formData.append('file', fileOrBlob, filename);

    try {
      const res = await fetch(`${rootUrl}/api/v1/predictions/csv`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        let detail = `Server responded with HTTP ${res.status}`;
        try {
          const errJson = await res.json();
          detail = errJson.detail || detail;
        } catch {
          // ignore
        }
        throw new Error(detail);
      }

      return (await res.json()) as BatchCsvResult;
    } catch (err: any) {
      console.warn('Live backend CSV scoring error, falling back to client evaluation if in demo:', err);
      if (mode === 'LIVE_BACKEND') throw err;
    }
  }

  // Client-side simulation fallback for offline demo
  return simulateCsvScoring(await fileOrBlob.text());
}

function simulateCsvScoring(csvText: string): BatchCsvResult {
  const lines = csvText.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length <= 1) {
    throw new Error('CSV must contain at least one order data row.');
  }

  const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
  const rows = lines.slice(1);

  const records: BatchScoredRecord[] = [];
  let lowCount = 0;
  let medCount = 0;
  let highCount = 0;
  let totalLoss = 0;
  let preventedLoss = 0;

  for (let idx = 0; idx < rows.length; idx++) {
    const cols = rows[idx].split(',').map(c => c.trim());
    const rowObj: Record<string, string> = {};
    headers.forEach((h, i) => {
      rowObj[h] = cols[i] || '';
    });

    const orderId = rowObj.order_id || `ORD_CSV_${idx + 1}`;
    const pincode = rowObj.pincode || '110001';
    const category = rowObj.category || 'fashion';
    const orderVal = parseFloat(rowObj.order_value || '1500') || 1500;
    const isCod = (rowObj.payment_mode || 'COD').toUpperCase() === 'COD';
    const pastOrders = parseInt(rowObj.past_orders || '0', 10);
    const pastRto = parseInt(rowObj.past_rto_count || '0', 10);
    const velocity = parseInt(rowObj.order_velocity_24h || '1', 10);

    // Realistic probability calculation based on the CatBoost model features
    let prob = 0.08;
    if (isCod) prob += 0.12;
    if (pastRto > 0) prob += 0.35 * (pastRto / Math.max(1, pastOrders));
    if (pastOrders === 0) prob += 0.14;
    if (velocity >= 3) prob += 0.18;
    if (orderVal > 4000) prob += 0.08;
    prob = Math.min(0.94, Math.max(0.02, prob));

    let band: 'low' | 'medium' | 'high' = 'low';
    let actionTier: 'ALLOW' | 'REVIEW' | 'BLOCK' = 'ALLOW';
    let action = 'DISPATCH_STANDARD';
    let reason = 'High repeat purchase rate; Tier-1 validated pincode';

    if (prob < 0.18) {
      band = 'low';
      actionTier = 'ALLOW';
      action = 'DISPATCH_STANDARD';
      reason = 'Consistent verified customer with zero previous returns';
      lowCount++;
    } else if (prob < 0.40) {
      band = 'medium';
      actionTier = 'REVIEW';
      action = 'REQUEST_ADDRESS_VERIFICATION';
      reason = 'Moderate delivery friction score; landmark verification suggested';
      medCount++;
    } else {
      band = 'high';
      actionTier = 'BLOCK';
      action = 'BLOCK_COD_OFFER_PREPAID';
      reason = 'Elevated return probability; multiple prior RTOs or high velocity';
      highCount++;
      preventedLoss += prob * 200;
    }

    const loss = prob * 200;
    totalLoss += loss;

    records.push({
      order_id: orderId,
      pincode,
      category,
      order_value: orderVal,
      is_cod: isCod,
      rto_probability: Math.round(prob * 1000) / 1000,
      risk_score: Math.round(prob * 100),
      risk_band: band,
      action_tier: actionTier,
      recommended_action: action,
      expected_loss_inr: Math.round(loss * 100) / 100,
      primary_reason: reason,
    });
  }

  // Generate enriched CSV string
  const enrichedHeaders = [
    'order_id',
    'pincode',
    'category',
    'order_value',
    'is_cod',
    'rto_probability',
    'risk_score',
    'risk_band',
    'action_tier',
    'recommended_action',
    'expected_loss_inr',
    'primary_reason',
  ];
  const outLines = [
    enrichedHeaders.join(','),
    ...records.map(r =>
      [
        r.order_id,
        r.pincode,
        r.category,
        r.order_value,
        r.is_cod,
        r.rto_probability,
        r.risk_score,
        r.risk_band,
        r.action_tier,
        r.recommended_action,
        r.expected_loss_inr,
        `"${r.primary_reason}"`,
      ].join(',')
    ),
  ];

  return {
    summary: {
      total_orders: records.length,
      low_risk_count: lowCount,
      medium_risk_count: medCount,
      high_risk_count: highCount,
      total_expected_loss_inr: Math.round(totalLoss * 100) / 100,
      prevented_loss_inr: Math.round(preventedLoss * 100) / 100,
    },
    records,
    csv_data: outLines.join('\n'),
  };
}
