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
    access_token_minutes: int = 15
    refresh_token_days: int = 7

    model_config = SettingsConfigDict(
        env_file=".env", env_prefix="TECH_SHOP_", extra="ignore"
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
