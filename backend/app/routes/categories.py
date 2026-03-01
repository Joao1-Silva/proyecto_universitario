from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..audit import log_audit_event
from ..category_crud import create_category, list_categories
from ..schemas import CategoryCreate
from ..security import AuthenticatedUser, Permission, get_db, require_permissions

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("")
def list_categories_route(
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.CATEGORY_VIEW)),
) -> dict:
    return {"data": list_categories(), "meta": {"source": "api"}}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_category_route(
    payload: CategoryCreate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.CATEGORY_CREATE)),
    session=Depends(get_db),
) -> dict:
    try:
        category = create_category(payload)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error
    log_audit_event(
        session,
        action="category_create",
        entity_type="category",
        entity_id=category.id,
        metadata={"name": category.name},
        request=request,
        user=current_user,
    )
    session.commit()
    return {"data": category, "meta": {"source": "api"}}
