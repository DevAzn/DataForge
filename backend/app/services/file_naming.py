"""File name pattern tokens — port of Electron fileNamePattern.ts."""
from __future__ import annotations

import re
import time
from datetime import datetime
from typing import Any

from app.services.generator import get_value_at_path, mulberry32

DEFAULT_PATTERN = "{schema}_{index:04}.{ext}"
TOKEN_RE = re.compile(r"\{([^{}]+)\}")


def sanitize_segment(raw: str, mode: str = "windows") -> str:
    s = str(raw or "")
    s = re.sub(r'[<>:"|?*\x00-\x1f]', "", s)
    if mode == "ascii":
        s = re.sub(r"[^\w.\-()+@#&=,;\[\]{}!~$%^ ]+", "_", s)
    s = re.sub(r"[. ]+$", "", s).strip()
    if re.match(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])$", s, re.I):
        s = f"_{s}"
    return s or "unnamed"


def sanitize_rel_path(rel: str, mode: str = "windows") -> str:
    parts = [
        sanitize_segment(p, mode)
        for p in rel.replace("\\", "/").split("/")
        if p and p not in (".", "..")
    ]
    return "/".join(parts)


def format_date(d: datetime, pattern: str) -> str:
    repl = {
        "yyyy": f"{d.year:04d}",
        "yy": f"{d.year % 100:02d}",
        "MM": f"{d.month:02d}",
        "dd": f"{d.day:02d}",
        "HH": f"{d.hour:02d}",
        "mm": f"{d.minute:02d}",
        "ss": f"{d.second:02d}",
        "SSS": f"{d.microsecond // 1000:03d}",
    }
    out = pattern
    for k, v in repl.items():
        out = out.replace(k, v)
    return out


def clock_for_index(
    index: int, *, seed: int = 0, deterministic: bool = False, now_ms: int | None = None
) -> datetime:
    if deterministic:
        return datetime.fromtimestamp(
            (1_700_000_000_000 + (seed % 86_400_000) + index * 1000) / 1000.0
        )
    base = now_ms if now_ms is not None else int(time.time() * 1000)
    return datetime.fromtimestamp((base + max(0, index - 1)) / 1000.0)


def _field_fragment(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        import json

        try:
            return json.dumps(value, ensure_ascii=False)
        except Exception:
            return ""
    return str(value)


def _rand_alpha(rand, n: int) -> str:
    alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    return "".join(alphabet[int(rand() * 36) % 36] for _ in range(n))


def _uuid(rand) -> str:
    hexc = "0123456789abcdef"

    def block(n: int) -> str:
        return "".join(hexc[int(rand() * 16) % 16] for _ in range(n))

    return f"{block(8)}-{block(4)}-4{block(3)}-{['8','9','a','b'][int(rand()*4)]}{block(3)}-{block(12)}"


def render_file_name(
    pattern: str,
    *,
    schema: str,
    index: int,
    count: int,
    format: str = "json",
    ext: str | None = None,
    prefix: str = "",
    suffix: str = "",
    seed: int = 0,
    record: Any = None,
    default_index_pad: int = 4,
    sanitize_mode: str = "windows",
    deterministic_random: bool = False,
    used_field_values: dict[str, set[str]] | None = None,
) -> str:
    mode = sanitize_mode or "windows"
    pad_default = min(max(default_index_pad or 4, 1), 12)
    det = bool(deterministic_random)
    seed = seed & 0xFFFFFFFF
    rand = mulberry32((seed ^ (index * 2654435761)) & 0xFFFFFFFF) if det else (lambda: __import__("random").random())
    now = clock_for_index(index, seed=seed, deterministic=det)
    schema_s = sanitize_segment(schema or "schema", mode)
    ext_s = (ext or format or "dat").lstrip(".")

    def resolve_field(path_and_flags: str) -> str:
        path = path_and_flags.strip()
        flag = "plain"
        if "|" in path:
            path, f = path.rsplit("|", 1)
            path, f = path.strip(), f.strip().lower()
            if f in ("unique", "rand"):
                flag = f
        fragment = _field_fragment(get_value_at_path(record, path) if record is not None else None)
        if flag == "rand":
            extra = _rand_alpha(rand, 6)
            return f"{fragment}_{extra}" if fragment else extra
        if flag == "unique":
            tracker = used_field_values
            if tracker is None:
                return f"{fragment}_{index}" if fragment else f"v{index}"
            key = path.lower()
            s = tracker.setdefault(key, set())
            candidate = fragment or f"v{index}"
            if candidate.lower() not in s:
                s.add(candidate.lower())
                return candidate
            candidate = f"{fragment or 'v'}_{index}"
            if candidate.lower() not in s:
                s.add(candidate.lower())
                return candidate
            n = 2
            while n < 10000:
                try_id = f"{fragment or 'v'}_{index}_{n}"
                if try_id.lower() not in s:
                    s.add(try_id.lower())
                    return try_id
                n += 1
            fb = f"{fragment or 'v'}_{_uuid(rand).replace('-', '')[:8]}"
            s.add(fb.lower())
            return fb
        return fragment

    def resolve_token(raw: str) -> str:
        body = raw.strip()
        if not body:
            return ""
        low = body.lower()
        if low.startswith("field:"):
            return resolve_field(body[6:].strip())
        if body == "index" or body.startswith("index:"):
            w = int(body.split(":")[1]) if ":" in body else pad_default
            width = min(max(w, 1), 12) if w == w else pad_default  # noqa: PLR0124
            try:
                width = min(max(int(body.split(":")[1]) if ":" in body else pad_default, 1), 12)
            except ValueError:
                width = pad_default
            return str(index).zfill(width)
        if body == "seq":
            return str(index).zfill(pad_default)
        if body == "count":
            return str(count)
        if body == "schema":
            return schema_s
        if body == "ext":
            return ext_s
        if body == "format":
            return format
        if body == "prefix":
            return prefix
        if body == "suffix":
            return suffix
        if body == "seed":
            return str(seed)
        if body in ("ts", "timestamp"):
            return str(int(now.timestamp() * 1000))
        if body == "time" or body.startswith("time:"):
            fmt = body.split(":", 1)[1] if ":" in body else "HHmmss_SSS"
            return format_date(now, fmt or "HHmmss_SSS")
        if body == "datetime" or body.startswith("datetime:"):
            fmt = body.split(":", 1)[1] if ":" in body else "yyyyMMdd_HHmmss_SSS"
            return format_date(now, fmt or "yyyyMMdd_HHmmss_SSS")
        if body == "date" or body.startswith("date:"):
            fmt = body.split(":", 1)[1] if ":" in body else "yyyyMMdd_HHmmss_SSS"
            return format_date(now, fmt or "yyyyMMdd_HHmmss_SSS")
        if body == "uuid":
            return _uuid(rand)
        if body == "uuid8":
            return _uuid(rand).replace("-", "")[:8]
        if body == "rand" or body.startswith("rand:"):
            try:
                n = int(body.split(":")[1]) if ":" in body else 8
            except ValueError:
                n = 8
            n = min(max(n, 1), 64)
            return _rand_alpha(rand, n)
        return ""

    pat = (pattern or DEFAULT_PATTERN).strip() or DEFAULT_PATTERN
    expanded = TOKEN_RE.sub(lambda m: resolve_token(m.group(1)), pat)
    leaf = expanded.split("/")[-1]
    has_ext = bool(re.search(r"\.[a-z0-9]+$", leaf, re.I)) or "{ext}" in pat
    if not has_ext and ext_s:
        expanded = f"{expanded}.{ext_s}"
    return sanitize_rel_path(expanded, mode)


def claim_unique_name(
    rel: str,
    used: set[str],
    *,
    collision: str = "suffix",
) -> str | None:
    """Return unique relative path or None if skip."""
    low = rel.lower()
    if low not in used:
        used.add(low)
        return rel
    if collision == "skip":
        return None
    if collision == "overwrite":
        return rel
    # suffix
    if "." in rel.split("/")[-1]:
        base, ext = rel.rsplit(".", 1)
        ext = "." + ext
    else:
        base, ext = rel, ""
    n = 2
    while n < 100000:
        candidate = f"{base}_{n}{ext}"
        if candidate.lower() not in used:
            used.add(candidate.lower())
            return candidate
        n += 1
    return None
