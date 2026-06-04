"""Category routes: list, create, delete (reassigning orphaned transactions)."""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Category, LearnedMerchant, Transaction
from ..schemas import CategoryCreate, CategoryOut

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db)):
    return db.scalars(
        select(Category).order_by(Category.sort_order, Category.id)
    ).all()


@router.post("", response_model=CategoryOut, status_code=201)
def create_category(payload: CategoryCreate, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required")
    if db.scalar(select(Category).where(Category.name == name)):
        raise HTTPException(status_code=409, detail=f"Category '{name}' already exists")

    # Slot new user categories just before the first system category (Payment/
    # Other/Uncategorized stay at the end), bumping those down by one.
    first_system_order = db.scalar(
        select(func.min(Category.sort_order)).where(Category.is_system.is_(True))
    )
    if first_system_order is None:
        max_order = db.scalar(select(func.coalesce(func.max(Category.sort_order), -1)))
        new_order = max_order + 1
    else:
        for c in db.scalars(
            select(Category).where(Category.sort_order >= first_system_order)
        ).all():
            c.sort_order += 1
        new_order = first_system_order

    category = Category(
        name=name, color=payload.color, is_system=False, sort_order=new_order
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.delete("/{category_id}", status_code=204)
def delete_category(category_id: int, db: Session = Depends(get_db)):
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")
    if category.is_system:
        raise HTTPException(
            status_code=400, detail="System categories cannot be deleted"
        )

    uncategorized = db.scalar(select(Category).where(Category.name == "Uncategorized"))
    # Reassign this category's transactions to Uncategorized, and drop any
    # learned mappings that pointed at it (they'd otherwise dangle).
    db.execute(
        update(Transaction)
        .where(Transaction.category_id == category_id)
        .values(category_id=uncategorized.id if uncategorized else None)
    )
    db.execute(
        delete(LearnedMerchant).where(LearnedMerchant.category_id == category_id)
    )
    db.delete(category)
    db.commit()
    return Response(status_code=204)
