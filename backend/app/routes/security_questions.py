from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import SecurityQuestionModel
from ..schemas import SecurityQuestionRead
from ..security import AuthenticatedUser, Permission, get_db, require_permissions

router = APIRouter(prefix="/security-questions", tags=["security-questions"])


@router.get("")
def list_security_questions(
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.USER_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    questions = session.execute(
        select(SecurityQuestionModel).where(SecurityQuestionModel.active.is_(True)).order_by(SecurityQuestionModel.id.asc())
    ).scalars().all()
    data = [
        SecurityQuestionRead(id=question.id, questionText=question.question_text, active=bool(question.active))
        for question in questions
    ]
    return {"data": data, "meta": {"source": "api"}}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_security_question(
    payload: dict,
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.USER_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    question_text = str(payload.get("questionText", "")).strip()
    if not question_text:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="questionText is required.")

    existing = session.execute(
        select(SecurityQuestionModel).where(func.lower(SecurityQuestionModel.question_text) == question_text.lower())
    ).scalar_one_or_none()
    if existing:
        data = SecurityQuestionRead(id=existing.id, questionText=existing.question_text, active=bool(existing.active))
        return {"data": data, "meta": {"source": "api"}}

    model = SecurityQuestionModel(question_text=question_text, active=True)
    session.add(model)
    session.commit()
    session.refresh(model)
    return {"data": SecurityQuestionRead(id=model.id, questionText=model.question_text, active=True), "meta": {"source": "api"}}
