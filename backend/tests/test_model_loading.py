"""Automated tests verifying model loading, artifact SHA-256, and frozen operating points."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

import src.serving as serving
from src.serving import MODEL_PATH, PINCODE_PATH, get_service


def test_model_artifact_exists():
    assert MODEL_PATH.exists(), f"Model artifact missing at {MODEL_PATH}"
    assert MODEL_PATH.stat().st_size > 300_000, "Model artifact is suspiciously small"


def test_pincode_database_exists():
    assert PINCODE_PATH.exists(), f"India Post pincodes missing at {PINCODE_PATH}"
    assert PINCODE_PATH.stat().st_size > 1_000_000, "Pincode directory incomplete"


def test_service_loads_actual_catboost_estimator():
    svc = get_service()
    assert svc is not None
    info = svc.describe()

    assert info["estimator"] == "CatBoostClassifier"
    assert list(svc.pipeline.named_steps["clf"].classes_) == [0, 1]
    assert "catboost" in info["model_key"].lower()
    assert info["frozen_threshold"] == pytest.approx(0.37, abs=0.01)
    assert info["frozen_tier_cuts"]["low_cut"] > 0
    assert info["frozen_tier_cuts"]["high_cut"] > info["frozen_tier_cuts"]["low_cut"]
    assert info["cost_params_inr"]["fn_cost_inr"] == 200.0


def test_model_sha256_integrity():
    svc = get_service()
    actual_hash = hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()
    assert svc.model_sha256 == actual_hash
    assert svc.describe()["model_sha256"] == actual_hash
