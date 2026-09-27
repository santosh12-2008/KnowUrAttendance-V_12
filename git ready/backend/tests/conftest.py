import os
import pytest
from pathlib import Path

# Ensure tests use an isolated test database
TEST_DB_PATH = Path(__file__).resolve().parent.parent / "test_attendance.db"
os.environ["ATTENDANCE_DB_PATH"] = str(TEST_DB_PATH)
os.environ["JWT_SECRET_KEY"] = "test-only-jwt-secret-change-me-32-bytes-minimum-123456"
os.environ["ADMIN_CR_USERNAME"] = "test_cr"
os.environ["ADMIN_CR_PASSWORD"] = "TestCR!123456"
os.environ["ADMIN_CR_NAME"] = "Test Class Representative"
os.environ["ADMIN_LR_USERNAME"] = "test_lr"
os.environ["ADMIN_LR_PASSWORD"] = "TestLR!123456"
os.environ["ADMIN_LR_NAME"] = "Test Ladies Representative"

from app.database import init_db

@pytest.fixture(scope="session", autouse=True)
def initialize_test_db():
    if TEST_DB_PATH.exists():
        try:
            TEST_DB_PATH.unlink()
        except Exception:
            pass
    init_db()
    yield
    if TEST_DB_PATH.exists():
        try:
            TEST_DB_PATH.unlink()
        except Exception:
            pass
