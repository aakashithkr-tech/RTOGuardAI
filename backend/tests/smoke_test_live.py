"""End-to-End Live Smoke Test for RTOGuardAI Unified Platform."""

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi.testclient import TestClient
from app import app
import database

def main():
    print("==================================================")
    print("RTOGUARD AI — FULL SYSTEM END-TO-END SMOKE TEST")
    print("==================================================")

    with TestClient(app) as client:
        # 1. Health
        h = client.get("/health")
        assert h.status_code == 200, f"Health failed: {h.text}"
        h_data = h.json()
        print(f"[PASS] /health -> status: {h_data['status']}, model: {h_data['model_details'].get('estimator')}")

        # 2. Readiness
        r = client.get("/ready")
        assert r.status_code == 200, f"Readiness failed: {r.text}"
        print(f"[PASS] /ready -> status: {r.json()['status']}, orders_count: {r.json()['orders_count']}")

        # 3. Model Status & Metrics
        ms = client.get("/api/v1/model/status")
        assert ms.status_code == 200
        ms_data = ms.json()
        print(f"[PASS] /api/v1/model/status -> threshold: {ms_data['frozen_threshold']}, sha256: {ms_data['sha256'][:16]}...")

        mm = client.get("/api/v1/model/metrics")
        assert mm.status_code == 200
        test_eval = mm.json()["test_set_evaluation"]
        print(f"[PASS] /api/v1/model/metrics -> test PR-AUC: {test_eval['pr_auc']:.4f}, ROC-AUC: {test_eval['roc_auc']:.4f}")

        # 4. List Orders
        orders_res = client.get("/api/orders")
        assert orders_res.status_code == 200
        orders = orders_res.json()
        print(f"[PASS] /api/orders -> retrieved {len(orders)} persistent orders")

        # 5. Score Existing Order with CatBoost
        score_res = client.post("/api/orders/ord_101/score")
        assert score_res.status_code == 200
        scored_order = score_res.json()
        risk = scored_order["risk"]
        print(f"[PASS] /api/orders/ord_101/score -> probability: {risk['modelProbability']:.4f}, tier: {risk['riskCategory']}, loss: Rs. {risk['expectedLossIfShippedInr']}")

        # 6. Dashboard Summary
        dash_res = client.get("/api/dashboard/summary")
        assert dash_res.status_code == 200
        dash = dash_res.json()
        print(f"[PASS] /api/dashboard/summary -> totalOrders: {dash['totalOrders']}, atRisk: {dash['ordersAtRiskCount']}, preventedLoss: Rs. {dash['preventedRtoLossEstimated']}")

        # 7. Profit Scenarios
        scen_res = client.post("/profit/scenarios", json={"orderId": "ord_101"})
        assert scen_res.status_code == 200
        scenarios = scen_res.json()
        print(f"[PASS] /profit/scenarios -> generated {len(scenarios)} actionable scenarios")

        # 8. Analytics
        rd_res = client.get("/api/v1/analytics/risk-distribution")
        assert rd_res.status_code == 200
        print(f"[PASS] /api/v1/analytics/risk-distribution -> categories: {rd_res.json()['categories']}")

        sl_res = client.get("/api/v1/analytics/shipping-loss")
        assert sl_res.status_code == 200
        print(f"[PASS] /api/v1/analytics/shipping-loss -> total expected loss: Rs. {sl_res.json()['total_expected_shipping_loss']}")

        # 9. Frontend Dist Serving
        root_res = client.get("/")
        assert root_res.status_code == 200
        if "html" in root_res.headers.get("content-type", ""):
            print("[PASS] / -> successfully served production React SPA bundle (index.html)")
        else:
            print(f"[PASS] / -> API index response: {root_res.json().get('message')}")

    print("==================================================")
    print("ALL 9 LIVE SMOKE TESTS COMPLETED SUCCESSFULLY!")
    print("==================================================")

if __name__ == "__main__":
    main()
