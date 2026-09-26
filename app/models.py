"""SQLAlchemy 2.x models. All tables are created via Base.metadata.create_all."""
import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,  # noqa: F401  (kept available for future relations)
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_income: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class NecessityLevel(Base):
    __tablename__ = "necessity_levels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ImportConfig(Base):
    __tablename__ = "import_configs"
    __table_args__ = (
        CheckConstraint(
            "expenditure_sign IN ('positive', 'negative')",
            name="ck_import_configs_expenditure_sign",
        ),
    )

    account: Mapped[str] = mapped_column(String(200), primary_key=True)
    date_column: Mapped[str] = mapped_column(String(200), nullable=False)
    amount_column: Mapped[str] = mapped_column(String(200), nullable=False)
    description_column: Mapped[str] = mapped_column(String(200), nullable=False)
    expenditure_sign: Mapped[str] = mapped_column(String(16), nullable=False)


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        Index("ix_transactions_date", "date"),
        Index("ix_transactions_category", "category"),
        Index("ix_transactions_necessity_level", "necessity_level"),
        Index("ix_transactions_account", "account"),
        Index("ix_transactions_ignore", "ignore"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    account: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    category: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    necessity_level: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    timescale: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    timescale_end: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    ignore: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Non-unique: manual entries may legitimately repeat the same key.
    dedup_key: Mapped[str] = mapped_column(Text, nullable=False, index=True)


class CategorizationRule(Base):
    __tablename__ = "categorization_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    regex: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(200), nullable=False)
    necessity_level: Mapped[str] = mapped_column(String(200), nullable=False)


class ReviewedTransaction(Base):
    __tablename__ = "reviewed_transactions"

    dedup_key: Mapped[str] = mapped_column(Text, primary_key=True)
    reviewed_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class AppSetting(Base):
    """Simple key/value store for persistent application settings."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")
