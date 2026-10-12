import React, { useState } from 'react';
import {
  UploadCloud,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Sparkles,
  ArrowRight,
  TrendingDown,
  Info,
  RefreshCw,
  Search,
  Filter,
} from 'lucide-react';
import {
  BatchCsvResult,
  BatchScoredRecord,
  SAMPLE_MERCHANT_CSV,
  uploadAndScoreCsv,
} from '../../services/batchApi';
import { formatCurrency } from '../../utils/formatters';

export const BatchCsvScorer: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [csvContentPreview, setCsvContentPreview] = useState<string | null>(null);
  const [isScoring, setIsScoring] = useState(false);
  const [result, setResult] = useState<BatchCsvResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTierFilter, setActiveTierFilter] = useState<'ALL' | 'ALLOW' | 'REVIEW' | 'BLOCK'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setErrorMessage(null);

      const reader = new FileReader();
      reader.onload = evt => {
        const text = evt.target?.result as string;
        setCsvContentPreview(text.slice(0, 500));
      };
      reader.readAsText(file);
    }
  };

  const handleLoadSample = () => {
    const blob = new File([SAMPLE_MERCHANT_CSV], 'sample_merchant_orders.csv', {
      type: 'text/csv',
    });
    setSelectedFile(blob);
    setCsvContentPreview(SAMPLE_MERCHANT_CSV.slice(0, 500));
    setErrorMessage(null);
  };

  const handleExecuteScoring = async () => {
    if (!selectedFile) {
      setErrorMessage('Please select or load a CSV file first.');
      return;
    }

    setIsScoring(true);
    setErrorMessage(null);

    try {
      const scoredResult = await uploadAndScoreCsv(selectedFile, selectedFile.name);
      setResult(scoredResult);
    } catch (err: any) {
      console.error('Batch scoring error:', err);
      setErrorMessage(err.message || 'Failed to process CSV orders with CatBoost.');
    } finally {
      setIsScoring(false);
    }
  };

  const handleDownloadEnrichedCsv = () => {
    if (!result?.csv_data) return;
    const blob = new Blob([result.csv_data], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `rtoguard_scored_orders_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredRecords = (result?.records || []).filter(rec => {
    if (activeTierFilter !== 'ALL' && rec.action_tier !== activeTierFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        rec.order_id.toLowerCase().includes(q) ||
        rec.pincode.includes(q) ||
        rec.category.toLowerCase().includes(q) ||
        rec.primary_reason.toLowerCase().includes(q) ||
        rec.recommended_action.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Batch CSV Risk Scoring Engine
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 uppercase tracking-wider">
              Trained CatBoost
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Upload raw e-commerce order spreadsheets to bulk-score up to 5,000 orders in real time.
            The engine evaluates India Post pincode logistics, customer order histories, and CART risk features,
            calculating expected shipping losses and actionable policy tiers.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleLoadSample}
            className="px-3.5 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors border border-indigo-100 flex items-center gap-1.5 shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            <span>Load Sample Orders (15 rows)</span>
          </button>
        </div>
      </div>

      {/* Upload & Configuration Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upload Dropzone */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">
            Select Merchant CSV File
          </label>

          <div className="border-2 border-dashed border-slate-200 hover:border-indigo-400 rounded-xl p-6 text-center transition-colors bg-slate-50/50 hover:bg-indigo-50/20">
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
              id="csv-file-input"
            />
            <label htmlFor="csv-file-input" className="cursor-pointer block">
              <UploadCloud className="w-10 h-10 text-indigo-500 mx-auto mb-2" />
              <div className="text-sm font-semibold text-slate-800">
                {selectedFile ? selectedFile.name : 'Click to browse or drop your CSV file here'}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                {selectedFile
                  ? `${(selectedFile.size / 1024).toFixed(1)} KB selected`
                  : 'Requires columns: pincode, address_line, order_value (optional: past_orders, is_cod)'}
              </div>
            </label>
          </div>

          {/* Action Button & Status */}
          <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              {selectedFile ? (
                <span className="text-emerald-700 font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  File ready for CatBoost batch inference
                </span>
              ) : (
                <span>No file chosen yet. Click sample button above for instant evaluation.</span>
              )}
            </div>

            <button
              onClick={handleExecuteScoring}
              disabled={!selectedFile || isScoring}
              className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all shadow-sm ${
                !selectedFile || isScoring
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/20'
              }`}
            >
              {isScoring ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Evaluating CatBoost Pipeline...</span>
                </>
              ) : (
                <>
                  <span>Score CSV Orders</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          {errorMessage && (
            <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Expected Schema Reference */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-indigo-600" />
              Supported CSV Headers
            </h3>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              The engine automatically normalizes common header synonyms:
            </p>

            <ul className="mt-3 space-y-1.5 text-xs text-slate-600">
              <li className="flex items-center justify-between border-b border-slate-100 pb-1">
                <span className="font-mono font-medium text-slate-900">pincode</span>
                <span className="text-[10px] text-slate-400">zip, postal_code</span>
              </li>
              <li className="flex items-center justify-between border-b border-slate-100 pb-1">
                <span className="font-mono font-medium text-slate-900">address_line</span>
                <span className="text-[10px] text-slate-400">street, address</span>
              </li>
              <li className="flex items-center justify-between border-b border-slate-100 pb-1">
                <span className="font-mono font-medium text-slate-900">order_value</span>
                <span className="text-[10px] text-slate-400">total, amount, value</span>
              </li>
              <li className="flex items-center justify-between border-b border-slate-100 pb-1">
                <span className="font-mono font-medium text-slate-900">payment_mode</span>
                <span className="text-[10px] text-slate-400">COD / PREPAID</span>
              </li>
              <li className="flex items-center justify-between pb-1">
                <span className="font-mono font-medium text-slate-900">past_orders / rto</span>
                <span className="text-[10px] text-slate-400">customer history</span>
              </li>
            </ul>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100 text-[11px] text-slate-500 bg-slate-50 p-3 rounded-xl">
            💡 <strong>Thresholds Applied:</strong> Allow: &lt;5%, Review: 5%-40%, Block: &gt;40%.
            Standard forward + reverse courier loss pegged at ₹200.
          </div>
        </div>
      </div>

      {/* Results View */}
      {result && (
        <div className="space-y-6">
          {/* Summary Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Total Orders
              </div>
              <div className="text-2xl font-extrabold text-slate-900 mt-1">
                {result.summary.total_orders}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Scored via CatBoost</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-emerald-200/80 shadow-xs bg-gradient-to-b from-white to-emerald-50/20">
              <div className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">
                Allow Tier (Safe)
              </div>
              <div className="text-2xl font-extrabold text-emerald-700 mt-1">
                {result.summary.low_risk_count}
              </div>
              <div className="text-[10px] text-emerald-600 mt-0.5">
                {Math.round((result.summary.low_risk_count / result.summary.total_orders) * 100)}% unconstrained
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-amber-200/80 shadow-xs bg-gradient-to-b from-white to-amber-50/20">
              <div className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">
                Review Tier (Verify)
              </div>
              <div className="text-2xl font-extrabold text-amber-700 mt-1">
                {result.summary.medium_risk_count}
              </div>
              <div className="text-[10px] text-amber-600 mt-0.5">
                {Math.round((result.summary.medium_risk_count / result.summary.total_orders) * 100)}% OTP / confirmation
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-rose-200/80 shadow-xs bg-gradient-to-b from-white to-rose-50/20">
              <div className="text-[11px] font-bold text-rose-800 uppercase tracking-wider">
                Block Tier (High Risk)
              </div>
              <div className="text-2xl font-extrabold text-rose-700 mt-1">
                {result.summary.high_risk_count}
              </div>
              <div className="text-[10px] text-rose-600 mt-0.5">
                {Math.round((result.summary.high_risk_count / result.summary.total_orders) * 100)}% COD locked
              </div>
            </div>

            <div className="col-span-2 md:col-span-1 bg-gradient-to-br from-indigo-900 to-slate-900 text-white p-4 rounded-xl shadow-xs">
              <div className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider">
                Prevented RTO Loss
              </div>
              <div className="text-2xl font-extrabold text-white mt-1">
                {formatCurrency(result.summary.prevented_loss_inr)}
              </div>
              <div className="text-[10px] text-indigo-200 mt-0.5">
                Protected courier capital
              </div>
            </div>
          </div>

          {/* Enriched Table & Toolbar */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
              {/* Filter Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <button
                  onClick={() => setActiveTierFilter('ALL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    activeTierFilter === 'ALL'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All ({result.records.length})
                </button>
                <button
                  onClick={() => setActiveTierFilter('ALLOW')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    activeTierFilter === 'ALLOW'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  }`}
                >
                  ALLOW ({result.summary.low_risk_count})
                </button>
                <button
                  onClick={() => setActiveTierFilter('REVIEW')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    activeTierFilter === 'REVIEW'
                      ? 'bg-amber-600 text-white'
                      : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                  }`}
                >
                  REVIEW ({result.summary.medium_risk_count})
                </button>
                <button
                  onClick={() => setActiveTierFilter('BLOCK')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    activeTierFilter === 'BLOCK'
                      ? 'bg-rose-600 text-white'
                      : 'bg-rose-50 text-rose-800 hover:bg-rose-100'
                  }`}
                >
                  BLOCK ({result.summary.high_risk_count})
                </button>
              </div>

              {/* Search & Download Buttons */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search ID, pincode, reason..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-800 w-48 sm:w-60"
                  />
                </div>

                <button
                  onClick={handleDownloadEnrichedCsv}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 transition-colors shadow-xs shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Enriched CSV</span>
                </button>
              </div>
            </div>

            {/* Orders Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 text-[11px]">
                  <tr>
                    <th className="px-4 py-3.5">Order ID</th>
                    <th className="px-3 py-3.5">Pincode</th>
                    <th className="px-3 py-3.5">Category</th>
                    <th className="px-3 py-3.5">Value & Mode</th>
                    <th className="px-3 py-3.5">RTO Probability</th>
                    <th className="px-3 py-3.5">Decision Tier</th>
                    <th className="px-3 py-3.5">Recommended Action</th>
                    <th className="px-3 py-3.5">Expected Loss</th>
                    <th className="px-4 py-3.5">Primary Feature Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {filteredRecords.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                        No orders match the current filter or search criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredRecords.map((r, idx) => {
                      const tierBadge =
                        r.action_tier === 'ALLOW'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : r.action_tier === 'REVIEW'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-rose-50 text-rose-800 border-rose-200';

                      return (
                        <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-3 font-mono font-bold text-slate-900">
                            {r.order_id}
                          </td>
                          <td className="px-3 py-3 font-mono text-slate-700">{r.pincode}</td>
                          <td className="px-3 py-3 capitalize text-slate-600">{r.category}</td>
                          <td className="px-3 py-3">
                            <span className="font-bold text-slate-900">
                              {formatCurrency(r.order_value)}
                            </span>
                            <span
                              className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                r.is_cod ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                              }`}
                            >
                              {r.is_cod ? 'COD' : 'PREPAID'}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-slate-900">
                                {(r.rto_probability * 100).toFixed(1)}%
                              </span>
                              <span className="text-[10px] text-slate-400">
                                ({r.rto_probability.toFixed(3)})
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${tierBadge}`}
                            >
                              {r.action_tier}
                            </span>
                          </td>
                          <td className="px-3 py-3 font-mono text-[11px] text-slate-700">
                            {r.recommended_action}
                          </td>
                          <td className="px-3 py-3 font-mono font-bold text-slate-900">
                            {formatCurrency(r.expected_loss_inr)}
                          </td>
                          <td className="px-4 py-3 text-[11px] text-slate-600 max-w-xs truncate" title={r.primary_reason}>
                            {r.primary_reason}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
