"""Generic CSV import engine (port of budget3.0's import_config/preprocessing).

Reads every configured account folder under RAWDATA_DIR, parses the CSVs using
the per-account column configuration stored in PostgreSQL, and inserts new
transactions. Duplicate (date, amount, description) rows are skipped forever.
"""
import datetime
import html
import numbers
import os
from typing import Any

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .categorize import income_category_name
from .config import RAWDATA_DIR
from .dedup import make_dedup_key
from .models import ImportConfig, Transaction
from .settings import is_demo


def account_folders() -> list[str]:
    """Sorted names of subdirectories under RAWDATA_DIR."""
    if not os.path.isdir(RAWDATA_DIR):
        return []
    return sorted(
        d
        for d in os.listdir(RAWDATA_DIR)
        if os.path.isdir(os.path.join(RAWDATA_DIR, d))
    )


def csv_files(account: str) -> list[str]:
    """Sorted full paths of .csv files (case-insensitive) in an account folder."""
    folder = os.path.join(RAWDATA_DIR, account)
    if not os.path.isdir(folder):
        return []
    return sorted(
        os.path.join(folder, f)
        for f in os.listdir(folder)
        if f.lower().endswith(".csv") and os.path.isfile(os.path.join(folder, f))
    )


def read_raw_csv(path: str) -> pd.DataFrame:
    """Read a raw bank CSV, falling back to latin-1 on decode errors.

    ``index_col=False`` prevents pandas from treating column 0 as the index when
    exports have a trailing comma on every data row (one extra field vs header).
    If the fast C parser rejects ragged rows (e.g. a trailing comma on only some
    rows), retry with the pure-python engine, which tolerates inconsistent field
    counts instead of discarding the whole file. The two engines produce
    byte-identical frames for all real bank exports (verified), so this fallback
    only changes behaviour for otherwise-unparseable files.
    """
    last_error: Exception | None = None
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            df = pd.read_csv(path, index_col=False, encoding=encoding)
        except UnicodeDecodeError as exc:
            last_error = exc
            continue
        except pd.errors.ParserError:
            df = pd.read_csv(
                path, index_col=False, encoding=encoding, engine="python"
            )
        df.columns = df.columns.str.strip()
        return df
    assert last_error is not None
    raise last_error


def parse_amount(val: Any) -> float:
    """Parse a raw amount, handling plain numbers, $/comma formatting and
    accounting-style "($16.82)" (negative). Returns NaN on failure."""
    if isinstance(val, numbers.Real):
        return float(val)
    s = str(val).strip()
    negative = s.startswith("(") and s.endswith(")")
    s = s.strip("()").replace("$", "").replace(",", "").strip()
    try:
        v = float(s)
    except ValueError:
        return float("nan")
    return -v if negative else v


def parse_dates(series: pd.Series) -> pd.Series:
    """Parse a date column, trying %m/%d/%Y first then flexible parsing."""
    dates = pd.to_datetime(series, format="%m/%d/%Y", errors="coerce")
    if dates.isna().any():
        dates = dates.fillna(pd.to_datetime(series, errors="coerce"))
    return dates


def load_file(path: str, account: str, cfg: dict) -> tuple[pd.DataFrame, list[str]]:
    """Parse one CSV into a DataFrame with date/amount/description/account.

    Returns ``(df, warnings)``; rows with unparseable date or amount are dropped.
    Raises KeyError if a configured column is missing.
    """
    df = read_raw_csv(path)
    for key in ("date_column", "amount_column", "description_column"):
        if cfg[key] not in df.columns:
            raise KeyError(
                f"column {cfg[key]!r} not found (has: {list(df.columns)})"
            )

    out = pd.DataFrame()
    dates = parse_dates(df[cfg["date_column"]])
    out["date"] = dates.dt.strftime("%Y-%m-%d")
    out["amount"] = df[cfg["amount_column"]].apply(parse_amount)
    if cfg["expenditure_sign"] == "positive":
        out["amount"] = out["amount"] * -1
    out["description"] = (
        df[cfg["description_column"]].astype(str).str.strip().apply(html.unescape)
    )
    out["account"] = account

    warnings: list[str] = []
    bad = dates.isna() | out["amount"].isna()
    if bad.any():
        warnings.append(
            f"skipped {int(bad.sum())} row(s) with unparseable date/amount in "
            f"{os.path.basename(path)}"
        )
        out = out[~bad]
    return out, warnings


def load_configs(session: Session) -> dict[str, dict]:
    """Return {account: config-dict} from the import_configs table."""
    rows = session.execute(select(ImportConfig)).scalars().all()
    return {
        row.account: {
            "date_column": row.date_column,
            "amount_column": row.amount_column,
            "description_column": row.description_column,
            "expenditure_sign": row.expenditure_sign,
        }
        for row in rows
    }


def pending_accounts(session: Session) -> list[str]:
    """Account folders containing >=1 CSV with no import config row."""
    if is_demo(session):
        return []
    configured = set(session.execute(select(ImportConfig.account)).scalars().all())
    return [
        a for a in account_folders() if a not in configured and csv_files(a)
    ]


def run_import(session: Session) -> dict:
    """Import all configured account folders. Returns a summary dict.

    Existing rows are never mutated; only new transactions are inserted.
    Each account is written inside its own SAVEPOINT, so a failure for one
    account is isolated and cannot discard rows staged for earlier accounts
    (nor leave the returned ``added`` counter or dedup set inconsistent).
    """
    if is_demo(session):
        total = session.execute(
            select(func.count()).select_from(Transaction)
        ).scalar_one()
        return {
            "added": 0,
            "total": int(total),
            "accounts": [],
            "skipped": [],
            "demo_mode": True,
        }

    configs = load_configs(session)
    existing: set[str] = set(
        session.execute(select(Transaction.dedup_key)).scalars().all()
    )
    income_name = income_category_name(session)

    added = 0
    added_keys: set[str] = set()
    accounts_out: list[dict] = []
    skipped: list[dict] = []

    for account in account_folders():
        cfg = configs.get(account)
        if cfg is None:
            if csv_files(account):
                skipped.append({"account": account, "reason": "unconfigured"})
            continue

        files = csv_files(account)
        warnings: list[str] = []
        staged: list[tuple[str, Transaction]] = []
        # Keys staged for this account, de-duped locally so repeats across
        # files in the same account are collapsed even before the savepoint
        # commits. Merged into added_keys only on success.
        local_keys: set[str] = set()

        try:
            for path in files:
                try:
                    df, file_warnings = load_file(path, account, cfg)
                except Exception as exc:  # noqa: BLE001 - keep importing other files
                    warnings.append(
                        f"could not parse {os.path.basename(path)}: {exc}"
                    )
                    continue
                warnings.extend(file_warnings)

                for row in df.itertuples(index=False):
                    amount = float(row.amount)
                    description = row.description
                    key = make_dedup_key(row.date, amount, description)
                    if key in existing or key in added_keys or key in local_keys:
                        continue
                    local_keys.add(key)
                    category = income_name if amount > 0 else ""
                    tx_date = datetime.date.fromisoformat(row.date)
                    staged.append(
                        (
                            key,
                            Transaction(
                                date=tx_date,
                                amount=amount,
                                description=description,
                                account=account,
                                category=category,
                                necessity_level="",
                                timescale=tx_date,
                                timescale_end=tx_date,
                                ignore=False,
                                dedup_key=key,
                            ),
                        )
                    )
        except Exception as exc:  # noqa: BLE001 - parsing/row errors per account
            skipped.append({"account": account, "reason": f"error: {exc}"})
            continue

        if staged:
            try:
                with session.begin_nested():
                    for _key, tx in staged:
                        session.add(tx)
            except Exception as exc:  # noqa: BLE001 - isolate this account
                skipped.append({"account": account, "reason": f"error: {exc}"})
                continue

            added_keys |= local_keys
            added += len(staged)

        accounts_out.append(
            {
                "account": account,
                "files": len(files),
                "added": len(staged),
                "warnings": warnings,
            }
        )

    session.commit()
    total = session.execute(select(func.count()).select_from(Transaction)).scalar_one()

    return {
        "added": added,
        "total": int(total),
        "accounts": accounts_out,
        "skipped": skipped,
    }
