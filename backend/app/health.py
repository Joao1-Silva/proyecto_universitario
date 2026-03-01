from fastapi import APIRouter, Response

from .db import get_db_state
from .settings import get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    settings = get_settings()
    db_state = get_db_state()
    db_mode = db_state.get("active_mode", "none")
    db_status = "connected" if db_mode in {"mariadb", "sqlite"} else "fallback"

    # TODO[PENDING_DEPENDENCY]: Extend health checks with domain-specific readiness probes.
    return {
        "status": "ok",
        "db": db_status,
        "mode": "api",
        "details": {
            "service": settings.app_name,
            "version": settings.app_version,
            "database": db_state,
        },
    }


@router.head("/health", include_in_schema=False)
def health_head() -> Response:
    return Response(status_code=200)
