"""Demo/live data-source switching endpoints.

These power the sidebar toggle that swaps the database between the
deterministic demo dataset and the live rawdata import.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_session
from ..demo import load_demo, switch_to_live
from ..settings import get_data_source

router = APIRouter(tags=["demo"])


@router.post("/demo/load")
def activate_demo(session: Session = Depends(get_session)) -> dict:
    """Activate the deterministic demo dataset without touching live data."""
    try:
        count = load_demo(session)
    except Exception as exc:  # noqa: BLE001 - surface a clean API error
        session.rollback()
        raise HTTPException(status_code=500, detail=f"failed to load demo data: {exc}")
    return {
        "data_source": get_data_source(session),
        "transactions": count,
        "message": f"Demo data loaded \u2014 {count} transactions. Imported data was kept.",
    }


@router.post("/demo/live")
def restore_live(session: Session = Depends(get_session)) -> dict:
    """Activate the live dataset, importing any new rawdata files."""
    try:
        result = switch_to_live(session)
    except Exception as exc:  # noqa: BLE001 - surface a clean API error
        session.rollback()
        raise HTTPException(status_code=500, detail=f"failed to restore live data: {exc}")
    return {
        "data_source": get_data_source(session),
        "transactions": result["total"],
        "message": f"Live data restored \u2014 {result['total']} transactions. Demo data was kept.",
    }
