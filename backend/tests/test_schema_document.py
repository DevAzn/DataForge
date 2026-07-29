"""Schema-shaped document export matches the edited tree (download intent)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.generator import (  # noqa: E402
    assemble_schema_document,
    generate_records,
    normalize_tied_paths,
)
from app.services import export_fmt  # noqa: E402


CATALOG_BOOK = {
    "name": "TestGen",
    "xmlRootTag": "catalog",
    "xmlRecordTag": "book",
    "csvTiedFieldPaths": ["catalog.book.author"],
    "root": [
        {
            "key": "catalog",
            "kind": "object",
            "children": [
                {
                    "key": "book",
                    "kind": "array",
                    "isRecordTag": True,
                    "children": [
                        {
                            "key": "title",
                            "kind": "value",
                            "sampleValue": "The Pragmatic Programmer",
                            "children": [],
                        },
                        {
                            "key": "author",
                            "kind": "value",
                            "sampleValue": "Andrew Hunt",
                            "children": [],
                        },
                        {
                            "key": "year",
                            "kind": "value",
                            "sampleValue": "1999",
                            "children": [],
                        },
                        {
                            "key": "price",
                            "kind": "value",
                            "sampleValue": "39.99",
                            "children": [],
                        },
                    ],
                }
            ],
        }
    ],
}


def test_assemble_preserves_catalog_book_path():
    bodies = [
        {"title": "A", "author": "X", "year": 1, "price": 1.0},
        {"title": "B", "author": "X", "year": 2, "price": 2.0},
    ]
    doc = assemble_schema_document(CATALOG_BOOK, bodies, xml_root_tag="catalog")
    assert doc == {"catalog": {"book": bodies}}


def test_assemble_renames_outer_root_tag():
    bodies = [{"title": "A", "author": "X", "year": 1, "price": 1.0}]
    doc = assemble_schema_document(CATALOG_BOOK, bodies, xml_root_tag="DataForge")
    assert list(doc.keys()) == ["DataForge"]
    assert "book" in doc["DataForge"]


def test_generate_document_xml_matches_tree():
    out = generate_records(CATALOG_BOOK, record_count=3, seed=5, ci_mode=True)
    assert out["hasRecordTag"] is True
    doc = out["document"]
    assert isinstance(doc, dict)
    # Default schema xmlRootTag is catalog
    assert "catalog" in doc
    assert isinstance(doc["catalog"]["book"], list)
    assert len(doc["catalog"]["book"]) == 3

    xml = export_fmt.serialize(
        doc,
        "xml",
        document_shaped=True,
        xml_root_tag="catalog",
        xml_record_tag="book",
    )
    assert xml.strip().startswith("<catalog>")
    assert xml.count("<book>") == 3
    assert "<title>" in xml and "<author>" in xml and "<year>" in xml
    # No synthetic list envelope
    assert "<record>" not in xml
    # No phantom nest inside book
    assert "<catalog>\n  <book>" in xml or "<catalog>\n  <book>" in xml.replace(
        "\r\n", "\n"
    )


def test_no_record_tag_single_is_full_tree():
    schema = {
        "name": "simple",
        "root": [
            {
                "key": "root",
                "kind": "object",
                "children": [
                    {"key": "name", "kind": "value", "sampleValue": "Ada", "children": []},
                    {"key": "n", "kind": "value", "sampleValue": "1", "children": []},
                ],
            }
        ],
    }
    out = generate_records(schema, record_count=1, seed=1, ci_mode=True)
    doc = out["document"]
    assert isinstance(doc, dict)
    assert "root" in doc
    xml = export_fmt.serialize(doc, "xml", document_shaped=True)
    assert xml.strip().startswith("<root>")
    assert "<name>" in xml and "<n>" in xml
    assert "<record>" not in xml
