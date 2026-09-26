"""Transaction listing, editing, and manual creation endpoints."""
import datetime
import math
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..categorize import income_category_name
from ..db import get_session
from ..dedup import make_dedup_key
from ..models import Transaction
from ..schemas import TransactionCreate, TransactionUpdateRequest

router = APIRouter(tags=["transactions"])

SORT_COLUMNS = {
    "date": Transaction.date,
    "amount": Transaction.amount,
    "description": Transaction.description,
    "account": Transaction.account,
    "category": Transaction.category,
    "necessity_level": Transaction.necessity_level,
}


def transaction_out(tx: Transaction) -> dict:
    return {
        "id": tx.id,
        "date": tx.date.isoformat(),
        "amount": round(float(tx.amount), 2),
        "description": tx.description,
        "account": tx.account,
        "category": tx.category,
        "necessity_level": tx.necessity_level,
        "timescale": tx.timescale.isoformat(),
        "timescale_end": tx.timescale_end.isoformat(),
        "ignore": bool(tx.ignore),
        "dedup_key": tx.dedup_key,
        "is_income": float(tx.amount) > 0,
    }


@router.get("/transactions")
def list_transactions(
    date_start: Optional[datetime.date] = None,
    date_end: Optional[datetime.date] = None,
    category: list[str] = Query(default=[]),
    necessity: list[str] = Query(default=[]),
    account: list[str] = Query(default=[]),
    hide_ignored: bool = True,
    uncategorized_only: bool = False,
    search: str = "",
    page: int = 1,
    page_size: int = 100,
    sort: str = "date",
    order: str = "desc",
    session: Session = Depends(get_session),
) -> dict:
    if page < 1:
        page = 1
    page_size = max(1, min(page_size, 500))
    sort = sort if sort in SORT_COLUMNS else "date"
    order = order.lower() if order.lower() in {"asc", "desc"} else "desc"

    filters = []
    if date_start is not None:
        filters.append(Transaction.date >= date_start)
    if date_end is not None:
        filters.append(Transaction.date <= date_end)
    if uncategorized_only:
        filters.append(Transaction.ignore.is_(False))
        filters.append(
            or_(Transaction.category == "", Transaction.necessity_level == "")
        )
    else:
        if hide_ignored:
            filters.append(Transaction.ignore.is_(False))
        if category:
            filters.append(Transaction.category.in_(category))
        if necessity:
            filters.append(Transaction.necessity_level.in_(necessity))
    if account:
        filters.append(Transaction.account.in_(account))
    if search:
        filters.append(Transaction.description.ilike(f"%{search}%"))

    total = session.execute(
        select(func.count()).select_from(Transaction).where(*filters)
    ).scalar_one()

    column = SORT_COLUMNS[sort]
    ordering = column.asc() if order == "asc" else column.desc()
    items = session.execute(
        select(Transaction)
        .where(*filters)
        .order_by(ordering, Transaction.id.desc() if order == "desc" else Transaction.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).scalars().all()

    pages = math.ceil(total / page_size) if total else 0
    return {
        "items": [transaction_out(tx) for tx in items],
        "total": int(total),
        "page": page,
        "page_size": page_size,
        "pages": pages,
    }


@router.patch("/transactions")
def patch_transactions(
    body: TransactionUpdateRequest,
    session: Session = Depends(get_session),
) -> dict:
    updates = body.updates
    if not updates:
        return {"updated": 0}

    ids = [u.id for u in updates]
    found = {
        tx.id: tx
        for tx in session.execute(
            select(Transaction).where(Transaction.id.in_(ids))
        ).scalars().all()
    }
    for tx_id in ids:
        if tx_id not in found:
            raise HTTPException(status_code=404, detail=f"transaction {tx_id} not found")

    parsed: list[tuple[Transaction, dict]] = []
    for item in updates:
        provided = item.model_dump(exclude_unset=True, exclude={"id"})
        changes: dict = {}
        for field in ("category", "necessity_level", "ignore"):
            if field in provided:
                changes[field] = provided[field]
        for field in ("timescale", "timescale_end"):
            if field in provided:
                raw = provided[field]
                if raw is None:
                    continue
                try:
                    changes[field] = datetime.date.fromisoformat(str(raw))
                except ValueError:
                    raise HTTPException(
                        status_code=400,
                        detail=f"invalid date for {field}: {raw!r}",
                    )
        parsed.append((found[item.id], changes))

    for tx, changes in parsed:
        for field, value in changes.items():
            setattr(tx, field, value)

    session.commit()
    return {"updated": len(parsed)}


@router.post("/transactions", status_code=201)
def create_transaction(
    body: TransactionCreate,
    session: Session = Depends(get_session),
) -> dict:
    description = (body.description or "").strip()
    account = (body.account or "").strip()
    if not description:
        raise HTTPException(status_code=400, detail="description is required")
    if not account:
        raise HTTPException(status_code=400, detail="account is required")

    amount = float(body.amount)
    category = body.category or ""
    if amount > 0 and not category:
        # Follow whichever row currently carries the is_income flag, since the
        # Income category may have been renamed.
        category = income_category_name(session)

    tx = Transaction(
        date=body.date,
        amount=amount,
        description=description,
        account=account,
        category=category,
        necessity_level=body.necessity_level or "",
        timescale=body.date,
        timescale_end=body.date,
        ignore=False,
        dedup_key=make_dedup_key(body.date, amount, description),
    )
    session.add(tx)
    session.commit()
    session.refresh(tx)
    return transaction_out(tx)
