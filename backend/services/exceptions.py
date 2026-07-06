class ServiceError(Exception):
    """Base class for expected business-service errors."""


class NotFoundError(ServiceError):
    pass


class ConflictError(ServiceError):
    pass


class ValidationError(ServiceError):
    pass
