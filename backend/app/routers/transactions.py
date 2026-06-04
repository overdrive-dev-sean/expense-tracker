"""Transaction routes: import (dedupe + categorize), list, retag (with learning)."""
import hashlib
from datetime import date as Date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..categorize import FALLBACK_CATEGORY, categorize, merchant_key
from ..kinds import classify_kind, reconcile_card_payments
from ..database import get_db
from ..models import Category, LearnedMerchant, Tag, Transaction
from ..schemas import (
    ImportResult,
    RecategorizeResult,
    TransactionImportItem,
    TransactionOut,
    TransactionPatch,
    TransactionPatchResult,
)

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


def _parse_date(raw: str | None) -> Date | None:
    if not raw:
        return None
    try:
        return Date.fromisoformat(raw.strip()[:10])
    except ValueError:
        return None


def _signature(
    date_str: str, description: str, amount_cents: int, card: str, occurrence: int
) -> str:
    """Fallback dedup signature for rows without a provider reference id.

    Keyed on date|description|amount_cents|card:occurrence — deliberately NOT on
    the import filename (so the same transaction from two different files
    dedupes), but DOES include `card` (so two cards in one file stay distinct)
    and an in-batch occurrence counter (so genuinely repeated identical charges,
    e.g. 3x the same parking fee in a day, are preserved rather than collapsed —
    while a re-import of the same file reproduces the same counters and dedupes).
    """
    raw = f"{date_str}|{description}|{amount_cents}|{card}:{occurrence}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _to_out(t: Transaction) -> TransactionOut:
    return TransactionOut(
        id=t.id,
        date=t.txn_date,
        description=t.description,
        amount=t.amount_cents / 100,
        source=t.source,
        category=t.category.name if t.category else None,
        is_manual=t.is_manual,
        kind=t.kind,
        tags=sorted(tag.name for tag in t.tags),
        details=t.details or None,
    )


def _get_or_create_tag(db: Session, name: str) -> Tag:
    tag = db.scalar(select(Tag).where(Tag.name == name))
    if tag is None:
        tag = Tag(name=name)
        db.add(tag)
        db.flush()
    return tag


@router.post("/import", response_model=ImportResult)
def import_transactions(
    items: list[TransactionImportItem], db: Session = Depends(get_db)
):
    # Seed dedup sets from what's already stored. A row keys off its reference
    # when present, otherwise off the computed signature.
    seen_refs = set(db.scalars(select(Transaction.reference)).all())
    seen_refs.discard(None)
    seen_sigs = set(db.scalars(select(Transaction.signature)).all())
    seen_sigs.discard(None)
    # In-batch occurrence counter per identical (date|desc|cents|card) tuple.
    occurrences: dict[tuple, int] = {}

    def _enrich(filter_):
        """On a re-import dup, fill in statement details if the existing row
        doesn't have them yet. Returns 1 if it enriched, else 0."""
        if not item.details:
            return 0
        existing = db.scalar(select(Transaction).where(filter_))
        if existing is not None and not existing.details:
            existing.details = item.details
            return 1
        return 0

    imported = skipped = enriched = 0
    for item in items:
        txn_date = _parse_date(item.date)
        amount_cents = int(round(item.amount * 100))

        reference = (item.reference or "").strip() or None
        signature = None
        if reference is not None:
            if reference in seen_refs:
                skipped += 1
                enriched += _enrich(Transaction.reference == reference)
                continue
            seen_refs.add(reference)
        else:
            date_str = txn_date.isoformat() if txn_date else ""
            card = (item.card or "").strip()
            # Advance the occurrence counter even if this row ends up skipped, so
            # later identical rows in the batch keep getting the next index.
            key = (date_str, item.description, amount_cents, card)
            occurrences[key] = occurrences.get(key, 0) + 1
            signature = _signature(
                date_str, item.description, amount_cents, card, occurrences[key]
            )
            if signature in seen_sigs:
                skipped += 1
                enriched += _enrich(Transaction.signature == signature)
                continue
            seen_sigs.add(signature)

        kind = classify_kind(item.description, amount_cents)
        category = categorize(db, item.description, hint=item.category_hint, kind=kind)
        db.add(
            Transaction(
                txn_date=txn_date,
                description=item.description,
                amount_cents=amount_cents,
                source=item.source,
                category_id=category.id if category else None,
                is_manual=False,
                kind=kind,
                details=item.details or None,
                reference=reference,
                signature=signature,
            )
        )
        imported += 1

    db.commit()
    # Bank debits that match a credit-card payment = the bank paying the card.
    reconcile_card_payments(db)
    return ImportResult(imported=imported, skipped=skipped, enriched=enriched)


@router.get("", response_model=list[TransactionOut])
def list_transactions(
    category: str | None = None,
    month: str | None = None,
    search: str | None = None,
    tag: str | None = None,
    db: Session = Depends(get_db),
):
    stmt = select(Transaction).outerjoin(Category, Transaction.category_id == Category.id)
    if category:
        stmt = stmt.where(Category.name == category)
    if month:
        stmt = stmt.where(func.strftime("%Y-%m", Transaction.txn_date) == month)
    if search:
        stmt = stmt.where(Transaction.description.ilike(f"%{search}%"))
    if tag:
        stmt = stmt.where(Transaction.tags.any(Tag.name == tag))
    # Most recent first; undated rows sort to the bottom.
    stmt = stmt.order_by(
        Transaction.txn_date.is_(None),
        Transaction.txn_date.desc(),
        Transaction.id.desc(),
    )
    return [_to_out(t) for t in db.scalars(stmt).all()]


@router.post("/recategorize", response_model=RecategorizeResult)
def recategorize(db: Session = Depends(get_db)):
    """Re-categorize non-manual rows, NON-DESTRUCTIVELY:
      - fill in rows that are currently Uncategorized, and
      - propagate learned-merchant rules (from your manual tags).
    It never downgrades an already-categorized row to Uncategorized and never
    re-classifies a categorized row on a bare keyword match — so categories that
    came from a provider's own category column (which the keyword engine can't
    reproduce) are preserved. Manual tags are left untouched.

    Also recomputes each row's `kind` (derived from description + amount) and
    reconciles bank-paid card payments, so improvements to those rules reach
    already-imported data."""
    for t in db.scalars(select(Transaction)).all():
        t.kind = classify_kind(t.description, t.amount_cents)
    db.commit()  # persist kind changes (the category pass below may not commit)
    reconcile_card_payments(db)

    learned_keys = set(db.scalars(select(LearnedMerchant.merchant_key)).all())
    rows = db.scalars(
        select(Transaction).where(Transaction.is_manual.is_(False))
    ).all()
    updated = 0
    for t in rows:
        new = categorize(db, t.description, kind=t.kind)
        if new is None or new.name == FALLBACK_CATEGORY:
            continue  # never assign/keep Uncategorized as a change
        current = t.category.name if t.category else None
        is_blank = current is None or current == FALLBACK_CATEGORY
        has_learned = (
            t.kind != "p2p" and merchant_key(t.description) in learned_keys
        )
        if (is_blank or has_learned) and t.category_id != new.id:
            t.category_id = new.id
            updated += 1
    if updated:
        db.commit()
    return RecategorizeResult(updated=updated, scanned=len(rows))


@router.patch("/{txn_id}", response_model=TransactionPatchResult)
def update_transaction(
    txn_id: int, patch: TransactionPatch, db: Session = Depends(get_db)
):
    txn = db.get(Transaction, txn_id)
    if txn is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # Tags: replace this transaction's tag set (independent of category).
    if patch.tags is not None:
        names = []
        for raw in patch.tags:
            n = (raw or "").strip()
            if n and n not in names:
                names.append(n)
        txn.tags = [_get_or_create_tag(db, n) for n in names]

    applied = 0
    if patch.category is None:
        db.commit()
        db.refresh(txn)
        return TransactionPatchResult(transaction=_to_out(txn), applied=applied)

    category = db.scalar(select(Category).where(Category.name == patch.category))
    if category is None:
        raise HTTPException(
            status_code=400, detail=f"Unknown category '{patch.category}'"
        )

    txn.category_id = category.id
    txn.is_manual = True

    mk = merchant_key(txn.description)
    # P2P payees are individuals sharing a generic merchant key, so we neither
    # learn nor propagate them — each is judged on its own.
    if mk and txn.kind != "p2p":
        # Learn this merchant -> category so future imports auto-sort.
        learned = db.scalar(
            select(LearnedMerchant).where(LearnedMerchant.merchant_key == mk)
        )
        if learned is None:
            db.add(LearnedMerchant(merchant_key=mk, category_id=category.id))
        else:
            learned.category_id = category.id

        # Retroactively apply to other auto-categorized rows of the same merchant.
        others = db.scalars(
            select(Transaction).where(
                Transaction.id != txn.id, Transaction.is_manual.is_(False)
            )
        ).all()
        for o in others:
            if o.category_id != category.id and merchant_key(o.description) == mk:
                o.category_id = category.id
                applied += 1

    db.commit()
    db.refresh(txn)
    return TransactionPatchResult(transaction=_to_out(txn), applied=applied)
