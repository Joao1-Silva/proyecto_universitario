from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import func, select

from .db import get_session_factory
from .models import (
    CategoryModel,
    SecurityQuestionModel,
    SupplierCategoryLinkModel,
    SupplierModel,
    UserModel,
    UserSecurityQuestionModel,
)
from .reference_data import DEFAULT_CATEGORIES
from .security import hash_secret, is_password_hash, normalize_role
from .settings import get_settings

logger = logging.getLogger(__name__)

DEFAULT_SECURITY_QUESTIONS = [
    "¿Cuál es el nombre de tu ciudad de nacimiento?",
    "¿Cuál fue tu primer proyecto laboral?",
    "¿Cuál es el nombre de tu mascota favorita?",
    "¿Cuál es tu película favorita?",
    "¿Cuál es tu lugar favorito para vacacionar?",
    "¿Cuál fue tu primer automóvil?",
]


def _normalize_category_ids(values: list[str] | None) -> list[str]:
    if not values:
        return []
    deduped: list[str] = []
    seen: set[str] = set()
    for value in values:
        category_id = str(value).strip()
        if not category_id or category_id in seen:
            continue
        seen.add(category_id)
        deduped.append(category_id)
    return deduped


def _seed_categories(session) -> bool:
    existing = session.execute(select(CategoryModel.id, CategoryModel.name)).all()
    existing_ids = {item[0] for item in existing}
    existing_names = {str(item[1]).strip().lower() for item in existing}
    changed = False

    for seed in DEFAULT_CATEGORIES:
        if seed.id in existing_ids or seed.name.lower() in existing_names:
            continue
        session.add(
            CategoryModel(
                id=seed.id,
                name=seed.name,
                description=seed.description,
                created_at=datetime.utcnow(),
            )
        )
        changed = True
    return changed


def _seed_security_questions(session) -> bool:
    existing = session.execute(select(SecurityQuestionModel)).scalars().all()
    existing_texts = {item.question_text.strip().lower() for item in existing}
    changed = False
    for question_text in DEFAULT_SECURITY_QUESTIONS:
        if question_text.strip().lower() in existing_texts:
            continue
        session.add(SecurityQuestionModel(question_text=question_text, active=True))
        changed = True
    return changed


def _seed_default_user(session, *, name: str, email: str, role: str, password: str) -> bool:
    normalized_email = email.strip().lower()
    if not normalized_email:
        return False

    existing = session.execute(select(UserModel).where(func.lower(UserModel.email) == normalized_email)).scalar_one_or_none()
    if existing is not None:
        changed = False
        normalized_role = normalize_role(existing.role)
        if normalized_role != existing.role:
            existing.role = normalized_role
            changed = True
        if existing.role != role:
            existing.role = role
            changed = True
        if not is_password_hash(existing.password):
            existing.password = hash_secret(existing.password or password)
            changed = True
        return changed

    user = UserModel(
        id=f"user_seed_{normalized_email.replace('@', '_').replace('.', '_')}",
        name=name.strip() or normalized_email,
        email=normalized_email,
        role=role,
        password=hash_secret(password),
        created_at=datetime.utcnow(),
    )
    session.add(user)
    return True


def _seed_default_users(session) -> bool:
    settings = get_settings()
    changed = False
    changed = _seed_default_user(
        session,
        name=settings.default_admin_name,
        email=settings.default_admin_email,
        role="superadmin",
        password=settings.default_admin_password,
    ) or changed
    changed = _seed_default_user(
        session,
        name=settings.default_finance_name,
        email=settings.default_finance_email,
        role="finanzas",
        password=settings.default_finance_password,
    ) or changed
    changed = _seed_default_user(
        session,
        name=settings.default_procura_name,
        email=settings.default_procura_email,
        role="procura",
        password=settings.default_procura_password,
    ) or changed
    return changed


def _migrate_security_answer_hashes(session) -> bool:
    assignments = session.execute(select(UserSecurityQuestionModel)).scalars().all()
    changed = False
    for assignment in assignments:
        if assignment.answer_hash and not is_password_hash(assignment.answer_hash):
            assignment.answer_hash = hash_secret(assignment.answer_hash)
            changed = True
    return changed


def _ensure_superuser_security_questions(session) -> bool:
    session.flush()
    settings = get_settings()
    superuser = session.execute(
        select(UserModel).where(func.lower(UserModel.email) == settings.default_admin_email.strip().lower())
    ).scalar_one_or_none()
    if superuser is None:
        superuser = session.execute(
            select(UserModel).where(func.lower(UserModel.role) == "superadmin").order_by(UserModel.created_at.asc())
        ).scalars().first()
    if superuser is None:
        return False

    questions = session.execute(select(SecurityQuestionModel).where(SecurityQuestionModel.active.is_(True))).scalars().all()
    selected_questions = questions[:3]
    if len(selected_questions) < 3:
        return False

    answers = [
        settings.superuser_security_answer_1,
        settings.superuser_security_answer_2,
        settings.superuser_security_answer_3,
    ]
    assignments = session.execute(
        select(UserSecurityQuestionModel).where(UserSecurityQuestionModel.user_id == superuser.id)
    ).scalars().all()
    assignment_by_question = {item.question_id: item for item in assignments}

    changed = False
    for index, question in enumerate(selected_questions):
        answer = (answers[index] or "").strip() or f"admin-answer-{index + 1}"

        existing = assignment_by_question.get(question.id)
        if existing is None:
            session.add(
                UserSecurityQuestionModel(
                    user_id=superuser.id,
                    question_id=question.id,
                    answer_hash=hash_secret(answer),
                    created_at=datetime.utcnow(),
                )
            )
            changed = True
            continue

        if not is_password_hash(existing.answer_hash):
            existing.answer_hash = hash_secret(existing.answer_hash or answer)
            changed = True

    return changed


def _sync_supplier_category_links(session) -> bool:
    suppliers = session.execute(select(SupplierModel)).scalars().all()
    changed = False

    for supplier in suppliers:
        legacy_ids = _normalize_category_ids(supplier.category_ids)
        linked_ids = session.execute(
            select(SupplierCategoryLinkModel.category_id).where(SupplierCategoryLinkModel.supplier_id == supplier.id)
        ).scalars().all()
        linked_ids = _normalize_category_ids([str(item) for item in linked_ids])

        if not linked_ids and legacy_ids:
            for category_id in legacy_ids:
                session.add(
                    SupplierCategoryLinkModel(
                        supplier_id=supplier.id,
                        category_id=category_id,
                        created_at=datetime.utcnow(),
                    )
                )
            linked_ids = legacy_ids
            changed = True

        if linked_ids != legacy_ids:
            supplier.category_ids = linked_ids
            changed = True

        if not supplier.rif and supplier.rfc:
            supplier.rif = supplier.rfc
            changed = True
        if supplier.status is None:
            supplier.status = "active" if supplier.is_active else "inactive"
            changed = True

    return changed


def _normalize_user_roles(session) -> bool:
    users = session.execute(select(UserModel)).scalars().all()
    changed = False
    for user in users:
        normalized = normalize_role(user.role)
        if user.role != normalized:
            user.role = normalized
            changed = True
        if user.password and not is_password_hash(user.password):
            user.password = hash_secret(user.password)
            changed = True
    return changed


def run_compatibility_migrations() -> None:
    session_factory = get_session_factory()
    if session_factory is None:
        return

    with session_factory() as session:
        changed = False
        changed = _seed_categories(session) or changed
        changed = _seed_security_questions(session) or changed
        changed = _normalize_user_roles(session) or changed
        changed = _seed_default_users(session) or changed
        changed = _migrate_security_answer_hashes(session) or changed
        changed = _ensure_superuser_security_questions(session) or changed
        changed = _sync_supplier_category_links(session) or changed

        if changed:
            session.commit()
            logger.info("Compatibility migrations applied successfully.")
