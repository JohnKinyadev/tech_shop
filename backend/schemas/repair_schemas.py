from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import Field

from backend.models.enums import PaymentMethod, RepairStatus
from backend.schemas.base_schemas import BaseSchema, ModelResponse


class RepairBookingCreate(BaseSchema):
    branch_id: UUID
    customer_id: UUID
    device_type: str = Field(min_length=2, max_length=50)
    device_brand: str = Field(min_length=1, max_length=100)
    device_model: str = Field(min_length=1, max_length=150)
    serial_number: str | None = Field(default=None, max_length=120)
    imei: str | None = Field(default=None, max_length=20)
    reported_issue: str = Field(min_length=5, max_length=3000)
    booked_for: datetime | None = None


class RepairIntakeUpdate(BaseSchema):
    serialized_unit_id: UUID | None = None
    intake_condition: str = Field(min_length=3, max_length=3000)
    intake_images: list[str] = Field(default_factory=list)
    accessories_received: list[str] = Field(default_factory=list)


class RepairDiagnosisUpdate(BaseSchema):
    diagnosis: str = Field(min_length=3, max_length=3000)
    labor_estimate: Decimal = Field(ge=0)
    parts_estimate: Decimal = Field(ge=0)


class RepairAssignmentUpdate(BaseSchema):
    technician_id: UUID


class RepairPartCreate(BaseSchema):
    variant_id: UUID
    serialized_unit_id: UUID | None = None
    quantity: int = Field(gt=0)


class RepairPartResponse(ModelResponse):
    repair_ticket_id: UUID
    variant_id: UUID
    serialized_unit_id: UUID | None
    quantity: int
    unit_cost: Decimal
    unit_price: Decimal


class RepairPartView(ModelResponse):
    repair_ticket_id: UUID
    variant_id: UUID
    serialized_unit_id: UUID | None
    quantity: int
    unit_price: Decimal


class RepairStatusUpdate(BaseSchema):
    status: RepairStatus
    note: str | None = Field(default=None, max_length=500)


class RepairNote(BaseSchema):
    note: str | None = Field(default=None, max_length=500)


class RepairQuoteDecision(BaseSchema):
    approved: bool
    note: str | None = Field(default=None, max_length=500)


class RepairPaymentCreate(BaseSchema):
    till_session_id: UUID
    method: PaymentMethod
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    provider_reference: str | None = Field(default=None, max_length=150)
    idempotency_key: str = Field(min_length=8, max_length=150)
    notes: str | None = Field(default=None, max_length=500)


class RepairStatusHistoryResponse(ModelResponse):
    repair_ticket_id: UUID
    from_status: RepairStatus | None
    to_status: RepairStatus
    changed_by_id: UUID
    note: str | None


class RepairTicketResponse(ModelResponse):
    ticket_number: str
    branch_id: UUID
    customer_id: UUID
    technician_id: UUID | None
    serialized_unit_id: UUID | None
    status: RepairStatus
    device_type: str
    device_brand: str
    device_model: str
    serial_number: str | None
    imei: str | None
    reported_issue: str
    diagnosis: str | None
    intake_condition: str | None
    intake_images: list
    accessories_received: list
    labor_estimate: Decimal
    parts_estimate: Decimal
    approved_at: datetime | None
    booked_for: datetime | None
    received_at: datetime | None
    ready_at: datetime | None
    collected_at: datetime | None
    parts: list[RepairPartResponse] = Field(default_factory=list)
    status_history: list[RepairStatusHistoryResponse] = Field(default_factory=list)


class RepairTicketView(RepairTicketResponse):
    parts: list[RepairPartView] = Field(default_factory=list)


class RepairInvoicePayment(BaseSchema):
    method: PaymentMethod
    amount: Decimal
    provider_reference: str | None
    paid_at: datetime | None


class RepairInvoiceResponse(BaseSchema):
    ticket_id: UUID
    ticket_number: str
    branch_id: UUID
    customer_id: UUID
    customer_name: str
    customer_phone: str
    device_description: str
    labor_amount: Decimal
    parts_amount: Decimal
    total_amount: Decimal
    paid_amount: Decimal
    balance_due: Decimal
    payment_status: str
    payments: list[RepairInvoicePayment] = Field(default_factory=list)


class RepairCollectionResponse(BaseSchema):
    ticket_id: UUID
    ticket_number: str
    status: RepairStatus
    collected_at: datetime
