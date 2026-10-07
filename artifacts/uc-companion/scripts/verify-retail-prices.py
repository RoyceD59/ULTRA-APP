"""Verify the approved public price extract, without importing costs or stale stock."""
import json
from decimal import Decimal
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

root = Path(__file__).resolve().parents[3]
record_dir = root / "artifacts/uc-companion/server/records"
manifest = json.loads((record_dir / "retail-prices_v6.json").read_text())
records = json.loads((record_dir / "products_v2.4.json").read_text())["products"]
ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
with ZipFile(root / "attached_assets" / manifest["source"]) as book:
    strings = []
    if "xl/sharedStrings.xml" in book.namelist():
        strings = ["".join(t.text or "" for t in x.findall(".//s:t", ns))
                   for x in ET.fromstring(book.read("xl/sharedStrings.xml"))]
    relations = {x.attrib["Id"]: x.attrib["Target"]
                 for x in ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))}
    sheet = next(x for x in ET.fromstring(book.read("xl/workbook.xml")).find("s:sheets", ns)
                 if x.attrib["name"] == manifest["sheet"])
    path = relations[sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]]
    path = path.lstrip("/") if path.startswith("/") else "xl/" + path
    prices, children = {}, {}
    for row in ET.fromstring(book.read(path)).findall(".//s:sheetData/s:row", ns):
        if int(row.attrib["r"]) < 5:
            continue
        values = {}
        for cell in row:
            v = cell.find("s:v", ns)
            value = v.text if v is not None else "".join(t.text or "" for t in cell.findall(".//s:t", ns))
            if cell.attrib.get("t") == "s":
                value = strings[int(value)]
            values["".join(c for c in cell.attrib["r"] if c.isalpha())] = value
        if not (values.get("A") or "").startswith("UC-") or not values.get("J"):
            continue
        price = Decimal(values["J"])
        assert price.is_finite() and price > 0
        sku, child = values["B"], values["A"]
        assert sku not in prices or prices[sku] == price, "Differing child prices require a revised contract"
        prices[sku] = price
        children[child] = price

expected = {p["parent_sku"]: prices[p["parent_sku"]]
            for p in records if p["parent_sku"] in prices}
assert {k: Decimal(str(v)) for k, v in manifest["prices"].items()} == expected
for product in records:
    sku = product["parent_sku"]
    if sku in expected:
        for variant in product["variants"]:
            assert children[variant["child_sku"]] == expected[sku]
    else:
        assert product["price_kes"] is None, "A priced record lacks a verified spreadsheet price"
print(f"Verified {len(expected)} full-record retail prices and every priced child SKU; enquiry-only records stay unpriced.")
