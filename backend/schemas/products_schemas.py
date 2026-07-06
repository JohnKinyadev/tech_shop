from decimal import Decimal
from uuid import UUID

from pydantic import Field, model_validator

from backend.models.enums import TrackingType
from backend.schemas.base_schemas import BaseSchema, ModelResponse


class CategoryCreate(BaseSchema):
    parent_id: UUID | None = None
    name: str = Field(min_length=2, max_length=150)
    slug: str = Field(
        min_length=2, max_length=170, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
    )
    description: str | None = Field(default=None, max_length=500)


class CategoryUpdate(BaseSchema):
    parent_id: UUID | None = None
    name: str | None = Field(default=None, min_length=2, max_length=150)
    description: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None


class CategoryResponse(ModelResponse):
    parent_id: UUID | None
    name: str
    slug: str
    description: str | None
    is_active: bool


class BrandCreate(BaseSchema):
    name: str = Field(min_length=2, max_length=150)
    description: str | None = Field(default=None, max_length=500)


class BrandUpdate(BaseSchema):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    description: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None


class BrandResponse(ModelResponse):
    name: str
    description: str | None
    is_active: bool


class ProductVariantCreate(BaseSchema):
    name: str = Field(min_length=1, max_length=150)
    sku: str = Field(min_length=2, max_length=100)
    barcode: str | None = Field(default=None, max_length=100)
    tracking_type: TrackingType = TrackingType.BULK
    attributes: dict[str, str] = Field(default_factory=dict)
    cost_price: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    selling_price: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    minimum_selling_price: Decimal | None = Field(
        default=None, ge=0, max_digits=14, decimal_places=2
    )

    @model_validator(mode="after")
    def validate_prices(self) -> "ProductVariantCreate":
        if (
            self.minimum_selling_price is not None
            and self.minimum_selling_price > self.selling_price
        ):
            raise ValueError("minimum_selling_price cannot exceed selling_price")
        return self


class ProductVariantResponse(ModelResponse):
    product_id: UUID
    name: str
    sku: str
    barcode: str | None
    tracking_type: TrackingType
    attributes: dict
    cost_price: Decimal
    selling_price: Decimal
    minimum_selling_price: Decimal | None
    is_active: bool


class ProductVariantUpdate(BaseSchema):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    barcode: str | None = Field(default=None, max_length=100)
    attributes: dict[str, str] | None = None
    cost_price: Decimal | None = Field(
        default=None, ge=0, max_digits=14, decimal_places=2
    )
    selling_price: Decimal | None = Field(
        default=None, ge=0, max_digits=14, decimal_places=2
    )
    minimum_selling_price: Decimal | None = Field(
        default=None, ge=0, max_digits=14, decimal_places=2
    )
    is_active: bool | None = None

    @model_validator(mode="after")
    def validate_prices(self) -> "ProductVariantUpdate":
        if (
            self.minimum_selling_price is not None
            and self.selling_price is not None
            and self.minimum_selling_price > self.selling_price
        ):
            raise ValueError("minimum_selling_price cannot exceed selling_price")
        return self


class ProductImageCreate(BaseSchema):
    url: str = Field(min_length=1, max_length=500)
    alt_text: str | None = Field(default=None, max_length=255)
    position: int = Field(default=0, ge=0)


class ProductImageUpdate(BaseSchema):
    url: str | None = Field(default=None, min_length=1, max_length=500)
    alt_text: str | None = Field(default=None, max_length=255)
    position: int | None = Field(default=None, ge=0)


class ProductImageResponse(ModelResponse):
    product_id: UUID
    url: str
    alt_text: str | None
    position: int


class ProductCreate(BaseSchema):
    name: str = Field(min_length=2, max_length=255)
    slug: str = Field(
        min_length=2, max_length=280, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
    )
    description: str | None = None
    category_id: UUID | None = None
    brand_id: UUID | None = None
    warranty_months: int = Field(default=0, ge=0, le=120)
    variants: list[ProductVariantCreate] = Field(min_length=1)


class ProductUpdate(BaseSchema):
    name: str | None = Field(default=None, min_length=2, max_length=255)
    description: str | None = None
    category_id: UUID | None = None
    brand_id: UUID | None = None
    warranty_months: int | None = Field(default=None, ge=0, le=120)
    is_active: bool | None = None
    is_published: bool | None = None


class ProductResponse(ModelResponse):
    name: str
    slug: str
    description: str | None
    category_id: UUID | None
    brand_id: UUID | None
    warranty_months: int
    is_active: bool
    is_published: bool
    variants: list[ProductVariantResponse] = Field(default_factory=list)
    images: list[ProductImageResponse] = Field(default_factory=list)
