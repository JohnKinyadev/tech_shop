from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from backend.api.dependencies import DatabaseSession, require_permission
from backend.models.enums import PurchaseStatus
from backend.schemas.base_schemas import Page
from backend.schemas.purchase_schemas import (
    GoodsReceiptCreate,
    GoodsReceiptResponse,
    PurchaseOrderCreate,
    PurchaseOrderResponse,
    PurchaseOrderUpdate,
)
from backend.schemas.supplier_schemas import (
    SupplierCreate,
    SupplierResponse,
    SupplierUpdate,
)
from backend.services import purchasing as purchasing_service
from backend.services import suppliers as supplier_service
from backend.services.auth import AuthPrincipal

router = APIRouter(tags=["staff-purchasing"])
PurchaseCreatePrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("purchases.create"))
]
PurchaseApprovePrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("purchases.approve"))
]
PurchaseReceivePrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("purchases.receive"))
]


@router.get("/suppliers", response_model=list[SupplierResponse])
def list_suppliers(
    principal: PurchaseCreatePrincipal,
    db: DatabaseSession,
    include_inactive: bool = False,
) -> list[SupplierResponse]:
    return [
        SupplierResponse.model_validate(item)
        for item in supplier_service.list_suppliers(
            db, include_inactive=include_inactive
        )
    ]


@router.get("/suppliers/{supplier_id}", response_model=SupplierResponse)
def get_supplier(
    supplier_id: UUID,
    principal: PurchaseCreatePrincipal,
    db: DatabaseSession,
) -> SupplierResponse:
    return SupplierResponse.model_validate(
        supplier_service.get_supplier(db, supplier_id)
    )


@router.post(
    "/suppliers", response_model=SupplierResponse, status_code=status.HTTP_201_CREATED
)
def create_supplier(
    payload: SupplierCreate,
    principal: PurchaseCreatePrincipal,
    db: DatabaseSession,
) -> SupplierResponse:
    item = supplier_service.create_supplier(db, principal, payload)
    db.commit()
    return SupplierResponse.model_validate(item)


@router.patch("/suppliers/{supplier_id}", response_model=SupplierResponse)
def update_supplier(
    supplier_id: UUID,
    payload: SupplierUpdate,
    principal: PurchaseCreatePrincipal,
    db: DatabaseSession,
) -> SupplierResponse:
    item = supplier_service.update_supplier(db, principal, supplier_id, payload)
    db.commit()
    return SupplierResponse.model_validate(item)


@router.get("/purchases", response_model=Page[PurchaseOrderResponse])
def list_purchase_orders(
    principal: PurchaseCreatePrincipal,
    db: DatabaseSession,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    purchase_status: PurchaseStatus | None = Query(default=None, alias="status"),
    supplier_id: UUID | None = None,
) -> Page[PurchaseOrderResponse]:
    items, total = purchasing_service.list_purchase_orders(
        db,
        principal,
        page=page,
        page_size=page_size,
        status=purchase_status,
        supplier_id=supplier_id,
    )
    return Page[PurchaseOrderResponse](
        items=items, total=total, page=page, page_size=page_size
    )


@router.get("/purchases/{order_id}", response_model=PurchaseOrderResponse)
def get_purchase_order(
    order_id: UUID,
    principal: PurchaseCreatePrincipal,
    db: DatabaseSession,
) -> PurchaseOrderResponse:
    return purchasing_service.get_purchase_order(db, principal, order_id)


@router.post(
    "/purchases",
    response_model=PurchaseOrderResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_purchase_order(
    payload: PurchaseOrderCreate,
    principal: PurchaseCreatePrincipal,
    db: DatabaseSession,
) -> PurchaseOrderResponse:
    item = purchasing_service.create_purchase_order(db, principal, payload)
    db.commit()
    return item


@router.patch("/purchases/{order_id}", response_model=PurchaseOrderResponse)
def update_purchase_order(
    order_id: UUID,
    payload: PurchaseOrderUpdate,
    principal: PurchaseCreatePrincipal,
    db: DatabaseSession,
) -> PurchaseOrderResponse:
    item = purchasing_service.update_purchase_order(db, principal, order_id, payload)
    db.commit()
    return item


@router.post("/purchases/{order_id}/submit", response_model=PurchaseOrderResponse)
def submit_purchase_order(
    order_id: UUID,
    principal: PurchaseCreatePrincipal,
    db: DatabaseSession,
) -> PurchaseOrderResponse:
    item = purchasing_service.submit_purchase_order(db, principal, order_id)
    db.commit()
    return item


@router.post("/purchases/{order_id}/approve", response_model=PurchaseOrderResponse)
def approve_purchase_order(
    order_id: UUID,
    principal: PurchaseApprovePrincipal,
    db: DatabaseSession,
) -> PurchaseOrderResponse:
    item = purchasing_service.approve_purchase_order(db, principal, order_id)
    db.commit()
    return item


@router.post("/purchases/{order_id}/cancel", response_model=PurchaseOrderResponse)
def cancel_purchase_order(
    order_id: UUID,
    principal: PurchaseApprovePrincipal,
    db: DatabaseSession,
) -> PurchaseOrderResponse:
    item = purchasing_service.cancel_purchase_order(db, principal, order_id)
    db.commit()
    return item


@router.get("/purchases/{order_id}/receipts", response_model=list[GoodsReceiptResponse])
def list_goods_receipts(
    order_id: UUID,
    principal: PurchaseCreatePrincipal,
    db: DatabaseSession,
) -> list[GoodsReceiptResponse]:
    return purchasing_service.list_goods_receipts(db, principal, order_id)


@router.post(
    "/purchases/{order_id}/receipts",
    response_model=GoodsReceiptResponse,
    status_code=status.HTTP_201_CREATED,
)
def receive_purchase_order(
    order_id: UUID,
    payload: GoodsReceiptCreate,
    principal: PurchaseReceivePrincipal,
    db: DatabaseSession,
) -> GoodsReceiptResponse:
    item = purchasing_service.receive_purchase_order(db, principal, order_id, payload)
    db.commit()
    return item
