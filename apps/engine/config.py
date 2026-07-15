"""Configuration centralisée et validation des secrets au démarrage."""
import sys
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _find_env_file() -> Path | None:
    """Remonte l'arborescence depuis ce fichier pour trouver `.env`."""
    current = Path(__file__).resolve().parent
    for _ in range(5):
        env_file = current / ".env"
        if env_file.exists():
            return env_file
        current = current.parent
    return None


_ENV_FILE = _find_env_file()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE) if _ENV_FILE else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Infrastructure ─────────────────────────────────────────────
    database_url: str = Field(..., validation_alias="DATABASE_URL")
    redis_url: str = Field(default="redis://localhost:6379", validation_alias="REDIS_URL")
    engine_port: int = Field(default=8000, validation_alias="ENGINE_PORT")

    # ── Market Data APIs ───────────────────────────────────────────
    binance_api_key: str = Field(default="", validation_alias="BINANCE_API_KEY")
    binance_api_secret: str = Field(default="", validation_alias="BINANCE_API_SECRET")
    twelve_data_api_key: str = Field(default="", validation_alias="TWELVE_DATA_API_KEY")
    alpha_vantage_api_key: str = Field(default="", validation_alias="ALPHA_VANTAGE_API_KEY")
    deriv_api_token: str = Field(default="", validation_alias="DERIV_API_TOKEN")

    # ── AI / LLM ───────────────────────────────────────────────────
    openai_api_key: str = Field(default="", validation_alias="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-4o", validation_alias="OPENAI_MODEL")
    llm_provider: str = Field(default="openai", validation_alias="LLM_PROVIDER")
    ollama_base_url: str = Field(default="http://localhost:11434", validation_alias="OLLAMA_BASE_URL")
    ollama_model: str = Field(default="llama3.2", validation_alias="OLLAMA_MODEL")

    # ── News / Sentiment ────────────────────────────────────────────
    news_api_key: str = Field(default="", validation_alias="NEWS_API_KEY")

    @field_validator("database_url")
    @classmethod
    def database_url_must_be_postgresql(cls, v: str) -> str:
        if not v.startswith("postgresql"):
            raise ValueError("DATABASE_URL doit commencer par postgresql:// ou postgresql+asyncpg://")
        return v


def load_settings() -> Settings:
    """Charge la config et affiche des warnings clairs si des clés optionnelles manquent."""
    try:
        settings = Settings()
    except Exception as exc:
        print(f"[ERREUR] Configuration invalide : {exc}", file=sys.stderr)
        sys.exit(1)

    if not settings.news_api_key:
        print("[WARN] NEWS_API_KEY absent — le sentiment NewsAPI sera désactivé.", file=sys.stderr)
    if not settings.openai_api_key and settings.llm_provider == "openai":
        print("[WARN] OPENAI_API_KEY absent — fallback vers mock LLM.", file=sys.stderr)
    if not settings.twelve_data_api_key:
        print("[WARN] TWELVE_DATA_API_KEY absent — les données Forex seront mockées.", file=sys.stderr)

    return settings


settings = load_settings()
