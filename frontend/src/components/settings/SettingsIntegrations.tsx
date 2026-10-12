import React, { useState, useEffect } from 'react';
import {
  Settings,
  Server,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Link2,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  Code2,
  Truck,
  Cpu,
  Database,
  Sparkles,
} from 'lucide-react';
import { DataSourceMode, getDataSourceMode, setDataSourceMode } from '../../services/apiClient';
import { fetchModelHealth } from '../../services/ordersApi';

interface SettingsIntegrationsProps {
  currentMode: DataSourceMode;
  onModeChange: (newMode: DataSourceMode) => void;
  onResetDemoData: () => void;
}

export const SettingsIntegrations: React.FC<SettingsIntegrationsProps> = ({
  currentMode,
  onModeChange,
  onResetDemoData,
}) => {
  const [apiUrl, setApiUrl] = useState(
    import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [modelHealth, setModelHealth] = useState<any>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);

  const loadHealth = async () => {
    try {
      setLoadingHealth(true);
      const data = await fetchModelHealth();
      setModelHealth(data);
    } catch (err: any) {
      setModelHealth({ error: err.message || 'Failed to query model health' });
    } finally {
      setLoadingHealth(false);
    }
  };

  useEffect(() => {
    loadHealth();
  }, [currentMode]);

  const handleSwitchMode = (mode: DataSourceMode) => {
    setDataSourceMode(mode);
    onModeChange(mode);
    setStatusMessage(
      mode === 'LIVE_BACKEND'
        ? 'Switched to Live Backend Mode. Will query backend at ' + apiUrl
        : 'Switched to Deterministic Demo Mock Mode.'
    );
    setTimeout(() => setStatusMessage(null), 4000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="p-1 rounded bg-indigo-50 text-indigo-700">
            <Settings className="w-4 h-4" />
          </span>
          <h1 className="text-lg font-bold text-slate-900">
            Platform Settings & Backend Integrations
          </h1>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Configure API contracts with teammate backend, toggle between live and deterministic simulation mode, and manage courier webhooks.
        </p>
      </div>

      {statusMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-xs text-emerald-800 font-semibold animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Backend Mode Switcher */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Server className="w-4 h-4 text-indigo-600" />
              <span>Data Source Environment</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Switch between local demo mock adapter and Person 2 backend REST API.
            </p>
          </div>

          <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            <button
              onClick={() => handleSwitchMode('DEMO_MOCK')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                currentMode === 'DEMO_MOCK'
                  ? 'bg-white text-purple-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Demo Simulation Mode
            </button>
            <button
              onClick={() => handleSwitchMode('LIVE_BACKEND')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                currentMode === 'LIVE_BACKEND'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Live Backend API
            </button>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-slate-700">Target Backend Base URL:</span>
            <span className="font-mono text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
              {apiUrl}
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            Configurable via <code className="text-indigo-600 font-mono">VITE_API_BASE_URL</code> in environment file. If the live backend is unreachable, the dashboard shows a connection error so mock data is not mistaken for live data.
          </p>
        </div>

        {/* Reset Demo Data Action */}
        <div className="pt-2 flex items-center justify-between border-t border-slate-100">
          <div>
            <h4 className="text-xs font-bold text-slate-900">Reset Demo Database</h4>
            <p className="text-[11px] text-slate-500">
              Restore the initial 6 seed orders (healthy, risky COD, NDR, RTO) for a fresh hackathon demo.
            </p>
          </div>

          <button
            onClick={() => {
              onResetDemoData();
              setStatusMessage('Demo database reset to initial pristine hackathon seed state.');
              setTimeout(() => setStatusMessage(null), 4000);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Demo Orders</span>
          </button>
        </div>
      </div>

      {/* Trained ML Model Status & Diagnostics */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Trained CatBoost Model Diagnostics
              </h2>
              <p className="text-xs text-slate-500">
                Live verification of artifact final_model.joblib and inference operating point
              </p>
            </div>
          </div>
          <button
            onClick={loadHealth}
            disabled={loadingHealth}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingHealth ? 'animate-spin' : ''}`} />
            <span>Check Status</span>
          </button>
        </div>

        {modelHealth?.trained_model_loaded ? (
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs">
              <div className="flex items-center gap-2 font-bold text-emerald-900">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Model Engine Loaded & Actively Serving Inference</span>
              </div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[11px] text-slate-700">
                <div className="p-2.5 rounded bg-white border border-emerald-100">
                  <div className="text-slate-400 font-semibold">Estimator</div>
                  <div className="font-mono font-bold text-slate-900">{modelHealth.model_details?.estimator || 'Unavailable'}</div>
                </div>
                <div className="p-2.5 rounded bg-white border border-emerald-100">
                  <div className="text-slate-400 font-semibold">Frozen Threshold</div>
                  <div className="font-mono font-bold text-indigo-700">{modelHealth.model_details?.frozen_threshold ?? 'Unavailable'}</div>
                </div>
                <div className="p-2.5 rounded bg-white border border-emerald-100">
                  <div className="text-slate-400 font-semibold">Tier Cuts (ALLOW/REVIEW/BLOCK)</div>
                  <div className="font-mono font-bold text-slate-900">
                    {modelHealth.model_details?.frozen_tier_cuts
                      ? `${modelHealth.model_details.frozen_tier_cuts.low_cut} / ${modelHealth.model_details.frozen_tier_cuts.high_cut}`
                      : 'Unavailable'}
                  </div>
                </div>
                <div className="p-2.5 rounded bg-white border border-emerald-100">
                  <div className="text-slate-400 font-semibold">SQLite Persisted Records</div>
                  <div className="font-mono font-bold text-slate-900">
                    {modelHealth.database?.orders_count ?? 0} Orders · {modelHealth.database?.predictions_count ?? 0} Preds
                  </div>
                </div>
              </div>
              <div className="mt-2 text-[10px] font-mono text-slate-500 break-all">
                SHA-256 Digest: {modelHealth.model_details?.model_sha256 || 'Unavailable'}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
            <div className="flex items-center gap-2 font-bold">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span>{modelHealth?.error || modelHealth?.message || 'Model service not detected in current mode.'}</span>
            </div>
            <p className="mt-1 text-[11px] text-amber-800">
              Ensure you have selected <strong>Live Backend API</strong> above and the backend server is running on port 8000.
            </p>
          </div>
        )}
      </div>

      <div className="bg-amber-50 rounded-2xl border border-amber-200 p-6 shadow-sm space-y-3">
        <div>
          <h2 className="text-sm font-bold text-amber-950">Offline Model Evaluation</h2>
          <p className="text-xs text-amber-900">
            The model was trained and evaluated on synthetic orders. These offline test results are not
            live-customer performance guarantees.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-lg border border-amber-200 bg-white p-3">
            <div className="text-slate-500">Test orders</div>
            <div className="font-mono font-bold text-slate-900">10,000</div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-white p-3">
            <div className="text-slate-500">Test ROC-AUC</div>
            <div className="font-mono font-bold text-slate-900">0.8060</div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-white p-3">
            <div className="text-slate-500">Precision at 0.37</div>
            <div className="font-mono font-bold text-slate-900">0.4583</div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-white p-3">
            <div className="text-slate-500">Recall at 0.37</div>
            <div className="font-mono font-bold text-slate-900">0.2688</div>
          </div>
        </div>
        <p className="text-[10px] text-amber-900">
          Source: backend/reports/METRICS.md. These fixed offline metrics are separate from the live
          artifact and runtime health checks above.
        </p>
      </div>

      {/* Integration Status Cards */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        <h2 className="text-sm font-bold text-slate-900">Demo Integration Status (not connected to live provider APIs)</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 flex items-start justify-between">
            <div>
              <div className="font-bold text-slate-900">Delhivery Express</div>
              <div className="text-[11px] text-slate-500">Illustrative AWB webhook status</div>
              <div className="text-[10px] text-slate-500 font-semibold mt-2 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> Demo placeholder
              </div>
            </div>
            <Truck className="w-4 h-4 text-slate-400" />
          </div>

          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 flex items-start justify-between">
            <div>
              <div className="font-bold text-slate-900">BlueDart Apex</div>
              <div className="text-[11px] text-slate-500">Illustrative tracking status</div>
              <div className="text-[10px] text-slate-500 font-semibold mt-2 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> Demo placeholder
              </div>
            </div>
            <Truck className="w-4 h-4 text-slate-400" />
          </div>

          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 flex items-start justify-between">
            <div>
              <div className="font-bold text-slate-900">Shopify Storefront</div>
              <div className="text-[11px] text-slate-500">Illustrative storefront status</div>
              <div className="text-[10px] text-slate-500 font-semibold mt-2 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> Demo placeholder
              </div>
            </div>
            <Link2 className="w-4 h-4 text-slate-400" />
          </div>
        </div>
      </div>

      {/* Backend API Contract Specification (Person 2 Coordination) */}
      <div className="bg-slate-900 text-slate-300 rounded-2xl p-6 shadow-sm border border-slate-800 space-y-3">
        <div className="flex items-center gap-2 text-white">
          <Code2 className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-bold">Person 2 Backend Coordination Contract</h3>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          The frontend service adapter layer is wired for the following agreed REST contract endpoints:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
          <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
            <span className="text-emerald-400 font-bold">GET</span> /api/dashboard/summary
          </div>
          <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
            <span className="text-emerald-400 font-bold">GET</span> /api/orders
          </div>
          <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
            <span className="text-emerald-400 font-bold">GET</span> /api/orders/:id
          </div>
          <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
            <span className="text-indigo-400 font-bold">POST</span> /api/orders/:id/actions
          </div>
          <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
            <span className="text-indigo-400 font-bold">POST</span> /api/orders/:id/events
          </div>
          <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
            <span className="text-indigo-400 font-bold">POST</span> /api/orders/:id/ndr/recovery
          </div>
        </div>
      </div>
    </div>
  );
};
