from fastapi import APIRouter

from backend.api.v1.routers.auth import router as auth_router
from backend.api.v1.routers.branches import router as branches_router
from backend.api.v1.routers.catalog import router as catalog_router
from backend.api.v1.routers.inventory import router as inventory_router
from backend.api.v1.routers.pos import router as pos_router
from backend.api.v1.routers.purchasing import router as purchasing_router
from backend.api.v1.routers.staff import router as staff_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(branches_router)
router.include_router(staff_router)
router.include_router(catalog_router)
router.include_router(purchasing_router)
router.include_router(inventory_router)
router.include_router(pos_router)
