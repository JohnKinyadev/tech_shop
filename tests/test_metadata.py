from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from backend.models import Base


def test_all_model_tables_compile_for_postgresql() -> None:
    dialect = postgresql.dialect()
    for table in Base.metadata.sorted_tables:
        ddl = str(CreateTable(table).compile(dialect=dialect))
        assert f"CREATE TABLE {table.name}" in ddl


def test_core_transaction_tables_exist() -> None:
    required = {
        "product_variants",
        "serialized_units",
        "stock_movements",
        "purchase_order_items",
        "sale_items",
        "repair_parts",
        "role_permissions",
        "approval_requests",
    }
    assert required <= set(Base.metadata.tables)
