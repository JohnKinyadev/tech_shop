from datetime import datetime
from uuid import UUID

from backend.schemas.base_schemas import ModelResponse


class WarrantyResponse(ModelResponse):
    sale_item_id: UUID
    serialized_unit_id: UUID | None
    customer_id: UUID | None
    start_date: datetime
    end_date: datetime
    status: str
