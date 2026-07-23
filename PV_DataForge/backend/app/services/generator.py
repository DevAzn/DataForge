"""Full record generation — port of Electron generator + fieldHistory."""
from __future__ import annotations

import math
import random
import re
import time
from datetime import datetime, timezone
from typing import Any, Callable

from app.defaults import MAX_GENERATE_RECORDS, MAX_IN_MEMORY_GENERATE_RECORDS, MIN_GENERATE_RECORDS
from app.services.patterns import detect_pattern, is_date_kind, is_numeric_kind


def mulberry32(seed: int) -> Callable[[], float]:
    state = seed & 0xFFFFFFFF

    def rand() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = state
        t = (t ^ (t >> 15)) & 0xFFFFFFFF
        t = (t * (t | 1)) & 0xFFFFFFFF
        t ^= t + ((t * ((t ^ (t >> 7)) & 0xFFFFFFFF)) & 0xFFFFFFFF)
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rand


def field_path_key(path: list[str], row: dict) -> str:
    leaf = (row.get("key") or "field").strip() or "field"
    parts = [p.strip() for p in path if p and p.strip()] + [leaf]
    return ".".join(parts)


def field_write_key(path: list[str], row: dict) -> str:
    pool = (row.get("historyPool") or "").strip()
    if pool:
        return f"pool:{pool}"
    path_key = field_path_key(path, row)
    leaf = (row.get("key") or "field").strip() or "field"
    override = (row.get("categoryOverride") or "").strip()
    if override and override.lower() != leaf.lower():
        return f"{override}/{path_key}"
    return path_key


def field_read_keys(path: list[str], row: dict) -> list[str]:
    keys: list[str] = []
    seen: set[str] = set()
    for k in [field_write_key(path, row), field_path_key(path, row)] + list(
        row.get("historySourceKeys") or []
    ):
        k = (k or "").strip()
        if not k:
            continue
        low = k.lower()
        if low in seen:
            continue
        seen.add(low)
        keys.append(k)
    return keys


def coerce_sample(sample: str) -> Any:
    s = sample.strip()
    if s == "":
        return ""
    if s == "true":
        return True
    if s == "false":
        return False
    if s == "null":
        return None
    if re.fullmatch(r"-?\d+", s):
        n = int(s)
        if abs(n) < 2**53:
            return n
    if re.fullmatch(r"-?\d+\.\d+", s):
        return float(s)
    return sample


def set_value_at_path(obj: dict, path: str, value: Any) -> None:
    parts = [p for p in path.split(".") if p]
    if not parts:
        return
    cur: Any = obj
    for p in parts[:-1]:
        nxt = cur.get(p)
        if not isinstance(nxt, dict):
            cur[p] = {}
        cur = cur[p]
    cur[parts[-1]] = value


def get_value_at_path(obj: Any, path: str) -> Any:
    cur = obj
    for p in path.split("."):
        if not p:
            continue
        if not isinstance(cur, dict):
            return None
        cur = cur.get(p)
    return cur


def path_exists(obj: Any, path: str) -> bool:
    cur = obj
    for p in [x for x in path.split(".") if x]:
        if not isinstance(cur, dict) or p not in cur:
            return False
        cur = cur[p]
    return True


def build_tied_template(root: list[dict], tied_paths: list[str]) -> dict:
    want = {p.strip().lower() for p in tied_paths if p and p.strip()}
    template: dict = {}

    def walk(rows: list[dict], parent: list[str]) -> None:
        for row in rows:
            leaf = (row.get("key") or "field").strip() or "field"
            full = parent + [leaf]
            pk = ".".join(full)
            kind = row.get("kind") or "value"
            if kind == "value":
                if pk.lower() in want:
                    raw = row.get("sampleValue")
                    if raw is not None and str(raw) != "":
                        set_value_at_path(template, pk, coerce_sample(str(raw)))
            elif row.get("children"):
                walk(row["children"], full)

    walk(root, [])
    return template


def apply_tied(source: dict, target: dict, paths: list[str]) -> dict:
    for p in paths:
        p = p.strip()
        if not p or not path_exists(source, p):
            continue
        set_value_at_path(target, p, get_value_at_path(source, p))
    return target


def merge_missing_tied(template: dict, record: dict, paths: list[str]) -> None:
    for p in paths:
        p = p.strip()
        if not p or path_exists(template, p):
            continue
        if path_exists(record, p):
            set_value_at_path(template, p, get_value_at_path(record, p))


def epoch_from_seed(seed: int) -> int:
    return 1_700_000_000_000 + (seed & 0xFFFFFFFF) % 1_000_000_000


def _pick(rand: Callable[[], float], items: list) -> Any:
    if not items:
        return None
    return items[int(rand() * len(items)) % len(items)]


def _rand_int(rand: Callable[[], float], lo: int, hi: int) -> int:
    if hi < lo:
        lo, hi = hi, lo
    return int(rand() * (hi - lo + 1)) + lo


def _rand_str(rand: Callable[[], float], charset: str, n: int) -> str:
    if n < 1:
        n = 1
    return "".join(charset[int(rand() * len(charset)) % len(charset)] for _ in range(n))


def _mutate(rand: Callable[[], float], template: str) -> str:
    alpha = "abcdefghijklmnopqrstuvwxyz"
    ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    out = []
    for ch in template:
        if ch.isdigit():
            out.append(str(_rand_int(rand, 0, 9)))
        elif "a" <= ch <= "z":
            out.append(alpha[_rand_int(rand, 0, 25)])
        elif "A" <= ch <= "Z":
            out.append(ALPHA[_rand_int(rand, 0, 25)])
        else:
            out.append(ch)
    return "".join(out)


def _expand_range(pattern: dict) -> tuple[float, float]:
    mn = float(pattern.get("minNum") if pattern.get("minNum") is not None else 1)
    mx = float(pattern.get("maxNum") if pattern.get("maxNum") is not None else mn + 100)
    if mn == mx:
        span = max(abs(mn) * 0.2, 10)
        mn, mx = mn - span, mx + span
    else:
        span = max(mx - mn, 1)
        mn, mx = mn - span * 0.1, mx + span * 0.25
    return mn, mx


def _format_currency(n: float, pattern: dict) -> str:
    decimals = int(pattern.get("decimals") or 2)
    neg = n < 0
    abs_n = abs(n)
    fixed = f"{abs_n:.{decimals}f}"
    if pattern.get("useThousands"):
        int_part, _, frac = fixed.partition(".")
        int_part = re.sub(r"(\d)(?=(\d{3})+$)", r"\1,", int_part)
        body = f"{int_part}.{frac}" if frac else int_part
    else:
        body = fixed
    prefix = pattern.get("currencyPrefix") or "$"
    return f"{'-' if neg else ''}{prefix}{body}"


def _format_date(ms: float, kind: str) -> str:
    d = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
    y, m, day = d.year, f"{d.month:02d}", f"{d.day:02d}"
    hh, mm, ss = f"{d.hour:02d}", f"{d.minute:02d}", f"{d.second:02d}"
    ms_part = f"{d.microsecond // 1000:03d}"
    if kind == "date-iso":
        return f"{y}-{m}-{day}"
    if kind == "datetime-iso":
        return f"{y}-{m}-{day}T{hh}:{mm}:{ss}.{ms_part}Z"
    if kind == "date-us":
        return f"{m}/{day}/{y}"
    if kind == "date-eu":
        return f"{day}/{m}/{y}"
    if kind == "date-slash-ymd":
        return f"{y}/{m}/{day}"
    return f"{y}-{m}-{day}"


def _random_date_ms(rand: Callable[[], float], epoch_ms: int) -> float:
    start = epoch_ms - 3 * 365.25 * 24 * 3600 * 1000
    end = epoch_ms + 365.25 * 24 * 3600 * 1000
    return start + rand() * (end - start)


def _synthesize(rand: Callable[[], float], pattern: dict, used: set[str], epoch_ms: int) -> str:
    kind = pattern.get("kind") or "string"
    samples = pattern.get("samples") or []
    for _ in range(100):
        value = ""
        if kind == "bool":
            value = "true" if rand() > 0.5 else "false"
        elif kind == "int":
            mn, mx = _expand_range(pattern)
            value = str(_rand_int(rand, math.ceil(mn), math.floor(mx)))
        elif kind == "int-padded":
            mn, mx = _expand_range(pattern)
            n = _rand_int(rand, max(0, math.ceil(mn)), math.floor(max(mx, mn + 1)))
            width = int(pattern.get("padWidth") or 4)
            value = str(n).zfill(width)
        elif kind == "float":
            mn, mx = _expand_range(pattern)
            decimals = int(pattern.get("decimals") or 2)
            n = mn + rand() * max(mx - mn, 0.01)
            value = f"{n:.{decimals}f}"
        elif kind == "currency":
            mn, mx = _expand_range(pattern)
            n = mn + rand() * max(mx - mn, 0.01)
            value = _format_currency(n, pattern)
        elif kind == "percent":
            mn, mx = _expand_range(pattern)
            decimals = int(pattern.get("decimals") or 1)
            n = mn + rand() * max(mx - mn, 0.1)
            value = f"{n:.{decimals}f}%"
        elif kind in (
            "date-iso",
            "datetime-iso",
            "date-us",
            "date-eu",
            "date-slash-ymd",
        ):
            value = _format_date(_random_date_ms(rand, epoch_ms), kind)
        elif kind == "email":
            if samples and rand() < 0.4:
                value = _mutate(rand, _pick(rand, samples))
                if "@" not in value:
                    value = f"{value}@example.com"
            else:
                user = _rand_str(rand, "abcdefghijklmnopqrstuvwxyz", _rand_int(rand, 5, 10))
                domain = _pick(rand, ["example.com", "test.local", "mail.dev", "sample.org", "demo.io"])
                value = f"{user}{_rand_int(rand, 1, 999)}@{domain}"
        elif kind == "uuid":
            hexc = "0123456789abcdef"
            parts = [_rand_str(rand, hexc, n) for n in (8, 4, 4, 4, 12)]
            parts[2] = "4" + parts[2][1:]
            value = "-".join(parts)
        elif kind == "phone":
            if samples:
                value = _mutate(rand, _pick(rand, samples))
            else:
                value = f"({_rand_int(rand,200,999)}) {_rand_int(rand,200,999)}-{_rand_int(rand,1000,9999)}"
        elif kind == "alpha":
            if samples and rand() < 0.55:
                value = _mutate(rand, _pick(rand, samples))
            else:
                mn = max(1, int(pattern.get("minLen") or 4))
                mx = max(mn, int(pattern.get("maxLen") or 12))
                upper = bool(samples and samples[0][0].isupper()) if samples else False
                charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ" if upper else "abcdefghijklmnopqrstuvwxyz"
                value = _rand_str(rand, charset, _rand_int(rand, mn, mx))
        elif kind == "alnum":
            if samples and rand() < 0.6:
                value = _mutate(rand, _pick(rand, samples))
            else:
                mn = max(1, int(pattern.get("minLen") or 4))
                mx = max(mn, int(pattern.get("maxLen") or 12))
                value = _rand_str(
                    rand,
                    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
                    _rand_int(rand, mn, mx),
                )
        else:
            if samples:
                value = _mutate(rand, _pick(rand, samples))
            else:
                value = _rand_str(rand, "abcdefghijklmnopqrstuvwxyz", _rand_int(rand, 4, 12))

        if value not in used:
            return value

    if is_date_kind(kind):
        return _format_date(epoch_ms + _rand_int(rand, 0, 86_400_000), kind)
    if is_numeric_kind(kind):
        return str((epoch_ms + int(rand() * 1e9)) % 1_000_000_000)
    return f"{_rand_str(rand, 'abcdefghijklmnopqrstuvwxyz', 6)}_{_rand_int(rand, 1000, 999999)}"


def _coerce_output(raw: str, pattern: dict) -> Any:
    kind = pattern.get("kind")
    if kind == "bool":
        return raw.lower() == "true"
    if kind == "int":
        try:
            return int(raw)
        except ValueError:
            return raw
    if kind == "float":
        try:
            return float(raw)
        except ValueError:
            return raw
    return raw


class Generator:
    def __init__(
        self,
        root: list[dict],
        *,
        seed: int | None,
        ci_mode: bool,
        history_lookup: Callable[[str], list[str]],
    ):
        self.root = root
        self.ci_mode = ci_mode
        if seed is not None and isinstance(seed, (int, float)):
            self.seed = int(seed) & 0xFFFFFFFF
        else:
            self.seed = (int(time.time() * 1000) ^ random.randint(0, 10**9)) & 0xFFFFFFFF
        self.rand = mulberry32(self.seed)
        self.epoch_ms = epoch_from_seed(self.seed)
        self.history_lookup = history_lookup
        self.unique_sets: dict[str, set[str]] = {}
        self.history_buffer: list[dict[str, str]] = []
        self.history_cap = 5000
        self.suppress_paths: set[str] = set()
        self.stats = {
            "leafValues": 0,
            "nullValues": 0,
            "historyHits": 0,
            "enumHits": 0,
            "synthesized": 0,
            "mutatedFromSample": 0,
            "patternRetries": 0,
            "patternFailures": 0,
            "lengthRepairs": 0,
            "numericRepairs": 0,
            "uniqueExhausted": 0,
        }

    def _push_history(self, path: list[str], row: dict, raw: str) -> None:
        if not raw or len(self.history_buffer) >= self.history_cap:
            return
        pk = field_path_key(path, row).lower()
        if pk in self.suppress_paths:
            return
        key = field_write_key(path, row)
        self.history_buffer.append(
            {"categoryName": key, "keyName": key, "value": raw}
        )

    def _apply_length(self, row: dict, raw: str) -> str:
        s = raw
        repaired = False
        if row.get("maxLength") is not None and int(row["maxLength"]) >= 0:
            ml = int(row["maxLength"])
            if len(s) > ml:
                s = s[:ml]
                repaired = True
        if row.get("minLength") is not None and int(row["minLength"]) > 0:
            mn = int(row["minLength"])
            if len(s) < mn:
                s = s + ("x" * (mn - len(s)))
                repaired = True
        if repaired:
            self.stats["lengthRepairs"] += 1
        return s

    def _apply_numeric(self, row: dict, raw: str, pattern: dict) -> str:
        kind = pattern.get("kind")
        if not is_numeric_kind(kind or "") and kind != "currency":
            return raw
        cleaned = re.sub(r"[^0-9.+-eE]", "", raw)
        try:
            n = float(cleaned)
        except ValueError:
            return raw
        before = n
        if row.get("min") is not None and n < float(row["min"]):
            n = float(row["min"])
        if row.get("max") is not None and n > float(row["max"]):
            n = float(row["max"])
        if n != before:
            self.stats["numericRepairs"] += 1
        if kind == "int":
            return str(int(n))
        if kind == "currency":
            return _format_currency(n, pattern)
        decimals = int(pattern.get("decimals") or 2)
        return f"{n:.{decimals}f}"

    def _leaf(self, row: dict, path: list[str]) -> Any:
        write_key = field_write_key(path, row)
        self.stats["leafValues"] += 1
        null_rate = float(row.get("nullRate") or 0)
        null_rate = max(0.0, min(100.0, null_rate))
        if null_rate > 0 and self.rand() * 100 < null_rate:
            self.stats["nullValues"] += 1
            return None

        enums = [str(v).strip() for v in (row.get("enumValues") or []) if str(v).strip()]
        require_unique = bool(row.get("isPrimary") or row.get("isUnique"))
        used = self.unique_sets.setdefault(write_key, set())

        if enums:
            pool = [e for e in enums if e not in used] if require_unique else enums
            if not pool:
                self.stats["uniqueExhausted"] += 1
                pool = enums
            choice = _pick(self.rand, pool)
            used.add(choice)
            self.stats["enumHits"] += 1
            self._push_history(path, row, choice)
            return choice

        history: list[str] = []
        if not self.ci_mode:
            for rk in field_read_keys(path, row):
                history.extend(self.history_lookup(rk))
        seen: set[str] = set()
        hist: list[str] = []
        for h in history:
            if h not in seen:
                seen.add(h)
                hist.append(h)

        pattern = detect_pattern(hist, row.get("sampleValue"))
        re_pat = None
        if row.get("pattern"):
            try:
                re_pat = re.compile(str(row["pattern"]))
            except re.error:
                re_pat = None

        raw = None
        source = "synth"
        for attempt in range(24):
            if require_unique:
                candidate = _synthesize(self.rand, pattern, used, self.epoch_ms)
                cand_source = "synth"
            else:
                candidate = None
                cand_source = "synth"
                if hist and self.rand() < 0.5:
                    candidate = _pick(self.rand, hist)
                    cand_source = "history"
                if (
                    candidate is None
                    and pattern.get("samples")
                    and not is_date_kind(pattern.get("kind") or "")
                    and not is_numeric_kind(pattern.get("kind") or "")
                    and pattern.get("kind") != "bool"
                    and self.rand() < 0.55
                ):
                    candidate = _mutate(self.rand, _pick(self.rand, pattern["samples"]))
                    cand_source = "mutate"
                if candidate is None:
                    candidate = _synthesize(self.rand, pattern, set(), self.epoch_ms)
                    cand_source = "synth"

            candidate = self._apply_length(row, candidate)
            candidate = self._apply_numeric(row, candidate, pattern)

            if re_pat and not re_pat.search(candidate):
                self.stats["patternRetries"] += 1
                if attempt < 23:
                    continue
                self.stats["patternFailures"] += 1

            if require_unique and candidate in used:
                if attempt < 23:
                    continue
                self.stats["uniqueExhausted"] += 1

            raw = candidate
            source = cand_source
            if require_unique:
                used.add(raw)
            break

        if raw is None:
            raw = self._apply_length(
                row, _synthesize(self.rand, pattern, used, self.epoch_ms)
            )
            source = "synth"
            if require_unique:
                used.add(raw)

        if source == "history":
            self.stats["historyHits"] += 1
        elif source == "mutate":
            self.stats["mutatedFromSample"] += 1
        else:
            self.stats["synthesized"] += 1

        self._push_history(path, row, raw)
        return _coerce_output(raw, pattern)

    def _from_row(self, row: dict, path: list[str]) -> Any:
        kind = row.get("kind") or "value"
        children = row.get("children") or []
        if kind == "array":
            n = 1 + int(self.rand() * 3)
            child_path = path + [(row.get("key") or "field").strip() or "field"]
            items = []
            for _ in range(n):
                if not children:
                    items.append(None)
                elif len(children) == 1 and (children[0].get("kind") or "value") == "value":
                    items.append(self._from_row(children[0], child_path))
                else:
                    items.append(self._object(children, child_path))
            return items
        if kind == "object" or children:
            child_path = path + [(row.get("key") or "field").strip() or "field"]
            return self._object(children, child_path)
        return self._leaf(row, path)

    def _object(self, rows: list[dict], path: list[str]) -> dict:
        obj: dict = {}
        for row in rows:
            key = (row.get("key") or "field").strip() or "field"
            obj[key] = self._from_row(row, path)
        return obj

    def one_record(self) -> dict:
        return self._object(self.root, [])

    def report(self, record_count: int, ms: int) -> dict:
        s = self.stats
        non_null = max(0, s["leafValues"] - s["nullValues"])
        return {
            **s,
            "historyHitRate": round((s["historyHits"] / non_null) * 1000) / 10 if non_null else 0,
            "nullRatePct": round((s["nullValues"] / s["leafValues"]) * 1000) / 10
            if s["leafValues"]
            else 0,
            "ciMode": self.ci_mode,
            "seed": self.seed,
            "recordCount": record_count,
            "ms": ms,
        }


def generate_records(
    schema: dict,
    *,
    record_count: int = 10,
    seed: int | None = None,
    ci_mode: bool = False,
    history_lookup=None,
    allow_large: bool = False,
) -> dict[str, Any]:
    started = time.time()
    count = max(MIN_GENERATE_RECORDS, min(int(record_count or 1), MAX_GENERATE_RECORDS))
    if not allow_large and count > MAX_IN_MEMORY_GENERATE_RECORDS:
        raise ValueError(
            f"In-memory generate limited to {MAX_IN_MEMORY_GENERATE_RECORDS:,} records "
            f"(requested {count:,}). Use stream generate or lower the count."
        )
    root = schema.get("root") or []
    tied = [p.strip() for p in (schema.get("csvTiedFieldPaths") or []) if p and str(p).strip()]
    lookup = history_lookup or (lambda _k: [])
    gen = Generator(root, seed=seed, ci_mode=ci_mode, history_lookup=lookup)
    template = build_tied_template(root, tied) if tied else None
    if tied:
        gen.suppress_paths = {p.lower() for p in tied}

    records: list[dict] = []
    for i in range(count):
        rec = gen.one_record()
        if template is not None:
            if i == 0:
                merge_missing_tied(template, rec, tied)
            apply_tied(template, rec, tied)
        records.append(rec)

    ms = int((time.time() - started) * 1000)
    return {
        "records": records,
        "recordCount": len(records),
        "seed": gen.seed,
        "ciMode": ci_mode,
        "ms": ms,
        "report": gen.report(len(records), ms),
        "historyBuffer": gen.history_buffer,
    }


def iter_records(
    schema: dict,
    *,
    record_count: int,
    seed: int | None = None,
    ci_mode: bool = False,
    history_lookup=None,
):
    """Yield records one by one (for stream / per-file)."""
    count = max(MIN_GENERATE_RECORDS, min(int(record_count or 1), MAX_GENERATE_RECORDS))
    root = schema.get("root") or []
    tied = [p.strip() for p in (schema.get("csvTiedFieldPaths") or []) if p and str(p).strip()]
    lookup = history_lookup or (lambda _k: [])
    gen = Generator(root, seed=seed, ci_mode=ci_mode, history_lookup=lookup)
    template = build_tied_template(root, tied) if tied else None
    if tied:
        gen.suppress_paths = {p.lower() for p in tied}

    for i in range(count):
        rec = gen.one_record()
        if template is not None:
            if i == 0:
                merge_missing_tied(template, rec, tied)
            apply_tied(template, rec, tied)
        yield i + 1, rec, gen

    return gen
