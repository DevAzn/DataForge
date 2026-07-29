"""Delivery chunk plan: sums to target, soft bounds, never crashes."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.delivery_svc import build_chunk_plan  # noqa: E402


def test_plan_sum_equals_target():
    for target, mn, mx in [
        (10, 4, 7),
        (5, 3, 4),
        (1, 5, 10),
        (100, 1, 1),
        (20, 5, 5),
        (10, 7, 3),  # max coerced to min
    ]:
        plan = build_chunk_plan(target, mn, mx, seed=1)
        assert sum(plan) == target, (target, mn, mx, plan)
        assert all(c >= 1 for c in plan), plan


def test_plan_no_crash_awkward_min_max():
    plan = build_chunk_plan(5, 3, 4, seed=42)
    assert sum(plan) == 5
    # Prefer merging undersized tails rather than tiny leftover chunks when possible
    assert min(plan) >= 1


def test_plan_includes_min_and_max_when_possible():
    plan = build_chunk_plan(20, 3, 7, seed=7)
    assert sum(plan) == 20
    assert 3 in plan
    assert 7 in plan


def test_single_chunk_when_target_fits_max():
    plan = build_chunk_plan(4, 2, 5, seed=1)
    assert plan == [4]
