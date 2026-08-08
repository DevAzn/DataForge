"""Delivery chunk plan + destination path jail."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app import database as db  # noqa: E402
from app.services.delivery_svc import (  # noqa: E402
    build_chunk_plan,
    delivery_exports_root,
    validate_destination_path,
)


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


def test_destination_default_under_exports_delivery():
    job_id = "job-abc"
    p = validate_destination_path(None, job_id=job_id)
    root = delivery_exports_root()
    assert p == (root / job_id).resolve()
    assert str(p).startswith(str(root))


def test_destination_relative_stays_in_jail():
    root = delivery_exports_root()
    p = validate_destination_path("subdir/run1", job_id="job-1")
    assert p == (root / "subdir" / "run1").resolve()
    p.relative_to(root)  # raises if outside


def test_destination_rejects_escape_outside_data(tmp_path):
    root = delivery_exports_root()
    # Absolute path that is not under the delivery exports root
    outside = (tmp_path / "evil-out").resolve()
    assert not str(outside).startswith(str(root))
    with pytest.raises(ValueError, match="must be under"):
        validate_destination_path(str(outside), job_id="j1")


def test_destination_rejects_dotdot_escape():
    root = delivery_exports_root()
    # Many .. segments trying to leave the jail
    escape = "../" * 20 + "etc"
    with pytest.raises(ValueError, match="must be under"):
        validate_destination_path(escape, job_id="j1")
    # Nested under root then .. should still resolve inside or fail
    ok = validate_destination_path("safe/../still-here", job_id="j1")
    assert ok == (root / "still-here").resolve()
    ok.relative_to(root)
