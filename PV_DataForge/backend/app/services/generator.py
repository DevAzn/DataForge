"""Record generation with seed, history, constraints, and CSV tie keys."""
from __future__ import annotations

import random
import re
import uuid
from typing import Any


def _mulberry32(seed: int):
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


class Generator:
    def __init__(
        self,
        root: list[dict],
        *,
        seed: int | None,
        ci_mode: bool,
        history_lookup,
    ):
        self.root = root
        self.ci_mode = ci_mode
        self.seed = seed if seed is not None else random.randint(0, 0xFFFFFFFF)
        self.rand = _mulberry32(self.seed)
        self.history_lookup = history_lookup  # callable(key) -> list[str]
        self.unique_sets: dict[str, set[str]] = {}
        self.history_buffer: list[dict[str, str]] = []
        self.suppress_paths: set[str] = set()

    def _pick(self, items: list[str]) -> str:
        if not items:
            return ""
        return items[int(self.rand() * len(items)) % len(items)]

    def _synth(self) -> str:
        alphabet = "abcdefghijklmnopqrstuvwxyz"
        s = "".join(alphabet[int(self.rand() * 26) % 26] for _ in range(6))
        return f"{s}_{int(self.rand() * 900000) + 1000}"

    def _push_history(self, path: list[str], row: dict, raw: str) -> None:
        if not raw:
            return
        pk = field_path_key(path, row).lower()
        if pk in self.suppress_paths:
            return
        key = field_write_key(path, row)
        if len(self.history_buffer) >= 5000:
            return
        self.history_buffer.append(
            {"categoryName": key, "keyName": key, "value": raw}
        )

    def _leaf(self, row: dict, path: list[str]) -> Any:
        write_key = field_write_key(path, row)
        null_rate = float(row.get("nullRate") or 0)
        if null_rate > 0 and self.rand() * 100 < null_rate:
            return None

        enums = [str(v).strip() for v in (row.get("enumValues") or []) if str(v).strip()]
        require_unique = bool(row.get("isPrimary") or row.get("isUnique"))
        used = self.unique_sets.setdefault(write_key, set())

        if enums:
            pool = [e for e in enums if e not in used] if require_unique else enums
            if not pool:
                pool = enums
            choice = self._pick(pool)
            used.add(choice)
            self._push_history(path, row, choice)
            return choice

        sample = (row.get("sampleValue") or "").strip()
        history: list[str] = []
        if not self.ci_mode:
            for rk in field_read_keys(path, row):
                history.extend(self.history_lookup(rk))
        # de-dupe preserve order
        seen: set[str] = set()
        hist: list[str] = []
        for h in history:
            if h not in seen:
                seen.add(h)
                hist.append(h)

        raw = ""
        for _ in range(16):
            if hist and self.rand() < 0.5 and not require_unique:
                raw = self._pick(hist)
            elif sample and self.rand() < 0.4:
                # light mutation of sample
                raw = sample if self.rand() < 0.7 else f"{sample}_{int(self.rand()*99)}"
            else:
                raw = sample if sample and self.rand() < 0.3 else self._synth()

            if row.get("maxLength") is not None:
                raw = raw[: int(row["maxLength"])]
            if row.get("minLength") is not None:
                ml = int(row["minLength"])
                if len(raw) < ml:
                    raw = raw + ("x" * (ml - len(raw)))
            if row.get("pattern"):
                try:
                    if not re.search(row["pattern"], raw):
                        continue
                except re.error:
                    pass
            if require_unique and raw in used:
                continue
            break

        if require_unique:
            used.add(raw)
        self._push_history(path, row, raw)

        # numeric coerce
        if re.fullmatch(r"-?\d+(\.\d+)?", raw or ""):
            try:
                if "." in raw:
                    return float(raw)
                return int(raw)
            except ValueError:
                pass
        return raw

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


def generate_records(
    schema: dict,
    *,
    record_count: int = 10,
    seed: int | None = None,
    ci_mode: bool = False,
    history_lookup=None,
) -> dict[str, Any]:
    count = max(1, min(int(record_count or 1), 100_000))
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

    return {
        "records": records,
        "recordCount": len(records),
        "seed": gen.seed,
        "ciMode": ci_mode,
        "historyBuffer": gen.history_buffer,
    }
