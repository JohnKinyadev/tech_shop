from fastapi import APIRouter

from backend.api.v1.routers import router as endpoints_router

router = APIRouter(prefix="/api/v1/staff")
router.include_router(endpoints_router)
