from dataclasses import dataclass

ADMIN = "admin"
BRANCH_MANAGER = "branch_manager"
INVENTORY_MANAGER = "inventory_manager"
TECHNICIAN = "technician"
CASHIER = "cashier"
ACCOUNTANT = "accountant"


@dataclass(frozen=True)
class PermissionDefinition:
    code: str
    resource: str
    action: str
    description: str


@dataclass(frozen=True)
class RoleDefinition:
    code: str
    name: str
    description: str
    permissions: frozenset[str]


def permission(code: str, description: str) -> PermissionDefinition:
    resource, action = code.rsplit(".", 1)
    return PermissionDefinition(code, resource, action, description)


PERMISSIONS = (
    permission("branches.manage", "Create and configure branches"),
    permission("catalog.view", "View the product catalog"),
    permission(
        "catalog.manage", "Create products, variants, categories, brands, and prices"
    ),
    permission("inventory.view", "View branch inventory levels"),
    permission("inventory.adjust", "Request or perform stock adjustments"),
    permission("inventory.transfer", "Initiate and process stock transfers"),
    permission("purchases.create", "Create purchase orders"),
    permission("purchases.approve", "Approve purchase orders"),
    permission("purchases.receive", "Receive stock against purchase orders"),
    permission("sales.process", "Process point-of-sale transactions"),
    permission("sales.void", "Approve or perform sale voids"),
    permission("returns.approve", "Approve returns and refunds"),
    permission("tills.manage", "Create and configure branch tills"),
    permission("repairs.view", "View repair tickets within the permitted scope"),
    permission("repairs.assign", "Assign repair tickets to technicians"),
    permission("repairs.update", "Update repair status and parts usage"),
    permission("repairs.close", "Close repair tickets and generate invoices"),
    permission("orders.fulfill", "Fulfill or cancel online orders"),
    permission("reports.sales.view", "View sales reports"),
    permission("reports.inventory.view", "View inventory and purchasing reports"),
    permission("reports.repairs.view", "View repair reports"),
    permission("reports.own_repairs.view", "View reports for assigned repair tickets"),
    permission("expenses.view", "View expense records"),
    permission("expenses.manage", "Create and approve expense records"),
    permission("staff.manage", "Create and edit staff accounts within role scope"),
    permission("tills.own.view", "View the signed-in cashier's till session"),
)

ALL_PERMISSION_CODES = frozenset(item.code for item in PERMISSIONS)

BRANCH_MANAGER_PERMISSIONS = frozenset(
    {
        "catalog.view",
        "inventory.view",
        "inventory.adjust",
        "inventory.transfer",
        "purchases.create",
        "purchases.approve",
        "purchases.receive",
        "sales.process",
        "sales.void",
        "returns.approve",
        "tills.manage",
        "repairs.view",
        "repairs.assign",
        "repairs.update",
        "repairs.close",
        "orders.fulfill",
        "reports.sales.view",
        "reports.inventory.view",
        "reports.repairs.view",
        "expenses.view",
        "expenses.manage",
        "staff.manage",
    }
)

ROLE_DEFINITIONS = (
    RoleDefinition(
        ADMIN, "Admin", "Full access across every branch", ALL_PERMISSION_CODES
    ),
    RoleDefinition(
        BRANCH_MANAGER,
        "Branch Manager",
        "Operational authority within one branch",
        BRANCH_MANAGER_PERMISSIONS,
    ),
    RoleDefinition(
        INVENTORY_MANAGER,
        "Inventory Manager",
        "Purchasing, receiving, stock, and fulfillment within one branch",
        frozenset(
            {
                "catalog.view",
                "inventory.view",
                "inventory.adjust",
                "inventory.transfer",
                "purchases.create",
                "purchases.approve",
                "purchases.receive",
                "orders.fulfill",
                "reports.inventory.view",
            }
        ),
    ),
    RoleDefinition(
        TECHNICIAN,
        "Technician",
        "Assigned repair tickets only",
        frozenset(
            {
                "repairs.view",
                "repairs.update",
                "repairs.close",
                "reports.own_repairs.view",
            }
        ),
    ),
    RoleDefinition(
        CASHIER,
        "Cashier",
        "Point of sale and own till access",
        frozenset(
            {
                "catalog.view",
                "inventory.view",
                "sales.process",
                "tills.own.view",
            }
        ),
    ),
    RoleDefinition(
        ACCOUNTANT,
        "Accountant",
        "Read-only financial and operational reporting",
        frozenset(
            {
                "reports.sales.view",
                "reports.inventory.view",
                "reports.repairs.view",
                "expenses.view",
            }
        ),
    ),
)

ROLE_CODES = frozenset(role.code for role in ROLE_DEFINITIONS)
ASSIGNABLE_ROLES = {
    ADMIN: ROLE_CODES,
    BRANCH_MANAGER: frozenset({CASHIER, TECHNICIAN}),
}
