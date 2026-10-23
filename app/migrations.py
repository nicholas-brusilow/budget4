"""Idempotent schema migrations for databases created by older versions.

This project has no Alembic; `Base.metadata.create_all` never alters existing
tables, so additive column changes are applied here at startup.
"""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from .db import SessionLocal
from .settings import get_data_source


def ensure_transaction_source(engine: Engine) -> None:
    """Add ``transactions.data_source`` to pre-existing databases.

    Existing rows belong to whichever dataset was active before the column
    existed, so they are tagged with the current data source.
    """
    inspector = inspect(engine)
    if "transactions" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("transactions")}
    if "data_source" in columns:
        return

    with SessionLocal() as session:
        source = get_data_source(session)

    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE transactions ADD COLUMN data_source "
                "VARCHAR(16) NOT NULL DEFAULT 'live'"
            )
        )
        conn.execute(
            text("UPDATE transactions SET data_source = :source"),
            {"source": source},
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_transactions_data_source "
                "ON transactions (data_source)"
            )
        )
