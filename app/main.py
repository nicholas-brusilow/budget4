"""Budget4 FastAPI application entry point."""
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from . import models  # noqa: F401 - ensure models are imported before create_all
from .config import STATIC_DIR
from .db import Base, SessionLocal, engine
from .demo import ensure_demo_seeded
from .importing import run_import
from .migrations import ensure_transaction_source
from .routers import categoricals, demo, imports, meta, rules, transactions, visual
from .seed import seed
from .settings import is_demo

logger = logging.getLogger("budget4")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(STATIC_DIR, exist_ok=True)

    last_error: Exception | None = None
    for attempt in range(30):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            last_error = None
            break
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt < 29:
                time.sleep(1)
    if last_error is not None:
        raise last_error

    Base.metadata.create_all(engine)
    ensure_transaction_source(engine)

    with SessionLocal() as session:
        demo = is_demo(session)
        seed(session, demo_mode=demo)
        if demo:
            ensure_demo_seeded(session)
            print("Demo mode active: raw CSV import skipped.")
        else:
            try:
                result = run_import(session)
                print(
                    "Import summary: "
                    f"added={result['added']} total={result['total']} "
                    f"skipped={len(result['skipped'])}"
                )
            except Exception as exc:  # noqa: BLE001 - never crash on import failure
                session.rollback()
                print(f"Import failed (continuing): {exc}")

    yield


app = FastAPI(title="Budget4", lifespan=lifespan)


@app.middleware("http")
async def no_cache_assets(request, call_next):
    """Revalidate static assets and the SPA shell so rebuilt JS/CSS load."""
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith((".js", ".css", ".html")):
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    return response


app.include_router(meta.router, prefix="/api")
app.include_router(demo.router, prefix="/api")
app.include_router(transactions.router, prefix="/api")
app.include_router(imports.router, prefix="/api")
app.include_router(categoricals.router, prefix="/api")
app.include_router(rules.router, prefix="/api")
app.include_router(visual.router, prefix="/api")

# Mounted last so /api routes take precedence (mount at "/" is greedy).
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
