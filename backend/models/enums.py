from enum import Enum


def enum_values(enum_class: type[Enum]) -> list[str]:
    return [item.value for item in enum_class]


class StringEnum(str, Enum):
    pass


class BranchStatus(StringEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    CLOSED = "closed"


class TrackingType(StringEnum):
    BULK = "bulk"
    SERIAL = "serial"
    IMEI = "imei"


class SerializedUnitStatus(StringEnum):
    AVAILABLE = "available"
    RESERVED = "reserved"
    IN_TRANSFER = "in_transfer"
    SOLD = "sold"
    RETURNED = "returned"
    DAMAGED = "damaged"
    QUARANTINED = "quarantined"


class StockMovementType(StringEnum):
    PURCHASE_RECEIPT = "purchase_receipt"
    SALE = "sale"
    RETURN = "return"
    RESERVATION = "reservation"
    RESERVATION_RELEASE = "reservation_release"
    REPAIR_USAGE = "repair_usage"
    TRANSFER_OUT = "transfer_out"
    TRANSFER_IN = "transfer_in"
    ADJUSTMENT = "adjustment"


class TransferStatus(StringEnum):
    DRAFT = "draft"
    APPROVED = "approved"
    DISPATCHED = "dispatched"
    RECEIVED = "received"
    CANCELLED = "cancelled"


class StockCountStatus(StringEnum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    CANCELLED = "cancelled"


class PurchaseStatus(StringEnum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    PARTIALLY_RECEIVED = "partially_received"
    RECEIVED = "received"
    CANCELLED = "cancelled"


class SaleChannel(StringEnum):
    POS = "pos"
    ONLINE = "online"
    REPAIR = "repair"


class SaleStatus(StringEnum):
    DRAFT = "draft"
    PENDING_PAYMENT = "pending_payment"
    PAID = "paid"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    VOIDED = "voided"
    REFUNDED = "refunded"


class FulfillmentStatus(StringEnum):
    NOT_REQUIRED = "not_required"
    UNFULFILLED = "unfulfilled"
    ALLOCATED = "allocated"
    READY = "ready"
    FULFILLED = "fulfilled"
    CANCELLED = "cancelled"


class PaymentMethod(StringEnum):
    CASH = "cash"
    MPESA = "mpesa"
    CARD = "card"
    BANK_TRANSFER = "bank_transfer"
    STORE_CREDIT = "store_credit"


class PaymentStatus(StringEnum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"


class PaymentDirection(StringEnum):
    INCOMING = "incoming"
    OUTGOING = "outgoing"


class RepairStatus(StringEnum):
    BOOKED = "booked"
    AWAITING_DROPOFF = "awaiting_dropoff"
    RECEIVED = "received"
    DIAGNOSING = "diagnosing"
    QUOTE_PENDING = "quote_pending"
    CUSTOMER_APPROVED = "customer_approved"
    AWAITING_PARTS = "awaiting_parts"
    REPAIRING = "repairing"
    READY_FOR_PICKUP = "ready_for_pickup"
    COLLECTED = "collected"
    CANCELLED = "cancelled"


class ApprovalStatus(StringEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class TillSessionStatus(StringEnum):
    OPEN = "open"
    CLOSED = "closed"
