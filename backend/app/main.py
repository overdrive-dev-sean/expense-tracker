"""FastAPI app: CORS, table creation + category seed on startup, routers.

Also serves the built frontend (frontend/dist) at "/" when present, so the whole
app runs as a single process — used by the packaged desktop build (see desktop.py).
"""
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, select, text

from .database import Base, SessionLocal, engine
from . import models  # noqa: F401  (register models on Base before create_all)
from .kinds import classify_kind
from .models import Transaction
from .seed import seed_if_empty
from .routers import categories, summary, tags, transactions


def _migrate_columns(db):
    """Lightweight, idempotent migrations (no Alembic yet): add columns that
    pre-existing databases lack, then backfill where it makes sense."""
    cols = [c["name"] for c in inspect(engine).get_columns("transactions")]
    with engine.begin() as conn:
        if "kind" not in cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN kind VARCHAR"))
        if "details" not in cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN details JSON"))
    # Backfill kind (derived from description + amount); details stay NULL until
    # a (re-)import provides them.
    rows = db.scalars(select(Transaction).where(Transaction.kind.is_(None))).all()
    for t in rows:
        t.kind = classify_kind(t.description, t.amount_cents)
    if rows:
        db.commit()

# Vite dev origin.
DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup (no migrations tool yet).
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_if_empty(db)
        _migrate_columns(db)
    finally:
        db.close()
    yield


app = FastAPI(title="Expense Tracker API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=DEV_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


app.include_router(transactions.router)
app.include_router(categories.router)
app.include_router(summary.router)
app.include_router(tags.router)

# Serve the built frontend at "/" when it exists (packaged app / production).
# Mounted last so it never shadows the /api routes above. In dev you run Vite
# instead, so dist/ is usually absent and this is simply skipped.
if getattr(sys, "frozen", False):
    _STATIC_DIR = Path(getattr(sys, "_MEIPASS", ".")) / "frontend_dist"
else:
    _STATIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="frontend")
