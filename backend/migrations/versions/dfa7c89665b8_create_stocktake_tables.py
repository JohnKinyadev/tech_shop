"""record stocktake schema checkpoint

Revision ID: dfa7c89665b8
Revises: 0980f07fde03
Create Date: 2026-07-06 20:28:19.343446
"""

from typing import Sequence, Union

revision: str = "dfa7c89665b8"
down_revision: Union[str, None] = "0980f07fde03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """The stock-count tables were created in revision 9c276b0ab9f0."""


def downgrade() -> None:
    """No schema operations were introduced by this checkpoint."""
