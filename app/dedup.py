"""Deduplication key generation, byte-compatible with budget3.0.

budget3.0 built keys as::

    date.astype(str) + "|" + amount.round(2).astype(str) + "|" + description

so e.g. -55.0 -> "-55.0", -16.82 -> "-16.82". We intentionally reproduce that
format with Python's ``round`` + ``str`` rather than deriving it from a SQL
numeric representation, which could differ in trailing zeros.
"""
import datetime


def make_dedup_key(date_value, amount, description) -> str:
    if isinstance(date_value, datetime.datetime):
        date_iso = date_value.date().isoformat()
    elif isinstance(date_value, datetime.date):
        date_iso = date_value.isoformat()
    else:
        date_iso = str(date_value)
    return f"{date_iso}|{round(float(amount), 2)}|{description}"
