from collections import defaultdict
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from backend.models.brand import Brand
from backend.models.products import Category, Product, ProductImage, ProductVariant
from backend.schemas.products_schemas import (
    BrandCreate,
    BrandUpdate,
    CategoryCreate,
    CategoryUpdate,
    ProductCreate,
    ProductImageCreate,
    ProductImageResponse,
    ProductImageUpdate,
    ProductResponse,
    ProductUpdate,
    ProductVariantCreate,
    ProductVariantResponse,
    ProductVariantUpdate,
)
from backend.services.audit import record_audit
from backend.services.auth import AuthPrincipal
from backend.services.authorization import enforce_permission
from backend.services.exceptions import ConflictError, NotFoundError, ValidationError


def _money(value: Decimal | None) -> str | None:
    return str(value) if value is not None else None


def category_snapshot(category: Category) -> dict[str, Any]:
    return {
        "id": str(category.id),
        "parent_id": str(category.parent_id) if category.parent_id else None,
        "name": category.name,
        "slug": category.slug,
        "description": category.description,
        "is_active": category.is_active,
    }


def brand_snapshot(brand: Brand) -> dict[str, Any]:
    return {
        "id": str(brand.id),
        "name": brand.name,
        "description": brand.description,
        "is_active": brand.is_active,
    }


def product_snapshot(product: Product) -> dict[str, Any]:
    return {
        "id": str(product.id),
        "name": product.name,
        "slug": product.slug,
        "category_id": str(product.category_id) if product.category_id else None,
        "brand_id": str(product.brand_id) if product.brand_id else None,
        "warranty_months": product.warranty_months,
        "is_active": product.is_active,
        "is_published": product.is_published,
    }


def variant_snapshot(variant: ProductVariant) -> dict[str, Any]:
    return {
        "id": str(variant.id),
        "product_id": str(variant.product_id),
        "name": variant.name,
        "sku": variant.sku,
        "barcode": variant.barcode,
        "tracking_type": variant.tracking_type.value,
        "attributes": variant.attributes,
        "cost_price": _money(variant.cost_price),
        "selling_price": _money(variant.selling_price),
        "minimum_selling_price": _money(variant.minimum_selling_price),
        "is_active": variant.is_active,
    }


def image_snapshot(image: ProductImage) -> dict[str, Any]:
    return {
        "id": str(image.id),
        "product_id": str(image.product_id),
        "url": image.url,
        "alt_text": image.alt_text,
        "position": image.position,
        "is_deleted": image.is_deleted,
    }


def list_categories(db: Session) -> list[Category]:
    return list(
        db.scalars(
            select(Category)
            .where(Category.is_deleted.is_(False))
            .order_by(Category.name)
        ).all()
    )


def _get_category(db: Session, category_id: UUID, *, active: bool = False) -> Category:
    statement = select(Category).where(
        Category.id == category_id,
        Category.is_deleted.is_(False),
    )
    if active:
        statement = statement.where(Category.is_active.is_(True))
    category = db.scalar(statement)
    if category is None:
        raise NotFoundError("category not found")
    return category


def get_category(db: Session, category_id: UUID) -> Category:
    return _get_category(db, category_id)


def _ensure_unique_category(
    db: Session, name: str, slug: str, exclude_id: UUID | None = None
) -> None:
    statement = select(Category.id).where(
        or_(
            func.lower(Category.name) == name.strip().lower(),
            func.lower(Category.slug) == slug.strip().lower(),
        ),
        Category.is_deleted.is_(False),
    )
    if exclude_id is not None:
        statement = statement.where(Category.id != exclude_id)
    if db.scalar(statement.limit(1)) is not None:
        raise ConflictError("category name or slug is already in use")


def _validate_category_parent(
    db: Session, parent_id: UUID | None, category_id: UUID | None = None
) -> None:
    current_id = parent_id
    visited: set[UUID] = set()
    while current_id is not None:
        if current_id == category_id or current_id in visited:
            raise ValidationError("category parent would create a cycle")
        visited.add(current_id)
        parent = _get_category(db, current_id, active=True)
        current_id = parent.parent_id


def create_category(
    db: Session, principal: AuthPrincipal, payload: CategoryCreate
) -> Category:
    enforce_permission(principal, "catalog.manage")
    _ensure_unique_category(db, payload.name, payload.slug)
    _validate_category_parent(db, payload.parent_id)
    category = Category(
        parent_id=payload.parent_id,
        name=payload.name.strip(),
        slug=payload.slug,
        description=payload.description,
        is_active=True,
    )
    db.add(category)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=principal.branch_id,
        action="catalog.category_created",
        resource_type="category",
        resource_id=category.id,
        after=category_snapshot(category),
    )
    return category


def update_category(
    db: Session,
    principal: AuthPrincipal,
    category_id: UUID,
    payload: CategoryUpdate,
) -> Category:
    enforce_permission(principal, "catalog.manage")
    if not payload.model_fields_set:
        raise ValidationError("at least one field is required")
    category = _get_category(db, category_id)
    if payload.name is not None:
        _ensure_unique_category(db, payload.name, category.slug, category.id)
    if "parent_id" in payload.model_fields_set:
        _validate_category_parent(db, payload.parent_id, category.id)
    before = category_snapshot(category)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "name" and value is not None:
            value = value.strip()
        setattr(category, field, value)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=principal.branch_id,
        action="catalog.category_updated",
        resource_type="category",
        resource_id=category.id,
        before=before,
        after=category_snapshot(category),
    )
    return category


def list_brands(db: Session) -> list[Brand]:
    return list(
        db.scalars(
            select(Brand).where(Brand.is_deleted.is_(False)).order_by(Brand.name)
        ).all()
    )


def _get_brand(db: Session, brand_id: UUID, *, active: bool = False) -> Brand:
    statement = select(Brand).where(
        Brand.id == brand_id,
        Brand.is_deleted.is_(False),
    )
    if active:
        statement = statement.where(Brand.is_active.is_(True))
    brand = db.scalar(statement)
    if brand is None:
        raise NotFoundError("brand not found")
    return brand


def get_brand(db: Session, brand_id: UUID) -> Brand:
    return _get_brand(db, brand_id)


def _ensure_unique_brand(
    db: Session, name: str, exclude_id: UUID | None = None
) -> None:
    statement = select(Brand.id).where(
        func.lower(Brand.name) == name.strip().lower(),
        Brand.is_deleted.is_(False),
    )
    if exclude_id is not None:
        statement = statement.where(Brand.id != exclude_id)
    if db.scalar(statement.limit(1)) is not None:
        raise ConflictError("brand name is already in use")


def create_brand(db: Session, principal: AuthPrincipal, payload: BrandCreate) -> Brand:
    enforce_permission(principal, "catalog.manage")
    _ensure_unique_brand(db, payload.name)
    brand = Brand(
        name=payload.name.strip(),
        description=payload.description,
        is_active=True,
    )
    db.add(brand)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=principal.branch_id,
        action="catalog.brand_created",
        resource_type="brand",
        resource_id=brand.id,
        after=brand_snapshot(brand),
    )
    return brand


def update_brand(
    db: Session,
    principal: AuthPrincipal,
    brand_id: UUID,
    payload: BrandUpdate,
) -> Brand:
    enforce_permission(principal, "catalog.manage")
    if not payload.model_fields_set:
        raise ValidationError("at least one field is required")
    brand = _get_brand(db, brand_id)
    if payload.name is not None:
        _ensure_unique_brand(db, payload.name, brand.id)
    before = brand_snapshot(brand)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "name" and value is not None:
            value = value.strip()
        setattr(brand, field, value)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=principal.branch_id,
        action="catalog.brand_updated",
        resource_type="brand",
        resource_id=brand.id,
        before=before,
        after=brand_snapshot(brand),
    )
    return brand


def _validate_product_links(
    db: Session, category_id: UUID | None, brand_id: UUID | None
) -> None:
    if category_id is not None:
        _get_category(db, category_id, active=True)
    if brand_id is not None:
        _get_brand(db, brand_id, active=True)


def _get_product(db: Session, product_id: UUID) -> Product:
    product = db.scalar(
        select(Product).where(
            Product.id == product_id,
            Product.is_deleted.is_(False),
        )
    )
    if product is None:
        raise NotFoundError("product not found")
    return product


def _ensure_unique_product_slug(
    db: Session, slug: str, exclude_id: UUID | None = None
) -> None:
    statement = select(Product.id).where(
        func.lower(Product.slug) == slug.lower(),
        Product.is_deleted.is_(False),
    )
    if exclude_id is not None:
        statement = statement.where(Product.id != exclude_id)
    if db.scalar(statement.limit(1)) is not None:
        raise ConflictError("product slug is already in use")


def _ensure_unique_variant(
    db: Session,
    sku: str,
    barcode: str | None,
    exclude_id: UUID | None = None,
) -> None:
    identity_checks = [func.lower(ProductVariant.sku) == sku.strip().lower()]
    if barcode:
        identity_checks.append(ProductVariant.barcode == barcode.strip())
    statement = select(ProductVariant.id).where(
        or_(*identity_checks),
        ProductVariant.is_deleted.is_(False),
    )
    if exclude_id is not None:
        statement = statement.where(ProductVariant.id != exclude_id)
    if db.scalar(statement.limit(1)) is not None:
        raise ConflictError("variant SKU or barcode is already in use")


def _new_variant(product_id: UUID, payload: ProductVariantCreate) -> ProductVariant:
    return ProductVariant(
        product_id=product_id,
        name=payload.name.strip(),
        sku=payload.sku.strip().upper(),
        barcode=payload.barcode.strip() if payload.barcode else None,
        tracking_type=payload.tracking_type,
        attributes=payload.attributes,
        cost_price=payload.cost_price,
        selling_price=payload.selling_price,
        minimum_selling_price=payload.minimum_selling_price,
        is_active=True,
    )


def create_product(
    db: Session, principal: AuthPrincipal, payload: ProductCreate
) -> ProductResponse:
    enforce_permission(principal, "catalog.manage")
    _ensure_unique_product_slug(db, payload.slug)
    _validate_product_links(db, payload.category_id, payload.brand_id)
    seen_skus: set[str] = set()
    seen_barcodes: set[str] = set()
    for item in payload.variants:
        sku = item.sku.strip().upper()
        barcode = item.barcode.strip() if item.barcode else None
        if sku in seen_skus or (barcode and barcode in seen_barcodes):
            raise ConflictError("duplicate SKU or barcode in product variants")
        _ensure_unique_variant(db, sku, barcode)
        seen_skus.add(sku)
        if barcode:
            seen_barcodes.add(barcode)

    product = Product(
        name=payload.name.strip(),
        slug=payload.slug,
        description=payload.description,
        category_id=payload.category_id,
        brand_id=payload.brand_id,
        warranty_months=payload.warranty_months,
        is_active=True,
        is_published=False,
    )
    db.add(product)
    db.flush()
    for item in payload.variants:
        db.add(_new_variant(product.id, item))
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=principal.branch_id,
        action="catalog.product_created",
        resource_type="product",
        resource_id=product.id,
        after=product_snapshot(product),
    )
    return get_product(db, product.id)


def _product_responses(db: Session, products: list[Product]) -> list[ProductResponse]:
    if not products:
        return []
    product_ids = [product.id for product in products]
    variants_by_product: dict[UUID, list[ProductVariantResponse]] = defaultdict(list)
    images_by_product: dict[UUID, list[ProductImageResponse]] = defaultdict(list)
    variants = db.scalars(
        select(ProductVariant)
        .where(
            ProductVariant.product_id.in_(product_ids),
            ProductVariant.is_deleted.is_(False),
        )
        .order_by(ProductVariant.name)
    ).all()
    images = db.scalars(
        select(ProductImage)
        .where(
            ProductImage.product_id.in_(product_ids),
            ProductImage.is_deleted.is_(False),
        )
        .order_by(ProductImage.position)
    ).all()
    for variant in variants:
        variants_by_product[variant.product_id].append(
            ProductVariantResponse.model_validate(variant)
        )
    for image in images:
        images_by_product[image.product_id].append(
            ProductImageResponse.model_validate(image)
        )
    return [
        ProductResponse.model_validate(product).model_copy(
            update={
                "variants": variants_by_product[product.id],
                "images": images_by_product[product.id],
            }
        )
        for product in products
    ]


def list_products(
    db: Session,
    *,
    page: int,
    page_size: int,
    query: str | None = None,
    category_id: UUID | None = None,
    brand_id: UUID | None = None,
    is_active: bool | None = None,
    is_published: bool | None = None,
) -> tuple[list[ProductResponse], int]:
    conditions = [Product.is_deleted.is_(False)]
    if query:
        search = f"%{query.strip()}%"
        sku_products = select(ProductVariant.product_id).where(
            ProductVariant.sku.ilike(search),
            ProductVariant.is_deleted.is_(False),
        )
        conditions.append(
            or_(
                Product.name.ilike(search),
                Product.slug.ilike(search),
                Product.id.in_(sku_products),
            )
        )
    if category_id is not None:
        conditions.append(Product.category_id == category_id)
    if brand_id is not None:
        conditions.append(Product.brand_id == brand_id)
    if is_active is not None:
        conditions.append(Product.is_active == is_active)
    if is_published is not None:
        conditions.append(Product.is_published == is_published)

    total = db.scalar(select(func.count()).select_from(Product).where(*conditions)) or 0
    products = list(
        db.scalars(
            select(Product)
            .where(*conditions)
            .order_by(Product.name)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    return _product_responses(db, products), total


def get_product(db: Session, product_id: UUID) -> ProductResponse:
    product = _get_product(db, product_id)
    return _product_responses(db, [product])[0]


def update_product(
    db: Session,
    principal: AuthPrincipal,
    product_id: UUID,
    payload: ProductUpdate,
) -> ProductResponse:
    enforce_permission(principal, "catalog.manage")
    if not payload.model_fields_set:
        raise ValidationError("at least one field is required")
    product = _get_product(db, product_id)
    effective_category = (
        payload.category_id
        if "category_id" in payload.model_fields_set
        else product.category_id
    )
    effective_brand = (
        payload.brand_id if "brand_id" in payload.model_fields_set else product.brand_id
    )
    _validate_product_links(db, effective_category, effective_brand)
    before = product_snapshot(product)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "name" and value is not None:
            value = value.strip()
        setattr(product, field, value)
    if not product.is_active:
        product.is_published = False
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=principal.branch_id,
        action="catalog.product_updated",
        resource_type="product",
        resource_id=product.id,
        before=before,
        after=product_snapshot(product),
    )
    return get_product(db, product.id)


def create_variant(
    db: Session,
    principal: AuthPrincipal,
    product_id: UUID,
    payload: ProductVariantCreate,
) -> ProductVariant:
    enforce_permission(principal, "catalog.manage")
    _get_product(db, product_id)
    _ensure_unique_variant(db, payload.sku, payload.barcode)
    variant = _new_variant(product_id, payload)
    db.add(variant)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=principal.branch_id,
        action="catalog.variant_created",
        resource_type="product_variant",
        resource_id=variant.id,
        after=variant_snapshot(variant),
    )
    return variant


def update_variant(
    db: Session,
    principal: AuthPrincipal,
    variant_id: UUID,
    payload: ProductVariantUpdate,
) -> ProductVariant:
    enforce_permission(principal, "catalog.manage")
    if not payload.model_fields_set:
        raise ValidationError("at least one field is required")
    variant = db.scalar(
        select(ProductVariant).where(
            ProductVariant.id == variant_id,
            ProductVariant.is_deleted.is_(False),
        )
    )
    if variant is None:
        raise NotFoundError("product variant not found")
    if payload.barcode:
        _ensure_unique_variant(db, variant.sku, payload.barcode, variant.id)
    effective_selling = (
        payload.selling_price
        if "selling_price" in payload.model_fields_set
        else variant.selling_price
    )
    effective_minimum = (
        payload.minimum_selling_price
        if "minimum_selling_price" in payload.model_fields_set
        else variant.minimum_selling_price
    )
    if effective_minimum is not None and effective_minimum > effective_selling:
        raise ValidationError("minimum selling price cannot exceed selling price")

    before = variant_snapshot(variant)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "name" and value is not None:
            value = value.strip()
        if field == "barcode" and value:
            value = value.strip()
        setattr(variant, field, value)
    db.flush()
    if not variant.is_active:
        active_variants = db.scalar(
            select(func.count())
            .select_from(ProductVariant)
            .where(
                ProductVariant.product_id == variant.product_id,
                ProductVariant.is_active.is_(True),
                ProductVariant.is_deleted.is_(False),
            )
        )
        if not active_variants:
            _get_product(db, variant.product_id).is_published = False
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=principal.branch_id,
        action="catalog.variant_updated",
        resource_type="product_variant",
        resource_id=variant.id,
        before=before,
        after=variant_snapshot(variant),
    )
    return variant


def _ensure_image_position(
    db: Session,
    product_id: UUID,
    position: int,
    exclude_id: UUID | None = None,
) -> None:
    statement = select(ProductImage.id).where(
        ProductImage.product_id == product_id,
        ProductImage.position == position,
        ProductImage.is_deleted.is_(False),
    )
    if exclude_id is not None:
        statement = statement.where(ProductImage.id != exclude_id)
    if db.scalar(statement.limit(1)) is not None:
        raise ConflictError("image position is already in use for this product")


def create_image(
    db: Session,
    principal: AuthPrincipal,
    product_id: UUID,
    payload: ProductImageCreate,
) -> ProductImage:
    enforce_permission(principal, "catalog.manage")
    _get_product(db, product_id)
    _ensure_image_position(db, product_id, payload.position)
    image = ProductImage(product_id=product_id, **payload.model_dump())
    db.add(image)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=principal.branch_id,
        action="catalog.image_created",
        resource_type="product_image",
        resource_id=image.id,
        after=image_snapshot(image),
    )
    return image


def _get_image(db: Session, image_id: UUID) -> ProductImage:
    image = db.scalar(
        select(ProductImage).where(
            ProductImage.id == image_id,
            ProductImage.is_deleted.is_(False),
        )
    )
    if image is None:
        raise NotFoundError("product image not found")
    return image


def update_image(
    db: Session,
    principal: AuthPrincipal,
    image_id: UUID,
    payload: ProductImageUpdate,
) -> ProductImage:
    enforce_permission(principal, "catalog.manage")
    if not payload.model_fields_set:
        raise ValidationError("at least one field is required")
    image = _get_image(db, image_id)
    if payload.position is not None:
        _ensure_image_position(db, image.product_id, payload.position, image.id)
    before = image_snapshot(image)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(image, field, value)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=principal.branch_id,
        action="catalog.image_updated",
        resource_type="product_image",
        resource_id=image.id,
        before=before,
        after=image_snapshot(image),
    )
    return image


def delete_image(db: Session, principal: AuthPrincipal, image_id: UUID) -> None:
    enforce_permission(principal, "catalog.manage")
    image = _get_image(db, image_id)
    before = image_snapshot(image)
    product_id = image.product_id
    db.delete(image)
    db.flush()
    remaining_images = db.scalar(
        select(func.count())
        .select_from(ProductImage)
        .where(
            ProductImage.product_id == product_id,
            ProductImage.is_deleted.is_(False),
        )
    )
    if not remaining_images:
        _get_product(db, product_id).is_published = False
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=principal.branch_id,
        action="catalog.image_deleted",
        resource_type="product_image",
        resource_id=image.id,
        before=before,
    )


def set_publication(
    db: Session,
    principal: AuthPrincipal,
    product_id: UUID,
    is_published: bool,
) -> ProductResponse:
    enforce_permission(principal, "catalog.manage")
    product = _get_product(db, product_id)
    if is_published:
        if not product.is_active:
            raise ValidationError("inactive products cannot be published")
        active_variants = db.scalar(
            select(func.count())
            .select_from(ProductVariant)
            .where(
                ProductVariant.product_id == product.id,
                ProductVariant.is_active.is_(True),
                ProductVariant.is_deleted.is_(False),
            )
        )
        images = db.scalar(
            select(func.count())
            .select_from(ProductImage)
            .where(
                ProductImage.product_id == product.id,
                ProductImage.is_deleted.is_(False),
            )
        )
        if not active_variants:
            raise ValidationError("a published product requires an active variant")
        if not images:
            raise ValidationError("a published product requires at least one image")
    before = product_snapshot(product)
    product.is_published = is_published
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=principal.branch_id,
        action=(
            "catalog.product_published"
            if is_published
            else "catalog.product_unpublished"
        ),
        resource_type="product",
        resource_id=product.id,
        before=before,
        after=product_snapshot(product),
    )
    return get_product(db, product.id)
