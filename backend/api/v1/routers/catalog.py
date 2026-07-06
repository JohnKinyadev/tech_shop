from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile, status

from backend.api.dependencies import DatabaseSession, require_permission
from backend.schemas.base_schemas import Page
from backend.schemas.products_schemas import (
    BrandCreate,
    BrandResponse,
    BrandUpdate,
    CatalogImportResponse,
    CatalogImportValidationResponse,
    CatalogProductResponse,
    CatalogVariantResponse,
    CategoryCreate,
    CategoryResponse,
    CategoryUpdate,
    ProductCreate,
    ProductImageCreate,
    ProductImageResponse,
    ProductImageUpdate,
    ProductPublicationUpdate,
    ProductResponse,
    ProductUpdate,
    ProductVariantCreate,
    ProductVariantResponse,
    ProductVariantUpdate,
)
from backend.services import catalog as catalog_service
from backend.services import catalog_import
from backend.services.auth import AuthPrincipal
from backend.services.exceptions import ValidationError

router = APIRouter(prefix="/catalog", tags=["staff-catalog"])
CatalogViewPrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("catalog.view"))
]
CatalogManagePrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("catalog.manage"))
]
MAX_CSV_BYTES = 5 * 1024 * 1024


def _safe_product(item: ProductResponse) -> CatalogProductResponse:
    return CatalogProductResponse(
        id=item.id,
        created_at=item.created_at,
        updated_at=item.updated_at,
        is_deleted=item.is_deleted,
        name=item.name,
        slug=item.slug,
        description=item.description,
        category_id=item.category_id,
        brand_id=item.brand_id,
        warranty_months=item.warranty_months,
        is_active=item.is_active,
        is_published=item.is_published,
        variants=[
            CatalogVariantResponse.model_validate(variant) for variant in item.variants
        ],
        images=item.images,
    )


@router.get("/categories", response_model=list[CategoryResponse])
def list_categories(
    principal: CatalogViewPrincipal, db: DatabaseSession
) -> list[CategoryResponse]:
    return [
        CategoryResponse.model_validate(item)
        for item in catalog_service.list_categories(db)
    ]


@router.get("/categories/{category_id}", response_model=CategoryResponse)
def get_category(
    category_id: UUID,
    principal: CatalogViewPrincipal,
    db: DatabaseSession,
) -> CategoryResponse:
    return CategoryResponse.model_validate(
        catalog_service.get_category(db, category_id)
    )


@router.post(
    "/categories", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED
)
def create_category(
    payload: CategoryCreate,
    principal: CatalogManagePrincipal,
    db: DatabaseSession,
) -> CategoryResponse:
    item = catalog_service.create_category(db, principal, payload)
    db.commit()
    return CategoryResponse.model_validate(item)


@router.patch("/categories/{category_id}", response_model=CategoryResponse)
def update_category(
    category_id: UUID,
    payload: CategoryUpdate,
    principal: CatalogManagePrincipal,
    db: DatabaseSession,
) -> CategoryResponse:
    item = catalog_service.update_category(db, principal, category_id, payload)
    db.commit()
    return CategoryResponse.model_validate(item)


@router.get("/brands", response_model=list[BrandResponse])
def list_brands(
    principal: CatalogViewPrincipal, db: DatabaseSession
) -> list[BrandResponse]:
    return [
        BrandResponse.model_validate(item) for item in catalog_service.list_brands(db)
    ]


@router.get("/brands/{brand_id}", response_model=BrandResponse)
def get_brand(
    brand_id: UUID,
    principal: CatalogViewPrincipal,
    db: DatabaseSession,
) -> BrandResponse:
    return BrandResponse.model_validate(catalog_service.get_brand(db, brand_id))


@router.post(
    "/brands", response_model=BrandResponse, status_code=status.HTTP_201_CREATED
)
def create_brand(
    payload: BrandCreate,
    principal: CatalogManagePrincipal,
    db: DatabaseSession,
) -> BrandResponse:
    item = catalog_service.create_brand(db, principal, payload)
    db.commit()
    return BrandResponse.model_validate(item)


@router.patch("/brands/{brand_id}", response_model=BrandResponse)
def update_brand(
    brand_id: UUID,
    payload: BrandUpdate,
    principal: CatalogManagePrincipal,
    db: DatabaseSession,
) -> BrandResponse:
    item = catalog_service.update_brand(db, principal, brand_id, payload)
    db.commit()
    return BrandResponse.model_validate(item)


async def _read_csv(file: UploadFile) -> bytes:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise ValidationError("catalog import must be a .csv file")
    content = await file.read(MAX_CSV_BYTES + 1)
    if len(content) > MAX_CSV_BYTES:
        raise ValidationError("catalog CSV cannot exceed 5 MB")
    return content


@router.post(
    "/products/import/validate", response_model=CatalogImportValidationResponse
)
async def validate_catalog_import(
    principal: CatalogManagePrincipal,
    db: DatabaseSession,
    file: UploadFile = File(...),
) -> CatalogImportValidationResponse:
    content = await _read_csv(file)
    plan = catalog_import.build_import_plan(db, content)
    return catalog_import.validation_response(plan)


@router.post("/products/import", response_model=CatalogImportResponse)
async def import_catalog(
    principal: CatalogManagePrincipal,
    db: DatabaseSession,
    file: UploadFile = File(...),
) -> CatalogImportResponse:
    content = await _read_csv(file)
    result = catalog_import.import_catalog(db, principal, content)
    db.commit()
    return result


@router.get("/products", response_model=Page[CatalogProductResponse])
def list_products(
    principal: CatalogViewPrincipal,
    db: DatabaseSession,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    q: str | None = Query(default=None, max_length=100),
    category_id: UUID | None = None,
    brand_id: UUID | None = None,
    is_active: bool | None = None,
    is_published: bool | None = None,
) -> Page[CatalogProductResponse]:
    items, total = catalog_service.list_products(
        db,
        page=page,
        page_size=page_size,
        query=q,
        category_id=category_id,
        brand_id=brand_id,
        is_active=is_active,
        is_published=is_published,
    )
    return Page[CatalogProductResponse](
        items=[_safe_product(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/products/{product_id}", response_model=CatalogProductResponse)
def get_product(
    product_id: UUID,
    principal: CatalogViewPrincipal,
    db: DatabaseSession,
) -> CatalogProductResponse:
    return _safe_product(catalog_service.get_product(db, product_id))


@router.post(
    "/products", response_model=ProductResponse, status_code=status.HTTP_201_CREATED
)
def create_product(
    payload: ProductCreate,
    principal: CatalogManagePrincipal,
    db: DatabaseSession,
) -> ProductResponse:
    item = catalog_service.create_product(db, principal, payload)
    db.commit()
    return item


@router.patch("/products/{product_id}", response_model=ProductResponse)
def update_product(
    product_id: UUID,
    payload: ProductUpdate,
    principal: CatalogManagePrincipal,
    db: DatabaseSession,
) -> ProductResponse:
    item = catalog_service.update_product(db, principal, product_id, payload)
    db.commit()
    return item


@router.patch("/products/{product_id}/publication", response_model=ProductResponse)
def update_product_publication(
    product_id: UUID,
    payload: ProductPublicationUpdate,
    principal: CatalogManagePrincipal,
    db: DatabaseSession,
) -> ProductResponse:
    item = catalog_service.set_publication(
        db, principal, product_id, payload.is_published
    )
    db.commit()
    return item


@router.post(
    "/products/{product_id}/variants",
    response_model=ProductVariantResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_variant(
    product_id: UUID,
    payload: ProductVariantCreate,
    principal: CatalogManagePrincipal,
    db: DatabaseSession,
) -> ProductVariantResponse:
    item = catalog_service.create_variant(db, principal, product_id, payload)
    db.commit()
    return ProductVariantResponse.model_validate(item)


@router.patch("/variants/{variant_id}", response_model=ProductVariantResponse)
def update_variant(
    variant_id: UUID,
    payload: ProductVariantUpdate,
    principal: CatalogManagePrincipal,
    db: DatabaseSession,
) -> ProductVariantResponse:
    item = catalog_service.update_variant(db, principal, variant_id, payload)
    db.commit()
    return ProductVariantResponse.model_validate(item)


@router.post(
    "/products/{product_id}/images",
    response_model=ProductImageResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_image(
    product_id: UUID,
    payload: ProductImageCreate,
    principal: CatalogManagePrincipal,
    db: DatabaseSession,
) -> ProductImageResponse:
    item = catalog_service.create_image(db, principal, product_id, payload)
    db.commit()
    return ProductImageResponse.model_validate(item)


@router.patch("/images/{image_id}", response_model=ProductImageResponse)
def update_image(
    image_id: UUID,
    payload: ProductImageUpdate,
    principal: CatalogManagePrincipal,
    db: DatabaseSession,
) -> ProductImageResponse:
    item = catalog_service.update_image(db, principal, image_id, payload)
    db.commit()
    return ProductImageResponse.model_validate(item)


@router.delete("/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_image(
    image_id: UUID,
    principal: CatalogManagePrincipal,
    db: DatabaseSession,
) -> Response:
    catalog_service.delete_image(db, principal, image_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
