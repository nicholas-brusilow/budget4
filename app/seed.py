"""Idempotent seeding of categories, necessity levels, and import configs."""
import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import RAWDATA_DIR
from .importing import account_folders
from .models import Category, ImportConfig, NecessityLevel

# Exact display / seeding order. Income is always last and flagged is_income.
CATEGORY_SEED = [
    "Home",
    "Bills & Utilities",
    "Auto & Transport",
    "Groceries",
    "Health & Wellness",
    "Charity",
    "Investment",
    "Tax",
    "Eating Out",
    "Savings",
    "Children",
    "Other Leisure",
    "Shopping",
    "Services",
    "Income",
]
INCOME_CATEGORY = "Income"

NECESSITY_SEED = ["basic", "middle", "luxury", "donation", "investment"]

DEFAULT_CONFIGS = {
    "alliant_cc": {
        "date_column": "Date",
        "amount_column": "Amount",
        "description_column": "Description",
        "expenditure_sign": "positive",
    },
    "alliant_checking": {
        "date_column": "Date",
        "amount_column": "Amount",
        "description_column": "Description",
        "expenditure_sign": "negative",
    },
    "chase_cc": {
        "date_column": "Transaction Date",
        "amount_column": "Amount",
        "description_column": "Description",
        "expenditure_sign": "negative",
    },
    "chase_checking": {
        "date_column": "Posting Date",
        "amount_column": "Amount",
        "description_column": "Description",
        "expenditure_sign": "negative",
    },
    "discover_cc": {
        "date_column": "Trans. Date",
        "amount_column": "Amount",
        "description_column": "Description",
        "expenditure_sign": "positive",
    },
}


def seed(session: Session, demo_mode: bool = False) -> None:
    """Canonicalize seed rows. Safe to call on every startup.

    Existing categories/necessity levels are moved to their canonical sort
    order and income flag; missing ones are inserted. Import configs are only
    seeded for live mode — in demo mode the table has been cleared and should
    stay empty.
    """
    existing_categories = {
        row.name: row
        for row in session.execute(select(Category)).scalars().all()
    }
    for order, name in enumerate(CATEGORY_SEED):
        row = existing_categories.get(name)
        if row is None:
            session.add(
                Category(
                    name=name,
                    sort_order=order,
                    is_income=(name == INCOME_CATEGORY),
                )
            )
        else:
            row.sort_order = order
            row.is_income = name == INCOME_CATEGORY

    existing_necessity = {
        row.name: row
        for row in session.execute(select(NecessityLevel)).scalars().all()
    }
    for order, name in enumerate(NECESSITY_SEED):
        row = existing_necessity.get(name)
        if row is None:
            session.add(NecessityLevel(name=name, sort_order=order))
        else:
            row.sort_order = order

    if not demo_mode:
        existing_accounts = set(
            session.execute(select(ImportConfig.account)).scalars().all()
        )
        folders = set(account_folders())
        for account, cfg in DEFAULT_CONFIGS.items():
            if account in existing_accounts:
                continue
            # Only seed folders that actually exist under RAWDATA_DIR.
            if account not in folders and not os.path.isdir(RAWDATA_DIR / account):
                continue
            session.add(ImportConfig(account=account, **cfg))

    session.commit()
