import base64
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.models.enums import (
    PaymentDirection,
    PaymentMethod,
    PaymentStatus,
    SaleStatus,
)
from backend.models.payments import Payment
from backend.models.sales import Sale
from backend.schemas.payments_schemas import (
    MpesaManualConfirmCreate,
    MpesaStkPushCreate,
    MpesaStkQueryResponse,
    MpesaStkPushResponse,
    PaymentResponse,
)
from backend.services import sales
from backend.services.audit import record_audit
from backend.services.auth import AuthPrincipal
from backend.services.exceptions import ConflictError, NotFoundError, ValidationError

NAIROBI_TZ = ZoneInfo("Africa/Nairobi")
MPESA_PENDING_RESULT_CODES = {499}
MPESA_CANCELLED_RESULT_CODES = {1032}


def _configured_value(value: str | None, label: str) -> str:
    if not value:
        raise ValidationError(f"M-Pesa {label} is not configured")
    return value


def _normalize_phone(phone_number: str) -> str:
    digits = "".join(character for character in phone_number if character.isdigit())
    if digits.startswith("0") and len(digits) == 10:
        digits = f"254{digits[1:]}"
    elif digits.startswith("7") and len(digits) == 9:
        digits = f"254{digits}"
    elif digits.startswith("1") and len(digits) == 9:
        digits = f"254{digits}"

    if not digits.startswith("254") or len(digits) not in {12, 13}:
        raise ValidationError("enter a valid Kenyan M-Pesa phone number")
    return digits


def _mpesa_amount(amount: Decimal) -> int:
    whole_amount = amount.quantize(Decimal("1"))
    if amount != whole_amount:
        raise ValidationError("M-Pesa amount must be a whole KES amount")
    if whole_amount <= 0:
        raise ValidationError("M-Pesa amount must be at least KES 1")
    return int(whole_amount)


def _result_code(value: object) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _timestamp() -> str:
    return datetime.now(NAIROBI_TZ).strftime("%Y%m%d%H%M%S")


def _password(shortcode: str, passkey: str, timestamp: str) -> str:
    value = f"{shortcode}{passkey}{timestamp}".encode()
    return base64.b64encode(value).decode()


def _access_token() -> str:
    consumer_key = _configured_value(settings.mpesa_consumer_key, "consumer key")
    consumer_secret = _configured_value(
        settings.mpesa_consumer_secret, "consumer secret"
    )
    try:
        response = httpx.get(
            f"{settings.mpesa_base_url}/oauth/v1/generate",
            params={"grant_type": "client_credentials"},
            auth=(consumer_key, consumer_secret),
            timeout=20,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ValidationError("could not authenticate with M-Pesa Daraja") from exc

    token = response.json().get("access_token")
    if not token:
        raise ValidationError("M-Pesa Daraja did not return an access token")
    return token


def _account_reference(invoice_number: str) -> str:
    compact = "".join(character for character in invoice_number if character.isalnum())
    return compact[-12:] or "TECHSHOP"


def initiate_sale_stk_push(
    db: Session,
    principal: AuthPrincipal,
    sale_id: UUID,
    payload: MpesaStkPushCreate,
) -> MpesaStkPushResponse:
    sale = sales.get_sale_model(db, principal, sale_id, lock=True)
    existing = db.scalar(
        select(Payment).where(Payment.idempotency_key == payload.idempotency_key)
    )
    if existing is not None:
        if existing.sale_id != sale.id:
            raise ConflictError("payment idempotency key is already in use")
        provider_payload = existing.provider_payload or {}
        return MpesaStkPushResponse(
            payment=PaymentResponse.model_validate(existing),
            merchant_request_id=str(provider_payload.get("merchant_request_id", "")),
            checkout_request_id=str(
                provider_payload.get("checkout_request_id")
                or existing.provider_reference
                or ""
            ),
            customer_message=str(
                provider_payload.get("customer_message")
                or "M-Pesa prompt already sent."
            ),
        )

    if sale.status != SaleStatus.PENDING_PAYMENT:
        raise ConflictError("this sale is not awaiting payment")
    pending_mpesa = db.scalar(
        select(Payment.id).where(
            Payment.sale_id == sale.id,
            Payment.method == PaymentMethod.MPESA,
            Payment.status == PaymentStatus.PENDING,
            Payment.is_deleted.is_(False),
        )
    )
    if pending_mpesa is not None:
        raise ConflictError(
            "a M-Pesa prompt is already pending; check its status or mark it "
            "cancelled before retrying"
        )

    outstanding = sales.money(sale.total_amount - sale.paid_amount)
    amount = sales.money(payload.amount)
    if amount > outstanding:
        raise ValidationError("payment exceeds the outstanding sale amount")

    phone_number = _normalize_phone(payload.phone_number)
    shortcode = settings.mpesa_shortcode.strip()
    passkey = _configured_value(settings.mpesa_passkey, "passkey")
    timestamp = _timestamp()
    request_payload = {
        "BusinessShortCode": shortcode,
        "Password": _password(shortcode, passkey, timestamp),
        "Timestamp": timestamp,
        "TransactionType": settings.mpesa_transaction_type,
        "Amount": _mpesa_amount(amount),
        "PartyA": phone_number,
        "PartyB": shortcode,
        "PhoneNumber": phone_number,
        "CallBackURL": settings.mpesa_stk_callback_url,
        "AccountReference": _account_reference(sale.invoice_number),
        "TransactionDesc": payload.notes or f"Payment for {sale.invoice_number}",
    }

    try:
        response = httpx.post(
            f"{settings.mpesa_base_url}/mpesa/stkpush/v1/processrequest",
            headers={"Authorization": f"Bearer {_access_token()}"},
            json=request_payload,
            timeout=30,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ValidationError("could not send M-Pesa STK Push prompt") from exc

    response_payload = response.json()
    response_code = str(response_payload.get("ResponseCode", ""))
    if response_code != "0":
        message = (
            response_payload.get("errorMessage")
            or response_payload.get("ResponseDescription")
            or "M-Pesa rejected the STK Push request"
        )
        raise ValidationError(str(message))

    checkout_request_id = str(response_payload.get("CheckoutRequestID") or "")
    merchant_request_id = str(response_payload.get("MerchantRequestID") or "")
    customer_message = str(
        response_payload.get("CustomerMessage")
        or "M-Pesa prompt sent. Ask the customer to enter their PIN."
    )
    if not checkout_request_id:
        raise ValidationError("M-Pesa response did not include a checkout request id")

    payment = Payment(
        branch_id=sale.branch_id,
        sale_id=sale.id,
        till_session_id=sale.till_session_id,
        direction=PaymentDirection.INCOMING,
        method=PaymentMethod.MPESA,
        status=PaymentStatus.PENDING,
        amount=amount,
        currency="KES",
        provider_reference=checkout_request_id,
        idempotency_key=payload.idempotency_key,
        provider_payload={
            "merchant_request_id": merchant_request_id,
            "checkout_request_id": checkout_request_id,
            "customer_message": customer_message,
            "phone_number": phone_number,
            "amount": str(amount),
            "callback_url": settings.mpesa_stk_callback_url,
            "response": response_payload,
        },
        notes=payload.notes,
    )
    db.add(payment)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=sale.branch_id,
        action="mpesa.stk_push_sent",
        resource_type="payment",
        resource_id=payment.id,
        after={
            "sale_id": str(sale.id),
            "checkout_request_id": checkout_request_id,
            "amount": str(amount),
        },
    )
    return MpesaStkPushResponse(
        payment=PaymentResponse.model_validate(payment),
        merchant_request_id=merchant_request_id,
        checkout_request_id=checkout_request_id,
        customer_message=customer_message,
    )


def _callback_metadata(callback: dict) -> dict[str, object]:
    items = callback.get("CallbackMetadata", {}).get("Item", [])
    return {
        str(item.get("Name")): item.get("Value") for item in items if item.get("Name")
    }


def _transaction_datetime(value: object) -> datetime | None:
    if value is None:
        return None
    try:
        parsed = datetime.strptime(str(value), "%Y%m%d%H%M%S").replace(
            tzinfo=NAIROBI_TZ
        )
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc)


def _find_checkout_payment(db: Session, checkout_request_id: str) -> Payment | None:
    return db.scalar(
        select(Payment)
        .where(
            Payment.method == PaymentMethod.MPESA,
            Payment.sale_id.is_not(None),
            or_(
                Payment.provider_reference == checkout_request_id,
                Payment.provider_payload["checkout_request_id"].as_string()
                == checkout_request_id,
            ),
            Payment.is_deleted.is_(False),
        )
        .with_for_update()
    )


def manually_confirm_sale_payment(
    db: Session,
    principal: AuthPrincipal,
    sale_id: UUID,
    payload: MpesaManualConfirmCreate,
) -> PaymentResponse:
    sale = sales.get_sale_model(db, principal, sale_id, lock=True)
    payment = db.scalar(
        select(Payment)
        .where(
            Payment.sale_id == sale.id,
            Payment.method == PaymentMethod.MPESA,
            Payment.status == PaymentStatus.PENDING,
            Payment.is_deleted.is_(False),
        )
        .order_by(Payment.created_at.desc())
        .with_for_update()
    )
    if payment is None:
        raise NotFoundError("no pending M-Pesa payment found for this sale")

    now = datetime.now(timezone.utc)
    provider_payload = {
        **(payment.provider_payload or {}),
        "manual_confirmation": True,
        "manual_confirmed_by": str(principal.user_id),
        "manual_confirmed_at": now.isoformat(),
        "manual_notes": payload.notes,
    }
    completed = sales.complete_pending_payment(
        db,
        payment,
        provider_reference=payload.provider_reference.strip().upper(),
        provider_payload=provider_payload,
        paid_at=now,
    )
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=sale.branch_id,
        action="mpesa.payment_manually_confirmed",
        resource_type="payment",
        resource_id=payment.id,
        after={
            "sale_id": str(sale.id),
            "provider_reference": completed.provider_reference,
        },
    )
    return completed


def _checkout_request_id(payment: Payment) -> str:
    provider_payload = payment.provider_payload or {}
    return str(
        provider_payload.get("checkout_request_id") or payment.provider_reference or ""
    )


def query_sale_stk_payment(
    db: Session,
    principal: AuthPrincipal,
    payment_id: UUID,
) -> MpesaStkQueryResponse:
    payment = db.scalar(
        select(Payment)
        .where(Payment.id == payment_id, Payment.is_deleted.is_(False))
        .with_for_update()
    )
    if payment is None:
        raise NotFoundError("payment not found")
    if payment.sale_id is None:
        raise ConflictError("payment is not linked to a sale")
    sale = sales.get_sale_model(db, principal, payment.sale_id, lock=True)
    if payment.method != PaymentMethod.MPESA:
        raise ConflictError("only M-Pesa payments can be queried")

    checkout_request_id = _checkout_request_id(payment)
    if not checkout_request_id:
        raise ValidationError("M-Pesa checkout request id is missing")

    if payment.status != PaymentStatus.PENDING:
        return MpesaStkQueryResponse(
            payment=PaymentResponse.model_validate(payment),
            checkout_request_id=checkout_request_id,
            result_code=None,
            result_description=f"M-Pesa payment is already {payment.status.value}.",
            customer_message=f"M-Pesa payment is already {payment.status.value}.",
        )

    shortcode = settings.mpesa_shortcode.strip()
    passkey = _configured_value(settings.mpesa_passkey, "passkey")
    timestamp = _timestamp()
    request_payload = {
        "BusinessShortCode": shortcode,
        "Password": _password(shortcode, passkey, timestamp),
        "Timestamp": timestamp,
        "CheckoutRequestID": checkout_request_id,
    }
    try:
        response = httpx.post(
            f"{settings.mpesa_base_url}/mpesa/stkpushquery/v1/query",
            headers={"Authorization": f"Bearer {_access_token()}"},
            json=request_payload,
            timeout=30,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ValidationError("could not query M-Pesa STK Push status") from exc

    response_payload = response.json()
    response_code = str(response_payload.get("ResponseCode") or "")
    if response_code and response_code != "0":
        message = (
            response_payload.get("errorMessage")
            or response_payload.get("ResponseDescription")
            or "M-Pesa rejected the STK status query"
        )
        raise ValidationError(str(message))

    result_code = _result_code(response_payload.get("ResultCode"))
    result_description = str(
        response_payload.get("ResultDesc")
        or response_payload.get("ResponseDescription")
        or "M-Pesa query completed."
    )
    provider_payload = {
        **(payment.provider_payload or {}),
        "stk_query": response_payload,
        "stk_query_result_code": result_code,
        "stk_query_result_description": result_description,
        "stk_query_checked_by": str(principal.user_id),
        "stk_query_checked_at": datetime.now(timezone.utc).isoformat(),
    }

    if result_code == 0:
        completed = sales.complete_pending_payment(
            db,
            payment,
            provider_reference=payment.provider_reference,
            provider_payload=provider_payload,
            paid_at=datetime.now(timezone.utc),
        )
        customer_message = "M-Pesa confirmed by status query. Receipt can be generated."
        return MpesaStkQueryResponse(
            payment=completed,
            checkout_request_id=checkout_request_id,
            result_code=result_code,
            result_description=result_description,
            customer_message=customer_message,
        )

    if result_code in MPESA_PENDING_RESULT_CODES or result_code is None:
        payment.provider_payload = provider_payload
        db.flush()
        return MpesaStkQueryResponse(
            payment=PaymentResponse.model_validate(payment),
            checkout_request_id=checkout_request_id,
            result_code=result_code,
            result_description=result_description,
            customer_message="M-Pesa is still processing this prompt.",
        )

    payment.status = (
        PaymentStatus.CANCELLED
        if result_code in MPESA_CANCELLED_RESULT_CODES
        else PaymentStatus.FAILED
    )
    payment.provider_payload = provider_payload
    payment.notes = result_description
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=sale.branch_id,
        action="mpesa.stk_push_status_checked",
        resource_type="payment",
        resource_id=payment.id,
        after={
            "sale_id": str(sale.id),
            "checkout_request_id": checkout_request_id,
            "result_code": result_code,
            "status": payment.status.value,
        },
    )
    return MpesaStkQueryResponse(
        payment=PaymentResponse.model_validate(payment),
        checkout_request_id=checkout_request_id,
        result_code=result_code,
        result_description=result_description,
        customer_message=(
            "M-Pesa prompt was cancelled."
            if payment.status == PaymentStatus.CANCELLED
            else "M-Pesa prompt failed. Choose another method or retry."
        ),
    )


def handle_stk_callback(db: Session, payload: dict) -> dict[str, object]:
    callback = payload.get("Body", {}).get("stkCallback", {})
    checkout_request_id = str(callback.get("CheckoutRequestID") or "")
    try:
        result_code = int(callback.get("ResultCode", -1))
    except (TypeError, ValueError):
        result_code = -1
    result_description = str(callback.get("ResultDesc") or "")
    merchant_request_id = str(callback.get("MerchantRequestID") or "")
    if not checkout_request_id:
        return {"matched": False, "status": "ignored", "reason": "missing checkout id"}

    payment = _find_checkout_payment(db, checkout_request_id)
    if payment is None:
        return {
            "matched": False,
            "status": "ignored",
            "checkout_request_id": checkout_request_id,
        }

    provider_payload = {
        **(payment.provider_payload or {}),
        "callback": payload,
        "result_code": result_code,
        "result_description": result_description,
        "merchant_request_id": merchant_request_id,
        "checkout_request_id": checkout_request_id,
    }

    if result_code != 0:
        sale = db.get(Sale, payment.sale_id) if payment.sale_id else None
        if payment.status == PaymentStatus.COMPLETED:
            payment.provider_payload = provider_payload
            db.flush()
            return {
                "matched": True,
                "status": payment.status.value,
                "checkout_request_id": checkout_request_id,
            }
        payment.status = (
            PaymentStatus.CANCELLED
            if result_code in MPESA_CANCELLED_RESULT_CODES
            else PaymentStatus.FAILED
        )
        payment.provider_payload = provider_payload
        db.flush()
        record_audit(
            db,
            actor_id=sale.cashier_id if sale else None,
            branch_id=payment.branch_id,
            action="mpesa.stk_push_failed",
            resource_type="payment",
            resource_id=payment.id,
            after={
                "checkout_request_id": checkout_request_id,
                "result_code": result_code,
                "result_description": result_description,
            },
        )
        return {
            "matched": True,
            "status": "failed",
            "checkout_request_id": checkout_request_id,
        }

    metadata = _callback_metadata(callback)
    receipt_number = str(metadata.get("MpesaReceiptNumber") or checkout_request_id)
    provider_payload["metadata"] = metadata
    if payment.status in {PaymentStatus.FAILED, PaymentStatus.CANCELLED}:
        sale = db.get(Sale, payment.sale_id) if payment.sale_id else None
        outstanding = (
            sales.money(sale.total_amount - sale.paid_amount)
            if sale is not None
            else Decimal("0.00")
        )
        if (
            sale is not None
            and sale.status == SaleStatus.PENDING_PAYMENT
            and payment.amount <= outstanding
        ):
            payment.status = PaymentStatus.PENDING
        else:
            payment.provider_payload = {
                **provider_payload,
                "late_success_after_unsuccessful": True,
                "late_success_needs_review": True,
            }
            db.flush()
            record_audit(
                db,
                actor_id=sale.cashier_id if sale else None,
                branch_id=payment.branch_id,
                action="mpesa.late_success_needs_review",
                resource_type="payment",
                resource_id=payment.id,
                after={
                    "checkout_request_id": checkout_request_id,
                    "provider_reference": receipt_number,
                    "current_status": payment.status.value,
                },
            )
            return {
                "matched": True,
                "status": "late_success_needs_review",
                "checkout_request_id": checkout_request_id,
                "provider_reference": receipt_number,
            }

    completed = sales.complete_pending_payment(
        db,
        payment,
        provider_reference=receipt_number,
        provider_payload=provider_payload,
        paid_at=_transaction_datetime(metadata.get("TransactionDate")),
    )
    return {
        "matched": True,
        "status": completed.status.value,
        "checkout_request_id": checkout_request_id,
        "provider_reference": completed.provider_reference,
    }
