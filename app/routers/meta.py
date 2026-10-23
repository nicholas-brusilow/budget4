"""Health and metadata endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from ..db import get_session
from ..importing import load_configs, pending_accounts
from ..models import Category, NecessityLevel, Transaction
from ..settings import get_data_source, is_demo

router = APIRouter(tags=["meta"])


@router.get("/health")
def health(session: Session = Depends(get_session)) -> dict:
    try:
        session.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"database unavailable: {exc}")
    return {"status": "ok", "db": "ok"}


@router.get("/meta")
def meta(session: Session = Depends(get_session)) -> dict:
    source = get_data_source(session)
    tx_accounts = set(
        session.execute(
            select(Transaction.account)
            .where(Transaction.account != "", Transaction.data_source == source)
            .distinct()
        ).scalars().all()
    )
    # Import configs describe the live rawdata folders; they are not part of the
    # demo dataset, so only surface them while live is active.
    configured = set(load_configs(session).keys()) if not is_demo(session) else set()
    accounts = sorted(tx_accounts | configured | {"Cash", "Crypto"})

    category_counts = dict(
        session.execute(
            select(Transaction.category, func.count())
            .where(Transaction.data_source == source)
            .group_by(Transaction.category)
            .having(Transaction.category != "")
        ).all()
    )
    categories = [
        {
            "id": row.id,
            "name": row.name,
            "sort_order": row.sort_order,
            "is_income": row.is_income,
            "count": int(category_counts.get(row.name, 0)),
        }
        for row in session.execute(
            select(Category).order_by(Category.sort_order, Category.id)
        ).scalars().all()
    ]

    necessity_counts = dict(
        session.execute(
            select(Transaction.necessity_level, func.count())
            .where(Transaction.data_source == source)
            .group_by(Transaction.necessity_level)
            .having(Transaction.necessity_level != "")
        ).all()
    )
    necessity_levels = [
        {
            "id": row.id,
            "name": row.name,
            "sort_order": row.sort_order,
            "count": int(necessity_counts.get(row.name, 0)),
        }
        for row in session.execute(
            select(NecessityLevel).order_by(NecessityLevel.sort_order, NecessityLevel.id)
        ).scalars().all()
    ]

    date_min, date_max = session.execute(
        select(func.min(Transaction.date), func.max(Transaction.date)).where(
            Transaction.data_source == source
        )
    ).one()
    transaction_count = session.execute(
        select(func.count())
        .select_from(Transaction)
        .where(Transaction.data_source == source)
    ).scalar_one()
    uncategorized_count = session.execute(
        select(func.count())
        .select_from(Transaction)
        .where(
            Transaction.ignore.is_(False),
            Transaction.data_source == source,
            or_(Transaction.category == "", Transaction.necessity_level == ""),
        )
    ).scalar_one()

    return {
        "accounts": accounts,
        "categories": categories,
        "necessity_levels": necessity_levels,
        "date_min": date_min.isoformat() if date_min else None,
        "date_max": date_max.isoformat() if date_max else None,
        "transaction_count": int(transaction_count),
        "uncategorized_count": int(uncategorized_count),
        "pending_accounts": pending_accounts(session),
        "demo_mode": is_demo(session),
    }
