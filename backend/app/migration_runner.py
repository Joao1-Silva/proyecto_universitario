from __future__ import annotations

import argparse
import logging
import re
from pathlib import Path

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import SQLAlchemyError

from .db import get_engine, initialize_database
from .settings import get_settings

logger = logging.getLogger(__name__)

MIGRATION_TABLE = "schema_migrations"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_ROOT = PROJECT_ROOT / "migrations"
SEED_FILE = MIGRATIONS_ROOT / "seed" / "seed.sql"

ALTER_ADD_COLUMN_PATTERN = re.compile(
    r"^\s*ALTER\s+TABLE\s+([`\"\[]?[A-Za-z0-9_]+[`\"\]]?)\s+ADD\s+COLUMN\s+([`\"\[]?[A-Za-z0-9_]+[`\"\]]?)",
    re.IGNORECASE,
)


def _normalize_identifier(value: str) -> str:
    return value.strip().strip("`").strip('"').strip("[").strip("]")


def _ensure_migration_table(connection: Connection) -> None:
    connection.execute(
        text(
            f"""
            CREATE TABLE IF NOT EXISTS {MIGRATION_TABLE} (
              version VARCHAR(128) PRIMARY KEY,
              name VARCHAR(255) NOT NULL,
              applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )


def _read_applied_migrations(connection: Connection) -> list[str]:
    _ensure_migration_table(connection)
    rows = connection.execute(
        text(f"SELECT version FROM {MIGRATION_TABLE} ORDER BY applied_at ASC, version ASC")
    ).fetchall()
    return [str(row[0]) for row in rows]


def _split_sql_statements(sql_text: str) -> list[str]:
    statements: list[str] = []
    current: list[str] = []
    in_single = False
    in_double = False
    in_line_comment = False
    prev = ""

    for ch in sql_text:
        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
                current.append(ch)
            prev = ch
            continue

        if not in_single and not in_double and ch == "-" and prev == "-":
            # Drop previous '-' from token stream and start comment mode.
            if current:
                current.pop()
            in_line_comment = True
            prev = ch
            continue

        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double

        if ch == ";" and not in_single and not in_double:
            statement = "".join(current).strip()
            if statement:
                statements.append(statement)
            current = []
        else:
            current.append(ch)

        prev = ch

    trailing = "".join(current).strip()
    if trailing:
        statements.append(trailing)

    return statements


def _column_exists(connection: Connection, table_name: str, column_name: str) -> bool:
    inspector = inspect(connection)
    try:
        columns = inspector.get_columns(table_name)
    except SQLAlchemyError:
        return False
    return any(col.get("name", "").lower() == column_name.lower() for col in columns)


def _execute_statement(connection: Connection, statement: str) -> None:
    normalized_statement = statement.lstrip("\ufeff").strip()
    dialect_name = str(connection.dialect.name).lower()
    if dialect_name in {"mysql", "mariadb"}:
        normalized_statement = normalized_statement.replace("AUTOINCREMENT", "AUTO_INCREMENT")
    elif dialect_name == "sqlite":
        normalized_statement = normalized_statement.replace("AUTO_INCREMENT", "AUTOINCREMENT")

    match = ALTER_ADD_COLUMN_PATTERN.match(normalized_statement)
    if match:
        table_name = _normalize_identifier(match.group(1))
        column_name = _normalize_identifier(match.group(2))
        if _column_exists(connection, table_name, column_name):
            logger.info("Skipping statement because column already exists: %s.%s", table_name, column_name)
            return

    connection.execute(text(normalized_statement))


def _execute_sql_file(connection: Connection, file_path: Path) -> None:
    sql_text = file_path.read_text(encoding="utf-8-sig")
    statements = _split_sql_statements(sql_text)
    for statement in statements:
        _execute_statement(connection, statement)


def _migration_directories() -> list[Path]:
    if not MIGRATIONS_ROOT.exists():
        return []
    dirs = [
        path
        for path in MIGRATIONS_ROOT.iterdir()
        if path.is_dir() and path.name != "seed" and (path / "up.sql").exists() and (path / "down.sql").exists()
    ]
    return sorted(dirs, key=lambda item: item.name)


def apply_migrations(engine: Engine | None = None) -> list[str]:
    db_engine = engine or get_engine()
    if db_engine is None:
        raise RuntimeError("Database engine is not available.")

    applied_now: list[str] = []
    with db_engine.begin() as connection:
        applied_versions = set(_read_applied_migrations(connection))
        for migration_dir in _migration_directories():
            version = migration_dir.name
            if version in applied_versions:
                continue

            logger.info("Applying migration: %s", version)
            _execute_sql_file(connection, migration_dir / "up.sql")
            connection.execute(
                text(
                    f"INSERT INTO {MIGRATION_TABLE}(version, name, applied_at) VALUES (:version, :name, CURRENT_TIMESTAMP)"
                ),
                {"version": version, "name": version},
            )
            applied_now.append(version)
    return applied_now


def rollback_migrations(steps: int = 1, engine: Engine | None = None) -> list[str]:
    if steps < 1:
        return []

    db_engine = engine or get_engine()
    if db_engine is None:
        raise RuntimeError("Database engine is not available.")

    rolled_back: list[str] = []
    with db_engine.begin() as connection:
        applied_versions = _read_applied_migrations(connection)
        for version in reversed(applied_versions[-steps:]):
            migration_dir = MIGRATIONS_ROOT / version
            if not migration_dir.exists():
                continue

            logger.info("Rolling back migration: %s", version)
            _execute_sql_file(connection, migration_dir / "down.sql")
            connection.execute(text(f"DELETE FROM {MIGRATION_TABLE} WHERE version = :version"), {"version": version})
            rolled_back.append(version)

    return rolled_back


def migration_status(engine: Engine | None = None) -> dict[str, list[str]]:
    db_engine = engine or get_engine()
    if db_engine is None:
        raise RuntimeError("Database engine is not available.")

    with db_engine.begin() as connection:
        applied = _read_applied_migrations(connection)

    all_versions = [path.name for path in _migration_directories()]
    pending = [version for version in all_versions if version not in set(applied)]

    return {
        "applied": applied,
        "pending": pending,
    }


def run_seed(engine: Engine | None = None) -> None:
    db_engine = engine or get_engine()
    if db_engine is None:
        raise RuntimeError("Database engine is not available.")
    if not SEED_FILE.exists():
        raise FileNotFoundError(f"Seed file not found: {SEED_FILE}")

    with db_engine.begin() as connection:
        _execute_sql_file(connection, SEED_FILE)


def run_from_cli() -> None:
    parser = argparse.ArgumentParser(description="Database migration runner")
    parser.add_argument("command", choices=["up", "down", "status", "seed"], help="Command to execute")
    parser.add_argument("--steps", type=int, default=1, help="Number of migrations to rollback when command=down")
    args = parser.parse_args()

    settings = get_settings()
    initialize_database(settings)

    if args.command == "up":
        applied = apply_migrations()
        print("Applied migrations:")
        for version in applied:
            print(f" - {version}")
        if not applied:
            print(" - none")
        return

    if args.command == "down":
        rolled_back = rollback_migrations(steps=args.steps)
        print("Rolled back migrations:")
        for version in rolled_back:
            print(f" - {version}")
        if not rolled_back:
            print(" - none")
        return

    if args.command == "seed":
        run_seed()
        print("Seed executed successfully.")
        return

    status = migration_status()
    print("Applied migrations:")
    for version in status["applied"]:
        print(f" - {version}")
    if not status["applied"]:
        print(" - none")

    print("Pending migrations:")
    for version in status["pending"]:
        print(f" - {version}")
    if not status["pending"]:
        print(" - none")


if __name__ == "__main__":
    run_from_cli()
