"""Application configuration, sourced from environment variables."""
import os
from pathlib import Path

# budget4/ root directory (parent of the app/ package)
BASE_DIR = Path(__file__).resolve().parent.parent

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg://budget:budget@localhost:5432/budget",
)

RAWDATA_DIR = Path(os.environ.get("RAWDATA_DIR", str(BASE_DIR / "rawdata")))
STATIC_DIR = Path(os.environ.get("STATIC_DIR", str(BASE_DIR / "static")))
