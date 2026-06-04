"""Tag listing — the set of sub-group labels in use, with transaction counts."""
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Tag, transaction_tags
from ..schemas import TagOut

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=list[TagOut])
def list_tags(db: Session = Depends(get_db)):
    count_col = func.count(transaction_tags.c.transaction_id)
    rows = db.execute(
        select(Tag.name, count_col)
        .outerjoin(transaction_tags, Tag.id == transaction_tags.c.tag_id)
        .group_by(Tag.id)
        .having(count_col > 0)  # hide empty sub-groups
        .order_by(Tag.name)
    ).all()
    return [TagOut(name=name, count=count) for name, count in rows]
