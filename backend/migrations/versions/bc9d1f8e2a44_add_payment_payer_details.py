"""add payer details to payments

Revision ID: bc9d1f8e2a44
Revises: dfa7c89665b8
Create Date: 2026-08-17 10:15:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "bc9d1f8e2a44"
down_revision: Union[str, None] = "dfa7c89665b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("payments", sa.Column("payer_phone", sa.String(length=20), nullable=True))
    op.add_column("payments", sa.Column("payer_name", sa.String(length=150), nullable=True))
    op.add_column(
        "payments",
        sa.Column("payer_account_reference", sa.String(length=150), nullable=True),
    )
    op.create_index("ix_payments_payer_phone", "payments", ["payer_phone"])


def downgrade() -> None:
    op.drop_index("ix_payments_payer_phone", table_name="payments")
    op.drop_column("payments", "payer_account_reference")
    op.drop_column("payments", "payer_name")
    op.drop_column("payments", "payer_phone")
