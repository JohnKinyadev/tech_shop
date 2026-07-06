from fastapi import APIRouter

from backend.api.v1.auth import router as auth_router

router = APIRouter(prefix="/api/v1/staff")
router.include_router(auth_router)
