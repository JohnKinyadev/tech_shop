from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend.core.permissions import ADMIN, PERMISSIONS, ROLE_DEFINITIONS
from backend.core.security import hash_password
from backend.models.audit import AuditLog
from backend.models.branch import Branch
from backend.models.permissions import Permission
from backend.models.roles import Role, RolePermission
from backend.models.users import User


class BootstrapError(ValueError):
    pass


@dataclass(frozen=True)
class SeedResult:
    permissions: int
    roles: int


def seed_system_access(db: Session) -> SeedResult:
    permission_by_code = {
        item.code: item for item in db.scalars(select(Permission)).all()
    }
    for definition in PERMISSIONS:
        item = permission_by_code.get(definition.code)
        if item is None:
            item = Permission(code=definition.code)
            db.add(item)
            permission_by_code[definition.code] = item
        item.resource = definition.resource
        item.action = definition.action
        item.description = definition.description
        item.is_deleted = False
    db.flush()

    role_by_code = {item.code: item for item in db.scalars(select(Role)).all()}
    for definition in ROLE_DEFINITIONS:
        role = role_by_code.get(definition.code)
        if role is None:
            role = Role(code=definition.code)
            db.add(role)
            role_by_code[definition.code] = role
        role.name = definition.name
        role.description = definition.description
        role.is_system = True
        role.is_active = True
        role.is_deleted = False
    db.flush()

    for definition in ROLE_DEFINITIONS:
        role = role_by_code[definition.code]
        desired_ids = {permission_by_code[code].id for code in definition.permissions}
        current_ids = set(
            db.scalars(
                select(RolePermission.permission_id).where(
                    RolePermission.role_id == role.id
                )
            ).all()
        )
        extra_ids = current_ids - desired_ids
        if extra_ids:
            db.execute(
                delete(RolePermission).where(
                    RolePermission.role_id == role.id,
                    RolePermission.permission_id.in_(extra_ids),
                )
            )
        for permission_id in desired_ids - current_ids:
            db.add(RolePermission(role_id=role.id, permission_id=permission_id))
    db.flush()
    return SeedResult(len(PERMISSIONS), len(ROLE_DEFINITIONS))


def create_initial_admin(
    db: Session,
    *,
    full_name: str,
    username: str,
    email: str,
    password: str,
    branch_name: str,
    branch_code: str,
    country: str = "Kenya",
) -> User:
    seed_system_access(db)
    admin_role = db.scalar(select(Role).where(Role.code == ADMIN))
    if admin_role is None:
        raise BootstrapError("admin role could not be created")

    existing_admin = db.scalar(
        select(User.id)
        .join(Role, Role.id == User.role_id)
        .where(
            Role.code == ADMIN,
            User.is_deleted.is_(False),
        )
        .limit(1)
    )
    if existing_admin is not None:
        raise BootstrapError("an admin account already exists")

    normalized_username = username.strip().lower()
    normalized_email = email.strip().lower()
    duplicate = db.scalar(
        select(User.id).where(
            (User.username == normalized_username) | (User.email == normalized_email)
        )
    )
    if duplicate is not None:
        raise BootstrapError("username or email is already in use")

    normalized_code = branch_code.strip().upper()
    branch = db.scalar(select(Branch).where(Branch.code == normalized_code))
    if branch is None:
        branch = Branch(
            name=branch_name.strip(),
            code=normalized_code,
            country=country.strip(),
            is_headquarters=True,
        )
        db.add(branch)
        db.flush()

    user = User(
        full_name=full_name.strip(),
        username=normalized_username,
        email=normalized_email,
        password_hash=hash_password(password),
        branch_id=branch.id,
        role_id=admin_role.id,
        is_active=True,
        is_verified=True,
        must_change_password=False,
    )
    db.add(user)
    db.flush()
    db.add(
        AuditLog(
            actor_id=user.id,
            branch_id=branch.id,
            action="system.initial_admin_created",
            resource_type="user",
            resource_id=user.id,
        )
    )
    return user
