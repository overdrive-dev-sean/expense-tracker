"""Categorization engine: merchant key, priority order, word-boundary matching."""
from app.categorize import categorize, merchant_key
from app.models import Category, LearnedMerchant


def test_merchant_key_normalizes():
    assert merchant_key("SHELL OIL 12345 #99") == "shell oil"
    assert merchant_key("WEIRD LOCAL VENDOR #778") == "weird local vendor"


def test_keyword_matching_is_word_boundary(db):
    # "mobil" must not match inside "tmobile", but must match a real Mobil station
    assert categorize(db, "TMOBILE*AUTO PAY").name == "Uncategorized"
    assert categorize(db, "EXXON MOBIL 1234").name == "Fuel"
    # prefix keyword still works
    assert categorize(db, "AMERICAN AIRLINES 001").name == "Travel"


def test_priority_learned_beats_keyword(db):
    # STARBUCKS would be Meals by keyword; a learned rule should win.
    eq = db.query(Category).filter_by(name="Equipment").one()
    db.add(LearnedMerchant(merchant_key=merchant_key("STARBUCKS 991"), category_id=eq.id))
    db.commit()
    assert categorize(db, "STARBUCKS 991").name == "Equipment"


def test_hint_used_below_keyword(db):
    # No keyword match -> hint applies; but keyword overrides hint.
    assert categorize(db, "OBSCURE VENDOR", hint="Travel").name == "Travel"
    assert categorize(db, "STARBUCKS", hint="Travel").name == "Meals"


def test_p2p_defaults_to_uncategorized(db):
    # "payment" keyword would pull this into Payment, but p2p forces Uncategorized.
    assert categorize(db, "Zelle payment to Bob", kind="p2p").name == "Uncategorized"
