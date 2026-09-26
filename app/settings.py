"""Persistent application settings stored in the ``app_settings`` table.

Currently only the active data source ("live" vs "demo") is stored here.
"""
from sqlalchemy.orm import Session

from .models import AppSetting

DATA_SOURCE_KEY = "data_source"
SOURCE_LIVE = "live"
SOURCE_DEMO = "demo"

VALID_SOURCES = {SOURCE_LIVE, SOURCE_DEMO}


def get_data_source(session: Session) -> str:
    """Return the configured data source, defaulting to ``"live"``."""
    row = session.get(AppSetting, DATA_SOURCE_KEY)
    if row is None or row.value not in VALID_SOURCES:
        return SOURCE_LIVE
    return row.value


def set_data_source(session: Session, value: str) -> None:
    """Upsert the data source setting. Raises ValueError for unknown values."""
    if value not in VALID_SOURCES:
        raise ValueError(
            f"invalid data source {value!r}; expected one of {sorted(VALID_SOURCES)}"
        )
    row = session.get(AppSetting, DATA_SOURCE_KEY)
    if row is None:
        session.add(AppSetting(key=DATA_SOURCE_KEY, value=value))
    else:
        row.value = value
    session.commit()


def is_demo(session: Session) -> bool:
    """True when the application is running against the generated demo set."""
    return get_data_source(session) == SOURCE_DEMO
