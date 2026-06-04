"""Pytest fixtures. Uses a throwaway SQLite file and resets it per test so each
test starts from a freshly-seeded database."""
import os

# Must be set before importing the app (database.py reads it at import time).
os.environ["EXPENSE_DB_URL"] = "sqlite:////tmp/expense_tracker_pytest.db"

import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine
from app.main import app
from app.seed import seed_if_empty


@pytest.fixture
def db():
    """Fresh, seeded database session for a single test."""
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    session = SessionLocal()
    seed_if_empty(session)
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db):
    """TestClient backed by the freshly-seeded database."""
    with TestClient(app) as c:
        yield c
