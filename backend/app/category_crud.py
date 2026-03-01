from datetime import datetime
from uuid import uuid4

from sqlalchemy import func, select

from .db import get_session_factory
from .models import CategoryModel
from .reference_data import DEFAULT_CATEGORIES
from .schemas import CategoryCreate, CategoryRead

_memory_categories: dict[str, CategoryRead] = {
    seed.id: CategoryRead(id=seed.id, name=seed.name, description=seed.description)
    for seed in DEFAULT_CATEGORIES
}


def _normalize_name(value: str) -> str:
    return value.strip()


def list_categories() -> list[CategoryRead]:
    session_factory = get_session_factory()
    if session_factory is None:
        return sorted(_memory_categories.values(), key=lambda item: item.name.lower())

    with session_factory() as session:
        records = session.execute(select(CategoryModel).order_by(func.lower(CategoryModel.name))).scalars().all()
        return [CategoryRead(id=item.id, name=item.name, description=item.description) for item in records]


def create_category(payload: CategoryCreate) -> CategoryRead:
    name = _normalize_name(payload.name)
    if not name:
        raise ValueError("Category name is required.")

    session_factory = get_session_factory()
    if session_factory is None:
        existing = next(
            (category for category in _memory_categories.values() if category.name.lower() == name.lower()),
            None,
        )
        if existing:
            return existing
        category = CategoryRead(id=f"cat_{uuid4()}", name=name, description=payload.description)
        _memory_categories[category.id] = category
        return category

    with session_factory() as session:
        existing = session.execute(
            select(CategoryModel).where(func.lower(CategoryModel.name) == name.lower())
        ).scalar_one_or_none()
        if existing is not None:
            return CategoryRead(id=existing.id, name=existing.name, description=existing.description)

        model = CategoryModel(
            id=f"cat_{uuid4()}",
            name=name,
            description=payload.description,
            created_at=datetime.utcnow(),
        )
        session.add(model)
        session.commit()
        session.refresh(model)
        return CategoryRead(id=model.id, name=model.name, description=model.description)
