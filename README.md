# RTOGuard AI — Production-Ready AI-Powered RTO Risk Intelligence Platform

RTOGuard AI is a production-grade Cash-on-Delivery (COD) Return-to-Origin (RTO) risk prediction and order protection platform for Indian e-commerce merchants.

It unifies:
1. **RTOGuard AI Operations Frontend**: A React + TypeScript + Vite merchant dashboard (Command Center, Order Desk, Profit Brain, NDR Rescue, Analytics), plus a risk-adaptive storefront checkout and batch CSV scorer.
2. **COD Return-Risk Scorer Backend**: A production-grade FastAPI service powered by a trained **`CatBoostClassifier`** machine learning pipeline with local SHAP feature attribution, calibrated operating thresholds (frozen at 0.37), expected shipping loss calculations, persistent SQLite storage (WAL mode), profit intelligence, and optional BHASHINI Indian-language translation.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│               RTOGuard AI Frontend (React 18 + TS)          │
│  - Command Center & Order Desk (Real-time risk scoring)     │
│  - Order Detail Drawer ("Score with Trained Model" action)  │
│  - Profit Brain & What-If Simulator (Unit economics)        │
│  - NDR Rescue Panel (Reattempts & RTO approval workflow)    │
│  - Settings & Integrations (Live Model Diagnostics)         │
└──────────────────────────────┬──────────────────────────────┘
                               │ REST / JSON (HTTP)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 FastAPI Backend (Python 3.13)               │
│  - Health & Diagnostics (/health, /ready, /api/v1/model/...)│
│  - Orders CRUD & Bounded Batch Prediction Engine            │
│  - CatBoost Model Pipeline (final_model.joblib)             │
│  - SHAP TreeExplainer & India Post Directory (29k+ pincodes)│
│  - Operating Point (0.37 threshold, 0.05/0.40 tier cuts)    │
│  - Persistent SQLite Database (/var/data/rtoguard.db)       │
│  - Profit Intelligence & Explainable Loss Engine            │
│  - Optional BHASHINI Multilingual Translation Service       │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Machine Learning Pipeline & Operating Policy

- **Model Artifact**: `backend/models/final_model.joblib` (fitted CatBoost pipeline with categorical encoding, numerical imputers, and frozen parameters).
- **Estimator**: `CatBoostClassifier` (classes `[0, 1]` where `1` = RTO / Return outcome).
- **Features Handled**:
  - **Pincode Intelligence**: City, district, state, tier classification (Tier 1/2/3/Rural) mapped from `data/external/india_pincodes.csv`.
  - **Customer Order History**: Past orders count, past RTO count, past RTO rate, account age in days, order velocity in 24h.
  - **Order Parameters**: Category (`fashion`, `footwear`, `beauty`, `accessories`, `home_kitchen`, `electronics`), order value (INR), COD payment method, address complexity, festive flags.
- **Decision Policy & Thresholds**:
  - **Operating Threshold**: **`0.37`** (frozen on validation in notebook `05` to minimize rupee cost). Orders with `probability >= 0.37` are flagged.
  - **ALLOW (Low Risk)**: `probability < 0.05` → Clear order for standard COD dispatch.
  - **REVIEW (Medium Risk)**: `0.05 <= probability < 0.40` → Verify address or charge COD commitment fee.
  - **BLOCK (High Risk)**: `probability >= 0.40` → Disable COD and offer prepaid conversion with smart discount.
- **Explainability**: SHAP `TreeExplainer` generates order-specific feature attributions without heuristic approximations.
- **Expected Shipping Loss Formula**:
  $$\text{Expected Shipping Loss} = P(\text{RTO}) \times \text{applicable RTO cost}$$
  Flat baseline: $P(\text{RTO}) \times ₹200$ (representing forward shipping, reverse shipping, packaging, and handling burn).
- **Verified Offline Evaluation**:
  - Test Set: 10,000 orders, base rate 14.73%.
  - PR-AUC: 0.3858 (2.62× the no-skill floor).
  - ROC-AUC: 0.8060.
  - Brier Score: 0.1059; Expected Calibration Error (ECE): 0.0118.
  - Classification at 0.37: Precision = 0.4583, Recall = 0.2688, F1 = 0.3389.

---

## 3. Complete API Endpoints Reference

### Health & Diagnostics
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Basic service health, database counts, and model status |
| `GET` | `/ready` | Deep readiness check (verifies database and ML model; returns 503 if unavailable) |
| `GET` | `/api/v1/model/status` | Model loading status, estimator, SHA-256 digest, version, and threshold |
| `GET` | `/api/v1/model/metrics` | Verified test & validation evaluation metrics from `05_final_metrics.json` |

### Orders Management
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/orders` | List orders (backward compatible) |
| `GET` | `/api/v1/orders` | List orders with pagination (`limit`, `offset`) and filters (`status`, `payment_method`, `risk_category`, `search`) |
| `POST` | `/api/v1/orders` | Create an order with validation, duplicate detection, and optional immediate scoring |
| `GET` | `/api/v1/orders/{order_id}` | Retrieve single order details |
| `PATCH` | `/api/v1/orders/{order_id}` | Update permitted order fields (status, address, financials, ndr) |
| `DELETE` | `/api/v1/orders/{order_id}` | Delete order record |

### RTO Risk Prediction
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/score` or `/api/v1/predictions` | Predict risk for an ad-hoc order payload using CatBoost + SHAP |
| `POST` | `/api/v1/predictions/batch` | Score a bounded batch of orders (up to 100 orders per request) |
| `GET` | `/api/v1/predictions` | Query persistent scoring history with pagination and probability filters |
| `GET` | `/api/v1/predictions/{id}` | Query single prediction by numeric ID or order ID |
| `POST` | `/api/orders/{id}/score` or `/api/v1/orders/{id}/predict` | Score an existing order, update its risk assessment, and append audit event |

### Dashboard & Analytics
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/dashboard/summary` | Real-time aggregate order counts, total order value, and estimated savings |
| `GET` | `/api/v1/analytics/risk-distribution` | Distribution across LOW, MEDIUM, HIGH, CRITICAL categories and decision bands |
| `GET` | `/api/v1/analytics/prediction-trends` | Time-series history of daily predictions, average scores, and flagged orders |
| `GET` | `/api/v1/analytics/shipping-loss` | Expected shipping loss vs actual recorded RTO losses and prevented losses |
| `GET` | `/api/v1/analytics/orders` | Breakdowns by order status, payment mode, and pincode tier |

### Profit Intelligence & What-If
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/profit/estimate` | Estimate expected shipping loss from probability and logistics cost inputs |
| `POST` | `/api/v1/profit/what-if` | Interactive what-if simulator comparing baseline vs intervention outcomes |
| `POST` | `/profit/scenarios` | Frontend-compatible endpoint generating 4 operational scenario comparisons |

### NDR Rescue & Multilingual
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/ndr/orders` | List all orders currently in `NDR_PENDING` or `RECOVERY_IN_PROGRESS` |
| `POST` | `/api/orders/{id}/ndr/recovery` | Schedule courier re-attempt or approve RTO for non-delivery report |
| `POST` | `/api/v1/multilingual/translate` | Translate communication templates to Hindi/regional languages via BHASHINI (with fallback) |

Interactive OpenAPI documentation is available at **`http://localhost:8000/docs`**.

### Razorpay checkout configuration

Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` to the credentials from a
Razorpay **test-mode** account to create real test orders and launch Standard
Checkout. Set `RAZORPAY_WEBHOOK_SECRET` to the webhook secret configured in the
Razorpay dashboard; webhook requests without a valid `X-Razorpay-Signature`
are rejected. The API verifies the Standard Checkout signature against the
persisted local/gateway order association before confirming an order.

When no Razorpay credentials are configured, the storefront offers a clearly
labelled local payment simulation. It does not create a payable link or claim
that money was charged. Never put the key secret or webhook secret in frontend
environment variables.

---

## 4. Local Execution & Quick Start (Windows PowerShell)

### Quick One-Click Launch
Double-click `run-local.bat` in the project root. It starts both backend and frontend in separate terminal windows.

### Manual Launch via Windows PowerShell

#### 1. Start the Backend
```powershell
cd backend
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app:app --reload --host 127.0.0.1 --port 8000
```
---

## 4. Integrate RTOGuard into any website

RTOGuardAI exposes a standalone, merchant-facing RTO risk-scoring API that any third-party B2C website (Shopify, WooCommerce, Magento, or custom React/Vue/Node.js checkouts) can integrate into its purchase flow.

### How it fits into checkout
When a shopper enters their shipping pincode, address, and selects a payment method, your checkout calls RTOGuard before confirming the order. RTOGuard evaluates the delivery address against 29,000+ Indian postal codes, factors in order value and customer history, and returns a dynamic decision:
- **`ALLOW`**: Low risk ($P(\text{RTO}) < 0.05$). Standard Cash on Delivery is approved with zero surcharge.
- **`REVIEW`**: Medium risk ($0.05 \le P(\text{RTO}) < 0.40$). COD is enabled with a ₹50 delivery confirmation fee, or the buyer is incentivized to pay prepaid with an instant ₹50 discount.
- **`BLOCK`**: High risk ($P(\text{RTO}) \ge 0.40$). Cash on Delivery is disabled. The buyer is offered secure online payment (UPI/Cards) with an instant discount (e.g. ₹50–₹100).

---

### Prerequisites & Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_TOKEN` | *Required for admin* | Master token used by merchant operations to create merchants and revoke keys via `X-Admin-Token`. If unset, admin endpoints fail closed. |
| `RATE_LIMIT_PER_MIN` | `60` | Per-API-key requests allowed per minute before returning HTTP `429 Too Many Requests`. |
| `DATABASE_PATH` | `data/rtoguard.db` | Path to persistent SQLite database. |

---

### Step 1: Merchant Registration & API Key Issuance

Merchants can self-register via the portal UI or the `/v1/auth` REST API, which automatically provisions initial API keys:

#### Option A: Self-Service Signup (Public)
```bash
curl -X POST "http://localhost:8000/v1/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Merchant",
    "email": "jane@example.com",
    "password": "securepassword123",
    "store_name": "Jane Boutique",
    "allowed_domains": ["https://janeboutique.com", "http://localhost:5173"]
  }'
```

#### Option B: 1-Click Judge & Demo Login (Hackathon Fast Pass)
```bash
curl -X POST "http://localhost:8000/v1/auth/demo-login"
```

#### Option C: Platform Admin Provisioning (Protected by ADMIN_TOKEN)
```bash
curl -X POST "http://localhost:8000/v1/admin/merchants" \
  -H "X-Admin-Token: YOUR_SECURE_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My E-Commerce Store",
    "allowed_domains": ["mystore.com", "http://localhost:5173"],
    "mode": "test"
  }'
```

**Response:**
```json
{
  "id": "merch_4c8a91bf",
  "name": "My E-Commerce Store",
  "allowed_domains": ["mystore.com", "http://localhost:5173"],
  "created_at": "2026-10-13T04:00:00Z",
  "active": true,
  "keys": [
    {
      "id": "key_110a",
      "type": "public",
      "key": "pk_test_a8f9c2d7e1b4...",
      "prefix": "pk_test_a8f9...",
      "created_at": "2026-10-13T04:00:00Z"
    },
    {
      "id": "key_220b",
      "type": "secret",
      "key": "sk_test_99bc33d1f0e2...",
      "prefix": "sk_test_99bc...",
      "created_at": "2026-10-13T04:00:00Z"
    }
  ]
}
```

> [!WARNING]
> Save the secret key (`sk_...`) in your secure server environment variables immediately. The plaintext key cannot be retrieved again; the database stores only SHA-256 cryptographic hashes.

---

### Step 2: Public vs. Secret Key Security Rules

- **Public Key (`pk_...`)**:
  - Safe for browser JavaScript and frontend HTML.
  - Requires a valid `Origin` header matching one of the merchant's configured `allowed_domains`.
  - Missing or unapproved origins are rejected with `403 Forbidden`.
- **Secret Key (`sk_...`)**:
  - Exclusively for server-to-server backend integrations.
  - **Never embed in client-side JavaScript or HTML.**
  - Does not require a browser `Origin` header.

Authentication headers accepted:
- `Authorization: Bearer <API_KEY>`
- `X-API-Key: <API_KEY>`

---

### Step 3: Embeddable JavaScript SDK Integration (`/rtoguard.js`)

Add the lightweight (< 10 KB), dependency-free SDK to your checkout page:

```html
<script src="https://YOUR-RTOGUARD-HOST/rtoguard.js" data-key="pk_test_YOUR_PUBLIC_KEY"></script>
```

#### Programmatic Scoring:
```javascript
RTOGuard.score({
  pincode: "110001",
  address: "Flat 4B, Barakhamba Road, New Delhi",
  orderValue: 1999,
  category: "fashion",
  isCod: true
}).then(function (decision) {
  console.log("Decision tier:", decision.tier);
  console.log("COD Available:", decision.cod_available);
  console.log("COD Fee:", decision.cod_fee_inr);
  console.log("Prepaid Discount:", decision.prepaid_discount_inr);

  if (!decision.cod_available) {
    document.getElementById("cod-radio").disabled = true;
    alert("Cash on Delivery is unavailable for this address.");
  }
});
```

#### Automatic Checkout Widget:
Place this container in your checkout form to automatically render an accessible COD/Prepaid selector:
```html
<div data-rtoguard-checkout
     data-pincode="110001"
     data-address="Flat 4B, Barakhamba Road"
     data-order-value="1999"
     data-category="fashion">
</div>
```

The SDK listens for decisions and emits a standard `CustomEvent`:
```javascript
window.addEventListener("rtoguard:decision", function (event) {
  console.log("RTOGuard decision received:", event.detail);
});
```

#### Fail-Open Reliability:
The SDK enforces a strict 3-second timeout. If the network drops or the API is temporarily unreachable, the SDK **fails open**: it returns an advisory `ALLOW` decision with `degraded: true`, ensuring your checkout flow is never blocked.

---

### Step 4: Server-Side Integration (`curl` & Node/Python)

For security-sensitive payment gating, execute scoring from your backend using your secret key:

```bash
curl -X POST "http://localhost:8000/v1/score" \
  -H "Authorization: Bearer sk_live_YOUR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "pincode": "560001",
    "address_line": "B-304, Cubbon Road, Bangalore",
    "order_value": 3199,
    "category": "home_kitchen",
    "is_cod": true,
    "customer_history": {
      "past_orders": 6,
      "past_rto_count": 0,
      "account_age_days": 180.0,
      "order_velocity_24h": 1
    }
  }'
```

#### Client-Side Browser `fetch` Example:
```javascript
const res = await fetch("https://YOUR-RTOGUARD-HOST/v1/score", {
  method: "POST",
  headers: {
    "X-API-Key": "pk_test_YOUR_PUBLIC_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    pincode: "560001",
    address_line: "B-304, Cubbon Road, Bangalore",
    order_value: 3199,
    category: "home_kitchen",
    is_cod: true
  })
});
const decision = await res.json();
```

---

### Step 5: Response Schema & Error Handling

#### Successful Response (`200 OK`):
```json
{
  "api_version": "v1",
  "request_id": "req_83f109ab44ce",
  "tier": "ALLOW",
  "rto_probability": 0.038,
  "reasons": [
    "Established buyer history with zero prior delivery failures",
    "High delivery density serviceable metro pin"
  ],
  "recommended_action": "allow",
  "cod_available": true,
  "cod_fee_inr": 0.0,
  "prepaid_discount_inr": 0.0,
  "message": "Standard Cash on Delivery is approved. Zero additional checkout friction.",
  "summary": "ALLOW tier: 3.8% return probability. COD is available."
}
```

#### Standard Error Response Format:
```json
{
  "error": {
    "code": "invalid_api_key",
    "message": "The API key is invalid or revoked."
  }
}
```

#### HTTP Status Codes:
- `401 Unauthorized`: Missing, invalid, or revoked API key (`code: "invalid_api_key"`).
- `403 Forbidden`: Origin header missing or not in `allowed_domains` (`code: "origin_not_allowed"`), or merchant inactive (`code: "inactive_merchant"`).
- `422 Unprocessable Entity`: Invalid pincode (not 6 digits), malformed data, or negative order value.
- `429 Too Many Requests`: Rate limit exceeded (`RATE_LIMIT_PER_MIN=60`). Includes `Retry-After: <seconds>` response header.
- `503 Service Unavailable`: Scoring model engine offline.

---

### Step 6: Querying Merchant Usage (`GET /v1/usage`)

Inspect your account's API call metrics and recent requests:

```bash
curl -X GET "http://localhost:8000/v1/usage" \
  -H "X-API-Key: sk_test_YOUR_SECRET_KEY"
```

**Response:**
```json
{
  "merchant_id": "merch_4c8a91bf",
  "total_requests": 142,
  "successful_requests": 140,
  "rate_limit_per_min": 60,
  "recent_activity": [
    {
      "endpoint": "/v1/score",
      "status_code": 200,
      "timestamp": "2026-10-13T04:15:30Z"
    }
  ]
}
```

---

### Step 7: Testing the Standalone Demo Storefront

Open `/integration-demo.html` in your browser:
- Local URL: `http://localhost:8000/integration-demo.html` (or `http://localhost:5173/integration-demo.html` with Vite dev server).
- Provides an interactive checkout sandbox demonstrating:
  - Real `/rtoguard.js` SDK calls against `/v1/score`.
  - Low, medium, and high risk presets (ALLOW, REVIEW, BLOCK).
  - UI fixtures for instant visual comparison.
  - Custom public test key and origin configuration.
  - Real-time `rtoguard:decision` event stream inspector.

---

## 5. Local Setup & Testing

#### 1. Start the Backend
```powershell
start-backend.bat
```
Backend will be live at `http://localhost:8000`.

#### 2. Start the Frontend
```powershell
start-frontend.bat
```
Frontend will be live at `http://localhost:5173`.

---

## 6. Automated Testing & Verification

Run the comprehensive test suite (36 automated tests covering model loading, real inference, feature validation, risk boundaries, expected loss, database persistence, CRUD, analytics, profit intelligence, batch predictions, Razorpay signature handling, and model unavailable behavior):

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest tests/ -v
```

Run the end-to-end smoke test against the live FastAPI application:
```powershell
cd backend
.\.venv\Scripts\python.exe tests/smoke_test_live.py
```

Run the frontend TypeScript compile & production bundle check:
```powershell
cd frontend
npm run build
```

The frontend sidebar includes **Storefront Checkout** for ALLOW/REVIEW/BLOCK
checkout demonstrations and **Batch CSV Scoring** for uploading merchant data
and downloading enriched results. In local simulation mode, the payment action
is explicitly labelled as a demo and records no real payment.

---

## 6. Production Deployment on Render

The repository is configured for zero-configuration Docker Blueprint deployment on Render:

1. **Blueprint**: `render.yaml` defines a Docker web service using the root `Dockerfile`.
2. **Persistent Storage**: Configures a 1 GB persistent disk mounted at `/var/data` to ensure SQLite survives redeploys.
3. **Environment Variables**:
   - `DATABASE_PATH`: Set to `/var/data/rtoguard.db`
   - `CORS_ORIGINS`: Set to `*` (or your merchant frontend domain)
   - `GEMINI_API_KEY`: (Optional) For AI-generated natural-language explanations
   - `BHASHINI_API_KEY`: (Optional) For live ULCA Hindi translations
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`: (Optional) Razorpay credentials; use test-mode keys for the hackathon demo
4. **Unified Single-Port Serving**: The multi-stage Docker container builds the React frontend with Vite and mounts the static distribution under FastAPI, serving the entire application on the port injected by Render via `$PORT`.
