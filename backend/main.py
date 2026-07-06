from fastapi import FastAPI

from backend.api.v1 import router as staff_router
from backend.core.config import settings

app = FastAPI(title=settings.app_name)
app.include_router(staff_router)


@app.get("/health", tags=["system"])
def health_check() -> dict[str, str]:
    return {"status": "ok", "environment": settings.environment}
