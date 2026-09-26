"""Import configuration and run endpoints."""
import numbers
import os
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import RAWDATA_DIR
from ..db import get_session
from ..importing import (
    csv_files,
    load_configs,
    pending_accounts,
    read_raw_csv,
    run_import,
)
from ..models import ImportConfig
from ..schemas import ImportConfigPut

router = APIRouter(tags=["imports"])

VALID_SIGNS = {"positive", "negative"}


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, numbers.Integral):
        return int(value)
    if isinstance(value, numbers.Real):
        return float(value)
    return value


@router.get("/import/configs")
def get_configs(session: Session = Depends(get_session)) -> dict:
    return {"configs": load_configs(session)}


@router.get("/import/pending")
def get_pending(session: Session = Depends(get_session)) -> list[dict]:
    result = []
    for account in pending_accounts(session):
        paths = csv_files(account)
        sample_path = paths[-1]
        try:
            df = read_raw_csv(sample_path)
        except Exception as exc:  # noqa: BLE001
            result.append(
                {
                    "account": account,
                    "files": [os.path.basename(p) for p in paths],
                    "sample_file": os.path.basename(sample_path),
                    "columns": [],
                    "preview": [],
                    "error": str(exc),
                }
            )
            continue

        preview = [
            {col: _json_safe(val) for col, val in record.items()}
            for record in df.head(5).to_dict(orient="records")
        ]
        result.append(
            {
                "account": account,
                "files": [os.path.basename(p) for p in paths],
                "sample_file": os.path.basename(sample_path),
                "columns": [str(c) for c in df.columns],
                "preview": preview,
            }
        )
    return result


@router.put("/import/configs/{account}")
def put_config(
    account: str,
    body: ImportConfigPut,
    session: Session = Depends(get_session),
) -> dict:
    folder = RAWDATA_DIR / account
    if not os.path.isdir(folder):
        raise HTTPException(status_code=400, detail=f"unknown account folder: {account}")
    paths = csv_files(account)
    if not paths:
        raise HTTPException(status_code=400, detail=f"no CSV files in {account}")

    if body.expenditure_sign not in VALID_SIGNS:
        raise HTTPException(
            status_code=400,
            detail="expenditure_sign must be 'positive' or 'negative'",
        )

    try:
        columns = list(read_raw_csv(paths[-1]).columns)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=400, detail=f"could not read newest CSV: {exc}"
        )

    for field in ("date_column", "amount_column", "description_column"):
        value = getattr(body, field)
        if value not in columns:
            raise HTTPException(
                status_code=400,
                detail=f"{field} {value!r} not found in newest CSV",
            )

    row = session.execute(
        select(ImportConfig).where(ImportConfig.account == account)
    ).scalars().first()
    if row is None:
        row = ImportConfig(account=account)
        session.add(row)
    row.date_column = body.date_column
    row.amount_column = body.amount_column
    row.description_column = body.description_column
    row.expenditure_sign = body.expenditure_sign
    session.commit()
    return {"ok": True, "account": account}


@router.post("/import/run")
def run_import_endpoint(session: Session = Depends(get_session)) -> dict:
    return run_import(session)
