from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..audit import log_audit_event
from ..models import SecurityQuestionModel, UserModel, UserSecurityQuestionModel
from ..schemas import UserCreate, UserRead, UserSecurityQuestionRead, UserUpdate
from ..security import (
    AuthenticatedUser,
    Permission,
    get_db,
    hash_secret,
    normalize_role,
    require_permissions,
)

router = APIRouter(prefix="/users", tags=["users"])


def _to_user_read(model: UserModel) -> UserRead:
    return UserRead(
        id=model.id,
        email=model.email,
        name=model.name,
        role=normalize_role(model.role),
        createdAt=model.created_at,
    )


def _get_user_by_email(session: Session, email: str) -> UserModel | None:
    return session.execute(select(UserModel).where(func.lower(UserModel.email) == email.lower())).scalar_one_or_none()


def _validate_security_questions(session: Session, payload_questions: list[dict]) -> list[dict]:
    if len(payload_questions) != 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Exactly 3 security questions are required.",
        )

    question_ids = [int(item.get("questionId", 0)) for item in payload_questions]
    if len(set(question_ids)) != 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Security questions must be unique.",
        )

    available = session.execute(
        select(SecurityQuestionModel.id).where(
            SecurityQuestionModel.active.is_(True),
            SecurityQuestionModel.id.in_(question_ids),
        )
    ).scalars().all()
    if len(set(int(value) for value in available)) != 3:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid security questions.")

    normalized: list[dict] = []
    for item in payload_questions:
        question_id = int(item.get("questionId", 0))
        answer = str(item.get("answer", "")).strip()
        if len(answer) < 2:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Each security answer must have at least 2 characters.",
            )
        normalized.append({"questionId": question_id, "answerHash": hash_secret(answer)})
    return normalized


def _replace_security_questions(session: Session, user_id: str, normalized_questions: list[dict]) -> None:
    session.execute(delete(UserSecurityQuestionModel).where(UserSecurityQuestionModel.user_id == user_id))
    for item in normalized_questions:
        session.add(
            UserSecurityQuestionModel(
                user_id=user_id,
                question_id=item["questionId"],
                answer_hash=item["answerHash"],
                created_at=datetime.utcnow(),
            )
        )


@router.get("")
def list_users(
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.USER_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    records = session.execute(select(UserModel).order_by(UserModel.created_at.desc())).scalars().all()
    return {"data": [_to_user_read(record) for record in records], "meta": {"source": "api"}}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.USER_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    email = payload.email.strip().lower()
    existing = _get_user_by_email(session, email)
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists.")

    security_questions = _validate_security_questions(
        session, [item.model_dump() for item in payload.securityQuestions]
    )

    user = UserModel(
        id=f"user_{uuid4()}",
        email=email,
        name=payload.name.strip(),
        role=normalize_role(payload.role),
        created_at=datetime.utcnow(),
        password=hash_secret(payload.password),
    )
    session.add(user)
    session.flush()
    _replace_security_questions(session, user.id, security_questions)

    log_audit_event(
        session,
        action="user_create",
        entity_type="user",
        entity_id=user.id,
        metadata={"email": user.email, "role": user.role},
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(user)
    return {"data": _to_user_read(user), "meta": {"source": "api"}}


@router.get("/{user_id}/security-questions")
def list_user_security_questions(
    user_id: str,
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.USER_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    user = session.get(UserModel, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    rows = session.execute(
        select(UserSecurityQuestionModel.question_id, SecurityQuestionModel.question_text)
        .join(SecurityQuestionModel, SecurityQuestionModel.id == UserSecurityQuestionModel.question_id)
        .where(UserSecurityQuestionModel.user_id == user_id)
        .order_by(UserSecurityQuestionModel.created_at.asc())
    ).all()
    data = [
        UserSecurityQuestionRead(questionId=int(row[0]), questionText=str(row[1]))
        for row in rows
    ]
    return {"data": data, "meta": {"source": "api"}}


@router.put("/{user_id}")
def update_user(
    user_id: str,
    payload: UserUpdate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.USER_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    updates = payload.model_dump(exclude_unset=True)

    user = session.get(UserModel, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if "email" in updates:
        next_email = str(updates["email"]).strip().lower()
        existing = _get_user_by_email(session, next_email)
        if existing is not None and existing.id != user_id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists.")
        user.email = next_email

    if "name" in updates:
        user.name = str(updates["name"]).strip()
    if "role" in updates:
        user.role = normalize_role(str(updates["role"]))
    if "password" in updates and updates["password"] is not None:
        user.password = hash_secret(str(updates["password"]))

    if "securityQuestions" in updates and updates["securityQuestions"] is not None:
        security_questions = _validate_security_questions(session, list(updates["securityQuestions"]))
        _replace_security_questions(session, user.id, security_questions)
        log_audit_event(
            session,
            action="security_questions_reset",
            entity_type="user",
            entity_id=user.id,
            metadata={"count": len(security_questions)},
            request=request,
            user=current_user,
        )

    log_audit_event(
        session,
        action="user_update",
        entity_type="user",
        entity_id=user.id,
        metadata={"email": user.email, "role": user.role},
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(user)
    return {"data": _to_user_read(user), "meta": {"source": "api"}}


@router.delete("/{user_id}")
def delete_user(
    user_id: str,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.USER_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    user = session.get(UserModel, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    if user.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Cannot delete current user.")

    session.execute(delete(UserSecurityQuestionModel).where(UserSecurityQuestionModel.user_id == user_id))
    session.delete(user)
    log_audit_event(
        session,
        action="user_delete",
        entity_type="user",
        entity_id=user_id,
        metadata={"email": user.email},
        request=request,
        user=current_user,
    )
    session.commit()
    return {"ok": True, "id": user_id}
