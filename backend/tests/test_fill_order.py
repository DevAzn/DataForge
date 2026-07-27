"""Unit tests: strict fill order enums → theme → custom → history → synth."""
from __future__ import annotations

import sys
from pathlib import Path

# Allow `python -m pytest` from repo root or backend/
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.generator import Generator, generate_records  # noqa: E402
from app.services import export_fmt  # noqa: E402


def _gen(
    root,
    *,
    seed=1,
    ci_mode=False,
    custom=None,
    history=None,
    theme=None,
    theme_prefer=True,
):
    custom = custom or {}
    history = history or {}
    theme = theme or {}
    return Generator(
        root,
        seed=seed,
        ci_mode=ci_mode,
        custom_lookup=lambda k: list(custom.get(k, [])),
        history_lookup=lambda k: list(history.get(k, [])),
        theme_lookup=(lambda c: list(theme.get(c, []))) if theme else None,
        theme_prefer=theme_prefer,
    )


def test_enums_exclusive_over_everything():
    root = [
        {
            "key": "status",
            "kind": "value",
            "enumValues": ["A", "B"],
            "themeCategory": "status",
            "sampleValue": "Z",
        }
    ]
    g = _gen(
        root,
        custom={"status": ["custom1"]},
        history={"status": ["hist1"]},
        theme={"status": ["theme1"]},
    )
    for _ in range(20):
        rec = g.one_record()
        assert rec["status"] in ("A", "B")
    assert g.stats["enumHits"] == 20
    assert g.stats["customHits"] == 0
    assert g.stats["historyHits"] == 0
    assert g.stats["themeHits"] == 0


def test_theme_before_custom_before_history():
    root = [
        {
            "key": "name",
            "kind": "value",
            "themeCategory": "character",
            "sampleValue": "sample",
        }
    ]
    g = _gen(
        root,
        seed=42,
        custom={"name": ["CustomName"]},
        history={"name": ["HistName"]},
        theme={"character": ["ThemeName"]},
    )
    rec = g.one_record()
    assert rec["name"] == "ThemeName"
    assert g.stats["themeHits"] == 1

    g2 = _gen(
        root,
        seed=42,
        custom={"name": ["CustomName"]},
        history={"name": ["HistName"]},
        theme={},  # no theme values
        theme_prefer=True,
    )
    # theme_lookup None when theme empty dict passed as theme_lookup still callable empty
    g2 = Generator(
        root,
        seed=42,
        ci_mode=False,
        custom_lookup=lambda k: ["CustomName"] if k == "name" else [],
        history_lookup=lambda k: ["HistName"] if k == "name" else [],
        theme_lookup=lambda _c: [],
        theme_prefer=True,
    )
    rec2 = g2.one_record()
    assert rec2["name"] == "CustomName"
    assert g2.stats["customHits"] == 1

    g3 = Generator(
        root,
        seed=42,
        ci_mode=False,
        custom_lookup=lambda _k: [],
        history_lookup=lambda k: ["HistName"] if k == "name" else [],
        theme_lookup=lambda _c: [],
        theme_prefer=True,
    )
    rec3 = g3.one_record()
    assert rec3["name"] == "HistName"
    assert g3.stats["historyHits"] == 1


def test_custom_preferred_over_history_when_both_present():
    root = [{"key": "city", "kind": "value", "sampleValue": "X"}]
    g = Generator(
        root,
        seed=7,
        ci_mode=False,
        custom_lookup=lambda k: ["Austin"] if k == "city" else [],
        history_lookup=lambda k: ["Dallas"] if k == "city" else [],
        theme_lookup=None,
    )
    for _ in range(15):
        assert g.one_record()["city"] == "Austin"
    assert g.stats["customHits"] == 15
    assert g.stats["historyHits"] == 0


def test_unique_uses_custom_before_synth():
    root = [
        {
            "key": "email",
            "kind": "value",
            "isUnique": True,
            "sampleValue": "a@example.com",
        }
    ]
    pool = [f"u{i}@ex.com" for i in range(5)]
    g = Generator(
        root,
        seed=1,
        ci_mode=False,
        custom_lookup=lambda k: list(pool) if k == "email" else [],
        history_lookup=lambda _k: [],
    )
    seen = [g.one_record()["email"] for _ in range(5)]
    assert set(seen) == set(pool)
    assert g.stats["customHits"] == 5
    assert g.stats["synthesized"] == 0


def test_ci_mode_skips_theme_custom_history():
    root = [
        {
            "key": "name",
            "kind": "value",
            "themeCategory": "character",
            "sampleValue": "Alpha",
        }
    ]
    g = Generator(
        root,
        seed=3,
        ci_mode=True,
        custom_lookup=lambda _k: ["CustomOnly"],
        history_lookup=lambda _k: ["HistOnly"],
        theme_lookup=lambda _c: ["ThemeOnly"],
    )
    rec = g.one_record()
    assert rec["name"] not in ("CustomOnly", "HistOnly", "ThemeOnly")
    assert g.stats["customHits"] == 0
    assert g.stats["historyHits"] == 0
    assert g.stats["themeHits"] == 0


def test_unknown_export_format_raises():
    try:
        export_fmt.serialize([{"a": 1}], "not-a-format")
        assert False, "expected ValueError"
    except ValueError as e:
        assert "Unknown" in str(e) or "unknown" in str(e).lower()


def test_validate_format_accepts_aliases():
    assert export_fmt.validate_format("yml") == "yaml"
    assert export_fmt.validate_format("ndjson") == "jsonl"
    assert export_fmt.validate_format("JSON") == "json"


def test_generate_records_report_includes_custom_hits():
    schema = {
        "name": "t",
        "root": [{"key": "x", "kind": "value", "sampleValue": "1"}],
    }
    result = generate_records(
        schema,
        record_count=3,
        seed=1,
        ci_mode=False,
        custom_lookup=lambda k: ["c1", "c2"] if k == "x" else [],
        history_lookup=lambda _k: ["h1"],
    )
    assert result["recordCount"] == 3
    assert result["report"]["customHits"] == 3
    assert all(r["x"] in ("c1", "c2") for r in result["records"])


def test_pattern_compile_error_counted():
    root = [
        {
            "key": "code",
            "kind": "value",
            "pattern": "[invalid",
            "sampleValue": "abc",
        }
    ]
    g = Generator(
        root,
        seed=1,
        ci_mode=True,
        history_lookup=lambda _k: [],
        custom_lookup=lambda _k: [],
    )
    g.one_record()
    assert g.stats["patternCompileErrors"] >= 1


if __name__ == "__main__":
    # Simple runner without pytest dependency
    tests = [v for k, v in list(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"OK  {t.__name__}")
        except Exception as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
    raise SystemExit(failed)
