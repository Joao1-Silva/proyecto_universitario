from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import create_all_tables, initialize_database
from .health import router as health_router
from .migration_runner import apply_migrations
from .migrations import run_compatibility_migrations
from .routes.auth import router as auth_router
from .routes.categories import router as categories_router
from .routes.company_settings import router as company_settings_router
from .routes.finanzas import router as finanzas_router
from .routes.inventory import router as inventory_router
from .routes.invoices import router as invoices_router
from .routes.late_fees import router as late_fees_router
from .routes.monitoring import router as monitoring_router
from .routes.payments import router as payments_router
from .routes.price_lists import router as price_lists_router
from .routes.products import router as products_router
from .routes.purchase_orders import router as purchase_orders_router
from .routes.reports import router as reports_router
from .routes.audit_logs import router as audit_logs_router
from .routes.security_questions import router as security_questions_router
from .routes.suppliers import router as suppliers_router
from .routes.users import router as users_router
from .settings import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize_database(settings)

    if settings.auto_migrate:
        try:
            applied = apply_migrations()
            if applied:
                logger.info("Applied %s migration(s): %s", len(applied), ", ".join(applied))
        except Exception as error:
            logger.exception("Database migrations failed during startup: %s", error)
            raise
    else:
        create_all_tables()

    run_compatibility_migrations()
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:3100",
        "http://localhost:3100",
        "null",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(categories_router)
app.include_router(suppliers_router)
app.include_router(products_router)
app.include_router(price_lists_router)
app.include_router(purchase_orders_router)
app.include_router(inventory_router)
app.include_router(finanzas_router)
app.include_router(monitoring_router)
app.include_router(reports_router)
app.include_router(audit_logs_router)
app.include_router(users_router)
app.include_router(security_questions_router)
app.include_router(company_settings_router)
app.include_router(late_fees_router)
app.include_router(invoices_router)
app.include_router(payments_router)
