"""SQLAlchemy models. Money is stored as integer cents everywhere."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, Date, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

# Free-form labels for grouping transactions into sub-groups (many-to-many),
# independent of category — e.g. "reimbursable", "2026-taxes", "trip-tokyo".
transaction_tags = Table(
    "transaction_tags",
    Base.metadata,
    Column("transaction_id", ForeignKey("transactions.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    color: Mapped[str] = mapped_column(String, nullable=False)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    rules: Mapped[list["CategoryRule"]] = relationship(
        back_populates="category", cascade="all, delete-orphan"
    )


class CategoryRule(Base):
    __tablename__ = "category_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), nullable=False)
    # lowercase substring matched against the transaction description
    keyword: Mapped[str] = mapped_column(String, nullable=False)

    category: Mapped["Category"] = relationship(back_populates="rules")


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    txn_date: Mapped[Date | None] = mapped_column(Date, nullable=True)
    description: Mapped[str] = mapped_column(String, nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(String, nullable=False)
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id"), nullable=True
    )
    is_manual: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Spend classification (purchase/income/transfer/card_payment/refund/p2p).
    # Makes exclusions from spend explicit; see kinds.py.
    kind: Mapped[str | None] = mapped_column(String, nullable=True)
    # Extra columns from the source statement (Amex "Extended Details", address,
    # "Appears On Your Statement As", etc.) kept as-is for forensic lookups.
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Dedup keys: a row uses exactly ONE. When the CSV provides a genuine
    # transaction id (AmEx "Reference") we key off `reference`; otherwise we
    # fall back to the computed `signature` (date|description|amount_cents).
    # Both are unique-but-nullable so a reference-keyed row and a signature-keyed
    # row never collide. (SQLite permits multiple NULLs in a UNIQUE column.)
    reference: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    signature: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    category: Mapped["Category | None"] = relationship()
    tags: Mapped[list["Tag"]] = relationship(secondary=transaction_tags, lazy="selectin")


class LearnedMerchant(Base):
    __tablename__ = "learned_merchants"

    id: Mapped[int] = mapped_column(primary_key=True)
    merchant_key: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), nullable=False)

    category: Mapped["Category"] = relationship()
