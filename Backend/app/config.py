from enum import StrEnum
from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = BACKEND_ROOT / "data" / "app.db"


class DatabaseBackend(StrEnum):
    sqlite = "sqlite"
    supabase = "supabase"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "GlimmoraTax"
    env: str = Field(default="dev")
    debug: bool = Field(default=True)

    # ------------------------------------------------------------------
    # Database backend selection.
    # "sqlite"  (default) -> local file at db_path; runs migrations from sql/sqlite/.
    # "supabase"          -> Postgres at supabase_db_url; runs migrations from sql/postgres/.
    # The selection is explicit via env so dev/CI/prod stay predictable; we do not
    # auto-fall-back from one to the other.
    # ------------------------------------------------------------------
    database_backend: DatabaseBackend = Field(default=DatabaseBackend.sqlite)

    # SQLite settings (used only when database_backend == 'sqlite')
    db_path: Path = Field(default=DEFAULT_DB_PATH)

    # Supabase / Postgres settings (used only when database_backend == 'supabase').
    # Get the full SQLAlchemy-style URL from Supabase Dashboard -> Project Settings ->
    # Database -> Connection string -> URI, then prefix it with `postgresql+psycopg://`.
    # Example: postgresql+psycopg://postgres:<password>@db.xxxx.supabase.co:5432/postgres
    supabase_db_url: str | None = Field(default=None)

    db_echo: bool = Field(default=False)

    host: str = Field(default="127.0.0.1")
    port: int = Field(default=8000)
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    # Shared HS256 secret used by the Next.js proxy to sign short-lived JWTs.
    # Must match the value Next.js loads from process.env.AUTH_SHARED_SECRET.
    auth_shared_secret: str | None = Field(default=None)

    # ------------------------------------------------------------------
    # Vertex AI Gemini — Layer 3 of the extraction pipeline.
    #
    # Credentials can be supplied in EITHER of two ways:
    #   1. GOOGLE_APPLICATION_CREDENTIALS=path/to/vertex-sa.json
    #      (the standard SDK convention; recommended for filesystem deploys)
    #   2. VERTEX_API_KEY=<base64-encoded service-account JSON>
    #      (useful when the host has no writable filesystem — Vercel etc.)
    #
    # When option 2 is set, the bootstrap decodes the JSON, extracts the
    # `project_id` from it (so GCP_PROJECT_ID becomes optional), builds a
    # Credentials object, and hands it to vertexai.init() directly.
    #
    # `VERTEX_GEMINI_MODEL=stub` (default) short-circuits with mock payloads.
    # ------------------------------------------------------------------
    vertex_gemini_model: str = Field(default="stub")
    vertex_api_key: str | None = Field(default=None)
    gcp_project_id: str | None = Field(default=None)
    gcp_region: str = Field(default="asia-south1")
    # Confidence below which Layer 2 escalates to Layer 3 (the LLM).
    extraction_llm_threshold: float = Field(default=0.9)

    @model_validator(mode="after")
    def _check_backend_config(self) -> "Settings":
        if self.database_backend is DatabaseBackend.supabase and not self.supabase_db_url:
            raise ValueError(
                "DATABASE_BACKEND=supabase requires SUPABASE_DB_URL to be set "
                "(format: postgresql+psycopg://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres)"
            )
        return self

    @property
    def database_url(self) -> str:
        if self.database_backend is DatabaseBackend.sqlite:
            return f"sqlite:///{self.db_path.as_posix()}"
        # Supabase: trust the user-supplied URL. We expect the `postgresql+psycopg` driver
        # so SQLAlchemy 2.x uses psycopg v3.
        assert self.supabase_db_url is not None  # guarded by validator
        return self.supabase_db_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
