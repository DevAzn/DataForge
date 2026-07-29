"""Hard field.pattern constraint + design-only pattern samples."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.generator import Generator  # noqa: E402
from app.services.patterns import detect_pattern  # noqa: E402


def test_digit_pattern_hard_match():
    root = [
        {
            "key": "code",
            "kind": "value",
            "pattern": r"^\d{4}$",
            "sampleValue": "1234",
            "children": [],
        }
    ]
    g = Generator(
        root,
        seed=99,
        ci_mode=True,
        custom_lookup=lambda _k: [],
        history_lookup=lambda _k: [],
    )
    pat = re.compile(r"^\d{4}$")
    vals = [str(g.one_record()["code"]) for _ in range(30)]
    bad = [v for v in vals if not pat.search(v)]
    assert not bad, f"non-matching values: {bad[:10]} stats={g.stats}"
    assert g.stats["patternFailures"] == 0


def test_impossible_pattern_returns_empty_not_wrong_value():
    root = [
        {
            "key": "code",
            "kind": "value",
            "pattern": r"^IMPOSSIBLE_NEVER_MATCH_XYZ$",
            "sampleValue": "1234",
            "children": [],
        }
    ]
    g = Generator(
        root,
        seed=1,
        ci_mode=True,
        custom_lookup=lambda _k: [],
        history_lookup=lambda _k: [],
    )
    vals = [g.one_record()["code"] for _ in range(5)]
    # Hard fail: empty string rather than leaking sample/synth that violates pattern
    assert all(v == "" or v is None for v in vals), vals
    assert g.stats["patternFailures"] >= 1


def test_bare_integer_is_not_currency():
    p = detect_pattern([], "1234")
    assert p["kind"] in ("int", "int-padded"), p
    p2 = detect_pattern([], "$12.50")
    assert p2["kind"] == "currency", p2


def test_pattern_samples_ignore_theme_pool_for_detect():
    """Theme values that fail pattern must not bias synth into theme-shaped wrong data."""
    root = [
        {
            "key": "code",
            "kind": "value",
            "themeCategory": "codes",
            "pattern": r"^\d{4}$",
            "sampleValue": "1234",
            "children": [],
        }
    ]
    g = Generator(
        root,
        seed=3,
        ci_mode=False,
        custom_lookup=lambda _k: [],
        history_lookup=lambda _k: [],
        theme_lookup=lambda _c: ["ALPHA", "BETA", "GAMMA"],
        theme_prefer=True,
    )
    pat = re.compile(r"^\d{4}$")
    vals = [str(g.one_record()["code"]) for _ in range(15)]
    # Theme alpha strings fail pattern → exclusive theme stage skips; synth must still match digits
    assert g.stats["themeHits"] == 0
    bad = [v for v in vals if v and not pat.search(v)]
    assert not bad, f"bad={bad} stats={g.stats} vals={vals}"
