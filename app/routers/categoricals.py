"""Category and necessity-level management endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import CategorizationRule, Category, NecessityLevel, Transaction
from ..schemas import CategoryCreate, NecessityLevelCreate, RenameRequest

router = APIRouter(tags=["categoricals"])


# --------------------------------------------------------------------------- #
# Categories
# --------------------------------------------------------------------------- #
def _category_counts(session: Session) -> dict[str, int]:
    return dict(
        session.execute(
            select(Transaction.category, func.count())
            .group_by(Transaction.category)
            .having(Transaction.category != "")
        ).all()
    )


def _category_out(row: Category, counts: dict[str, int]) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "sort_order": row.sort_order,
        "is_income": row.is_income,
        "count": int(counts.get(row.name, 0)),
    }


@router.get("/categories")
def list_categories(session: Session = Depends(get_session)) -> list[dict]:
    counts = _category_counts(session)
    rows = session.execute(
        select(Category).order_by(Category.sort_order, Category.id)
    ).scalars().all()
    return [_category_out(row, counts) for row in rows]


@router.post("/categories", status_code=201)
def add_category(
    body: CategoryCreate,
    session: Session = Depends(get_session),
) -> dict:
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    exists = session.execute(
        select(Category.id).where(Category.name == name)
    ).first()
    if exists is not None:
        raise HTTPException(status_code=409, detail="category already exists")

    max_order = session.execute(select(func.max(Category.sort_order))).scalar()
    row = Category(
        name=name,
        sort_order=(max_order + 1) if max_order is not None else 0,
        is_income=False,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _category_out(row, {})


@router.patch("/categories/{category_id}")
def rename_category(
    category_id: int,
    body: RenameRequest,
    session: Session = Depends(get_session),
) -> dict:
    row = session.get(Category, category_id)
    if row is None:
        raise HTTPException(status_code=404, detail="category not found")

    new_name = (body.new_name or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="new_name is required")
    if new_name == row.name:
        raise HTTPException(status_code=400, detail="new_name is unchanged")

    duplicate = session.execute(
        select(Category.id).where(Category.name == new_name, Category.id != category_id)
    ).first()
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="category already exists")

    old_name = row.name
    row.name = new_name

    tx_result = session.execute(
        update(Transaction)
        .where(Transaction.category == old_name)
        .values(category=new_name)
    )
    session.execute(
        update(CategorizationRule)
        .where(CategorizationRule.category == old_name)
        .values(category=new_name)
    )
    session.commit()
    return {"updated_transactions": int(tx_result.rowcount or 0)}


@router.delete("/categories/{category_id}")
def delete_category(
    category_id: int,
    session: Session = Depends(get_session),
) -> dict:
    row = session.get(Category, category_id)
    if row is None:
        raise HTTPException(status_code=404, detail="category not found")
    if row.is_income:
        raise HTTPException(status_code=400, detail="Income category cannot be deleted")

    name = row.name
    tx_result = session.execute(
        update(Transaction)
        .where(Transaction.category == name)
        .values(category="")
    )
    session.execute(
        delete(CategorizationRule).where(CategorizationRule.category == name)
    )
    session.delete(row)
    session.commit()
    return {"cleared_transactions": int(tx_result.rowcount or 0)}


# --------------------------------------------------------------------------- #
# Necessity levels
# --------------------------------------------------------------------------- #
def _necessity_counts(session: Session) -> dict[str, int]:
    return dict(
        session.execute(
            select(Transaction.necessity_level, func.count())
            .group_by(Transaction.necessity_level)
            .having(Transaction.necessity_level != "")
        ).all()
    )


def _necessity_out(row: NecessityLevel, counts: dict[str, int]) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "sort_order": row.sort_order,
        "count": int(counts.get(row.name, 0)),
    }


@router.get("/necessity-levels")
def list_necessity_levels(session: Session = Depends(get_session)) -> list[dict]:
    counts = _necessity_counts(session)
    rows = session.execute(
        select(NecessityLevel).order_by(NecessityLevel.sort_order, NecessityLevel.id)
    ).scalars().all()
    return [_necessity_out(row, counts) for row in rows]


@router.post("/necessity-levels", status_code=201)
def add_necessity_level(
    body: NecessityLevelCreate,
    session: Session = Depends(get_session),
) -> dict:
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    exists = session.execute(
        select(NecessityLevel.id).where(NecessityLevel.name == name)
    ).first()
    if exists is not None:
        raise HTTPException(status_code=409, detail="necessity level already exists")

    max_order = session.execute(select(func.max(NecessityLevel.sort_order))).scalar()
    row = NecessityLevel(
        name=name,
        sort_order=(max_order + 1) if max_order is not None else 0,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _necessity_out(row, {})


@router.patch("/necessity-levels/{level_id}")
def rename_necessity_level(
    level_id: int,
    body: RenameRequest,
    session: Session = Depends(get_session),
) -> dict:
    row = session.get(NecessityLevel, level_id)
    if row is None:
        raise HTTPException(status_code=404, detail="necessity level not found")

    new_name = (body.new_name or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="new_name is required")
    if new_name == row.name:
        raise HTTPException(status_code=400, detail="new_name is unchanged")

    duplicate = session.execute(
        select(NecessityLevel.id).where(
            NecessityLevel.name == new_name, NecessityLevel.id != level_id
        )
    ).first()
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="necessity level already exists")

    old_name = row.name
    row.name = new_name

    tx_result = session.execute(
        update(Transaction)
        .where(Transaction.necessity_level == old_name)
        .values(necessity_level=new_name)
    )
    session.execute(
        update(CategorizationRule)
        .where(CategorizationRule.necessity_level == old_name)
        .values(necessity_level=new_name)
    )
    session.commit()
    return {"updated_transactions": int(tx_result.rowcount or 0)}


@router.delete("/necessity-levels/{level_id}")
def delete_necessity_level(
    level_id: int,
    session: Session = Depends(get_session),
) -> dict:
    row = session.get(NecessityLevel, level_id)
    if row is None:
        raise HTTPException(status_code=404, detail="necessity level not found")

    name = row.name
    tx_result = session.execute(
        update(Transaction)
        .where(Transaction.necessity_level == name)
        .values(necessity_level="")
    )
    session.execute(
        delete(CategorizationRule).where(CategorizationRule.necessity_level == name)
    )
    session.delete(row)
    session.commit()
    return {"cleared_transactions": int(tx_result.rowcount or 0)}
