"""End-to-end API tests via TestClient."""


def _row(**kw):
    base = {"date": "2026-05-01", "description": "X", "amount": 1.0,
            "source": "Test", "card": None, "reference": None, "category_hint": None}
    base.update(kw)
    return base


def test_seeded_categories(client):
    cats = client.get("/api/categories").json()
    names = {c["name"] for c in cats}
    assert {"Travel", "Meals", "Payment", "Uncategorized"} <= names
    assert len(cats) == 11


def test_reference_dedup_and_categorize(client):
    rows = [
        _row(description="SHELL OIL 12345", amount=42.10, reference="REF1"),
        _row(description="SHELL OIL 12345", amount=42.10, reference="REF1"),  # dup ref
        _row(description="STARBUCKS 991", amount=6.75, reference="REF2"),
    ]
    r = client.post("/api/transactions/import", json=rows).json()
    assert (r["imported"], r["skipped"]) == (2, 1)
    txns = client.get("/api/transactions").json()
    by_desc = {t["description"]: t for t in txns}
    assert by_desc["SHELL OIL 12345"]["category"] == "Fuel"
    assert by_desc["STARBUCKS 991"]["category"] == "Meals"


def test_occurrence_dedup_keeps_real_repeats(client):
    rows = [_row(description="SAN DIEGO PARKING", amount=2.85, card="1237") for _ in range(3)]
    assert client.post("/api/transactions/import", json=rows).json()["imported"] == 3
    # re-import the same file -> all skipped
    assert client.post("/api/transactions/import", json=rows).json()["skipped"] == 3


def test_summary_excludes_non_purchases(client):
    rows = [
        _row(description="BLUE BOTTLE", amount=6.25, reference="A"),          # purchase
        _row(description="ONLINE PAYMENT - THANK YOU", amount=-500.0, reference="B"),  # card_payment
        _row(description="Overdrive DES:PAYROLL", amount=-3000.0, reference="C"),      # income
    ]
    client.post("/api/transactions/import", json=rows)
    s = client.get("/api/summary").json()
    assert s["total_spend_cents"] == 625  # only the purchase


def test_card_payment_value_match(client):
    # An Amex card payment of $500, then a bank debit of $500 with an opaque
    # description -> the bank debit is reconciled to card_payment (excluded).
    client.post("/api/transactions/import", json=[
        _row(description="ONLINE PAYMENT - THANK YOU", amount=-500.0, reference="P", source="Amex"),
        _row(description="OBSCURE BILLER 9981", amount=500.0, source="BofA checking"),
        _row(description="TRADER JOES", amount=40.0, source="BofA checking"),
    ])
    kinds = {t["description"]: t["kind"] for t in client.get("/api/transactions").json()}
    assert kinds["OBSCURE BILLER 9981"] == "card_payment"
    assert kinds["TRADER JOES"] == "purchase"
    assert client.get("/api/summary").json()["total_spend_cents"] == 4000


def test_patch_propagates_to_same_merchant(client):
    client.post("/api/transactions/import", json=[
        _row(description="ACME WIDGETS CO", amount=10.0, reference="1"),
        _row(description="ACME WIDGETS CO", amount=20.0, reference="2"),
    ])
    txns = client.get("/api/transactions").json()
    tid = txns[0]["id"]
    res = client.patch(f"/api/transactions/{tid}", json={"category": "Equipment"}).json()
    assert res["applied"] == 1  # the other ACME row
    cats = {t["category"] for t in client.get("/api/transactions").json()}
    assert cats == {"Equipment"}


def test_patch_p2p_not_propagated(client):
    client.post("/api/transactions/import", json=[
        _row(description="Zelle payment to Alice", amount=50.0, reference="1"),
        _row(description="Zelle payment to Bob", amount=60.0, reference="2"),
    ])
    txns = {t["description"]: t for t in client.get("/api/transactions").json()}
    res = client.patch(f"/api/transactions/{txns['Zelle payment to Alice']['id']}",
                       json={"category": "Meals"}).json()
    assert res["applied"] == 0
    after = {t["description"]: t for t in client.get("/api/transactions").json()}
    assert after["Zelle payment to Bob"]["category"] == "Uncategorized"


def test_recategorize_is_non_destructive(client):
    # A row categorized via hint (not reproducible by keywords) must survive.
    client.post("/api/transactions/import", json=[
        _row(description="MYSTERY SHOP", amount=15.0, reference="1", category_hint="Travel"),
    ])
    assert client.post("/api/transactions/recategorize").json()["updated"] == 0
    txns = client.get("/api/transactions").json()
    assert txns[0]["category"] == "Travel"  # not downgraded to Uncategorized


def test_tags_and_scoped_summary(client):
    client.post("/api/transactions/import", json=[
        _row(description="HOTEL XYZ", amount=200.0, reference="1"),
    ])
    tid = client.get("/api/transactions").json()[0]["id"]
    client.patch(f"/api/transactions/{tid}", json={"tags": ["trip-tokyo"]})
    assert [t["name"] for t in client.get("/api/tags").json()] == ["trip-tokyo"]
    assert len(client.get("/api/transactions?tag=trip-tokyo").json()) == 1
    assert client.get("/api/summary?tag=trip-tokyo").json()["total_spend_cents"] == 20000


def test_details_stored_and_enriched_on_reimport(client):
    # First import without statement details.
    client.post("/api/transactions/import", json=[
        _row(description="LS WONDERS OF EARTH", amount=20.0, reference="R"),
    ])
    assert client.get("/api/transactions").json()[0]["details"] is None
    # Re-import the same reference WITH details -> enriches, doesn't duplicate.
    r = client.post("/api/transactions/import", json=[
        _row(description="LS WONDERS OF EARTH", amount=20.0, reference="R",
             details={"Address": "123 Main St", "City/State": "OAKLAND, CA"}),
    ]).json()
    assert (r["imported"], r["skipped"], r["enriched"]) == (0, 1, 1)
    t = client.get("/api/transactions").json()[0]
    assert t["details"]["City/State"] == "OAKLAND, CA"


def test_category_create_and_system_delete_rules(client):
    assert client.post("/api/categories", json={"name": "Childcare", "color": "#abcdef"}).status_code == 201
    assert client.post("/api/categories", json={"name": "Fuel", "color": "#000"}).status_code == 409
    payment_id = next(c["id"] for c in client.get("/api/categories").json() if c["name"] == "Payment")
    assert client.delete(f"/api/categories/{payment_id}").status_code == 400
