from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models._types import new_uuid, utcnow_iso


class CountryRule(Base):
    __tablename__ = "country_rules"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_uuid)
    country: Mapped[str] = mapped_column(Text, nullable=False)
    tax_year: Mapped[str] = mapped_column(Text, nullable=False)
    rule_type: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    rule_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    source_reference: Mapped[str] = mapped_column(Text, nullable=False)
    effective_from: Mapped[str] = mapped_column(Text, nullable=False)
    effective_to: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending_approval")

    created_by_user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    approved_by_user_id: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id"))
    approved_at: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_uuid)
    source_doc: Mapped[str] = mapped_column(Text, nullable=False)
    section_ref: Mapped[str | None] = mapped_column(Text)
    country: Mapped[str] = mapped_column(Text, nullable=False, default="IN")
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    # In Postgres this is `vector(1536)`. In SQLite we store the JSON array of floats and
    # do similarity search in application code (or punt to an external vector index).
    embedding: Mapped[list[float]] = mapped_column(JSON, nullable=False)
    token_count: Mapped[int | None] = mapped_column(Integer)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, nullable=False, default=dict)
    ingested_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)
    ingest_run_id: Mapped[str | None] = mapped_column(Text)


class RAGQueryLog(Base):
    __tablename__ = "rag_query_log"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    question_redacted: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str | None] = mapped_column(Text)
    sources: Mapped[dict | None] = mapped_column(JSON)
    model_used: Mapped[str | None] = mapped_column(Text)
    tokens_used: Mapped[int | None] = mapped_column(Integer)
    intercepted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    intercept_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)
