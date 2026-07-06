import csv
import io
import json
from dataclasses import dataclass

from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.models.brand import Brand
from backend.models.products import Category, Product, ProductVariant
from backend.schemas.products_schemas import (
    CatalogImportError,
    CatalogImportResponse,
    CatalogImportValidationResponse,
    ProductCreate,
    ProductVariantCreate,
)
from backend.services import catalog
from backend.services.auth import AuthPrincipal
from backend.services.authorization import enforce_permission
from backend.services.exceptions import ValidationError

REQUIRED_COLUMNS = {
    "product_name",
    "product_slug",
    "variant_name",
    "sku",
    "cost_price",
    "selling_price",
}
MAX_IMPORT_ROWS = 5000


@dataclass(frozen=True)
class CatalogImportPlan:
    total_rows: int
    products: list[ProductCreate]
    errors: list[CatalogImportError]

    @property
    def valid_rows(self) -> int:
        invalid_rows = {error.row for error in self.errors if error.row > 1}
        return max(0, self.total_rows - len(invalid_rows))


def _error(row: int, message: str, column: str | None = None) -> CatalogImportError:
    return CatalogImportError(row=row, column=column, message=message)


def _decode_csv(
    content: bytes,
) -> tuple[list[dict[str, str]], list[CatalogImportError]]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return [], [_error(1, "file must be UTF-8 encoded")]
    try:
        reader = csv.DictReader(io.StringIO(text))
        fieldnames = set(reader.fieldnames or [])
        missing = sorted(REQUIRED_COLUMNS - fieldnames)
        if missing:
            return [], [_error(1, f"missing required columns: {', '.join(missing)}")]
        rows = list(reader)
    except csv.Error as exc:
        return [], [_error(1, f"invalid CSV: {exc}")]
    if not rows:
        return [], [_error(1, "CSV contains no product rows")]
    if len(rows) > MAX_IMPORT_ROWS:
        return [], [_error(1, f"CSV cannot exceed {MAX_IMPORT_ROWS} rows")]
    return rows, []


def build_import_plan(db: Session, content: bytes) -> CatalogImportPlan:
    rows, errors = _decode_csv(content)
    if errors:
        return CatalogImportPlan(0, [], errors)

    categories = {
        item.name.lower(): item.id
        for item in db.scalars(
            select(Category).where(
                Category.is_active.is_(True), Category.is_deleted.is_(False)
            )
        ).all()
    }
    brands = {
        item.name.lower(): item.id
        for item in db.scalars(
            select(Brand).where(Brand.is_active.is_(True), Brand.is_deleted.is_(False))
        ).all()
    }
    existing_slugs = set(
        db.scalars(
            select(func.lower(Product.slug)).where(Product.is_deleted.is_(False))
        ).all()
    )
    existing_skus = set(
        db.scalars(
            select(func.lower(ProductVariant.sku)).where(
                ProductVariant.is_deleted.is_(False)
            )
        ).all()
    )
    existing_barcodes = set(
        db.scalars(
            select(ProductVariant.barcode).where(
                ProductVariant.barcode.is_not(None),
                ProductVariant.is_deleted.is_(False),
            )
        ).all()
    )

    product_data: dict[str, dict] = {}
    seen_skus: set[str] = set()
    seen_barcodes: set[str] = set()

    for row_number, row in enumerate(rows, start=2):
        product_name = (row.get("product_name") or "").strip()
        product_slug = (row.get("product_slug") or "").strip().lower()
        category_name = (row.get("category") or "").strip()
        brand_name = (row.get("brand") or "").strip()
        sku = (row.get("sku") or "").strip().upper()
        barcode = (row.get("barcode") or "").strip() or None

        category_id = categories.get(category_name.lower()) if category_name else None
        brand_id = brands.get(brand_name.lower()) if brand_name else None
        if category_name and category_id is None:
            errors.append(
                _error(row_number, "category does not exist or is inactive", "category")
            )
        if brand_name and brand_id is None:
            errors.append(
                _error(row_number, "brand does not exist or is inactive", "brand")
            )
        if product_slug in existing_slugs:
            errors.append(
                _error(row_number, "product slug already exists", "product_slug")
            )
        if sku.lower() in existing_skus or sku.lower() in seen_skus:
            errors.append(
                _error(row_number, "SKU already exists or is duplicated", "sku")
            )
        if barcode and (barcode in existing_barcodes or barcode in seen_barcodes):
            errors.append(
                _error(row_number, "barcode already exists or is duplicated", "barcode")
            )

        attributes: dict[str, str] = {}
        raw_attributes = (row.get("attributes_json") or "").strip()
        if raw_attributes:
            try:
                parsed_attributes = json.loads(raw_attributes)
                if not isinstance(parsed_attributes, dict):
                    raise ValueError
                attributes = {
                    str(key): str(value) for key, value in parsed_attributes.items()
                }
            except (json.JSONDecodeError, ValueError):
                errors.append(
                    _error(
                        row_number,
                        "attributes_json must be a JSON object",
                        "attributes_json",
                    )
                )

        try:
            variant = ProductVariantCreate(
                name=(row.get("variant_name") or "").strip(),
                sku=sku,
                barcode=barcode,
                tracking_type=(row.get("tracking_type") or "bulk").strip().lower(),
                attributes=attributes,
                cost_price=(row.get("cost_price") or "").strip(),
                selling_price=(row.get("selling_price") or "").strip(),
                minimum_selling_price=(row.get("minimum_selling_price") or "").strip()
                or None,
            )
        except PydanticValidationError as exc:
            for item in exc.errors():
                column = str(item["loc"][0]) if item.get("loc") else None
                errors.append(_error(row_number, item["msg"], column))
            continue

        try:
            warranty_months = int((row.get("warranty_months") or "0").strip())
        except ValueError:
            errors.append(
                _error(
                    row_number, "warranty_months must be an integer", "warranty_months"
                )
            )
            warranty_months = 0

        metadata = {
            "name": product_name,
            "slug": product_slug,
            "description": (row.get("description") or "").strip() or None,
            "category_id": category_id,
            "brand_id": brand_id,
            "warranty_months": warranty_months,
        }
        existing_product = product_data.get(product_slug)
        if existing_product is None:
            product_data[product_slug] = {**metadata, "variants": [variant]}
        else:
            comparable = {key: existing_product[key] for key in metadata}
            if comparable != metadata:
                errors.append(
                    _error(
                        row_number,
                        "rows sharing a product_slug must use identical product details",
                        "product_slug",
                    )
                )
            existing_product["variants"].append(variant)

        seen_skus.add(sku.lower())
        if barcode:
            seen_barcodes.add(barcode)

    products: list[ProductCreate] = []
    for data in product_data.values():
        try:
            products.append(ProductCreate(**data))
        except PydanticValidationError as exc:
            for item in exc.errors():
                column = str(item["loc"][0]) if item.get("loc") else None
                errors.append(_error(1, item["msg"], column))
    return CatalogImportPlan(len(rows), products, errors)


def validation_response(plan: CatalogImportPlan) -> CatalogImportValidationResponse:
    return CatalogImportValidationResponse(
        total_rows=plan.total_rows,
        valid_rows=plan.valid_rows,
        can_import=not plan.errors and bool(plan.products),
        errors=plan.errors,
    )


def import_catalog(
    db: Session, principal: AuthPrincipal, content: bytes
) -> CatalogImportResponse:
    enforce_permission(principal, "catalog.manage")
    plan = build_import_plan(db, content)
    if plan.errors or not plan.products:
        first_error = (
            plan.errors[0].message if plan.errors else "CSV contains no products"
        )
        raise ValidationError(f"catalog import failed validation: {first_error}")
    created_variants = 0
    for payload in plan.products:
        catalog.create_product(db, principal, payload)
        created_variants += len(payload.variants)
    return CatalogImportResponse(
        created_products=len(plan.products),
        created_variants=created_variants,
    )
