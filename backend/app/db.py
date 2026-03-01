from dataclasses import asdict, dataclass
import logging
from pathlib import Path
from typing import Generator
from urllib.parse import quote_plus

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool

from .settings import BACKEND_ROOT, Settings, get_settings

Base = declarative_base()
logger = logging.getLogger(__name__)

_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


@dataclass
class DbRuntimeState:
    requested_mode: str
    active_mode: str
    status: str
    message: str
    url: str


_db_state = DbRuntimeState(
    requested_mode="mariadb",
    active_mode="none",
    status="not-initialized",
    message="Database bootstrap has not run yet.",
    url="",
)


def _build_mariadb_url(settings: Settings) -> str:
    user = quote_plus(settings.db_user)
    password = quote_plus(settings.db_password)
    # Dev URL pattern requested by product spec:
    # mysql+pymysql://root:admin@localhost:3306/proyecto_universitario_db
    return f"mysql+pymysql://{user}:{password}@{settings.db_host}:{settings.db_port}/{settings.db_name}"


def _build_sqlite_url(settings: Settings) -> str:
    raw_path = settings.sqlite_path.strip() if settings.sqlite_path else "portable.db"
    sqlite_path = Path(raw_path)
    if not sqlite_path.is_absolute():
        sqlite_path = (BACKEND_ROOT / sqlite_path).resolve()
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite+pysqlite:///{sqlite_path.as_posix()}"


def _set_engine(url: str, mode: str, timeout_seconds: float) -> None:
    global _engine, _session_factory

    if mode == "sqlite":
        engine = create_engine(
            url,
            future=True,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
    else:
        connect_args = {"connect_timeout": max(int(timeout_seconds), 1)} if mode == "mariadb" else {}
        engine = create_engine(url, future=True, pool_pre_ping=True, connect_args=connect_args)
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))

    _engine = engine
    _session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def _set_none_mode(requested_mode: str, message: str) -> None:
    global _engine, _session_factory, _db_state
    _engine = None
    _session_factory = None
    _db_state = DbRuntimeState(
        requested_mode=requested_mode,
        active_mode="none",
        status="degraded",
        message=message,
        url="none://",
    )


def initialize_database(settings: Settings | None = None) -> DbRuntimeState:
    global _db_state

    config = settings or get_settings()
    requested_mode = config.db_dialect.lower().strip()

    if requested_mode == "none":
        logger.warning("DB_DIALECT=none -> persistence disabled.")
        _set_none_mode(requested_mode, "Persistence disabled by DB_DIALECT=none.")
        return _db_state

    if requested_mode == "sqlite":
        sqlite_url = _build_sqlite_url(config)
        _set_engine(sqlite_url, "sqlite", config.request_timeout_seconds)
        logger.info("DB_DIALECT=sqlite -> using SQLite file mode at %s.", sqlite_url)
        _db_state = DbRuntimeState(
            requested_mode=requested_mode,
            active_mode="sqlite",
            status="ok",
            message="SQLite file mode enabled.",
            url=sqlite_url,
        )
        return _db_state

    mariadb_url = _build_mariadb_url(config)
    try:
        _set_engine(mariadb_url, "mariadb", config.request_timeout_seconds)
        logger.info("Connected to MariaDB successfully.")
        _db_state = DbRuntimeState(
            requested_mode=requested_mode,
            active_mode="mariadb",
            status="ok",
            message="Connected to MariaDB.",
            url=mariadb_url,
        )
        return _db_state
    except Exception as mariadb_error:
        if config.db_require_mariadb:
            logger.error("MariaDB connection failed and DB_REQUIRE_MARIADB=true.")
            _set_none_mode(
                requested_mode,
                f"MariaDB connection failed with DB_REQUIRE_MARIADB=true. Cause: {mariadb_error}",
            )
            raise RuntimeError("MariaDB is required but unavailable.") from mariadb_error

        logger.warning("MariaDB connection failed. Falling back to SQLite in-memory. Cause: %s", mariadb_error)
        sqlite_url = _build_sqlite_url(config)
        try:
            _set_engine(sqlite_url, "sqlite", config.request_timeout_seconds)
            _db_state = DbRuntimeState(
                requested_mode=requested_mode,
                active_mode="sqlite",
                status="degraded",
                message=f"MariaDB unavailable; fallback to SQLite file mode. Cause: {mariadb_error}",
                url=sqlite_url,
            )
            return _db_state
        except Exception as sqlite_error:
            logger.error("SQLite fallback failed after MariaDB failure. Entering no-persistence mode.")
            _set_none_mode(
                requested_mode,
                f"MariaDB and SQLite bootstrap failed. Cause: {mariadb_error}; SQLite error: {sqlite_error}",
            )
            return _db_state


def get_db_state() -> dict:
    return asdict(_db_state)


def get_engine() -> Engine | None:
    return _engine


def create_all_tables() -> None:
    if _engine is None:
        return
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=_engine)


def get_session_factory() -> sessionmaker[Session] | None:
    return _session_factory


def get_db_session() -> Generator[Session, None, None]:
    if _session_factory is None:
        raise RuntimeError("Database session factory is unavailable in current DB mode.")
    db = _session_factory()
    try:
        yield db
    finally:
        db.close()
