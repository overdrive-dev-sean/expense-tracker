"""Summary route: total spend, spend by category, spend by month.

Spend = true purchases only. Income, transfers, card payments and refunds are
excluded by `kind`; P2P (Zelle/Cash App) sends count only once the user has
manually tagged them. See kinds.py.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Category, Tag, Transaction
from ..schemas import CategorySpend, MonthSpend, SummaryOut

router = APIRouter(prefix="/api/summary", tags=["summary"])

# A row counts as spend if it's a purchase, or a P2P send the user has tagged.
_SPEND = or_(
    Transaction.kind == "purchase",
    and_(Transaction.kind == "p2p", Transaction.is_manual.is_(True)),
)


@router.get("", response_model=SummaryOut)
def get_summary(tag: str | None = None, db: Session = Depends(get_db)):
    # Optionally scope the whole report to a tag sub-group.
    def _spend_filter(stmt):
        stmt = stmt.where(_SPEND)
        if tag:
            stmt = stmt.where(Transaction.tags.any(Tag.name == tag))
        return stmt

    cat_stmt = _spend_filter(
        select(
            Category.name,
            Category.color,
            func.sum(Transaction.amount_cents),
        ).join(Transaction, Transaction.category_id == Category.id)
    ).group_by(Category.id).order_by(func.sum(Transaction.amount_cents).desc())

    by_category = [
        CategorySpend(name=name, color=color, cents=int(total))
        for name, color, total in db.execute(cat_stmt).all()
    ]
    total_spend_cents = sum(c.cents for c in by_category)

    month_expr = func.strftime("%Y-%m", Transaction.txn_date)
    month_stmt = _spend_filter(
        select(month_expr, func.sum(Transaction.amount_cents))
        .join(Category, Transaction.category_id == Category.id)
        .where(Transaction.txn_date.is_not(None))
    ).group_by(month_expr).order_by(month_expr)

    by_month = [
        MonthSpend(month=month, cents=int(total))
        for month, total in db.execute(month_stmt).all()
    ]

    return SummaryOut(
        total_spend_cents=total_spend_cents,
        by_category=by_category,
        by_month=by_month,
    )
