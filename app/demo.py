"""Deterministic demo dataset generator and data-source CLI.

Run ``python -m app.demo reset`` to wipe the live data and install a small,
pre-categorized toy dataset (Jan–Aug 2026). ``python -m app.demo live`` restores
the real rawdata import. ``python -m app.demo status`` prints the current state.
"""
import argparse
import calendar
import datetime
import random
import sys
from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .db import Base, SessionLocal, engine
from .dedup import make_dedup_key
from .importing import run_import
from .models import (
    CategorizationRule,
    Category,
    ImportConfig,
    ReviewedTransaction,
    Transaction,
)
from .seed import CATEGORY_SEED, seed
from .settings import SOURCE_DEMO, SOURCE_LIVE, get_data_source, is_demo, set_data_source

DEMO_CHECKING = "Demo Checking"
DEMO_CREDIT = "Demo Credit Card"
DEMO_SAVINGS = "Demo Savings"

MONTHS = range(1, 9)  # Jan..Aug 2026
_YEAR = 2026


def _date(month: int, day: int) -> datetime.date:
    return datetime.date(_YEAR, month, day)


def _last_day(month: int) -> int:
    return calendar.monthrange(_YEAR, month)[1]


def _tx(
    date: datetime.date,
    amount,
    description: str,
    account: str,
    category: str,
    necessity_level: str,
    ignore: bool = False,
    timescale: datetime.date | None = None,
    timescale_end: datetime.date | None = None,
) -> Transaction:
    """Build a fully categorized Transaction row."""
    amount = Decimal(str(round(float(amount), 2)))
    if not category or not necessity_level:
        raise ValueError(f"demo row {description!r} missing category/necessity")
    return Transaction(
        date=date,
        amount=amount,
        description=description,
        account=account,
        category=category,
        necessity_level=necessity_level,
        timescale=timescale or date,
        timescale_end=timescale_end or date,
        ignore=ignore,
        data_source=SOURCE_DEMO,
        dedup_key=make_dedup_key(date, amount, description),
    )


def build_demo_transactions() -> list[Transaction]:
    """Return the deterministic toy dataset (Jan–Aug 2026).

    A single ``random.Random(42)`` supplies the small amount jitter noted for a
    few merchants, so repeated runs produce byte-identical rows.
    """
    rng = random.Random(42)
    rows: list[Transaction] = []

    # ---- Income: positive, category "Income", necessity "basic" ----
    for m in MONTHS:
        rows.append(_tx(_date(m, 1), 3200.00, "Acme Corp Payroll", DEMO_CHECKING, "Income", "basic"))
        rows.append(_tx(_date(m, 15), 3200.00, "Acme Corp Payroll", DEMO_CHECKING, "Income", "basic"))
        rows.append(_tx(_date(m, 20), 475.00, "Freelance Payment", DEMO_CHECKING, "Income", "basic"))
        rows.append(
            _tx(
                _date(m, _last_day(m)),
                2.15,
                "Interest Payment",
                DEMO_SAVINGS,
                "Income",
                "basic",
            )
        )

    # ---- Bills & Utilities (Demo Checking) ----
    for idx, m in enumerate(MONTHS):
        rows.append(_tx(_date(m, 1), -1650.00, "Rent Payment", DEMO_CHECKING, "Bills & Utilities", "basic"))
        rows.append(
            _tx(
                _date(m, 9),
                -(78.40 + 6.30 * idx),
                "City Power & Light",
                DEMO_CHECKING,
                "Bills & Utilities",
                "basic",
            )
        )
        rows.append(_tx(_date(m, 5), -79.99, "Comcast Internet", DEMO_CHECKING, "Bills & Utilities", "basic"))
        rows.append(_tx(_date(m, 8), -65.00, "Verizon Wireless", DEMO_CHECKING, "Bills & Utilities", "basic"))
        rows.append(_tx(_date(m, 12), -42.35, "City Water Department", DEMO_CHECKING, "Bills & Utilities", "basic"))
        rows.append(_tx(_date(m, 18), -15.49, "Netflix", DEMO_CHECKING, "Bills & Utilities", "luxury"))
        rows.append(_tx(_date(m, 22), -10.99, "Spotify Premium", DEMO_CHECKING, "Bills & Utilities", "middle"))
    rows.append(
        _tx(
            _date(1, 1),
            -960.00,
            "Annual Home Insurance",
            DEMO_CHECKING,
            "Bills & Utilities",
            "basic",
            timescale=_date(1, 1),
            timescale_end=_date(8, 31),
        )
    )

    # ---- Auto & Transport ----
    for m in MONTHS:
        for day in (4, 19):
            rows.append(
                _tx(
                    _date(m, day),
                    -(46.20 + rng.uniform(-6.00, 6.00)),
                    "Shell Gas Station",
                    DEMO_CREDIT,
                    "Auto & Transport",
                    "basic",
                )
            )
        rows.append(_tx(_date(m, 2), -75.00, "Metro Transit Pass", DEMO_CHECKING, "Auto & Transport", "basic"))
    for m in (1, 3, 5, 7, 8):
        rows.append(_tx(_date(m, 7), -12.00, "ParkWhiz", DEMO_CREDIT, "Auto & Transport", "middle"))
    rows.append(
        _tx(
            _date(1, 1),
            -1440.00,
            "Annual Auto Insurance",
            DEMO_CHECKING,
            "Auto & Transport",
            "basic",
            timescale=_date(1, 1),
            timescale_end=_date(8, 31),
        )
    )

    # ---- Groceries ----
    for m in MONTHS:
        for day in (3, 17):
            rows.append(
                _tx(
                    _date(m, day),
                    -(95.00 + rng.uniform(-25.00, 25.00)),
                    "Whole Foods Market",
                    DEMO_CREDIT,
                    "Groceries",
                    "basic",
                )
            )
        rows.append(
            _tx(
                _date(m, 24),
                -(62.00 + rng.uniform(-15.00, 15.00)),
                "Trader Joe's",
                DEMO_CREDIT,
                "Groceries",
                "basic",
            )
        )

    # ---- Eating Out ----
    for m in MONTHS:
        for day in (6, 21):
            rows.append(_tx(_date(m, day), -6.75, "Blue Bottle Coffee", DEMO_CREDIT, "Eating Out", "luxury"))
        rows.append(_tx(_date(m, 14), -48.00, "Local Bistro", DEMO_CREDIT, "Eating Out", "luxury"))

    # ---- Health & Wellness ----
    for m in MONTHS:
        rows.append(_tx(_date(m, 3), -45.00, "FitLife Gym", DEMO_CHECKING, "Health & Wellness", "middle"))
    for m in (1, 4, 7):
        rows.append(_tx(_date(m, 11), -18.50, "CVS Pharmacy", DEMO_CREDIT, "Health & Wellness", "basic"))

    # ---- Shopping ----
    for m in MONTHS:
        rows.append(_tx(_date(m, 13), -54.99, "Amazon.com", DEMO_CREDIT, "Shopping", "middle"))
    for m in (2, 5, 8):
        rows.append(_tx(_date(m, 27), -87.25, "Target", DEMO_CREDIT, "Shopping", "middle"))

    # ---- Children ----
    for m in MONTHS:
        rows.append(_tx(_date(m, 1), -450.00, "Little Sprouts Daycare", DEMO_CHECKING, "Children", "basic"))
    for m in (3, 7):
        rows.append(_tx(_date(m, 16), -34.99, "Toy Galaxy", DEMO_CREDIT, "Children", "luxury"))

    # ---- Charity ----
    for m in MONTHS:
        rows.append(_tx(_date(m, 15), -50.00, "Red Cross Donation", DEMO_CHECKING, "Charity", "donation"))

    # ---- Investment ----
    for m in MONTHS:
        rows.append(
            _tx(_date(m, 25), -500.00, "Vanguard Brokerage Transfer", DEMO_SAVINGS, "Investment", "investment")
        )

    # ---- Savings ----
    for m in MONTHS:
        rows.append(
            _tx(_date(m, 26), -300.00, "High-Yield Savings Transfer", DEMO_CHECKING, "Savings", "middle")
        )

    # ---- Tax ----
    rows.append(_tx(_date(4, 15), -1200.00, "IRS Quarterly Estimate", DEMO_CHECKING, "Tax", "basic"))
    rows.append(_tx(_date(6, 15), -1200.00, "IRS Quarterly Estimate", DEMO_CHECKING, "Tax", "basic"))

    # ---- Other Leisure ----
    for m in MONTHS:
        rows.append(_tx(_date(m, 20), -28.00, "Cinema City", DEMO_CREDIT, "Other Leisure", "luxury"))
    for m in (2, 6):
        rows.append(_tx(_date(m, 8), -22.99, "Steam Games", DEMO_CREDIT, "Other Leisure", "luxury"))

    # ---- Home ----
    rows.append(_tx(_date(2, 21), -224.50, "IKEA", DEMO_CREDIT, "Home", "middle"))
    rows.append(_tx(_date(7, 18), -224.50, "IKEA", DEMO_CREDIT, "Home", "middle"))
    rows.append(_tx(_date(3, 7), -86.40, "Home Depot", DEMO_CREDIT, "Home", "middle"))
    rows.append(_tx(_date(5, 9), -86.40, "Home Depot", DEMO_CREDIT, "Home", "middle"))
    rows.append(_tx(_date(8, 15), -86.40, "Home Depot", DEMO_CREDIT, "Home", "middle"))

    # ---- Services ----
    for m in MONTHS:
        rows.append(_tx(_date(m, 10), -130.00, "Sparkle Cleaning Co.", DEMO_CHECKING, "Services", "middle"))
    for m in (4, 5, 6, 7):
        rows.append(_tx(_date(m, 11), -65.00, "GreenLeaf Lawn Care", DEMO_CHECKING, "Services", "middle"))

    # ---- Ignored (still categorized) ----
    rows.append(
        _tx(
            _date(4, 9),
            -35.00,
            "Duplicate Charge \u2014 Reversed",
            DEMO_CREDIT,
            "Shopping",
            "middle",
            ignore=True,
        )
    )
    rows.append(
        _tx(
            _date(1, 2),
            -1.00,
            "Test Transaction (ignored)",
            DEMO_CHECKING,
            "Other Leisure",
            "luxury",
            ignore=True,
        )
    )

    return rows


def _demo_summary(rows: list[Transaction]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for tx in rows:
        counts[tx.category] = counts.get(tx.category, 0) + 1
    return counts


def _print_category_summary(rows: list[Transaction]) -> None:
    counts = _demo_summary(rows)
    print(f"Inserted {len(rows)} demo transactions.")
    for name in CATEGORY_SEED:
        if name in counts:
            print(f"  {name}: {counts[name]}")


def reset_to_demo(session) -> int:
    """Developer escape hatch: wipe EVERY transaction (both datasets) and
    install the deterministic demo dataset. Destructive; used by the CLI only.
    """
    session.execute(delete(Transaction))
    session.execute(delete(ReviewedTransaction))
    session.execute(delete(CategorizationRule))
    session.execute(delete(ImportConfig))
    session.execute(delete(Category))
    session.commit()

    seed(session, demo_mode=True)

    rows = build_demo_transactions()
    session.add_all(rows)
    set_data_source(session, SOURCE_DEMO)
    session.commit()

    _print_category_summary(rows)
    return len(rows)


def _demo_count(session: Session) -> int:
    return int(
        session.execute(
            select(func.count())
            .select_from(Transaction)
            .where(Transaction.data_source == SOURCE_DEMO)
        ).scalar_one()
    )


def _insert_demo_rows(session: Session) -> int:
    rows = build_demo_transactions()
    session.add_all(rows)
    session.commit()
    print(f"Demo dataset was empty; inserted {len(rows)} transactions.")
    return len(rows)


def ensure_demo_seeded(session: Session) -> int:
    """Self-heal: insert the demo dataset when in demo mode but empty."""
    if not is_demo(session):
        return 0
    if _demo_count(session):
        return 0
    return _insert_demo_rows(session)


def load_demo(session: Session) -> int:
    """Activate the demo dataset, generating it on first use.

    Live transactions and both datasets' categorizations are left untouched.
    """
    set_data_source(session, SOURCE_DEMO)
    if _demo_count(session) == 0:
        _insert_demo_rows(session)
    return _demo_count(session)


def switch_to_live(session: Session) -> dict:
    """Activate the live dataset, importing any new rawdata files.

    Demo transactions and both datasets' categorizations are left untouched.
    """
    set_data_source(session, SOURCE_LIVE)
    seed(session, demo_mode=False)
    session.commit()
    result = run_import(session)
    print(
        "Switched to live mode: "
        f"added={result['added']} total={result['total']} "
        f"skipped={len(result['skipped'])}"
    )
    return result


def status(session) -> None:
    source = get_data_source(session)
    live_count = int(session.execute(select(func.count()).select_from(Transaction).where(Transaction.data_source == SOURCE_LIVE)).scalar_one())
    demo_count = int(session.execute(select(func.count()).select_from(Transaction).where(Transaction.data_source == SOURCE_DEMO)).scalar_one())
    active = live_count if source == SOURCE_LIVE else demo_count
    date_min, date_max = session.execute(
        select(func.min(Transaction.date), func.max(Transaction.date)).where(Transaction.data_source == source)
    ).one()
    category_count = session.execute(select(func.count()).select_from(Category)).scalar_one()
    print(f"data_source:     {source}")
    print(f"transactions:    {active} active ({live_count} live / {demo_count} demo)")
    print(f"date range:      {date_min} .. {date_max}")
    print(f"categories:      {int(category_count)}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.demo", description="Budget4 data source management")
    parser.add_argument("command", choices=["reset", "live", "status"])
    args = parser.parse_args(argv)

    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        if args.command == "reset":
            reset_to_demo(session)
        elif args.command == "live":
            switch_to_live(session)
        else:
            status(session)
    return 0


if __name__ == "__main__":
    sys.exit(main())
