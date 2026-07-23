"""Default settings and caps mirroring Electron DataForge shared/types."""

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
    "defaultExportFormat": "xml",
    "defaultRecordCount": 10,
    "encryption": {**DEFAULT_ENCRYPTION},
    "fileNaming": {**DEFAULT_FILE_NAMING},
}

MAX_GENERATE_RECORDS = 1_000_000
MAX_IN_MEMORY_GENERATE_RECORDS = 10_000
MIN_GENERATE_RECORDS = 1
MAX_IMPORT_BYTES = 25 * 1024 * 1024
