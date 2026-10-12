# RTOGuard AI Backend

This FastAPI backend serves the integrated RTOGuard AI application. It loads
`models/final_model.joblib`, uses the feature pipeline in `src/`, and persists
orders and model predictions in SQLite.
The dependency pins match the supplied scorer project's
`deploy/requirements-serve.txt`.

For complete local setup, testing, and Render instructions, see the repository
[README](../README.md).

## Run locally

From this directory in PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

The model's frozen binary decision threshold is returned as
`binary_threshold`; it flags an order when its RTO probability is greater than
or equal to that value. The model's separate frozen tier cutoffs determine its
ALLOW, REVIEW, and BLOCK action. Missing or unmappable model inputs are
rejected instead of being silently replaced.
Prediction history stores the latest scored result per order; rescoring updates
that snapshot rather than adding a duplicate. Each scoring event is still
recorded in the order's audit timeline.

## Test

```powershell
.\.venv\Scripts\python.exe -m pytest tests/ -v
```
