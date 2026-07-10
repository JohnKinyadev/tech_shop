from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from backend.api.errors import register_error_handlers
from backend.api.v1 import router as staff_router
from backend.core.config import settings
from backend.models.database import SessionLocal

app = FastAPI(title=settings.app_name)
if settings.cors_origin_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
register_error_handlers(app)
app.include_router(staff_router)


@app.get("/health", tags=["system"])
def health_check() -> dict[str, str]:
    return {"status": "ok", "environment": settings.environment}


@app.get("/health/db", tags=["system"])
def database_health_check() -> dict[str, str]:
    with SessionLocal() as db:
        db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "reachable"}
