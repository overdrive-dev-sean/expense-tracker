"""Default category + keyword-rule seed. Runs only when categories is empty."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Category, CategoryRule

# (name, color, is_system, [keywords])
DEFAULT_CATEGORIES = [
    ("Travel", "#e8b04b", False, [
        "uber", "lyft", "delta", "united", "southwest", "american air",
        "hertz", "enterprise", "avis", "airline", "flight", "taxi", "amtrak",
    ]),
    ("Lodging", "#6aa9ff", False, [
        "hotel", "marriott", "hilton", "hampton", "airbnb", "inn", "motel",
        "hyatt", "resort",
    ]),
    ("Meals", "#c792ea", False, [
        "restaurant", "cafe", "coffee", "starbucks", "grill", "pizza",
        "catering", "doordash", "grubhub", "diner",
    ]),
    ("Fuel", "#ff7a5c", False, [
        "shell", "chevron", "exxon", "mobil", "arco", "gas", "fuel", "diesel",
    ]),
    ("Groceries", "#5ad1a5", False, [
        "whole foods", "trader joe", "safeway", "kroger", "grocery", "costco",
        "publix", "aldi",
    ]),
    ("Equipment", "#f2c0d5", False, [
        "home depot", "grainger", "mouser", "digikey", "lowes", "hardware",
        "mcmaster", "amazon",
    ]),
    ("Utilities", "#7fd6e8", False, [
        "electric", "water", "comcast", "internet", "utility", "verizon", "at&t",
    ]),
    ("Subscriptions", "#b6c95a", False, [
        "netflix", "spotify", "adobe", "hetzner", "aws", "github", "apple.com",
        "subscription",
    ]),
    # Payment is excluded from spend totals/charts.
    ("Payment", "#5a626d", True, [
        "payment", "autopay", "thank you", "transfer", "online pmt",
    ]),
    ("Other", "#9aa3ad", True, []),
    ("Uncategorized", "#c0392b", True, []),
]


def seed_if_empty(db: Session) -> None:
    """Seed default categories + rules only if the categories table is empty."""
    if db.scalar(select(func.count()).select_from(Category)):
        return

    for sort_order, (name, color, is_system, keywords) in enumerate(DEFAULT_CATEGORIES):
        category = Category(
            name=name, color=color, is_system=is_system, sort_order=sort_order
        )
        category.rules = [CategoryRule(keyword=kw) for kw in keywords]
        db.add(category)

    db.commit()
