"""Auto-categorization rule and review endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..categorize import add_rule, approve, deny, review_scan
from ..db import get_session
from ..models import CategorizationRule
from ..schemas import ReviewKeys, RuleCreate

router = APIRouter(tags=["rules"])


def _rule_out(row: CategorizationRule) -> dict:
    return {
        "id": row.id,
        "regex": row.regex,
        "category": row.category,
        "necessity_level": row.necessity_level,
    }


@router.get("/rules")
def list_rules(session: Session = Depends(get_session)) -> list[dict]:
    rows = session.execute(
        select(CategorizationRule).order_by(CategorizationRule.id)
    ).scalars().all()
    return [_rule_out(row) for row in rows]


@router.post("/rules", status_code=201)
def create_rule(
    body: RuleCreate,
    session: Session = Depends(get_session),
) -> dict:
    try:
        rule = add_rule(session, body.regex, body.category, body.necessity_level)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _rule_out(rule)


@router.delete("/rules/{rule_id}")
def delete_rule(
    rule_id: int,
    session: Session = Depends(get_session),
) -> dict:
    row = session.get(CategorizationRule, rule_id)
    if row is None:
        raise HTTPException(status_code=404, detail="rule not found")
    session.delete(row)
    session.commit()
    return {"deleted": True}


@router.post("/rules/review")
def review(session: Session = Depends(get_session)) -> dict:
    return review_scan(session)


@router.post("/rules/review/approve")
def review_approve(
    body: ReviewKeys,
    session: Session = Depends(get_session),
) -> dict:
    return approve(session, body.keys)


@router.post("/rules/review/deny")
def review_deny(
    body: ReviewKeys,
    session: Session = Depends(get_session),
) -> dict:
    return deny(session, body.keys)
