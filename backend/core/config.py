from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Tech Shop System"
    environment: str = "development"
    database_url: str = (
        "postgresql+psycopg2://postgres:postgres@localhost:5432/tech_shop"
    )
    jwt_secret_key: str = "development-only-change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60
    refresh_token_days: int = 7
    cors_origins: str = (
        "http://localhost:5173,"
        "http://127.0.0.1:5173,"
        "http://localhost:3000,"
        "http://127.0.0.1:3000"
    )
    mpesa_environment: str = "sandbox"
    mpesa_consumer_key: str | None = None
    mpesa_consumer_secret: str | None = None
    mpesa_passkey: str | None = None
    mpesa_shortcode: str = "174379"
    mpesa_transaction_type: str = "CustomerPayBillOnline"
    mpesa_callback_base_url: str = "http://127.0.0.1:8000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def mpesa_base_url(self) -> str:
        if self.mpesa_environment.lower() in {"production", "live", "prod"}:
            return "https://api.safaricom.co.ke"
        return "https://sandbox.safaricom.co.ke"

    @property
    def mpesa_stk_callback_url(self) -> str:
        base_url = self.mpesa_callback_base_url.rstrip("/")
        return f"{base_url}/api/v1/staff/pos/mpesa/callback"

    model_config = SettingsConfigDict(
        env_file=".env", env_prefix="TECH_SHOP_", extra="ignore"
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
