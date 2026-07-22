"""Serialize generated data to common formats."""
from __future__ import annotations

import csv
import io
import json
from typing import Any
from xml.sax.saxutils import escape

import yaml


def to_json(data: Any) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False)


def to_yaml(data: Any) -> str:
    return yaml.safe_dump(data, sort_keys=False, allow_unicode=True)


def to_txt(data: Any) -> str:
    if isinstance(data, str):
        return data
    return to_json(data)


def _xml_node(tag: str, value: Any) -> str:
    safe = "".join(c if c.isalnum() or c in "_-." else "_" for c in tag) or "item"
    if value is None:
        return f"<{safe}/>"
    if isinstance(value, bool):
        return f"<{safe}>{str(value).lower()}</{safe}>"
    if isinstance(value, (int, float)):
        return f"<{safe}>{value}</{safe}>"
    if isinstance(value, list):
        inner = "\n".join(_xml_node(f"{safe}_item", v) for v in value)
        return f"<{safe}>\n{inner}\n</{safe}>"
    if isinstance(value, dict):
        inner = "\n".join(_xml_node(k, v) for k, v in value.items())
        return f"<{safe}>\n{inner}\n</{safe}>"
    return f"<{safe}>{escape(str(value))}</{safe}>"


def to_xml(data: Any) -> str:
    if isinstance(data, list):
        body = "\n".join(_xml_node("record", r) for r in data)
        return f"<root>\n{body}\n</root>"
    return _xml_node("root", data)


def _flatten(obj: Any, prefix: str = "", out: dict | None = None) -> dict:
    out = out if out is not None else {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else str(k)
            _flatten(v, key, out)
    elif isinstance(obj, list):
        out[prefix or "items"] = json.dumps(obj, ensure_ascii=False)
    else:
        out[prefix or "value"] = "" if obj is None else obj
    return out


def to_csv(data: Any, multi_row: bool = True) -> str:
    rows: list[dict]
    if isinstance(data, list):
        rows = [_flatten(r) for r in (data if multi_row else data[:1])]
    else:
        rows = [_flatten(data)]
    if not rows:
        return ""
    # union headers
    headers: list[str] = []
    seen: set[str] = set()
    for r in rows:
        for k in r:
            if k not in seen:
                seen.add(k)
                headers.append(k)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=headers, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow({h: r.get(h, "") for h in headers})
    return buf.getvalue()


def serialize(data: Any, fmt: str, *, multi_row: bool = True) -> str:
    f = (fmt or "json").lower()
    if f == "json":
        return to_json(data)
    if f == "yaml":
        return to_yaml(data)
    if f == "xml":
        return to_xml(data)
    if f == "csv":
        return to_csv(data, multi_row=multi_row)
    if f == "txt":
        return to_txt(data)
    return to_json(data)
