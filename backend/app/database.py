"""Database engine, session factory, declarative Base, and FastAPI dependency."""
import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# SQLite file lives next to the backend package, owner-controlled, gitignored.
# EXPENSE_DB_URL can override it (handy for tests/throwaway DBs).
DB_PATH = Path(__file__).resolve().parent.parent / "expense_tracker.db"
DATABASE_URL = os.environ.get("EXPENSE_DB_URL", f"sqlite:///{DB_PATH}")

# check_same_thread=False so the connection can be shared across FastAPI's
# threadpool workers; each request still gets its own Session.
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    """Yield a Session and ensure it is closed after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
