from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..audit import log_audit_event
from ..db import get_session_factory
from ..models import CompanySettingsModel
from ..schemas import CompanySettingsRead, CompanySettingsUpdate
from ..security import AuthenticatedUser, Permission, require_permissions

router = APIRouter(tags=["company-settings"])


def _to_company_settings_read(model: CompanySettingsModel) -> CompanySettingsRead:
    return CompanySettingsRead(
        name=model.name,
        rif=model.rfc,
        address=model.address,
        phone=model.phone,
        email=model.email,
        logo=model.logo,
    )


def _get_session_factory():
    session_factory = get_session_factory()
    if session_factory is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database session factory is unavailable.",
        )
    return session_factory


def _ensure_settings(session) -> CompanySettingsModel:
    settings = session.get(CompanySettingsModel, "default")
    if settings is None:
        settings = CompanySettingsModel(id="default")
        session.add(settings)
        session.commit()
        session.refresh(settings)
    return settings


@router.get("/company-settings")
def get_company_settings(
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.SETTINGS_MANAGE)),
) -> dict:
    session_factory = _get_session_factory()
    with session_factory() as session:
        settings = _ensure_settings(session)
        return {"data": _to_company_settings_read(settings), "meta": {"source": "api"}}


@router.put("/company-settings")
def update_company_settings(
    payload: CompanySettingsUpdate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.SETTINGS_MANAGE)),
) -> dict:
    session_factory = _get_session_factory()
    with session_factory() as session:
        settings = _ensure_settings(session)
        settings.name = payload.name.strip()
        settings.rfc = payload.rif.strip()
        settings.address = payload.address.strip()
        settings.phone = payload.phone.strip()
        settings.email = payload.email.strip()
        settings.logo = payload.logo
        log_audit_event(
            session,
            action="company_settings_update",
            entity_type="settings",
            entity_id="company",
            metadata=payload.model_dump(),
            request=request,
            user=current_user,
        )
        session.commit()
        session.refresh(settings)
        return {"data": _to_company_settings_read(settings), "meta": {"source": "api"}}
