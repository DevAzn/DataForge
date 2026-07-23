"""Infer field formats from samples/history (port of Electron patterns.ts)."""
from __future__ import annotations

import re
from typing import Any

ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ISO_DATETIME = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$"
)
DATE_US = re.compile(r"^(0?[1-9]|1[0-2])/(0?[1-9]|[12]\d|3[01])/\d{4}$")
DATE_EU = re.compile(r"^(0?[1-9]|[12]\d|3[01])/(0?[1-9]|1[0-2])/\d{4}$")
DATE_YMD_SLASH = re.compile(r"^\d{4}/(0?[1-9]|1[0-2])/(0?[1-9]|[12]\d|3[01])$")
EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)
PHONE = re.compile(r"^[+]?[\d\s().-]{7,20}$")
INT = re.compile(r"^-?\d+$")
FLOAT = re.compile(r"^-?\d+\.\d+$")
CURRENCY = re.compile(
    r"^(\$|€|£)?-?\d{1,3}(,\d{3})*(\.\d+)?$|^(\$|€|£)?-?\d+(\.\d+)?$"
)
PERCENT = re.compile(r"^-?\d+(\.\d+)?%$")
ALPHA = re.compile(r"^[A-Za-z]+$")
ALNUM = re.compile(r"^[A-Za-z0-9_-]+$")

DATE_KINDS = {
    "date-iso",
    "datetime-iso",
    "date-us",
    "date-eu",
    "date-slash-ymd",
}
NUMERIC_KINDS = {"int", "int-padded", "float"}


def is_date_kind(kind: str) -> bool:
    return kind in DATE_KINDS


def is_numeric_kind(kind: str) -> bool:
    return kind in NUMERIC_KINDS


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for v in values:
        s = (v or "").strip()
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def _all_match(samples: list[str], rx: re.Pattern) -> bool:
    return bool(samples) and all(rx.match(s) for s in samples)


def _decimals(s: str) -> int:
    m = re.search(r"\.(\d+)", s.replace("%", ""))
    return len(m.group(1)) if m else 0


def _parse_loose(s: str) -> float:
    return float(re.sub(r"[$€£,%]", "", s).replace(",", ""))


def detect_pattern(history: list[str], sample_value: str | None = None) -> dict[str, Any]:
    sample = (sample_value or "").strip() or None
    pool = _unique(([sample] if sample else []) + list(history))
    if not pool:
        return {"kind": "string", "samples": [], "minLen": 4, "maxLen": 12}

    detect_from = [sample] if sample else pool
    lens = [len(s) for s in pool]
    min_len, max_len = min(lens), max(lens)

    if _all_match(detect_from, re.compile(r"^(true|false)$", re.I)) or _all_match(
        pool, re.compile(r"^(true|false)$", re.I)
    ):
        return {"kind": "bool", "samples": pool, "minLen": 4, "maxLen": 5}

    if _all_match(detect_from, ISO_DATE) or (_all_match(pool, ISO_DATE) and not sample):
        return {"kind": "date-iso", "samples": pool, "minLen": 10, "maxLen": 10}
    if _all_match(detect_from, ISO_DATETIME) or _all_match(pool, ISO_DATETIME):
        return {"kind": "datetime-iso", "samples": pool, "minLen": 19, "maxLen": 30}

    if sample and DATE_US.match(sample) and not DATE_EU.match(sample):
        return {"kind": "date-us", "samples": pool, "minLen": 8, "maxLen": 10}
    if sample and DATE_EU.match(sample) and not sample.startswith(
        tuple("0123456789")[:0]
    ):
        day = int(sample.split("/")[0])
        if day > 12 or DATE_EU.match(sample):
            return {"kind": "date-eu", "samples": pool, "minLen": 8, "maxLen": 10}
    if _all_match(detect_from, DATE_YMD_SLASH) or _all_match(pool, DATE_YMD_SLASH):
        return {"kind": "date-slash-ymd", "samples": pool, "minLen": 8, "maxLen": 10}
    if _all_match(detect_from, DATE_US) or _all_match(pool, DATE_US):
        return {"kind": "date-us", "samples": pool, "minLen": 8, "maxLen": 10}
    if _all_match(detect_from, DATE_EU) or _all_match(pool, DATE_EU):
        return {"kind": "date-eu", "samples": pool, "minLen": 8, "maxLen": 10}

    if _all_match(detect_from, EMAIL) or _all_match(pool, EMAIL):
        return {"kind": "email", "samples": pool, "minLen": min_len, "maxLen": max_len}
    if _all_match(detect_from, UUID) or _all_match(pool, UUID):
        return {"kind": "uuid", "samples": pool, "minLen": 36, "maxLen": 36}

    def _safe_nums(values: list[str]) -> list[float]:
        out: list[float] = []
        for s in values:
            try:
                out.append(_parse_loose(s))
            except (ValueError, TypeError):
                continue
        return out or [0.0]

    if _all_match(detect_from, PERCENT) or _all_match(pool, PERCENT):
        src = [s for s in pool if PERCENT.match(s)] or detect_from
        nums = _safe_nums(src)
        return {
            "kind": "percent",
            "samples": pool,
            "minLen": min_len,
            "maxLen": max_len,
            "minNum": min(nums),
            "maxNum": max(nums),
            "decimals": max((_decimals(s) for s in src), default=0),
        }

    if _all_match(detect_from, CURRENCY) or _all_match(pool, CURRENCY):
        src = sample or pool[0]
        m = re.match(r"^(\$|€|£)", src)
        numeric_src = [s for s in pool if CURRENCY.match(s)] or detect_from
        nums = _safe_nums(numeric_src)
        return {
            "kind": "currency",
            "samples": pool,
            "minLen": min_len,
            "maxLen": max_len,
            "minNum": min(nums),
            "maxNum": max(nums),
            "decimals": max((_decimals(s) for s in numeric_src), default=2) or 2,
            "currencyPrefix": m.group(1) if m else "$",
            "useThousands": any("," in s for s in numeric_src),
        }

    if _all_match(detect_from, FLOAT) or _all_match(pool, FLOAT):
        src = [s for s in pool if FLOAT.match(s)] or detect_from
        nums = [float(s) for s in src]
        return {
            "kind": "float",
            "samples": pool,
            "minLen": min_len,
            "maxLen": max_len,
            "minNum": min(nums),
            "maxNum": max(nums),
            "decimals": max((_decimals(s) for s in src), default=2),
        }

    if _all_match(detect_from, INT) or _all_match(pool, INT):
        src = [s for s in pool if INT.match(s)] or detect_from
        nums = [int(s) for s in src]
        pad = all(s.lstrip("-").startswith("0") and len(s.lstrip("-")) > 1 for s in src)
        if pad or (sample and sample.lstrip("-").startswith("0") and len(sample) > 1):
            width = max(len(s.lstrip("-")) for s in src)
            return {
                "kind": "int-padded",
                "samples": pool,
                "minLen": min_len,
                "maxLen": max_len,
                "minNum": min(nums),
                "maxNum": max(nums),
                "padWidth": width,
            }
        return {
            "kind": "int",
            "samples": pool,
            "minLen": min_len,
            "maxLen": max_len,
            "minNum": min(nums),
            "maxNum": max(nums),
        }

    if _all_match(detect_from, PHONE) or _all_match(pool, PHONE):
        return {"kind": "phone", "samples": pool, "minLen": min_len, "maxLen": max_len}
    if _all_match(detect_from, ALPHA) or _all_match(pool, ALPHA):
        return {"kind": "alpha", "samples": pool, "minLen": min_len, "maxLen": max_len}
    if _all_match(detect_from, ALNUM) or _all_match(pool, ALNUM):
        return {"kind": "alnum", "samples": pool, "minLen": min_len, "maxLen": max_len}

    return {
        "kind": "string",
        "samples": pool,
        "minLen": min_len,
        "maxLen": max_len,
    }
