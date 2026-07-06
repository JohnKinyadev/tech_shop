from sqlalchemy import Boolean, Enum, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import BaseModel
from backend.models.enums import BranchStatus, enum_values


class Branch(BaseModel):
    __tablename__ = "branches"

    name: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    country: Mapped[str] = mapped_column(String(100), default="Kenya", nullable=False)
    is_headquarters: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    status: Mapped[BranchStatus] = mapped_column(
        Enum(
            BranchStatus,
            values_callable=enum_values,
            native_enum=False,
            name="branch_status",
        ),
        default=BranchStatus.ACTIVE,
        nullable=False,
    )
