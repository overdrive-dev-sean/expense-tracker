"""Categorization engine + merchant-key normalization.

Priority order for a description:
  1. Exact merchant_key match in learned_merchants.
  2. First category whose any keyword is a substring of the lowercased
     description (skipping "Other" and "Uncategorized").
  3. Provider category hint (pre-mapped client-side), if it names a real
     category — so keyword/learned rules above always win.
  4. Fallback: "Uncategorized".
"""
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Category, CategoryRule, LearnedMerchant

# Categories never matched by keyword scanning.
SKIP_KEYWORD_MATCH = {"Other", "Uncategorized"}
FALLBACK_CATEGORY = "Uncategorized"

_NON_KEY_CHARS = re.compile(r"[0-9#*]+")
_WHITESPACE = re.compile(r"\s+")


def _keyword_matches(keyword: str, text: str) -> bool:
    """True if `keyword` appears at the START of a word in `text` (left word
    boundary). So "mobil" matches "exxon mobil" but not "tmobile", while prefix
    keywords like "american air" still match "american airlines". Both keyword
    and text are already lowercased."""
    return re.search(rf"(?<!\w){re.escape(keyword)}", text) is not None


def merchant_key(description: str) -> str:
    """Normalize a description into a stable learned-merchant lookup key:
    lowercase, strip digits/#/*, collapse whitespace, first 3 tokens joined.
    """
    s = (description or "").lower()
    s = _NON_KEY_CHARS.sub(" ", s)
    s = _WHITESPACE.sub(" ", s).strip()
    return " ".join(s.split(" ")[:3])


def categorize(
    db: Session, description: str, hint: str | None = None, kind: str | None = None
) -> Category:
    """Resolve a Category for the given description, following the priority
    order above. Always returns a real Category row (falls back to
    "Uncategorized", which the seed guarantees exists)."""
    desc_lower = (description or "").lower()

    # P2P sends (Zelle/Cash App) are individual and ambiguous — default them to
    # Uncategorized for manual review, regardless of keywords like "payment".
    if kind == "p2p":
        return db.scalar(select(Category).where(Category.name == FALLBACK_CATEGORY))

    # 1. Learned merchant mapping.
    mk = merchant_key(description)
    if mk:
        learned = db.scalar(
            select(LearnedMerchant).where(LearnedMerchant.merchant_key == mk)
        )
        if learned is not None:
            return learned.category

    # 2. Keyword rules, in category sort order.
    categories = db.scalars(
        select(Category).order_by(Category.sort_order, Category.id)
    ).all()
    for cat in categories:
        if cat.name in SKIP_KEYWORD_MATCH:
            continue
        for rule in cat.rules:
            if rule.keyword and _keyword_matches(rule.keyword, desc_lower):
                return cat

    # 3. Provider category hint, if it names a real (non-fallback) category.
    if hint:
        hinted = db.scalar(select(Category).where(Category.name == hint))
        if hinted is not None and hinted.name != FALLBACK_CATEGORY:
            return hinted

    # 4. Fallback.
    fallback = db.scalar(select(Category).where(Category.name == FALLBACK_CATEGORY))
    return fallback
