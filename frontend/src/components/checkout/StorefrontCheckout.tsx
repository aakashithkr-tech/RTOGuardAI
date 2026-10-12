import React, { useState } from 'react';
import {
  ShoppingBag,
  CreditCard,
  Truck,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  QrCode,
  Smartphone,
  Lock,
} from 'lucide-react';
import { formatCurrency } from '../../utils/formatters';

interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  imageEmoji: string;
  description: string;
}

const SAMPLE_PRODUCTS: Product[] = [
  {
    id: 'prod_1',
    name: 'AeroPulse Pro Running Sneakers',
    category: 'footwear',
    price: 2499,
    imageEmoji: '👟',
    description: 'Lightweight breathable marathon trainers (Black/10)',
  },
  {
    id: 'prod_2',
    name: 'Banarasi Silk Handcrafted Saree',
    category: 'fashion',
    price: 4200,
    imageEmoji: '🥻',
    description: 'Festive pure zari woven silk saree (Crimson Red)',
  },
  {
    id: 'prod_3',
    name: 'Noise-Cancelling Wireless Earbuds',
    category: 'electronics',
    price: 1850,
    imageEmoji: '🎧',
    description: 'Dual-mic ANC with 32-hour playback (Ivory White)',
  },
  {
    id: 'prod_4',
    name: 'Artisan Espresso Beans (1kg)',
    category: 'home_kitchen',
    price: 1450,
    imageEmoji: '☕',
    description: 'Fresh dark-roasted specialty arabica beans',
  },
];

interface Persona {
  label: string;
  badge: string;
  badgeColor: string;
  expectedTier: 'ALLOW' | 'REVIEW' | 'BLOCK';
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  pastOrders: number;
  pastRto: number;
  explanation: string;
}

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name: string; contact: string };
  handler: (response: RazorpaySuccess) => void;
  modal: { ondismiss: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => { open: () => void };
  }
}

const TEST_PERSONAS: Persona[] = [
  {
    label: 'Persona 1: Trusted Repeat Buyer',
    badge: 'Expected: ALLOW',
    badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    expectedTier: 'ALLOW',
    name: 'Pooja Murthy',
    phone: '+91 98200 48291',
    address: 'B-304, Cubbon Park Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
    pastOrders: 6,
    pastRto: 0,
    explanation: 'Tier-1 metro, 6 clean deliveries. Zero RTO history. Safe for unconstrained COD.',
  },
  {
    label: 'Persona 2: Moderate Risk Buyer',
    badge: 'Expected: REVIEW',
    badgeColor: 'bg-amber-100 text-amber-800 border-amber-300',
    expectedTier: 'REVIEW',
    name: 'Rohan Kumar',
    phone: '+91 99100 84729',
    address: 'Near Old Water Tank, Sector 62',
    city: 'Noida',
    state: 'Uttar Pradesh',
    pincode: '201303',
    pastOrders: 4,
    pastRto: 1,
    explanation: 'Tier-1/2, 25% past return rate. Triggers ₹50 COD confirmation fee gate.',
  },
  {
    label: 'Persona 3: High-Risk / Serial RTO Buyer',
    badge: 'Expected: BLOCK',
    badgeColor: 'bg-rose-100 text-rose-800 border-rose-300',
    expectedTier: 'BLOCK',
    name: 'Vikas Tyagi',
    phone: '+91 97112 59281',
    address: 'Near Old Bus Stand, Post Office Gali',
    city: 'Rohtak',
    state: 'Haryana',
    pincode: '124001',
    pastOrders: 1,
    pastRto: 1,
    explanation: 'Tier-3 pincode, 100% past RTO rate. COD disabled; prepaid discount offered.',
  },
];

export const StorefrontCheckout: React.FC<{
  onOrderCreated?: (orderId: string) => void;
}> = ({ onOrderCreated }) => {
  const [selectedProduct, setSelectedProduct] = useState<Product>(SAMPLE_PRODUCTS[0]);
  const [customerName, setCustomerName] = useState(TEST_PERSONAS[0].name);
  const [customerPhone, setCustomerPhone] = useState(TEST_PERSONAS[0].phone);
  const [addressLine, setAddressLine] = useState(TEST_PERSONAS[0].address);
  const [pincode, setPincode] = useState(TEST_PERSONAS[0].pincode);
  const [city, setCity] = useState(TEST_PERSONAS[0].city);
  const [state, setState] = useState(TEST_PERSONAS[0].state);
  const [pastOrders, setPastOrders] = useState(TEST_PERSONAS[0].pastOrders);
  const [pastRto, setPastRto] = useState(TEST_PERSONAS[0].pastRto);

  // Scoring & Dynamic Razorpay Checkout State
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [checkoutDecision, setCheckoutDecision] = useState<any | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'COD' | 'RAZORPAY_PREPAID' | null>(null);
  const [isRazorpayModalOpen, setIsRazorpayModalOpen] = useState(false);
  const [isOrderPlaced, setIsOrderPlaced] = useState(false);
  const [placedOrderId, setPlacedOrderId] = useState<string | null>(null);
  const [pendingPaymentOrderId, setPendingPaymentOrderId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleApplyPersona = (p: Persona) => {
    setCustomerName(p.name);
    setCustomerPhone(p.phone);
    setAddressLine(p.address);
    setPincode(p.pincode);
    setCity(p.city);
    setState(p.state);
    setPastOrders(p.pastOrders);
    setPastRto(p.pastRto);
    setCheckoutDecision(null);
    setSelectedPaymentMethod(null);
    setIsOrderPlaced(false);
    setErrorMsg(null);
  };

  const evaluateCheckoutGate = async () => {
    if (!pincode || pincode.trim().length !== 6) {
      setErrorMsg('Please enter a valid 6-digit Indian pincode.');
      return;
    }
    setErrorMsg(null);
    setIsEvaluating(true);
    setCheckoutDecision(null);

    const payload = {
      order_id: `ord_${Date.now()}`,
      customer_id: customerName,
      pincode: pincode.trim(),
      address_line: addressLine,
      category: selectedProduct.category,
      order_value: selectedProduct.price,
      customer_history: {
        past_orders: pastOrders,
        past_rto_count: pastRto,
        account_age_days: 90,
        order_velocity_24h: 1,
      },
    };

    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';
      const rootUrl = apiBase.endsWith('/api') ? apiBase.slice(0, -4) : apiBase;
      const res = await fetch(`${rootUrl}/api/v1/razorpay/checkout-gate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server returned ${res.status}`);
      }

      const data = await res.json();
      setCheckoutDecision(data);
      if (data.tier === 'BLOCK') {
        setSelectedPaymentMethod('RAZORPAY_PREPAID');
      } else {
        setSelectedPaymentMethod('COD');
      }
    } catch (err: any) {
      console.error('Checkout gate error:', err);
      setErrorMsg(err.message || 'Failed to evaluate dynamic checkout gate.');
    } finally {
      setIsEvaluating(false);
    }
  };

  const apiRoot = () => {
    const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';
    return apiBase.endsWith('/api') ? apiBase.slice(0, -4) : apiBase;
  };

  const finishOrder = (orderId: string) => {
    setPlacedOrderId(orderId);
    setIsOrderPlaced(true);
    setIsRazorpayModalOpen(false);
    setPendingPaymentOrderId(null);
    onOrderCreated?.(orderId);
  };

  const verifyRazorpayPayment = async (orderId: string, payment: RazorpaySuccess) => {
    const res = await fetch(`${apiRoot()}/api/v1/razorpay/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: orderId,
        razorpay_order_id: payment.razorpay_order_id,
        razorpay_payment_id: payment.razorpay_payment_id,
        razorpay_signature: payment.razorpay_signature,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Payment verification failed (${res.status}).`);
    }
    finishOrder(orderId);
  };

  const handleCompleteOrder = async (isPrepaid: boolean) => {
    try {
      const orderId = `ord_live_${Date.now().toString().slice(-6)}`;
      const orderNum = `RTO-${Date.now().toString().slice(-4)}`;
      const rootUrl = apiRoot();

      const orderPayload = {
        id: orderId,
        orderNumber: orderNum,
        orderValue: selectedProduct.price,
        paymentMethod: isPrepaid ? 'PREPAID' : 'COD',
        status: 'PENDING',
        deliveryAttempts: 0,
        items: [
          {
            sku: `SKU-${selectedProduct.id}`,
            name: selectedProduct.name,
            quantity: 1,
            unitPrice: selectedProduct.price,
          },
        ],
        customer: {
          name: customerName,
          phoneMasked: customerPhone,
          emailMasked: 'buyer@example.com',
          addressLine: addressLine,
          city: city,
          state: state,
          pincode: pincode,
          pincodeTier: 'TIER_2',
          historicalRtoRate: pastOrders > 0 ? pastRto / pastOrders : 0,
          totalOrdersCount: pastOrders,
          accountAgeDays: 90,
          orderVelocity24h: 1,
        },
        financials: {
          orderValue: selectedProduct.price,
          productCost: Math.round(selectedProduct.price * 0.35),
          forwardShippingCost: 120,
          packagingCost: 40,
          paymentGatewayFee: isPrepaid ? Math.round(selectedProduct.price * 0.02) : 0,
          codCollectionFee: isPrepaid ? 0 : 50,
          reverseLogisticsCost: 150,
          verificationCost: 0,
          incentiveDiscount: isPrepaid ? (checkoutDecision?.prepaid_discount_inr || 50) : 0,
          expectedContribution: Math.round(selectedProduct.price * 0.35),
          currency: 'INR',
        },
        runPredictionImmediately: true,
      };

      const orderRes = await fetch(`${rootUrl}/api/v1/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload),
      });
      if (!orderRes.ok) {
        const err = await orderRes.json().catch(() => ({}));
        throw new Error(err.detail || `Could not save order (${orderRes.status}).`);
      }

      if (isPrepaid) {
        const payableAmount = checkoutDecision.final_prepaid_amount;
        const gatewayRes = await fetch(`${rootUrl}/api/v1/razorpay/create-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount_inr: payableAmount,
            order_id: orderId,
            notes: { order_id: orderId, tier: checkoutDecision.tier },
          }),
        });
        const gatewayOrder = await gatewayRes.json();
        if (!gatewayRes.ok) {
          throw new Error(gatewayOrder.detail || `Could not start checkout (${gatewayRes.status}).`);
        }

        if (gatewayOrder.mode === 'simulated') {
          setPendingPaymentOrderId(orderId);
          setIsRazorpayModalOpen(true);
          return;
        }

        if (!gatewayOrder.key_id || !gatewayOrder.id) {
          throw new Error('Razorpay did not return a checkout key and order ID.');
        }
        if (!window.Razorpay) {
          await new Promise<void>((resolve, reject) => {
            const existingScript = document.querySelector<HTMLScriptElement>(
              'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
            );
            if (existingScript) {
              existingScript.addEventListener('load', () => resolve(), { once: true });
              existingScript.addEventListener('error', () => reject(new Error('Razorpay Checkout failed to load.')), { once: true });
              return;
            }
            const script = document.createElement('script');
            script.src = 'https://checkout.razorpay.com/v1/checkout.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Razorpay Checkout failed to load.'));
            document.body.appendChild(script);
          });
        }
        if (!window.Razorpay) {
          throw new Error('Razorpay Checkout is unavailable in this browser.');
        }

        const checkout = new window.Razorpay({
          key: gatewayOrder.key_id,
          amount: gatewayOrder.amount,
          currency: gatewayOrder.currency || 'INR',
          name: 'RTOGuard Verified Merchant',
          description: `Payment for ${orderNum}`,
          order_id: gatewayOrder.id,
          prefill: { name: customerName, contact: customerPhone },
          handler: payment => {
            void verifyRazorpayPayment(orderId, payment).catch(error => {
              setErrorMsg(error.message || 'Razorpay payment verification failed.');
            });
          },
          modal: { ondismiss: () => setErrorMsg('Payment cancelled. The order remains pending payment.') },
        });
        checkout.open();
        return;
      }

      finishOrder(orderId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed saving order to backend.');
    }
  };

  const completeSimulatedPayment = async () => {
    if (!pendingPaymentOrderId) return;
    try {
      const res = await fetch(`${apiRoot()}/api/v1/razorpay/demo-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: pendingPaymentOrderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || `Demo payment failed (${res.status}).`);
      }
      finishOrder(pendingPaymentOrderId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Could not record the simulated payment.');
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Top Banner explaining the Razorpay Track 02 Flow */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 rounded-2xl border border-indigo-500/30 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-semibold border border-indigo-400/30 mb-2">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Razorpay AI Buildathon 2026 — Track 02 Showcase</span>
            </div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">
              Mock Storefront: Dynamic Razorpay Checkout Gate
            </h1>
            <p className="text-xs md:text-sm text-slate-300 mt-1 max-w-3xl">
              Watch the CatBoost ML engine intercept the checkout in real-time. Instead of blindly offering COD,
              RTOGuardAI dynamically routes buyers: <strong>ALLOW</strong> (Clean COD), <strong>REVIEW</strong> (COD with ₹50 commitment fee), or <strong>BLOCK</strong> (Prepaid only with UPI instant discount).
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm p-3 rounded-xl border border-white/10 shrink-0 text-center">
            <span className="text-[11px] text-slate-300 uppercase tracking-wider block">Decision Latency</span>
            <span className="text-xl font-mono font-extrabold text-emerald-400">&lt; 45 ms</span>
          </div>
        </div>

        {/* 1-Click Persona Pre-fillers */}
        <div className="mt-5 pt-4 border-t border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-3">
          {TEST_PERSONAS.map((p, idx) => (
            <button
              key={idx}
              onClick={() => handleApplyPersona(p)}
              className="text-left p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 hover:border-indigo-400/60 transition-all group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white group-hover:text-indigo-300 transition-colors">
                  {p.label}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${p.badgeColor}`}>
                  {p.expectedTier}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{p.explanation}</p>
            </button>
          ))}
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Checkout Experience Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Product Selection & Customer Shipping Form */}
        <div className="lg:col-span-7 space-y-6">
          {/* 1. Pick Product */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-indigo-600" />
              <span>1. Select Store Product for Cart</span>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {SAMPLE_PRODUCTS.map(prod => (
                <div
                  key={prod.id}
                  onClick={() => {
                    setSelectedProduct(prod);
                    setCheckoutDecision(null);
                  }}
                  className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                    selectedProduct.id === prod.id
                      ? 'border-indigo-600 bg-indigo-50/50 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <span className="text-2xl p-2 rounded-lg bg-slate-100 shrink-0">{prod.imageEmoji}</span>
                  <div className="min-w-0">
                    <h3 className="text-xs font-bold text-slate-900 truncate">{prod.name}</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{prod.description}</p>
                    <span className="text-xs font-mono font-bold text-indigo-700 mt-1 block">
                      {formatCurrency(prod.price)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 2. Customer & Address Form */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Truck className="w-4 h-4 text-indigo-600" />
              <span>2. Delivery Address & Customer Profile</span>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">Customer Full Name</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">Mobile Contact</label>
                <input
                  type="text"
                  value={customerPhone}
                  onChange={e => setCustomerPhone(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-700 block mb-1">Street Address / Landmark</label>
              <input
                type="text"
                value={addressLine}
                onChange={e => setAddressLine(e.target.value)}
                placeholder="House / Flat, Landmark, Area"
                className="w-full text-xs p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">Pincode (6-digits)</label>
                <input
                  type="text"
                  maxLength={6}
                  value={pincode}
                  onChange={e => setPincode(e.target.value)}
                  className="w-full text-xs font-mono font-bold p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">City</label>
                <input
                  type="text"
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">State</label>
                <input
                  type="text"
                  value={state}
                  onChange={e => setState(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Merchant History Context (Normally pulled from store DB) */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-[10px] font-semibold text-slate-500 uppercase block">Past Orders Count</span>
                <input
                  type="number"
                  min={0}
                  value={pastOrders}
                  onChange={e => setPastOrders(parseInt(e.target.value) || 0)}
                  className="w-full font-mono text-xs p-1.5 rounded border border-slate-200 mt-0.5"
                />
              </div>
              <div>
                <span className="text-[10px] font-semibold text-slate-500 uppercase block">Past Unresolved RTOs</span>
                <input
                  type="number"
                  min={0}
                  value={pastRto}
                  onChange={e => setPastRto(parseInt(e.target.value) || 0)}
                  className="w-full font-mono text-xs p-1.5 rounded border border-slate-200 mt-0.5"
                />
              </div>
            </div>

            {/* Step 3 Action: Evaluate Checkout Gate */}
            <button
              onClick={evaluateCheckoutGate}
              disabled={isEvaluating}
              className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-60"
            >
              {isEvaluating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Evaluating CatBoost Model & Razorpay Policy...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Proceed to Payment: Evaluate Dynamic Gate</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Column: Dynamic Razorpay Checkout Gate Results */}
        <div className="lg:col-span-5 space-y-6">
          {/* Cart Summary */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Cart Order Summary</h3>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-xl">{selectedProduct.imageEmoji}</span>
                <div>
                  <span className="text-xs font-bold text-slate-800 block">{selectedProduct.name}</span>
                  <span className="text-[10px] text-slate-500">Qty: 1</span>
                </div>
              </div>
              <span className="text-xs font-mono font-bold text-slate-900">{formatCurrency(selectedProduct.price)}</span>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal</span>
                <span>{formatCurrency(selectedProduct.price)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Standard Delivery</span>
                <span className="text-emerald-600 font-semibold">FREE</span>
              </div>
              {checkoutDecision?.prepaid_discount_inr > 0 && selectedPaymentMethod === 'RAZORPAY_PREPAID' && (
                <div className="flex justify-between text-emerald-600 font-semibold">
                  <span>Prepaid Instant Discount</span>
                  <span>- {formatCurrency(checkoutDecision.prepaid_discount_inr)}</span>
                </div>
              )}
              {checkoutDecision?.cod_fee_inr > 0 && selectedPaymentMethod === 'COD' && (
                <div className="flex justify-between text-amber-700 font-semibold">
                  <span>COD Commitment Fee</span>
                  <span>+ {formatCurrency(checkoutDecision.cod_fee_inr)}</span>
                </div>
              )}
              <div className="pt-2 border-t border-slate-200 flex justify-between font-bold text-slate-900 text-sm">
                <span>Payable Amount</span>
                <span className="font-mono text-indigo-700">
                  {formatCurrency(
                    selectedPaymentMethod === 'RAZORPAY_PREPAID' && checkoutDecision?.final_prepaid_amount
                      ? checkoutDecision.final_prepaid_amount
                      : selectedPaymentMethod === 'COD' && checkoutDecision?.final_cod_amount
                        ? checkoutDecision.final_cod_amount
                        : selectedProduct.price
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Dynamic Gate Output Box */}
          {checkoutDecision ? (
            <div className="bg-white rounded-2xl border-2 border-indigo-600/60 p-5 shadow-md space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <span className="text-[10px] font-extrabold tracking-wider uppercase text-slate-400">
                    Live Model Decision
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full border ${
                        checkoutDecision.tier === 'ALLOW'
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                          : checkoutDecision.tier === 'REVIEW'
                            ? 'bg-amber-100 text-amber-800 border-amber-300'
                            : 'bg-rose-100 text-rose-800 border-rose-300'
                      }`}
                    >
                      {checkoutDecision.tier} TIER
                    </span>
                    <span className="text-xs font-mono font-bold text-slate-700">
                      RTO Risk: {(checkoutDecision.rto_probability * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block">Frozen Threshold</span>
                  <span className="text-xs font-mono font-bold text-slate-800">
                    0.3700 (₹200 burn)
                  </span>
                </div>
              </div>

              {/* Natural language summary explanation */}
              <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100 italic">
                "{checkoutDecision.recommended_message}"
              </p>

              {/* Dynamic Payment Options Radio Cards */}
              <div className="space-y-2.5">
                <span className="text-xs font-bold text-slate-900 block">Select Available Payment Option:</span>

                {/* Option 1: Cash on Delivery (COD) */}
                <div
                  onClick={() => {
                    if (checkoutDecision.cod_available) {
                      setSelectedPaymentMethod('COD');
                    }
                  }}
                  className={`p-3.5 rounded-xl border transition-all ${
                    !checkoutDecision.cod_available
                      ? 'bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed'
                      : selectedPaymentMethod === 'COD'
                        ? 'border-indigo-600 bg-indigo-50/40 shadow-sm cursor-pointer'
                        : 'border-slate-200 hover:border-slate-300 cursor-pointer'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <input
                        type="radio"
                        disabled={!checkoutDecision.cod_available}
                        checked={selectedPaymentMethod === 'COD'}
                        onChange={() => setSelectedPaymentMethod('COD')}
                        className="text-indigo-600"
                      />
                      <div>
                        <span className="text-xs font-bold text-slate-900 flex items-center gap-2">
                          <span>Cash on Delivery (COD)</span>
                          {!checkoutDecision.cod_available && (
                            <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                              LOCKED DUE TO RTO RISK
                            </span>
                          )}
                        </span>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {checkoutDecision.cod_available
                            ? checkoutDecision.cod_fee_inr > 0
                              ? `Pay at doorstep with ₹${checkoutDecision.cod_fee_inr} delivery confirmation charge.`
                              : 'Pay with cash upon package delivery.'
                            : 'Disabled for this order profile to prevent return-to-origin loss.'}
                        </p>
                      </div>
                    </div>
                    {checkoutDecision.cod_available && (
                      <span className="text-xs font-mono font-bold text-slate-800">
                        {formatCurrency(checkoutDecision.final_cod_amount)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Option 2: Razorpay Online Prepayment (UPI / Cards / Netbanking) */}
                <div
                  onClick={() => setSelectedPaymentMethod('RAZORPAY_PREPAID')}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                    selectedPaymentMethod === 'RAZORPAY_PREPAID'
                      ? 'border-indigo-600 bg-indigo-50/40 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <input
                        type="radio"
                        checked={selectedPaymentMethod === 'RAZORPAY_PREPAID'}
                        onChange={() => setSelectedPaymentMethod('RAZORPAY_PREPAID')}
                        className="text-indigo-600"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900">
                            Razorpay Standard Checkout (UPI / Cards)
                          </span>
                          {checkoutDecision.prepaid_discount_inr > 0 && (
                            <span className="text-[10px] font-extrabold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-300">
                              SAVE ₹{checkoutDecision.prepaid_discount_inr}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Instant GooglePay, PhonePe, Cards, or NetBanking via Razorpay.
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-mono font-bold text-emerald-700">
                      {formatCurrency(checkoutDecision.final_prepaid_amount)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Order Placement Trigger */}
              {isOrderPlaced ? (
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center space-y-2 animate-fadeIn">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                  <h4 className="text-xs font-bold text-emerald-900">Order Placed & Persisted Successfully!</h4>
                  <p className="text-[11px] text-emerald-800">
                    Order ID <strong>{placedOrderId}</strong> is recorded in SQLite with CatBoost risk assessment.
                  </p>
                  <button
                    onClick={() => {
                      setIsOrderPlaced(false);
                      setCheckoutDecision(null);
                    }}
                    className="mt-2 text-xs font-bold text-indigo-700 hover:text-indigo-900 underline inline-block"
                  >
                    Place Another Test Order
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    if (selectedPaymentMethod === 'RAZORPAY_PREPAID') {
                      handleCompleteOrder(true);
                    } else if (selectedPaymentMethod === 'COD') {
                      handleCompleteOrder(false);
                    }
                  }}
                  disabled={!selectedPaymentMethod}
                  className="w-full py-3.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs flex items-center justify-center gap-2 shadow-md transition-all disabled:opacity-50"
                >
                  {selectedPaymentMethod === 'RAZORPAY_PREPAID' ? (
                    <>
                      <CreditCard className="w-4 h-4 text-emerald-400" />
                      <span>Pay {formatCurrency(checkoutDecision.final_prepaid_amount)} via Razorpay</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-indigo-400" />
                      <span>Confirm Cash on Delivery Order</span>
                    </>
                  )}
                </button>
              )}
            </div>
          ) : (
            <div className="bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-8 text-center space-y-2">
              <CreditCard className="w-8 h-8 text-slate-400 mx-auto" />
              <h4 className="text-xs font-bold text-slate-700">Dynamic Gate Awaiting Evaluation</h4>
              <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                Fill the address and click "Proceed to Payment" to see Razorpay adapt checkout terms in real-time.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Explicit local simulation shown only when no Razorpay credentials are configured */}
      {isRazorpayModalOpen && checkoutDecision && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200">
            {/* Razorpay Brand Header */}
            <div className="bg-[#0c2340] text-white p-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded bg-blue-600 flex items-center justify-center font-black text-white text-xs">
                  R
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white tracking-wide">Simulated Online Checkout</h4>
                  <span className="text-[10px] text-blue-300 block">No payment is charged</span>
                </div>
              </div>
              <button
                onClick={() => setIsRazorpayModalOpen(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              <div className="flex justify-between items-baseline pb-3 border-b border-slate-100">
                <div>
                  <span className="text-[11px] text-slate-500">Merchant</span>
                  <h3 className="text-xs font-bold text-slate-900">RTOGuard Verified Merchant</h3>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-slate-500">Amount Due</span>
                  <span className="text-lg font-mono font-extrabold text-blue-900 block">
                    {formatCurrency(checkoutDecision.final_prepaid_amount)}
                  </span>
                </div>
              </div>

              {/* UPI Option Preview */}
              <div className="p-3.5 rounded-xl border border-blue-200 bg-blue-50/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Smartphone className="w-5 h-5 text-blue-700" />
                  <div>
                    <span className="text-xs font-bold text-blue-900 block">Instant UPI Payment</span>
                    <span className="text-[10px] text-blue-700">GPay, PhonePe, Paytm, BHIM</span>
                  </div>
                </div>
                <QrCode className="w-6 h-6 text-blue-600" />
              </div>

              {/* Simulated Success Action */}
              <div className="space-y-2 pt-2">
                <button
                  onClick={completeSimulatedPayment}
                  className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Confirm Demo Payment ({formatCurrency(checkoutDecision.final_prepaid_amount)})</span>
                </button>
                <button
                  onClick={() => setIsRazorpayModalOpen(false)}
                  className="w-full py-2 text-xs text-slate-500 hover:text-slate-700 font-semibold text-center block"
                >
                  Cancel and Return to Cart
                </button>
              </div>
            </div>

            <div className="bg-slate-50 px-6 py-3 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
              <div className="flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>256-bit SSL Encrypted</span>
              </div>
              <span>Local demo only</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
