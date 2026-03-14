from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[1]
# Prefer the project-local backend/.env over unrelated machine-level variables
# so local runs remain tied to this repository's intended database.
load_dotenv(BACKEND_ROOT / ".env", override=True)


class Settings(BaseSettings):
    app_name: str = "SYMBIOS"
    app_version: str = "0.1.0"
    api_host: str = "127.0.0.1"
    api_port: int = 8000

    db_dialect: str = "mariadb"
    db_host: str = "localhost"
    db_port: int = 3306
    db_user: str = "root"
    db_password: str = "admin"
    db_name: str = "proyecto_universitario_db"
    db_require_mariadb: bool = True
    sqlite_path: str = "portable.db"

    request_timeout_seconds: float = 2.0
    auto_migrate: bool = True

    default_admin_name: str = "Juan Perez"
    default_admin_email: str = "juan.perez@empresa.com"
    default_admin_password: str = "Admin123!"
    default_finance_name: str = "Maria Lopez"
    default_finance_email: str = "maria.lopez@empresa.com"
    default_finance_password: str = "Finance123!"
    default_procura_name: str = "Carlos Ruiz"
    default_procura_email: str = "carlos.ruiz@empresa.com"
    default_procura_password: str = "Procura123!"

    superuser_security_answer_1: str = "Admin123!"
    superuser_security_answer_2: str = "SYMBIOS"
    superuser_security_answer_3: str = "Operación"

    password_recovery_max_attempts: int = 5
    password_recovery_attempt_window_minutes: int = 15
    password_recovery_session_minutes: int = 10
    password_recovery_reset_token_minutes: int = 10

    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
