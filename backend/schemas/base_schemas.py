from datetime import datetime
from decimal import Decimal
from typing import Generic, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ModelResponse(BaseSchema):
    id: UUID
    created_at: datetime
    updated_at: datetime
    is_deleted: bool


TimestampedSchema = ModelResponse
T = TypeVar("T")


class Page(BaseSchema, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


Money = Decimal
