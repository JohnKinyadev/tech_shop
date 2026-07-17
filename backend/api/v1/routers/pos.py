from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from backend.api.dependencies import DatabaseSession, require_permission
from backend.models.enums import SaleStatus
from backend.schemas.approval_schemas import ApprovalDecision, ApprovalRequestResponse
from backend.schemas.base_schemas import Page
from backend.schemas.customer_schemas import CustomerCreate, CustomerResponse
from backend.schemas.payments_schemas import (
    MpesaManualConfirmCreate,
    MpesaStkPushCreate,
    MpesaStkPushResponse,
    PaymentResponse,
    SalePaymentCreate,
)
from backend.schemas.sales_schemas import (
    POSSaleResponse,
    ReceiptResponse,
    SaleCreate,
    SaleReturnCreate,
    SaleReturnResponse,
    SaleVoidRequest,
    TillCreate,
    TillResponse,
    TillSessionClose,
    TillSessionOpen,
    TillSessionResponse,
    TillUpdate,
)
from backend.schemas.warranty_schemas import WarrantyResponse
from backend.services import customers as customer_service
from backend.services import mpesa as mpesa_service
from backend.services import returns as return_service
from backend.services import sales as sale_service
from backend.services import tills as till_service
from backend.services.auth import AuthPrincipal

router = APIRouter(prefix="/pos", tags=["staff-pos"])
SalesPrincipal = Annotated[AuthPrincipal, Depends(require_permission("sales.process"))]
OwnTillPrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("tills.own.view"))
]
TillManagePrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("tills.manage"))
]
VoidPrincipal = Annotated[AuthPrincipal, Depends(require_permission("sales.void"))]
ReturnApprovePrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("returns.approve"))
]


@router.get("/tills", response_model=list[TillResponse])
def list_tills(
    branch_id: UUID,
    principal: SalesPrincipal,
    db: DatabaseSession,
    include_inactive: bool = False,
) -> list[TillResponse]:
    return [
        TillResponse.model_validate(item)
        for item in till_service.list_tills(
            db, principal, branch_id, include_inactive=include_inactive
        )
    ]


@router.post("/tills", response_model=TillResponse, status_code=status.HTTP_201_CREATED)
def create_till(
    payload: TillCreate,
    principal: TillManagePrincipal,
    db: DatabaseSession,
) -> TillResponse:
    item = till_service.create_till(db, principal, payload)
    db.commit()
    return TillResponse.model_validate(item)


@router.patch("/tills/{till_id}", response_model=TillResponse)
def update_till(
    till_id: UUID,
    payload: TillUpdate,
    principal: TillManagePrincipal,
    db: DatabaseSession,
) -> TillResponse:
    item = till_service.update_till(db, principal, till_id, payload)
    db.commit()
    return TillResponse.model_validate(item)


@router.get("/till-sessions/current", response_model=TillSessionResponse)
def current_till_session(
    principal: OwnTillPrincipal, db: DatabaseSession
) -> TillSessionResponse:
    return TillSessionResponse.model_validate(
        till_service.get_current_session(db, principal)
    )


@router.post(
    "/till-sessions/open",
    response_model=TillSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
def open_till_session(
    payload: TillSessionOpen,
    principal: SalesPrincipal,
    db: DatabaseSession,
) -> TillSessionResponse:
    item = till_service.open_session(db, principal, payload)
    db.commit()
    return TillSessionResponse.model_validate(item)


@router.post("/till-sessions/{session_id}/close", response_model=TillSessionResponse)
def close_till_session(
    session_id: UUID,
    payload: TillSessionClose,
    principal: SalesPrincipal,
    db: DatabaseSession,
) -> TillSessionResponse:
    item = till_service.close_session(db, principal, session_id, payload)
    db.commit()
    return TillSessionResponse.model_validate(item)


@router.get("/customers", response_model=list[CustomerResponse])
def list_customers(
    principal: SalesPrincipal,
    db: DatabaseSession,
    query: str | None = Query(default=None, min_length=1, max_length=150),
    limit: int = Query(default=50, ge=1, le=100),
) -> list[CustomerResponse]:
    return [
        CustomerResponse.model_validate(item)
        for item in customer_service.list_customers(
            db, principal, query=query, limit=limit
        )
    ]


@router.post(
    "/customers",
    response_model=CustomerResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_customer(
    payload: CustomerCreate,
    principal: SalesPrincipal,
    db: DatabaseSession,
) -> CustomerResponse:
    item = customer_service.create_customer(db, principal, payload)
    db.commit()
    return CustomerResponse.model_validate(item)


@router.get("/customers/{customer_id}", response_model=CustomerResponse)
def get_customer(
    customer_id: UUID,
    principal: SalesPrincipal,
    db: DatabaseSession,
) -> CustomerResponse:
    return CustomerResponse.model_validate(
        customer_service.get_customer(db, principal, customer_id)
    )


@router.get("/sales", response_model=Page[POSSaleResponse])
def list_sales(
    branch_id: UUID,
    principal: SalesPrincipal,
    db: DatabaseSession,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    sale_status: SaleStatus | None = Query(default=None, alias="status"),
) -> Page[POSSaleResponse]:
    items, total = sale_service.list_sales(
        db,
        principal,
        branch_id=branch_id,
        page=page,
        page_size=page_size,
        status=sale_status,
    )
    return Page[POSSaleResponse](
        items=items, total=total, page=page, page_size=page_size
    )


@router.post(
    "/sales",
    response_model=POSSaleResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_sale(
    payload: SaleCreate,
    principal: SalesPrincipal,
    db: DatabaseSession,
) -> POSSaleResponse:
    item = sale_service.create_sale(db, principal, payload)
    db.commit()
    return item


@router.get("/sales/void-requests", response_model=list[ApprovalRequestResponse])
def list_void_requests(
    branch_id: UUID,
    principal: VoidPrincipal,
    db: DatabaseSession,
) -> list[ApprovalRequestResponse]:
    return return_service.list_void_requests(db, principal, branch_id)


@router.post(
    "/sales/void-requests/{request_id}/decision",
    response_model=ApprovalRequestResponse,
)
def decide_void(
    request_id: UUID,
    payload: ApprovalDecision,
    principal: VoidPrincipal,
    db: DatabaseSession,
) -> ApprovalRequestResponse:
    item = return_service.decide_void(db, principal, request_id, payload)
    db.commit()
    return item


@router.get("/sales/{sale_id}", response_model=POSSaleResponse)
def get_sale(
    sale_id: UUID,
    principal: SalesPrincipal,
    db: DatabaseSession,
) -> POSSaleResponse:
    return sale_service.get_sale(db, principal, sale_id)


@router.post("/sales/{sale_id}/payments", response_model=PaymentResponse)
def add_sale_payment(
    sale_id: UUID,
    payload: SalePaymentCreate,
    principal: SalesPrincipal,
    db: DatabaseSession,
) -> PaymentResponse:
    item = sale_service.add_payment(db, principal, sale_id, payload)
    db.commit()
    return item


@router.post("/sales/{sale_id}/mpesa/stk-push", response_model=MpesaStkPushResponse)
def send_mpesa_stk_push(
    sale_id: UUID,
    payload: MpesaStkPushCreate,
    principal: SalesPrincipal,
    db: DatabaseSession,
) -> MpesaStkPushResponse:
    item = mpesa_service.initiate_sale_stk_push(db, principal, sale_id, payload)
    db.commit()
    return item


@router.post("/sales/{sale_id}/mpesa/manual-confirm", response_model=PaymentResponse)
def manually_confirm_mpesa_payment(
    sale_id: UUID,
    payload: MpesaManualConfirmCreate,
    principal: SalesPrincipal,
    db: DatabaseSession,
) -> PaymentResponse:
    item = mpesa_service.manually_confirm_sale_payment(db, principal, sale_id, payload)
    db.commit()
    return item


@router.post("/mpesa/callback", include_in_schema=False)
def mpesa_callback(payload: dict, db: DatabaseSession) -> dict[str, str]:
    mpesa_service.handle_stk_callback(db, payload)
    db.commit()
    return {"ResultCode": "0", "ResultDesc": "Accepted"}


@router.post("/sales/{sale_id}/cancel", response_model=POSSaleResponse)
def cancel_sale(
    sale_id: UUID,
    principal: SalesPrincipal,
    db: DatabaseSession,
) -> POSSaleResponse:
    item = sale_service.cancel_unpaid_sale(db, principal, sale_id)
    db.commit()
    return item


@router.get("/sales/{sale_id}/receipt", response_model=ReceiptResponse)
def sale_receipt(
    sale_id: UUID,
    principal: SalesPrincipal,
    db: DatabaseSession,
) -> ReceiptResponse:
    return sale_service.receipt(db, principal, sale_id)


@router.post(
    "/sales/{sale_id}/void-requests",
    response_model=ApprovalRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
def request_sale_void(
    sale_id: UUID,
    payload: SaleVoidRequest,
    principal: SalesPrincipal,
    db: DatabaseSession,
) -> ApprovalRequestResponse:
    item = return_service.request_void(db, principal, sale_id, payload)
    db.commit()
    return item


@router.get("/sales/{sale_id}/returns", response_model=list[SaleReturnResponse])
def list_sale_returns(
    sale_id: UUID,
    principal: SalesPrincipal,
    db: DatabaseSession,
) -> list[SaleReturnResponse]:
    return return_service.list_returns(db, principal, sale_id)


@router.post(
    "/sales/{sale_id}/returns",
    response_model=SaleReturnResponse,
    status_code=status.HTTP_201_CREATED,
)
def request_sale_return(
    sale_id: UUID,
    payload: SaleReturnCreate,
    principal: SalesPrincipal,
    db: DatabaseSession,
) -> SaleReturnResponse:
    item = return_service.request_return(db, principal, sale_id, payload)
    db.commit()
    return item


@router.post("/returns/{return_id}/decision", response_model=SaleReturnResponse)
def decide_sale_return(
    return_id: UUID,
    payload: ApprovalDecision,
    principal: ReturnApprovePrincipal,
    db: DatabaseSession,
) -> SaleReturnResponse:
    item = return_service.decide_return(db, principal, return_id, payload)
    db.commit()
    return item


@router.get("/warranties/lookup", response_model=WarrantyResponse)
def lookup_warranty(
    principal: SalesPrincipal,
    db: DatabaseSession,
    identifier: str = Query(min_length=3, max_length=120),
) -> WarrantyResponse:
    return sale_service.lookup_warranty(db, principal, identifier)
