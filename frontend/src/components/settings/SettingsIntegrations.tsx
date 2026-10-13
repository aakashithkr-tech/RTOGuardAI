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
  Key,
  Copy,
  Check,
  ShieldAlert,
  Terminal,
  Globe,
  Layers,
  Clock,
  Zap,
  Trash2,
  Lock,
  ChevronDown,
  ChevronUp,
  History,
  Shield,
  ArrowUpRight,
  Info,
  X,
  CreditCard,
} from 'lucide-react';
import { DataSourceMode, getDataSourceMode, setDataSourceMode } from '../../services/apiClient';
import { fetchModelHealth } from '../../services/ordersApi';
import {
  getStoredKeys,
  generateNewKeys,
  rotateApiKey,
  revokeApiKey,
  fetchBillingUsage,
  fetchAuditLogs,
  createBillingOrder,
  verifyBillingPayment,
  MerchantUser,
  MerchantProfile,
  ApiKeyItem,
  BillingUsage,
  AuditLogItem,
} from '../../services/authApi';

interface SettingsIntegrationsProps {
  currentMode: DataSourceMode;
  onModeChange: (newMode: DataSourceMode) => void;
  onResetDemoData: () => void;
  currentUser?: MerchantUser | null;
  currentMerchant?: MerchantProfile | null;
  onOpenAuthModal?: () => void;
}

export const SettingsIntegrations: React.FC<SettingsIntegrationsProps> = ({
  currentMode,
  onModeChange,
  onResetDemoData,
  currentUser,
  currentMerchant,
  onOpenAuthModal,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'platform' | 'integrate'>('integrate');
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);
  const [keys, setKeys] = useState<ApiKeyItem[] | null>(currentMerchant?.keys || getStoredKeys());
  const [isGeneratingKeys, setIsGeneratingKeys] = useState(false);

  // Billing & Usage Metering
  const [usage, setUsage] = useState<BillingUsage | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);

  // Audit Logs
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [showAuditLogs, setShowAuditLogs] = useState(false);

  // One-time Key Reveal Modal
  const [revealModal, setRevealModal] = useState<{
    isOpen: boolean;
    secretKey: string;
    publicKey?: string;
    overlapUntil?: string | null;
    warning?: string;
  }>({
    isOpen: false,
    secretKey: '',
    publicKey: '',
  });

  // Rotation Modal
  const [rotateModal, setRotateModal] = useState<{
    isOpen: boolean;
    keyItem: ApiKeyItem | null;
    overlapHours: number;
    isSubmitting: boolean;
  }>({
    isOpen: false,
    keyItem: null,
    overlapHours: 24,
    isSubmitting: false,
  });

  // Upgrade Modal
  const [upgradeModal, setUpgradeModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'free' | 'premium'>('premium');
  const [isUpgrading, setIsUpgrading] = useState(false);

  // Integration snippet language
  const [codeTab, setCodeTab] = useState<
    'curl' | 'node' | 'python' | 'php' | 'shopify' | 'woocommerce' | 'sdk'
  >('curl');

  const [apiUrl, setApiUrl] = useState(
    import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modelHealth, setModelHealth] = useState<any>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);

  const loadUsageAndLogs = async () => {
    if (!currentUser) return;
    try {
      setLoadingUsage(true);
      const [usageData, logsData] = await Promise.all([
        fetchBillingUsage(),
        fetchAuditLogs(),
      ]);
      if (usageData) setUsage(usageData);
      if (logsData) setAuditLogs(logsData);
    } catch {
      // ignore
    } finally {
      setLoadingUsage(false);
    }
  };

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

  useEffect(() => {
    if (currentUser) {
      loadUsageAndLogs();
      if (currentMerchant?.keys) {
        setKeys(currentMerchant.keys);
      }
    }
  }, [currentUser, currentMerchant]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSnippet(id);
    setTimeout(() => setCopiedSnippet(null), 2500);
  };

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

  // Generate Key Pair
  const handleGenerateKey = async () => {
    try {
      setIsGeneratingKeys(true);
      const res = await generateNewKeys({ name: 'Default Storefront Key Pair' });
      setKeys(res.keys);

      if (res.secret_key_revealed) {
        const pk = res.keys.find((k) => k.type === 'public')?.key;
        setRevealModal({
          isOpen: true,
          secretKey: res.secret_key_revealed,
          publicKey: pk,
          warning: res.warning || 'Save your secret key now. It will NEVER be shown again.',
        });
      }

      await loadUsageAndLogs();
      setStatusMessage('Successfully generated a fresh API key pair.');
      setTimeout(() => setStatusMessage(null), 3500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Key generation failed');
      setTimeout(() => setErrorMessage(null), 4500);
    } finally {
      setIsGeneratingKeys(false);
    }
  };

  // Rotate Key
  const handleConfirmRotate = async () => {
    if (!rotateModal.keyItem) return;
    try {
      setRotateModal((prev) => ({ ...prev, isSubmitting: true }));
      const overlap = usage?.can_rotate_with_overlap ? rotateModal.overlapHours : 0;
      const res = await rotateApiKey({
        old_key_id: rotateModal.keyItem.id,
        overlap_hours: overlap,
      });

      setKeys(res.keys);
      setRotateModal({ isOpen: false, keyItem: null, overlapHours: 24, isSubmitting: false });

      if (res.secret_key_revealed || res.new_secret_key) {
        const pk = res.keys.find((k) => k.type === 'public')?.key;
        setRevealModal({
          isOpen: true,
          secretKey: res.secret_key_revealed || res.new_secret_key || '',
          publicKey: pk,
          overlapUntil: res.overlap_expires_at,
          warning:
            'A new key pair has been issued. Copy your new secret key now! It will NEVER be shown again.',
        });
      }

      await loadUsageAndLogs();
      setStatusMessage('API Key rotated successfully.');
      setTimeout(() => setStatusMessage(null), 3500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Key rotation failed');
      setTimeout(() => setErrorMessage(null), 4500);
      setRotateModal((prev) => ({ ...prev, isSubmitting: false }));
    }
  };

  // Revoke Key
  const handleRevokeKey = async (keyItem: ApiKeyItem) => {
    if (
      !window.confirm(
        `Are you sure you want to permanently revoke API key ${keyItem.id}? Any checkout systems using this key will immediately receive 401 Unauthorized errors.`
      )
    ) {
      return;
    }

    try {
      await revokeApiKey(keyItem.id);
      setKeys((prev) =>
        prev
          ? prev.map((k) =>
              k.id === keyItem.id ? { ...k, revoked: true, revoked_at: new Date().toISOString() } : k
            )
          : null
      );
      await loadUsageAndLogs();
      setStatusMessage(`Key ${keyItem.id} revoked.`);
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Key revocation failed');
      setTimeout(() => setErrorMessage(null), 4000);
    }
  };

  // Plan Upgrade
  const handleUpgradePlan = async (targetPlan: string = 'premium') => {
    if (targetPlan === 'free' && usage?.plan === 'free') {
      setStatusMessage('You are already active on the Free Plan (100 req/mo).');
      setUpgradeModal(false);
      return;
    }

    try {
      setIsUpgrading(true);
      const order = await createBillingOrder(targetPlan);

      // In development, free plan, or simulated mode:
      if (targetPlan === 'free' || order.provider === 'simulated' || !window.Razorpay) {
        const verifyRes = await verifyBillingPayment({
          order_id: order.order_id,
          payment_id: 'pay_' + Math.random().toString(36).substring(2, 9),
          signature: 'sim_signature',
          plan: targetPlan,
        });

        setStatusMessage(
          verifyRes.message ||
            (targetPlan === 'free'
              ? 'Active plan set to Free Plan (100 req/mo).'
              : 'Upgraded to Premium successfully!')
        );
        setUpgradeModal(false);
        await loadUsageAndLogs();
      } else {
        // Razorpay modal
        const options = {
          key: order.key_id,
          amount: order.amount,
          currency: order.currency,
          name: 'RTOGuardAI',
          description: 'Premium Developer Subscription (5,000 API requests/month)',
          order_id: order.order_id,
          handler: async function (response: any) {
            try {
              const verifyRes = await verifyBillingPayment({
                order_id: response.razorpay_order_id,
                payment_id: response.razorpay_payment_id,
                signature: response.razorpay_signature,
                plan: targetPlan,
              });
              setStatusMessage(verifyRes.message);
              setUpgradeModal(false);
              await loadUsageAndLogs();
            } catch (err: any) {
              setErrorMessage(err.message || 'Verification failed');
            }
          },
          modal: {
            ondismiss: function () {
              setIsUpgrading(false);
            },
          },
          prefill: {
            name: currentUser?.name || 'Merchant',
            email: currentUser?.email || 'merchant@example.com',
          },
          theme: { color: '#4f46e5' },
        };
        const rzp = new (window as any).Razorpay(options);
        rzp.open();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Upgrade failed');
    } finally {
      setIsUpgrading(false);
    }
  };

  // Active public key for code snippets
  const activePublicKey =
    keys?.find((k) => k.type === 'public' && !k.revoked)?.key || 'pk_live_YOUR_PUBLIC_KEY';

  // Multi-Language Integration Snippets
  const snippets: Record<string, string> = {
    curl: `curl -X POST "http://localhost:8000/v1/score" \\
  -H "Authorization: Bearer sk_live_YOUR_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "pincode": "110001",
    "address_line": "Connaught Place, Central Delhi",
    "order_value": 2499,
    "category": "fashion",
    "is_cod": true,
    "customer_history": {
      "past_orders": 4,
      "past_rto_count": 0,
      "account_age_days": 120.0,
      "order_velocity_24h": 1
    }
  }'`,

    node: `// Node.js / Express Checkout Middleware
const axios = require('axios');

async function evaluateRTO(orderData) {
  try {
    const response = await axios.post('http://localhost:8000/v1/score', {
      pincode: orderData.shipping_pincode,
      address_line: orderData.shipping_address,
      order_value: orderData.subtotal,
      category: orderData.category || 'general',
      is_cod: orderData.payment_method === 'cod',
      customer_history: {
        past_orders: orderData.customer.total_orders || 0,
        past_rto_count: orderData.customer.rto_count || 0
      }
    }, {
      headers: {
        'Authorization': \`Bearer \${process.env.RTOGUARD_SECRET_KEY}\`,
        'Content-Type': 'application/json'
      },
      timeout: 2500 // Fail open gracefully if network times out
    });

    const decision = response.data;
    return {
      allowed: decision.cod_available,
      tier: decision.tier,           // 'ALLOW' | 'REVIEW' | 'BLOCK'
      risk: decision.rto_probability,
      codFee: decision.cod_fee_inr,
      reasons: decision.reasons
    };
  } catch (error) {
    console.error('RTOGuard scoring fallback:', error.message);
    // Fail open safely so customer checkout never gets blocked
    return { allowed: true, tier: 'ALLOW', risk: 0.05, codFee: 0 };
  }
}`,

    python: `# Python / FastAPI / Django Integration
import requests

def get_rto_decision(order):
    payload = {
        "pincode": str(order["pincode"]),
        "address_line": order["address"],
        "order_value": float(order["total_amount"]),
        "category": order.get("category", "general"),
        "is_cod": order.get("payment_method") == "cod",
        "customer_history": {
            "past_orders": order["customer"].get("orders_count", 0),
            "past_rto_count": order["customer"].get("rto_count", 0),
        }
    }
    
    headers = {
        "Authorization": f"Bearer {os.environ.get('RTOGUARD_SECRET_KEY')}",
        "Content-Type": "application/json"
    }

    try:
        response = requests.post("http://localhost:8000/v1/score", json=payload, headers=headers, timeout=2.0)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as exc:
        # Graceful fallback: return safe ALLOW
        return {"tier": "ALLOW", "cod_available": True, "rto_probability": 0.05}
`,

    php: `<?php
// PHP / Laravel Checkout Gateway Gate
function evaluateRTORisk($order) {
    $apiUrl = 'http://localhost:8000/v1/score';
    $secretKey = env('RTOGUARD_SECRET_KEY');

    $payload = json_encode([
        'pincode' => $order->shipping_pincode,
        'address_line' => $order->shipping_address,
        'order_value' => (float)$order->total,
        'category' => 'apparel',
        'is_cod' => ($order->payment_method === 'cod')
    ]);

    $ch = curl_init($apiUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_TIMEOUT, 2);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Authorization: Bearer ' . $secretKey,
        'Content-Type: application/json'
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200) {
        $result = json_decode($response, true);
        return $result['cod_available'];
    }

    // Fail open default
    return true;
}
?>`,

    shopify: `<!-- Shopify Storefront Checkout Liquid & Script -->
<!-- In your theme.liquid or checkout.liquid: -->
<script src="http://localhost:8000/rtoguard.js" data-key="${activePublicKey}"></script>

<script>
document.addEventListener("DOMContentLoaded", function() {
  const pincodeInput = document.getElementById("checkout_shipping_address_zip");
  
  if (pincodeInput) {
    pincodeInput.addEventListener("blur", function() {
      if (this.value.length === 6) {
        RTOGuard.score({
          pincode: this.value,
          orderValue: Shopify.Checkout.estimatedPrice || 1999
        }).then(function(decision) {
          const codOption = document.querySelector('input[data-backup="manual"]');
          if (codOption && !decision.cod_available) {
            codOption.disabled = true;
            codOption.closest('.radio-wrapper').style.opacity = '0.5';
          }
        });
      }
    });
  }
});
</script>`,

    woocommerce: `<?php
/**
 * WooCommerce functions.php Hook: Conditionally Disable COD on High RTO Risk
 */
add_filter('woocommerce_available_payment_gateways', 'rtoguard_filter_cod_gateway');

function rtoguard_filter_cod_gateway($gateways) {
    if (is_admin()) return $gateways;
    if (!isset($gateways['cod'])) return $gateways;

    $pincode = WC()->customer->get_shipping_postcode();
    $total   = WC()->cart->get_total('edit');

    if (strlen($pincode) === 6) {
        $response = wp_remote_post('http://localhost:8000/v1/score', [
            'timeout' => 2,
            'headers' => [
                'Authorization' => 'Bearer ' . get_option('rtoguard_secret_key'),
                'Content-Type'  => 'application/json'
            ],
            'body' => json_encode([
                'pincode'     => $pincode,
                'order_value' => (float)$total,
                'is_cod'      => true
            ])
        ]);

        if (!is_wp_error($response)) {
            $data = json_decode(wp_remote_retrieve_body($response), true);
            if (isset($data['cod_available']) && !$data['cod_available']) {
                unset($gateways['cod']); // Disable COD on high risk
            }
        }
    }

    return $gateways;
}
?>`,

    sdk: `<!-- Embed rtoguard.js directly before closing </body> -->
<script src="http://localhost:8000/rtoguard.js" data-key="${activePublicKey}"></script>

<!-- Place automatic COD / Prepaid Dynamic Widget on checkout form -->
<div data-rtoguard-checkout 
     data-pincode-input="#pincode" 
     data-amount-input="#order-total">
</div>

<script>
// Or trigger programmatically:
RTOGuard.score({
  pincode: "110001",
  address: "Barakhamba Road, Connaught Place",
  orderValue: 2499,
  category: "fashion"
}).then(function(result) {
  console.log("Tier:", result.tier);                 // 'ALLOW' | 'REVIEW' | 'BLOCK'
  console.log("COD Available:", result.cod_available); // true | false
  console.log("Summary:", result.summary);
});
</script>`,
  };

  const sampleResponse = `{
  "api_version": "v1",
  "request_id": "req_a8f920bc48324f11",
  "tier": "ALLOW",
  "rto_probability": 0.042,
  "reasons": [
    "Established buyer history with zero prior delivery failures",
    "High delivery density serviceable metro pin"
  ],
  "recommended_action": "allow",
  "cod_available": true,
  "cod_fee_inr": 0.0,
  "prepaid_discount_inr": 0.0,
  "message": "Standard Cash on Delivery is approved. Zero additional checkout friction.",
  "summary": "ALLOW tier: 4.2% return probability. COD is available."
}`;

  return (
    <div className="space-y-6">
      {/* Top Header & Navigation */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-700">
                <Settings className="w-4 h-4" />
              </span>
              <h1 className="text-lg font-bold text-slate-900">
                Platform Settings & API Integration
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Manage your merchant API keys, subscription quotas, or integrate RTOGuard scoring into any storefront.
            </p>
          </div>

          {/* Subtab Switcher */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-semibold self-start sm:self-auto">
            <button
              onClick={() => setActiveSubTab('integrate')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
                activeSubTab === 'integrate'
                  ? 'bg-white text-indigo-700 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Key className="w-3.5 h-3.5" />
              <span>API / Integrate</span>
            </button>
            <button
              onClick={() => setActiveSubTab('platform')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
                activeSubTab === 'platform'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Diagnostics & Environment</span>
            </button>
          </div>
        </div>
      </div>

      {statusMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between text-xs text-emerald-800 font-semibold animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{statusMessage}</span>
          </div>
          <button onClick={() => setStatusMessage(null)} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between text-xs text-rose-800 font-semibold animate-fadeIn">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-rose-700 hover:text-rose-900">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUBTAB 1: API / INTEGRATE (MERCHANT INTEGRATION & KEYS)                    */}
      {/* ========================================================================= */}
      {activeSubTab === 'integrate' && (
        <div className="space-y-6">
          {/* Plan & Usage Metering Hero Card */}
          {currentUser && (
            <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 text-white rounded-2xl p-6 shadow-sm border border-indigo-800/40 space-y-5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                        usage?.plan === 'premium'
                          ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                          : 'bg-indigo-500/20 text-indigo-300 border border-indigo-400/30'
                      }`}
                    >
                      <Sparkles className="w-3 h-3" />
                      {usage?.plan_name || 'Free Plan'}
                    </span>
                    <span className="text-xs text-slate-400">
                      • {currentUser.name} ({currentMerchant?.name || 'Store'})
                    </span>
                  </div>
                  <h2 className="text-lg font-bold text-white mt-1">
                    API Usage & Monthly Quota Entitlements
                  </h2>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Production RTO risk scoring queries are metered atomically per billing month.
                  </p>
                </div>

                <div className="flex items-center gap-2 self-start md:self-auto">
                  {usage?.plan === 'premium' ? (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-xs font-semibold">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span>Premium Active</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => setUpgradeModal(true)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
                    >
                      <Zap className="w-3.5 h-3.5 text-amber-300" />
                      <span>Upgrade to Premium (₹4,999/mo)</span>
                    </button>
                  )}
                  <button
                    onClick={loadUsageAndLogs}
                    className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 transition-colors"
                    title="Refresh Usage"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingUsage ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Progress Bar & Metric Pills */}
              <div className="space-y-2 bg-white/5 p-4 rounded-xl border border-white/10">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-medium">
                    Monthly Billable Requests:{' '}
                    <strong className="text-white font-bold">
                      {usage ? usage.used_this_month.toLocaleString() : 0}
                    </strong>{' '}
                    /{' '}
                    <span className="text-slate-400">
                      {usage ? usage.monthly_quota.toLocaleString() : 100}
                    </span>
                  </span>
                  <span className="font-bold text-indigo-300">
                    {usage ? usage.quota_percentage : 0}% used
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      (usage?.quota_percentage || 0) >= 90
                        ? 'bg-rose-500'
                        : (usage?.quota_percentage || 0) >= 70
                        ? 'bg-amber-400'
                        : 'bg-indigo-500'
                    }`}
                    style={{ width: `${Math.min(100, usage?.quota_percentage || 0)}%` }}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 pt-1">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-slate-400" />
                    <span>
                      Quota resets in{' '}
                      <strong className="text-slate-200">
                        {usage?.days_until_reset || 30} days
                      </strong>{' '}
                      ({usage?.reset_at ? usage.reset_at.split('T')[0] : 'end of month'})
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span>
                      Remaining:{' '}
                      <strong className="text-white">
                        {usage ? usage.remaining.toLocaleString() : 100} reqs
                      </strong>
                    </span>
                    <span>•</span>
                    <span>
                      Active Keys:{' '}
                      <strong className="text-white">
                        {usage?.keys_count || 0}/{usage?.max_keys || 1} pairs
                      </strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* Entitlement Highlights */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
                <div className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-indigo-300 tracking-wider">
                    Rate Limit
                  </span>
                  <div className="text-white font-semibold flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>{usage?.plan === 'premium' ? '300 req/min' : '60 req/min'}</span>
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-indigo-300 tracking-wider">
                    Max Key Pairs
                  </span>
                  <div className="text-white font-semibold flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{usage?.plan === 'premium' ? '5 Key Pairs' : '1 Key Pair'}</span>
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-indigo-300 tracking-wider">
                    Zero-Downtime Rotation
                  </span>
                  <div className="text-white font-semibold flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>
                      {usage?.can_rotate_with_overlap
                        ? '24-Hour Overlap Grace'
                        : 'Immediate (Upgrade for Overlap)'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Active Merchant API Credentials Section */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Key className="w-4 h-4 text-indigo-600" />
                  <span>Merchant API Credentials</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {currentUser
                    ? `Public and masked secret keys for ${currentMerchant?.name || currentUser.name}.`
                    : 'Sign in to generate isolated merchant API credentials.'}
                </p>
              </div>

              {currentUser ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleGenerateKey}
                    disabled={Boolean(isGeneratingKeys || (usage && usage.keys_count >= usage.max_keys * 2))}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors disabled:opacity-50"
                  >
                    <Key className="w-3.5 h-3.5" />
                    <span>
                      {isGeneratingKeys ? 'Issuing...' : 'Generate Key Pair'}
                    </span>
                  </button>
                  <button
                    onClick={() => setShowAuditLogs(!showAuditLogs)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors"
                  >
                    <History className="w-3.5 h-3.5" />
                    <span>Audit Log</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={onOpenAuthModal}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Sign In / 1-Click Judge Demo</span>
                </button>
              )}
            </div>

            {/* Security Notice: Secret keys are masked */}
            <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200/80 text-xs text-amber-900 flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1 text-[11px] leading-relaxed">
                <span className="font-bold text-amber-950 block">
                  Security Invariant: Secret Keys Are Permanently Masked
                </span>
                <span>
                  Secret keys (<code>sk_...</code>) are shown in plaintext <strong>only once</strong> at creation or rotation. They are cryptographically hashed and never stored or returned in full by the backend. Use rotation if a secret key is compromised or misplaced.
                </span>
              </div>
            </div>

            {/* Keys Table / List */}
            {currentUser && keys && keys.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold">
                      <th className="py-2.5 px-4">Key Type & Purpose</th>
                      <th className="py-2.5 px-4">Identifier / Value</th>
                      <th className="py-2.5 px-4">Status</th>
                      <th className="py-2.5 px-4">Last Used</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {keys.map((k) => {
                      const isRevoked = k.revoked || !!k.revoked_at;
                      const isExpiring = k.expires_at && !isRevoked;
                      const isPublic = k.type === 'public';

                      return (
                        <tr
                          key={k.id}
                          className={`hover:bg-slate-50/80 transition-colors ${
                            isRevoked ? 'opacity-50 bg-slate-50/40' : ''
                          }`}
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  isRevoked
                                    ? 'bg-rose-500'
                                    : isExpiring
                                    ? 'bg-amber-400'
                                    : isPublic
                                    ? 'bg-emerald-500'
                                    : 'bg-indigo-500'
                                }`}
                              />
                              <div>
                                <span className="font-bold text-slate-900 block">
                                  {isPublic ? 'Public Key' : 'Secret Key'}
                                </span>
                                <span className="text-[10px] text-slate-500">
                                  {isPublic
                                    ? 'Browser / SDK (Storefront)'
                                    : 'Server-to-Server Only'}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-4 font-mono">
                            <div className="flex items-center gap-2">
                              <span className="bg-slate-100 px-2 py-1 rounded text-slate-900 text-xs border border-slate-200 select-all">
                                {k.key || `${k.prefix}••••••••••••••••••••••••`}
                              </span>
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            {isRevoked ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">
                                Revoked
                              </span>
                            ) : isExpiring ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                                Expiring {k.expires_at?.split('T')[1]?.slice(0, 5)}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">
                                Active
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-slate-500 text-[11px]">
                            {k.last_used_at
                              ? new Date(k.last_used_at).toLocaleDateString() +
                                ' ' +
                                new Date(k.last_used_at).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : 'Never used'}
                          </td>

                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Copy Button */}
                              {isPublic && k.key ? (
                                <button
                                  onClick={() => handleCopy(k.key!, k.id)}
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                                  title="Copy Public Key"
                                >
                                  {copiedSnippet === k.id ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              ) : null}

                              {/* Rotate Key Button */}
                              {!isRevoked && (
                                <button
                                  onClick={() =>
                                    setRotateModal({
                                      isOpen: true,
                                      keyItem: k,
                                      overlapHours: usage?.can_rotate_with_overlap ? 24 : 0,
                                      isSubmitting: false,
                                    })
                                  }
                                  className="p-1.5 rounded-lg text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 transition-colors"
                                  title="Rotate Key"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* Revoke Key Button */}
                              {!isRevoked && (
                                <button
                                  onClick={() => handleRevokeKey(k)}
                                  className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                                  title="Revoke Key Permanently"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : !currentUser ? (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between gap-3">
                <span>
                  Using mock credentials for preview. Sign in to issue and manage production API credentials.
                </span>
                <button
                  onClick={onOpenAuthModal}
                  className="font-bold text-indigo-600 hover:text-indigo-800 text-xs underline shrink-0"
                >
                  Authenticate Now →
                </button>
              </div>
            ) : (
              <div className="p-4 text-center rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500">
                No API keys issued yet. Click "Generate Key Pair" to create your credentials.
              </div>
            )}

            {/* Audit Logs Drawer / Collapsible */}
            {showAuditLogs && (
              <div className="p-4 rounded-xl bg-slate-900 text-slate-200 text-xs space-y-3 animate-fadeIn">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-indigo-400" />
                    <span className="font-bold text-white">Merchant Security Audit Log</span>
                  </div>
                  <button
                    onClick={() => setShowAuditLogs(false)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {auditLogs.length === 0 ? (
                  <p className="text-[11px] text-slate-400">No security audit events logged yet.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto font-mono text-[11px]">
                    {auditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-start justify-between p-2 rounded bg-slate-950/60 border border-slate-800"
                      >
                        <div>
                          <span className="text-indigo-400 font-semibold">{log.action}</span>
                          {log.key_id && (
                            <span className="text-slate-400 ml-2">key: {log.key_id}</span>
                          )}
                          {log.details && (
                            <span className="text-slate-500 ml-2">
                              {JSON.stringify(log.details)}
                            </span>
                          )}
                        </div>
                        <span className="text-slate-500 shrink-0 ml-3">
                          {new Date(log.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Multi-Language Developer Integration Guides */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-indigo-600" />
                  <span>Platform-Independent Checkout Integration</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Connect RTOGuard scoring to any store (Shopify, WooCommerce, custom Node/Python/PHP backend).
                </p>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href="/integration-demo.html"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-lg transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Live Storefront Demo</span>
                </a>
                <button
                  onClick={() => handleCopy(snippets[codeTab], codeTab)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  {copiedSnippet === codeTab ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedSnippet === codeTab ? 'Copied' : 'Copy Snippet'}</span>
                </button>
              </div>
            </div>

            {/* Language Selector Pills */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 pb-3 text-xs font-semibold">
              {[
                { id: 'curl', label: 'cURL / REST' },
                { id: 'node', label: 'Node.js / Express' },
                { id: 'python', label: 'Python' },
                { id: 'php', label: 'PHP / Laravel' },
                { id: 'shopify', label: 'Shopify Storefront' },
                { id: 'woocommerce', label: 'WooCommerce' },
                { id: 'sdk', label: 'Browser JS (rtoguard.js)' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setCodeTab(tab.id as any)}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    codeTab === tab.id
                      ? 'bg-indigo-600 text-white shadow-xs font-bold'
                      : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Code Box */}
            <pre className="p-4 rounded-xl bg-slate-950 text-slate-200 font-mono text-xs overflow-x-auto leading-relaxed border border-slate-800 max-h-80">
              {snippets[codeTab]}
            </pre>
          </div>

          {/* Response Contract & Error Handling Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Stable Response Schema */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-900 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Documented Success Response Contract</span>
                </h4>
                <button
                  onClick={() => handleCopy(sampleResponse, 'resp')}
                  className="text-xs text-slate-500 hover:text-slate-800 font-semibold flex items-center gap-1"
                >
                  {copiedSnippet === 'resp' ? (
                    <Check className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>Copy</span>
                </button>
              </div>
              <pre className="p-3.5 rounded-xl bg-slate-950 text-emerald-400 font-mono text-[11px] overflow-x-auto leading-relaxed border border-slate-800 max-h-72">
                {sampleResponse}
              </pre>
            </div>

            {/* Error Contract & Rate Limits */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-3">
              <h4 className="text-xs font-bold text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-600" />
                <span>Error Codes & Quota Enforcement</span>
              </h4>
              <p className="text-xs text-slate-500">
                All error responses return standardized JSON with RFC-compliant HTTP status codes:
              </p>
              <div className="p-3 rounded-lg bg-slate-950 text-rose-300 font-mono text-[11px] border border-slate-800">
                {`{\n  "error": {\n    "code": "quota_exceeded",\n    "message": "Monthly API quota of 100 requests exceeded. Please upgrade to Premium."\n  }\n}`}
              </div>

              <div className="space-y-1.5 text-[11px] text-slate-700 pt-1">
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="font-mono font-bold text-slate-900">401 Unauthorized</span>
                  <span className="text-slate-500">Missing, invalid, or revoked API key</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="font-mono font-bold text-slate-900">403 Forbidden</span>
                  <span className="text-slate-500">Public key Origin not in allowed_domains</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="font-mono font-bold text-slate-900">429 quota_exceeded</span>
                  <span className="text-slate-500">Monthly plan limit breached (resets on 1st of month)</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="font-mono font-bold text-slate-900">429 rate_limit_exceeded</span>
                  <span className="text-slate-500">Burst rate limit hit (60 req/min Free, 300 Premium)</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="font-mono font-bold text-slate-900">503 Unavailable</span>
                  <span className="text-slate-500">Model pipeline error; client fails open safely</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUBTAB 2: ENVIRONMENT & MODEL DIAGNOSTICS (PLATFORM VIEW)                 */}
      {/* ========================================================================= */}
      {activeSubTab === 'platform' && (
        <div className="space-y-6">
          {/* Backend Mode Switcher */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Server className="w-4 h-4 text-indigo-600" />
                  <span>Data Source Environment</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Switch between local demo mock adapter and backend REST API.
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
                In Live Backend Mode, network requests query the FastAPI service on <code>/v1/score</code> and <code>/api/*</code>.
              </p>
            </div>
          </div>

          {/* Model Health Diagnostics */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-indigo-600" />
                  <span>CatBoost ML Model Artifact Diagnostics</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Real-time pipeline health check for risk scoring models.
                </p>
              </div>

              <button
                onClick={loadHealth}
                disabled={loadingHealth}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingHealth ? 'animate-spin' : ''}`} />
                <span>Recheck Model</span>
              </button>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 text-slate-200 font-mono text-xs overflow-x-auto leading-relaxed border border-slate-800">
              {loadingHealth ? (
                <span>Checking ML model pipeline status...</span>
              ) : modelHealth ? (
                JSON.stringify(modelHealth, null, 2)
              ) : (
                <span>Diagnostics unavailable.</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: ONE-TIME SECRET KEY REVEAL                                        */}
      {/* ========================================================================= */}
      {revealModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-scaleUp">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-slate-900">
                <span className="p-2 rounded-xl bg-emerald-50 text-emerald-700">
                  <Key className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold">New Secret Key Generated</h3>
                  <span className="text-xs text-slate-500">One-time reveal</span>
                </div>
              </div>
            </div>

            {/* Critical Security Warning */}
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1 text-[11px] leading-relaxed">
                <span className="font-bold text-rose-950 block">Save This Key Now</span>
                <span>
                  {revealModal.warning ||
                    'For security reasons, RTOGuardAI will NEVER display this secret key again. If you close this window without saving it, you will need to rotate the key pair.'}
                </span>
              </div>
            </div>

            {/* Secret Key Input Box */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">Secret Key (Server-to-Server)</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={revealModal.secretKey}
                  className="w-full font-mono text-xs p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 select-all"
                />
                <button
                  onClick={() => handleCopy(revealModal.secretKey, 'modal-sk')}
                  className="px-3.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
                >
                  {copiedSnippet === 'modal-sk' ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedSnippet === 'modal-sk' ? 'Copied' : 'Copy Key'}</span>
                </button>
              </div>
            </div>

            {/* Public Key Display */}
            {revealModal.publicKey && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">Public Key (Browser SDK)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={revealModal.publicKey}
                    className="w-full font-mono text-xs p-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 select-all"
                  />
                  <button
                    onClick={() => handleCopy(revealModal.publicKey!, 'modal-pk')}
                    className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                  >
                    {copiedSnippet === 'modal-pk' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedSnippet === 'modal-pk' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Overlap reminder if rotated */}
            {revealModal.overlapUntil && (
              <div className="p-3 rounded-xl bg-indigo-50/80 border border-indigo-200 text-xs text-indigo-950 flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>
                  Old key remains valid until{' '}
                  <strong>{new Date(revealModal.overlapUntil).toLocaleString()}</strong> to prevent downtime.
                </span>
              </div>
            )}

            <div className="pt-2">
              <button
                onClick={() =>
                  setRevealModal({ isOpen: false, secretKey: '', publicKey: '' })
                }
                className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                I have saved my secret key securely
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: KEY ROTATION DIALOG                                              */}
      {/* ========================================================================= */}
      {rotateModal.isOpen && rotateModal.keyItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-slate-900">
                <span className="p-2 rounded-xl bg-indigo-50 text-indigo-700">
                  <RotateCcw className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold">Rotate API Key Pair</h3>
                  <span className="text-xs text-slate-500">Key ID: {rotateModal.keyItem.id}</span>
                </div>
              </div>
              <button
                onClick={() =>
                  setRotateModal({ isOpen: false, keyItem: null, overlapHours: 24, isSubmitting: false })
                }
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Rotating issues a brand new API key pair. You can specify an overlap grace period so your active servers continue processing checkouts while you deploy the new key.
            </p>

            {usage?.can_rotate_with_overlap ? (
              <div className="space-y-2 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <label className="text-xs font-bold text-slate-700 block">
                  Grace Period Overlap Duration (Premium Entitlement)
                </label>
                <select
                  value={rotateModal.overlapHours}
                  onChange={(e) =>
                    setRotateModal((prev) => ({
                      ...prev,
                      overlapHours: parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-full text-xs p-2 rounded-lg bg-white border border-slate-200 text-slate-900"
                >
                  <option value={24}>24 Hours (Recommended for zero downtime)</option>
                  <option value={12}>12 Hours</option>
                  <option value={2}>2 Hours</option>
                  <option value={0}>0 Hours (Immediate Revocation of old key)</option>
                </select>
                <span className="text-[10px] text-slate-500 block">
                  Both keys will authenticate successfully during this grace window.
                </span>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
                <span className="font-bold block">Immediate Rotation (Free Plan)</span>
                <span className="text-[11px] block text-amber-800">
                  On the Free plan, old keys are revoked immediately upon rotation. Upgrade to Premium for 24-hour zero-downtime key rotation.
                </span>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() =>
                  setRotateModal({ isOpen: false, keyItem: null, overlapHours: 24, isSubmitting: false })
                }
                className="w-1/2 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRotate}
                disabled={rotateModal.isSubmitting}
                className="w-1/2 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
              >
                {rotateModal.isSubmitting ? 'Rotating...' : 'Confirm & Rotate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: UPGRADE TO PREMIUM PLAN                                           */}
      {/* ========================================================================= */}
      {upgradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-scaleUp">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-amber-50 text-amber-600">
                  <Zap className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Upgrade to RTOGuardAI Premium
                  </h3>
                  <span className="text-xs text-slate-500">
                    High-throughput developer plan for scaling B2C brands
                  </span>
                </div>
              </div>
              <button
                onClick={() => setUpgradeModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Selectable Plan Comparison Grid */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              {/* Free Plan Card */}
              <div
                onClick={() => setSelectedPlan('free')}
                className={`p-4 rounded-xl border-2 transition-all cursor-pointer space-y-2 relative ${
                  selectedPlan === 'free'
                    ? 'border-indigo-600 bg-indigo-50/60 shadow-md ring-2 ring-indigo-500/20'
                    : 'border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-slate-100/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                    Free Plan
                  </span>
                  {usage?.plan === 'free' ? (
                    <span className="bg-emerald-100 text-emerald-800 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                      Current
                    </span>
                  ) : selectedPlan === 'free' ? (
                    <span className="bg-indigo-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                      <Check className="w-2.5 h-2.5" /> Selected
                    </span>
                  ) : null}
                </div>

                <div className="text-xl font-bold text-slate-900">
                  ₹0 <span className="text-xs text-slate-500 font-normal">/ month</span>
                </div>

                <ul className="space-y-1.5 text-[11px] text-slate-600 pt-2 border-t border-slate-200">
                  <li className="flex items-center gap-1.5">
                    <Check className={`w-3 h-3 ${selectedPlan === 'free' ? 'text-indigo-600 font-bold' : 'text-slate-400'} shrink-0`} />
                    <span>100 requests / month</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Check className={`w-3 h-3 ${selectedPlan === 'free' ? 'text-indigo-600 font-bold' : 'text-slate-400'} shrink-0`} />
                    <span>1 API key pair</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Check className={`w-3 h-3 ${selectedPlan === 'free' ? 'text-indigo-600 font-bold' : 'text-slate-400'} shrink-0`} />
                    <span>60 requests / minute</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Check className={`w-3 h-3 ${selectedPlan === 'free' ? 'text-indigo-600 font-bold' : 'text-slate-400'} shrink-0`} />
                    <span>Immediate key rotation</span>
                  </li>
                </ul>
              </div>

              {/* Premium Plan Card */}
              <div
                onClick={() => setSelectedPlan('premium')}
                className={`p-4 rounded-xl border-2 transition-all cursor-pointer space-y-2 relative ${
                  selectedPlan === 'premium'
                    ? 'border-indigo-600 bg-indigo-50/70 shadow-md ring-2 ring-indigo-500/20'
                    : 'border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-slate-100/50'
                }`}
              >
                <span className="absolute -top-2.5 right-3 bg-indigo-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Recommended
                </span>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-900 uppercase tracking-wider block">
                    Premium Plan
                  </span>
                  {usage?.plan === 'premium' ? (
                    <span className="bg-emerald-100 text-emerald-800 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                      Current
                    </span>
                  ) : selectedPlan === 'premium' ? (
                    <span className="bg-indigo-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                      <Check className="w-2.5 h-2.5" /> Selected
                    </span>
                  ) : null}
                </div>

                <div className="text-xl font-bold text-indigo-950">
                  ₹4,999 <span className="text-xs text-slate-500 font-normal">/ month</span>
                </div>

                <ul className="space-y-1.5 text-[11px] text-indigo-950 font-medium pt-2 border-t border-indigo-200">
                  <li className="flex items-center gap-1.5">
                    <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                    <strong>5,000 requests / month</strong>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                    <strong>5 Active API Key Pairs</strong>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                    <strong>300 requests / min burst</strong>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                    <strong>24h Zero-Downtime Rotation</strong>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                    <span>Priority Support & SLA</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500 flex items-center gap-2">
              <Info className="w-4 h-4 text-slate-400 shrink-0" />
              <span>
                Click either plan to select it. In test mode, plan switches complete instantly via simulated verification.
              </span>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setUpgradeModal(false)}
                className="w-1/3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={() => handleUpgradePlan(selectedPlan)}
                disabled={isUpgrading}
                className={`w-2/3 py-2.5 rounded-xl text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/30 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer ${
                  selectedPlan === 'free'
                    ? 'bg-slate-800 hover:bg-slate-700'
                    : 'bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600'
                }`}
              >
                {isUpgrading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Activating Subscription...</span>
                  </>
                ) : selectedPlan === 'free' ? (
                  usage?.plan === 'free' ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Stay on Free Plan (₹0)</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Switch to Free Plan (₹0)</span>
                    </>
                  )
                ) : (
                  <>
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>Confirm Upgrade (₹4,999/mo)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
