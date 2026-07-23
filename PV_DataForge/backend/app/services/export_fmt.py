"""Serialize generated data — full CSV layout modes matching Electron."""
from __future__ import annotations

import json
from typing import Any

import yaml


def extension_for_format(fmt: str) -> str:
    f = (fmt or "json").lower()
    return "yml" if f == "yaml" else f


def sanitize_export_file_name(name: str) -> str:
    base = (name or "dataforge-export").replace("\\", "/").split("/")[-1].strip()
    no_ext = base.rsplit(".", 1)[0] if "." in base else base
    cleaned = "".join(
        c for c in no_ext if c not in '<>:"/\\|?*' and ord(c) >= 32
    ).rstrip(".").strip()
    return cleaned or "dataforge-export"


def to_json(data: Any) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False)


def to_yaml(data: Any) -> str:
    return yaml.safe_dump(data, sort_keys=False, allow_unicode=True)


def to_txt(data: Any) -> str:
    if isinstance(data, str):
        return data
    return to_json(data)


def _escape_xml(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def sanitize_xml_tag(tag: str, fallback: str = "item") -> str:
    """Make a safe XML element name (start with letter/underscore)."""
    raw = (tag or "").strip() or fallback
    # Replace illegal characters; keep letters, digits, underscore, hyphen, period
    safe = "".join(c if (c.isalnum() or c in "_-.") else "_" for c in raw)
    if not safe or not (safe[0].isalpha() or safe[0] == "_"):
        safe = f"_{safe}" if safe else fallback
    return safe or fallback


def _empty_xml(tag: str, self_closing: bool) -> str:
    if self_closing:
        return f"<{tag}/>"
    return f"<{tag}></{tag}>"


def _xml_node(tag: str, value: Any, *, self_closing: bool = True) -> str:
    safe = sanitize_xml_tag(tag)
    if value is None:
        return _empty_xml(safe, self_closing)
    if isinstance(value, bool):
        return f"<{safe}>{str(value).lower()}</{safe}>"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f"<{safe}>{value}</{safe}>"
    if isinstance(value, list):
        if not value:
            return _empty_xml(safe, self_closing)
        inner = "\n".join(
            _xml_node(f"{safe}_{i}", v, self_closing=self_closing)
            for i, v in enumerate(value)
        )
        return f"<{safe}>\n{_indent(inner)}\n</{safe}>"
    if isinstance(value, dict):
        if not value:
            return _empty_xml(safe, self_closing)
        inner = "\n".join(
            _xml_node(k, v, self_closing=self_closing) for k, v in value.items()
        )
        return f"<{safe}>\n{_indent(inner)}\n</{safe}>"
    text = str(value)
    if text == "":
        return _empty_xml(safe, self_closing)
    return f"<{safe}>{_escape_xml(text)}</{safe}>"


def _indent(s: str) -> str:
    return "\n".join(("  " + line if line else line) for line in s.split("\n"))


def to_xml(
    data: Any,
    *,
    root_tag: str = "root",
    record_tag: str = "record",
    self_closing: bool = True,
) -> str:
    """
    Serialize data as XML.

    - root_tag: outer wrapper name (e.g. Orders, Document)
    - record_tag: each array item name when data is a list of records
    - self_closing: null/empty elements as <tag/> vs <tag></tag>
    """
    root = sanitize_xml_tag(root_tag, "root")
    rec = sanitize_xml_tag(record_tag, "record")

    if isinstance(data, list):
        if not data:
            return _empty_xml(root, self_closing)
        body = "\n".join(
            _xml_node(rec, r, self_closing=self_closing) for r in data
        )
        return f"<{root}>\n{_indent(body)}\n</{root}>"

    # Single object/scalar: still wrap in root when it's a dict so user always
    # gets a controllable root name. Scalars become root text content.
    if isinstance(data, dict):
        if not data:
            return _empty_xml(root, self_closing)
        inner = "\n".join(
            _xml_node(k, v, self_closing=self_closing) for k, v in data.items()
        )
        return f"<{root}>\n{_indent(inner)}\n</{root}>"

    return _xml_node(root, data, self_closing=self_closing)


def csv_escape(value: str) -> str:
    if any(c in value for c in '",\n\r'):
        return '"' + value.replace('"', '""') + '"'
    return value


def flatten_record(
    obj: dict, delim: str = ".", nested_as_json: bool = False
) -> dict[str, str]:
    key_set: set[str] = set()
    return _flatten_object(obj, delim, nested_as_json, key_set)


def _flatten_object(
    obj: dict,
    delim: str,
    nested_as_json: bool,
    key_set: set[str],
    prefix: str = "",
) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in obj.items():
        key = f"{prefix}{delim}{k}" if prefix else str(k)
        if v is not None and isinstance(v, (dict, list)):
            if nested_as_json:
                key_set.add(key)
                out[key] = json.dumps(v, ensure_ascii=False)
            elif isinstance(v, list):
                if v and isinstance(v[0], dict):
                    for i, item in enumerate(v):
                        if isinstance(item, dict):
                            out.update(
                                _flatten_object(
                                    item, delim, nested_as_json, key_set, f"{key}{delim}{i}"
                                )
                            )
                else:
                    key_set.add(key)
                    out[key] = json.dumps(v, ensure_ascii=False)
            else:
                out.update(
                    _flatten_object(v, delim, nested_as_json, key_set, key)
                )
        else:
            key_set.add(key)
            out[key] = "" if v is None else str(v)
    return out


def _normalize_records(data: Any, multi_row: bool) -> list[dict]:
    if isinstance(data, list):
        rows = [
            r if isinstance(r, dict) else {"value": r}
            for r in data
        ]
        if not multi_row and rows:
            return [rows[0]]
        return rows
    if isinstance(data, dict):
        return [data]
    return [{"value": data}]


def to_csv_single_header(
    records: list[dict], delim: str, nested_as_json: bool
) -> str:
    if not records:
        return ""
    key_set: set[str] = set()
    flat_rows = [
        _flatten_object(r, delim, nested_as_json, key_set) for r in records
    ]
    headers = list(key_set)
    # preserve first-seen order via flat_rows scan
    headers = []
    seen: set[str] = set()
    for fr in flat_rows:
        for k in fr:
            if k not in seen:
                seen.add(k)
                headers.append(k)
    lines = [",".join(csv_escape(h) for h in headers)]
    for fr in flat_rows:
        lines.append(",".join(csv_escape(fr.get(h, "")) for h in headers))
    return "\n".join(lines)


def _collect_entities(
    obj: dict,
    entity_name: str,
    buckets: dict[str, list[dict[str, str]]],
    delim: str,
    nested_as_json: bool,
) -> None:
    scalar: dict[str, str] = {}
    child_objects: list[tuple[str, dict]] = []
    child_arrays: list[tuple[str, list]] = []

    for k, v in obj.items():
        if v is not None and isinstance(v, dict):
            child_objects.append((k, v))
        elif isinstance(v, list):
            child_arrays.append((k, v))
        else:
            scalar[k] = "" if v is None else str(v)

    if nested_as_json:
        for name, val in child_objects:
            scalar[name] = json.dumps(val, ensure_ascii=False)

    if scalar:
        buckets.setdefault(entity_name, []).append(scalar)

    if not nested_as_json:
        for name, val in child_objects:
            child = name if entity_name == "root" else f"{entity_name}{delim}{name}"
            _collect_entities(val, child, buckets, delim, nested_as_json)

    for name, items in child_arrays:
        child = name if entity_name == "root" else f"{entity_name}{delim}{name}"
        if nested_as_json:
            rows = buckets.setdefault(entity_name, [])
            if not rows:
                rows.append({})
            rows[-1][name] = json.dumps(items, ensure_ascii=False)
            continue
        for item in items:
            if isinstance(item, dict):
                _collect_entities(item, child, buckets, delim, nested_as_json)
            else:
                buckets.setdefault(child, []).append(
                    {"value": "" if item is None else str(item)}
                )


def to_csv_entity_sections(
    records: list[dict], delim: str, nested_as_json: bool
) -> str:
    buckets: dict[str, list[dict[str, str]]] = {}
    for rec in records:
        _collect_entities(rec, "root", buckets, delim, nested_as_json)
    if not buckets:
        return ""
    blocks: list[str] = []
    for entity, rows in buckets.items():
        if not rows:
            continue
        headers: list[str] = []
        seen: set[str] = set()
        for r in rows:
            for k in r:
                if k not in seen:
                    seen.add(k)
                    headers.append(k)
        lines = [f"# entity: {entity}", ",".join(csv_escape(h) for h in headers)]
        for r in rows:
            lines.append(",".join(csv_escape(r.get(h, "")) for h in headers))
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def to_csv_per_key_sections(
    records: list[dict], delim: str, nested_as_json: bool
) -> str:
    if not records:
        return ""
    key_set: set[str] = set()
    flat_rows = [
        _flatten_object(r, delim, nested_as_json, key_set) for r in records
    ]
    headers: list[str] = []
    seen: set[str] = set()
    for fr in flat_rows:
        for k in fr:
            if k not in seen:
                seen.add(k)
                headers.append(k)
    blocks = []
    for key in headers:
        lines = [csv_escape(key)]
        for row in flat_rows:
            lines.append(csv_escape(row.get(key, "")))
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def to_csv(
    data: Any,
    *,
    multi_row: bool = True,
    layout_mode: str = "single-header",
    delim: str = ".",
    nested_as_json: bool = False,
) -> str:
    records = _normalize_records(data, multi_row)
    mode = (layout_mode or "single-header").lower()
    if mode == "entity-sections":
        return to_csv_entity_sections(records, delim, nested_as_json)
    if mode == "per-key-sections":
        return to_csv_per_key_sections(records, delim, nested_as_json)
    return to_csv_single_header(records, delim, nested_as_json)


def serialize(
    data: Any,
    fmt: str,
    *,
    multi_row: bool = True,
    layout_mode: str = "single-header",
    delim: str = ".",
    nested_as_json: bool = False,
    xml_root_tag: str = "root",
    xml_record_tag: str = "record",
    xml_self_closing: bool = True,
) -> str:
    f = (fmt or "json").lower()
    if f == "json":
        return to_json(data)
    if f == "yaml":
        return to_yaml(data)
    if f == "xml":
        return to_xml(
            data,
            root_tag=xml_root_tag,
            record_tag=xml_record_tag,
            self_closing=xml_self_closing,
        )
    if f == "csv":
        return to_csv(
            data,
            multi_row=multi_row,
            layout_mode=layout_mode,
            delim=delim,
            nested_as_json=nested_as_json,
        )
    if f == "txt":
        return to_txt(data)
    return to_json(data)
