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
Backend will be live at `http://localhost:8000`.

#### 2. Start the Frontend
```powershell
cd frontend
npm ci
npm run dev
```
Frontend will be live at `http://localhost:5173`.

---

## 5. Automated Testing & Verification

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
