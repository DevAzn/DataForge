"""Default settings and caps for PV_DataForge."""

from __future__ import annotations

DEFAULT_ENCRYPTION = {
    "enabled": False,
    "invokeCommand": 'python "{script}" --key "{key}" --input "{input}"',
    "encryptOnExport": False,
}

DEFAULT_FILE_NAMING = {
    "pattern": "{schema}_{index:04}.{ext}",
    "prefix": "",
    "suffix": "",
    "defaultIndexPad": 4,
    "collision": "suffix",
    "sanitizeMode": "windows",
    "deterministicRandom": False,
    "ensureUniqueNames": True,
}

DEFAULT_DATA_THEMES = {
    # When true, fields with themeCategory pull from active theme packs
    "enabled": True,
    # Blend packs: [{ themeId, weight }] — multiple themes = cross-theme mix
    "blend": [],
    # Prefer theme values before custom lists / history (still after enums)
    "preferOverHistory": True,
}

DEFAULT_SETTINGS = {
    "themeMode": "dark",
    "csvFlattenDelimiter": ".",
    "csvNestedAsJson": False,
    "csvLayoutMode": "single-header",
    "csvMultiRow": True,
    # XML export options
    "xmlRootTag": "root",
    "xmlRecordTag": "record",
    "xmlSelfClosing": True,
    # Team formats: xml | csv | txt (json/yaml not offered in UI)
    "defaultExportFormat": "xml",
    "defaultRecordCount": 10,
    # Data theme packs (Star Wars, GoT, …) — not UI chrome
    "dataThemes": {**DEFAULT_DATA_THEMES},
    "encryption": {**DEFAULT_ENCRYPTION},
    "fileNaming": {**DEFAULT_FILE_NAMING},
}

MAX_GENERATE_RECORDS = 1_000_000
MAX_IN_MEMORY_GENERATE_RECORDS = 10_000
MIN_GENERATE_RECORDS = 1
MAX_IMPORT_BYTES = 25 * 1024 * 1024
# Structured stream formats (json/xml/yaml) must fit in memory; use csv/jsonl for larger N.
STREAM_STRUCTURED_MAX_RECORDS = MAX_IN_MEMORY_GENERATE_RECORDS
