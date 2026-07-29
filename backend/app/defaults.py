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
    # When true, hover tooltips explain controls (turn off once comfortable)
    "showUiHelp": True,
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
# Structured stream formats (json/xml/yaml) must fit in memory; use csv/txt/jsonl for larger N.
STREAM_STRUCTURED_MAX_RECORDS = MAX_IN_MEMORY_GENERATE_RECORDS
# Per-theme category value pool (user-curated fun packs e.g. Star Wars / names)
MAX_THEME_CATEGORY_VALUES = 100
THEME_CATEGORY_WARN_AT = 95
# Field values pool per tag/column (e.g. TN across many files)
MAX_FIELD_VALUES_PER_TAG = 1000
FIELD_VALUES_WARN_AT = 950
