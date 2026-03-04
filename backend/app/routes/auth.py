from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..audit import log_audit_event
from ..models import PasswordRecoveryAttemptModel, SecurityQuestionModel, UserModel, UserSecurityQuestionModel
from ..schemas import (
    AuthLoginRequest,
    PasswordRecoveryResetRequest,
    PasswordRecoveryStartRequest,
    PasswordRecoveryVerifyRequest,
    UserRead,
)
from ..security import (
    AuthenticatedUser,
    extract_bearer_token,
    get_current_user,
    get_db,
    hash_secret,
    is_password_hash,
    issue_token,
    normalize_role,
    resolve_user_id_from_token,
    revoke_token,
    verify_secret,
)
from ..settings import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])


@dataclass
class RecoverySession:
    token: str
    user_id: str
    question_ids: list[int]
    expires_at: datetime


@dataclass
class ResetSession:
    token: str
    user_id: str
    expires_at: datetime


_recovery_sessions: dict[str, RecoverySession] = {}
_reset_sessions: dict[str, ResetSession] = {}


def _cleanup_expired_sessions() -> None:
    now = datetime.utcnow()
    expired_recovery = [token for token, session in _recovery_sessions.items() if session.expires_at <= now]
    for token in expired_recovery:
        _recovery_sessions.pop(token, None)

    expired_reset = [token for token, session in _reset_sessions.items() if session.expires_at <= now]
    for token in expired_reset:
        _reset_sessions.pop(token, None)


def _to_user_read(model: UserModel) -> UserRead:
    return UserRead(
        id=model.id,
        email=model.email,
        name=model.name,
        role=normalize_role(model.role),
        createdAt=model.created_at,
    )


def _resolve_identifier(value: str) -> str:
    return value.strip().lower()


def _create_password_recovery_attempt(
    session: Session,
    *,
    identifier: str,
    user_id: str | None,
    ip_address: str,
    successful: bool,
) -> None:
    session.add(
        PasswordRecoveryAttemptModel(
            id=f"pra_{uuid4()}",
            identifier=identifier,
            user_id=user_id,
            ip_address=ip_address,
            successful=successful,
            attempted_at=datetime.utcnow(),
        )
    )


def _is_rate_limited(
    session: Session,
    *,
    identifier: str,
    user_id: str | None,
    ip_address: str,
) -> bool:
    settings = get_settings()
    window_start = datetime.utcnow() - timedelta(minutes=settings.password_recovery_attempt_window_minutes)

    criteria = [
        PasswordRecoveryAttemptModel.attempted_at >= window_start,
        PasswordRecoveryAttemptModel.successful.is_(False),
    ]
    identity_checks = [func.lower(PasswordRecoveryAttemptModel.identifier) == identifier.lower()]
    if user_id:
        identity_checks.append(PasswordRecoveryAttemptModel.user_id == user_id)
    identity_checks.append(PasswordRecoveryAttemptModel.ip_address == ip_address)
    criteria.append(or_(*identity_checks))

    attempts = session.execute(
        select(func.count()).select_from(PasswordRecoveryAttemptModel).where(*criteria)
    ).scalar_one()
    return int(attempts) >= settings.password_recovery_max_attempts


@router.post("/login")
def login(payload: AuthLoginRequest, request: Request, session: Session = Depends(get_db)) -> dict:
    identifier = payload.email.strip().lower()
    password = payload.password.strip()
    user = session.execute(
        select(UserModel).where(func.lower(UserModel.email) == identifier)
    ).scalar_one_or_none()
    if not identifier or not password or user is None or not verify_secret(password, user.password):
        log_audit_event(
            session,
            action="login_failed",
            entity_type="auth",
            entity_id=identifier or "unknown",
            metadata={"reason": "invalid_credentials"},
            request=request,
            user_id=user.id if user else "anonymous",
            user_name=user.name if user else "Anónimo",
            role=user.role if user else "system",
        )
        session.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas.")

    if not is_password_hash(user.password):
        user.password = hash_secret(password)

    token = issue_token(user.id)
    log_audit_event(
        session,
        action="login_success",
        entity_type="auth",
        entity_id=user.id,
        metadata={"email": user.email},
        request=request,
        user_id=user.id,
        user_name=user.name,
        role=user.role,
    )
    session.commit()
    session.refresh(user)
    return {"data": {"token": token, "user": _to_user_read(user)}, "meta": {"source": "api"}}


@router.get("/me")
def me(current_user: AuthenticatedUser = Depends(get_current_user), session: Session = Depends(get_db)) -> dict:
    user = session.get(UserModel, current_user.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido.")
    return {"data": _to_user_read(user), "meta": {"source": "api"}}


@router.post("/logout")
def logout(
    request: Request,
    authorization: str | None = Header(default=None),
    session: Session = Depends(get_db),
) -> dict:
    token = extract_bearer_token(authorization)
    current_user: UserModel | None = None
    if token:
        user_id = resolve_user_id_from_token(token)
        if user_id:
            current_user = session.get(UserModel, user_id)

    if current_user is not None:
        log_audit_event(
            session,
            action="logout",
            entity_type="auth",
            entity_id=current_user.id,
            metadata={"email": current_user.email},
            request=request,
            user_id=current_user.id,
            user_name=current_user.name,
            role=current_user.role,
        )
        session.commit()

    revoke_token(token)
    return {"ok": True}


@router.post("/password-recovery/start")
def password_recovery_start(
    payload: PasswordRecoveryStartRequest,
    request: Request,
    session: Session = Depends(get_db),
) -> dict:
    _cleanup_expired_sessions()
    identifier = _resolve_identifier(payload.identifier)
    if not identifier:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="El identificador es obligatorio.")

    user = session.execute(
        select(UserModel).where(
            or_(
                func.lower(UserModel.email) == identifier,
                func.lower(UserModel.name) == identifier,
            )
        )
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado.")

    question_rows = session.execute(
        select(UserSecurityQuestionModel.question_id, SecurityQuestionModel.question_text)
        .join(SecurityQuestionModel, SecurityQuestionModel.id == UserSecurityQuestionModel.question_id)
        .where(
            UserSecurityQuestionModel.user_id == user.id,
            SecurityQuestionModel.active.is_(True),
        )
        .order_by(UserSecurityQuestionModel.created_at.asc())
    ).all()
    if len(question_rows) < 1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El usuario no tiene preguntas de seguridad configuradas.",
        )

    settings = get_settings()
    recovery_token = f"recovery_{uuid4()}"
    recovery_session = RecoverySession(
        token=recovery_token,
        user_id=user.id,
        question_ids=[int(row[0]) for row in question_rows[:3]],
        expires_at=datetime.utcnow() + timedelta(minutes=settings.password_recovery_session_minutes),
    )
    _recovery_sessions[recovery_token] = recovery_session

    log_audit_event(
        session,
        action="password_recovery_start",
        entity_type="user",
        entity_id=user.id,
        metadata={"identifier": identifier},
        request=request,
        user_id=user.id,
        user_name=user.name,
        role=user.role,
    )
    session.commit()

    return {
        "data": {
            "recoveryToken": recovery_token,
            "expiresAt": recovery_session.expires_at,
            "questions": [
                {"questionId": int(row[0]), "questionText": str(row[1])}
                for row in question_rows[:3]
            ],
        },
        "meta": {"source": "api"},
    }


@router.post("/password-recovery/verify")
def password_recovery_verify(
    payload: PasswordRecoveryVerifyRequest,
    request: Request,
    session: Session = Depends(get_db),
) -> dict:
    _cleanup_expired_sessions()
    recovery = _recovery_sessions.get(payload.recoveryToken)
    if recovery is None or recovery.expires_at <= datetime.utcnow():
        _recovery_sessions.pop(payload.recoveryToken, None)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="La sesión de recuperación expiró.")

    user = session.get(UserModel, recovery.user_id)
    if user is None:
        _recovery_sessions.pop(payload.recoveryToken, None)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado.")

    identifier = user.email.lower()
    ip_address = request.client.host if request.client and request.client.host else "unknown"
    if _is_rate_limited(session, identifier=identifier, user_id=user.id, ip_address=ip_address):
        _create_password_recovery_attempt(
            session,
            identifier=identifier,
            user_id=user.id,
            ip_address=ip_address,
            successful=False,
        )
        log_audit_event(
            session,
            action="password_recovery_rate_limited",
            entity_type="user",
            entity_id=user.id,
            metadata={"identifier": identifier},
            request=request,
            user_id=user.id,
            user_name=user.name,
            role=user.role,
        )
        session.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos de recuperación. Intenta nuevamente más tarde.",
        )

    answers_by_question = {int(item.questionId): item.answer for item in payload.answers}
    if any(question_id not in answers_by_question for question_id in recovery.question_ids):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Debes responder todas las preguntas.")

    stored_answers = session.execute(
        select(UserSecurityQuestionModel)
        .where(
            UserSecurityQuestionModel.user_id == user.id,
            UserSecurityQuestionModel.question_id.in_(recovery.question_ids),
        )
        .order_by(UserSecurityQuestionModel.question_id.asc())
    ).scalars().all()

    is_valid = len(stored_answers) == len(recovery.question_ids) and all(
        verify_secret(answers_by_question.get(item.question_id, ""), item.answer_hash) for item in stored_answers
    )

    _create_password_recovery_attempt(
        session,
        identifier=identifier,
        user_id=user.id,
        ip_address=ip_address,
        successful=is_valid,
    )

    if not is_valid:
        log_audit_event(
            session,
            action="password_recovery_failed",
            entity_type="user",
            entity_id=user.id,
            metadata={"identifier": identifier},
            request=request,
            user_id=user.id,
            user_name=user.name,
            role=user.role,
        )
        session.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Las respuestas de seguridad no coinciden.")

    settings = get_settings()
    reset_token = f"reset_{uuid4()}"
    reset_session = ResetSession(
        token=reset_token,
        user_id=user.id,
        expires_at=datetime.utcnow() + timedelta(minutes=settings.password_recovery_reset_token_minutes),
    )
    _reset_sessions[reset_token] = reset_session
    _recovery_sessions.pop(payload.recoveryToken, None)

    log_audit_event(
        session,
        action="password_recovery_verified",
        entity_type="user",
        entity_id=user.id,
        metadata={"identifier": identifier},
        request=request,
        user_id=user.id,
        user_name=user.name,
        role=user.role,
    )
    session.commit()

    return {
        "data": {
            "resetToken": reset_token,
            "expiresAt": reset_session.expires_at,
        },
        "meta": {"source": "api"},
    }


@router.post("/password-recovery/reset")
def password_recovery_reset(
    payload: PasswordRecoveryResetRequest,
    request: Request,
    session: Session = Depends(get_db),
) -> dict:
    _cleanup_expired_sessions()
    reset_session = _reset_sessions.get(payload.resetToken)
    if reset_session is None or reset_session.expires_at <= datetime.utcnow():
        _reset_sessions.pop(payload.resetToken, None)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="La sesión de restablecimiento expiró.")

    new_password = payload.newPassword.strip()
    if len(new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La nueva contraseña debe tener al menos 8 caracteres.",
        )

    user = session.get(UserModel, reset_session.user_id)
    if user is None:
        _reset_sessions.pop(payload.resetToken, None)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado.")

    user.password = hash_secret(new_password)
    _reset_sessions.pop(payload.resetToken, None)

    log_audit_event(
        session,
        action="password_reset",
        entity_type="user",
        entity_id=user.id,
        metadata={"reason": "security_questions"},
        request=request,
        user_id=user.id,
        user_name=user.name,
        role=user.role,
    )
    session.commit()

    return {"ok": True}
