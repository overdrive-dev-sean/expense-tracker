"""Pydantic request/response models. Dollars live only here at the edge;
everything internal is integer cents."""
from datetime import date as Date

from pydantic import BaseModel, ConfigDict


# ── Transactions ─────────────────────────────────────────────
class TransactionImportItem(BaseModel):
    """One normalized CSV row from the client. amount is in dollars.

    A positive amount is a charge (spend); a negative amount is a payment or
    credit/refund. `reference` is the source's genuine transaction id (e.g.
    AmEx "Reference") when present — preferred for dedup.
    """
    date: str | None = None
    description: str
    amount: float
    source: str
    reference: str | None = None
    # `card` distinguishes accounts within one file (e.g. Chase exports two
    # cards) and feeds the fallback dedup signature — NOT the import filename.
    card: str | None = None
    # Provider's own category column, pre-mapped client-side to our scheme.
    # Used only as a fallback hint; keyword/learned rules still override it.
    category_hint: str | None = None
    # Extra source columns (statement descriptor, address, etc.) for lookups.
    details: dict | None = None


class ImportResult(BaseModel):
    imported: int
    skipped: int
    enriched: int = 0  # existing rows that gained statement details on re-import


class TransactionOut(BaseModel):
    id: int
    date: Date | None
    description: str
    amount: float  # dollars
    source: str
    category: str | None
    is_manual: bool
    kind: str | None
    tags: list[str] = []
    details: dict | None = None


class TransactionPatch(BaseModel):
    # Both optional: update category, tags, or both in one request.
    category: str | None = None
    tags: list[str] | None = None


class TransactionPatchResult(BaseModel):
    transaction: TransactionOut
    applied: int  # other same-merchant rows auto-updated by this tag


class RecategorizeResult(BaseModel):
    updated: int
    scanned: int


# ── Categories ───────────────────────────────────────────────
class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: str
    is_system: bool
    sort_order: int


class CategoryCreate(BaseModel):
    name: str
    color: str


class TagOut(BaseModel):
    name: str
    count: int


# ── Summary ──────────────────────────────────────────────────
class CategorySpend(BaseModel):
    name: str
    color: str
    cents: int


class MonthSpend(BaseModel):
    month: str
    cents: int


class SummaryOut(BaseModel):
    total_spend_cents: int
    by_category: list[CategorySpend]
    by_month: list[MonthSpend]
