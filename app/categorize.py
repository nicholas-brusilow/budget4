"""Auto-categorization: rule validation, review scanning, approve/deny.

Port of budget3.0's auto_categorize.py, but reviewed keys and rules live in
PostgreSQL instead of a JSON file.
"""
import re

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from .models import (
    CategorizationRule,
    Category,
    NecessityLevel,
    ReviewedTransaction,
    Transaction,
)


def _reviewed_subquery():
    return select(ReviewedTransaction.dedup_key)


def income_category_name(session: Session) -> str:
    """Current name of the category flagged ``is_income`` (default ``Income``).

    The Income category can be renamed; auto-labeling of positive amounts must
    follow whichever row still carries the ``is_income`` flag.
    """
    name = session.execute(
        select(Category.name)
        .where(Category.is_income.is_(True))
        .order_by(Category.id)
    ).scalars().first()
    return name or "Income"


def mark_reviewed(session: Session, keys) -> None:
    """Record dedup keys as reviewed so they are never proposed again."""
    unique = list(dict.fromkeys(k for k in keys if k))
    if not unique:
        return
    session.execute(
        pg_insert(ReviewedTransaction)
        .values([{"dedup_key": k} for k in unique])
        .on_conflict_do_nothing(index_elements=["dedup_key"])
    )


def add_rule(session: Session, regex: str, category: str, necessity_level: str):
    """Validate and persist a rule. Raises ValueError on any validation failure."""
    regex = (regex or "").strip()
    category = (category or "").strip()
    necessity_level = (necessity_level or "").strip()

    if not regex or not category or not necessity_level:
        raise ValueError("Regex, category, and necessity level are required.")
    try:
        re.compile(regex)
    except re.error:
        raise ValueError("Invalid regular expression.")

    duplicate = session.execute(
        select(CategorizationRule).where(
            CategorizationRule.regex == regex,
            CategorizationRule.category == category,
            CategorizationRule.necessity_level == necessity_level,
        )
    ).scalars().first()
    if duplicate is not None:
        raise ValueError("That rule already exists.")

    category_exists = session.execute(
        select(Category.id).where(Category.name == category)
    ).first()
    if category_exists is None:
        raise ValueError(f"Unknown category: {category}")

    necessity_exists = session.execute(
        select(NecessityLevel.id).where(NecessityLevel.name == necessity_level)
    ).first()
    if necessity_exists is None:
        raise ValueError(f"Unknown necessity level: {necessity_level}")

    rule = CategorizationRule(
        regex=regex, category=category, necessity_level=necessity_level
    )
    session.add(rule)
    session.commit()
    return rule


def _compile_rules(session: Session):
    rules = session.execute(select(CategorizationRule)).scalars().all()
    return [(re.compile(r.regex, re.IGNORECASE), r) for r in rules]


def review_scan(session: Session) -> dict:
    """Scan uncategorized transactions and propose matches.

    Transactions matching no rule are immediately marked reviewed. Transactions
    matching multiple rules are returned but left unreviewed.
    """
    pending = session.execute(
        select(Transaction)
        .where(
            Transaction.ignore.is_(False),
            Transaction.category == "",
            Transaction.necessity_level == "",
            Transaction.dedup_key.not_in(_reviewed_subquery()),
        )
        .order_by(Transaction.date, Transaction.id)
    ).scalars().all()

    if not pending:
        return {
            "pending_count": 0,
            "proposals": [],
            "multi_match": [],
            "no_match_count": 0,
        }

    compiled = _compile_rules(session)

    proposals: list[dict] = []
    multi_match: list[dict] = []
    no_match_keys: list[str] = []

    for tx in pending:
        description = tx.description or ""
        matched = [rule for rc, rule in compiled if rc.search(description)]
        if len(matched) == 1:
            rule = matched[0]
            proposals.append(
                {
                    "dedup_key": tx.dedup_key,
                    "date": tx.date.isoformat(),
                    "amount": round(float(tx.amount), 2),
                    "description": description,
                    "account": tx.account,
                    "category": rule.category,
                    "necessity_level": rule.necessity_level,
                    "regex": rule.regex,
                }
            )
        elif len(matched) > 1:
            multi_match.append(
                {
                    "dedup_key": tx.dedup_key,
                    "date": tx.date.isoformat(),
                    "amount": round(float(tx.amount), 2),
                    "description": description,
                    "matched_regexes": [rule.regex for rule in matched],
                }
            )
        else:
            no_match_keys.append(tx.dedup_key)

    mark_reviewed(session, no_match_keys)
    session.commit()

    return {
        "pending_count": len(pending),
        "proposals": proposals,
        "multi_match": multi_match,
        "no_match_count": len(no_match_keys),
    }


def approve(session: Session, keys) -> dict:
    """Apply rules to the given dedup keys when exactly one rule matches."""
    compiled = _compile_rules(session)
    applied = 0
    skipped: list[dict] = []

    for key in keys:
        tx = session.execute(
            select(Transaction).where(Transaction.dedup_key == key)
        ).scalars().first()
        if tx is None or tx.ignore or tx.category or tx.necessity_level:
            skipped.append({"dedup_key": key, "reason": "not_pending"})
            continue

        description = tx.description or ""
        matched = [rule for rc, rule in compiled if rc.search(description)]
        if len(matched) == 1:
            rule = matched[0]
            tx.category = rule.category
            tx.necessity_level = rule.necessity_level
            mark_reviewed(session, [key])
            applied += 1
        elif len(matched) > 1:
            skipped.append({"dedup_key": key, "reason": "multiple_matches"})
        else:
            skipped.append({"dedup_key": key, "reason": "no_match"})

    session.commit()
    return {"applied": applied, "skipped": skipped}


def deny(session: Session, keys) -> dict:
    """Mark the given keys reviewed, leaving their transactions untouched."""
    unique = list(dict.fromkeys(k for k in keys if k))
    mark_reviewed(session, unique)
    session.commit()
    return {"denied": len(unique)}
