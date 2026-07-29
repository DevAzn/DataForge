"""Same-across-records (csvTiedFieldPaths) works for all schema formats."""

from app.services.generator import generate_records, normalize_tied_paths
from app.services import export_fmt


def test_tied_field_same_across_records():
    schema = {
        "root": [
            {
                "id": "a",
                "key": "region",
                "kind": "value",
                "sampleValue": "WEST",
                "isUnique": False,
                "children": [],
            },
            {
                "id": "b",
                "key": "code",
                "kind": "value",
                "sampleValue": "X1",
                "isUnique": False,
                "children": [],
            },
        ],
        "csvTiedFieldPaths": ["region"],
    }
    out = generate_records(schema, record_count=8, seed=42, ci_mode=True)
    records = out["records"]
    assert len(records) == 8
    regions = [r.get("region") for r in records]
    assert all(v == regions[0] for v in regions), regions
    assert regions[0] is not None
    # Untied field is free to vary (not all equal required, but list exists)
    assert all("code" in r for r in records)


def test_unique_field_differs_when_possible():
    schema = {
        "root": [
            {
                "id": "a",
                "key": "id",
                "kind": "value",
                "sampleValue": "A1",
                "isUnique": True,
                "enumValues": [f"ID{i}" for i in range(20)],
                "children": [],
            }
        ]
    }
    out = generate_records(schema, record_count=5, seed=7, ci_mode=True)
    vals = [r.get("id") for r in out["records"]]
    assert len(vals) == 5
    assert len(set(vals)) == 5


def test_tied_path_with_record_tag_no_phantom_nest():
    """
    UI stores absolute paths (catalog.book.author) while isRecordTag unwraps
    the book body. Same-mode must pin author without injecting nested catalog.
    """
    schema = {
        "name": "TestGen",
        "xmlRootTag": "DataForge",
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
                        ],
                    }
                ],
            }
        ],
    }
    assert normalize_tied_paths(schema["root"], schema["csvTiedFieldPaths"]) == [
        "author"
    ]
    out = generate_records(schema, record_count=5, seed=99, ci_mode=True)
    records = out["records"]
    assert len(records) == 5
    authors = [r.get("author") for r in records]
    assert all(a == authors[0] for a in authors), authors
    assert authors[0] is not None and str(authors[0]) != ""
    # No phantom catalog nest from absolute tied path apply
    for r in records:
        assert "catalog" not in r, r
        assert "title" in r and "year" in r
    # Untied title should not all be forced equal to sample only (may vary)
    titles = [r.get("title") for r in records]
    assert all(t is not None for t in titles)

    from app.services.generator import assemble_schema_document

    doc = assemble_schema_document(schema, records, xml_root_tag="DataForge")
    # Renamed outermost catalog → DataForge; books nested under it
    assert isinstance(doc, dict)
    assert "DataForge" in doc or "catalog" in doc
    xml = export_fmt.serialize(
        doc,
        "xml",
        multi_row=True,
        xml_root_tag="DataForge",
        xml_record_tag="book",
        document_shaped=True,
    )
    assert xml.count("<book>") == 5
    assert "Andrew Hunt" in xml or str(authors[0]) in xml
    # Schema tree preserved (or renamed root) — not a flat list of bare fields
    assert "<title>" in xml and "<author>" in xml
