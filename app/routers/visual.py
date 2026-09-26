"""Visualization data endpoint.

Spreads each transaction across its timescale -> timescale_end range in a
single SQL statement, then groups by (day, category, necessity_level).
"""
import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from ..db import get_session

router = APIRouter(tags=["visual"])

_BASE_SQL = """
SELECT gs::date AS date,
       t.category AS category,
       t.necessity_level AS necessity_level,
       SUM(t.amount / d.divisor) AS amount
FROM transactions t
CROSS JOIN LATERAL (
    SELECT GREATEST((t.timescale_end - t.timescale) + 1, 1) AS divisor
) d
CROSS JOIN LATERAL generate_series(
    t.timescale,
    GREATEST(t.timescale, t.timescale_end),
    interval '1 day'
) AS gs
WHERE t.ignore = false
"""


@router.get("/visual/data")
def visual_data(
    date_start: Optional[datetime.date] = None,
    date_end: Optional[datetime.date] = None,
    category: list[str] = Query(default=[]),
    necessity: list[str] = Query(default=[]),
    session: Session = Depends(get_session),
) -> dict:
    sql = _BASE_SQL
    params: dict = {}
    expanding: list[str] = []

    if date_start is not None:
        sql += " AND gs::date >= :date_start"
        params["date_start"] = date_start
    if date_end is not None:
        sql += " AND gs::date <= :date_end"
        params["date_end"] = date_end
    if category:
        sql += " AND t.category IN :cats"
        params["cats"] = category
        expanding.append("cats")
    if necessity:
        sql += " AND t.necessity_level IN :necs"
        params["necs"] = necessity
        expanding.append("necs")

    sql += " GROUP BY 1, 2, 3 ORDER BY 1"

    stmt = text(sql)
    for name in expanding:
        stmt = stmt.bindparams(bindparam(name, expanding=True))

    rows = session.execute(stmt, params).all()
    return {
        "rows": [
            {
                "date": row.date.isoformat(),
                "amount": float(row.amount),
                "category": row.category or "",
                "necessity_level": row.necessity_level or "",
            }
            for row in rows
        ]
    }
