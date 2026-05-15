"""Vertex AI Gemini extractor — Layer 3 of the ingestion pipeline.

Two modes, picked off `settings.vertex_gemini_model`:

  * **stub** (default until creds are provisioned) — returns a deterministic
    mock payload that matches the per-doc-type Pydantic schema. The UI is
    fully buildable in this mode. Confidence is reported as 0.5 so the
    "ai_assisted" flag still applies and the user must verify before submit.

  * **real** (`gemini-1.5-pro` / `gemini-2.0-flash` / etc.) — uses the Vertex
    AI SDK (`google-cloud-aiplatform`) to call Gemini with the PDF bytes as
    a Part, the canonical per-type prompt from FILING_FLOW.md §4.4, and a
    `response_schema` constraining the output to strict JSON.

Both modes return the same shape so callers can switch transparently.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import ValidationError

from app.config import get_settings
from app.schemas.extraction import (
    AisExtraction,
    BankPdfExtraction,
    CapitalGainsExtraction,
    ClassificationProbe,
    Form16Extraction,
    Form26ASExtraction,
    SalarySlipExtraction,
    schema_for,
)


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ExtractionResult:
    doc_type: str             # the (possibly refined) document_type
    payload: dict             # raw model output, validated against the schema
    confidence: float
    model_used: str
    extracted_at: str         # ISO UTC


class ExtractionError(RuntimeError):
    """Raised when extraction can't be salvaged. Caller is expected to mark the
    document `extraction_error` and `routing_status='unresolved'`."""


# ---------------------------------------------------------------------------
# System preamble + per-type prompts (verbatim from FILING_FLOW.md §4.4)
# ---------------------------------------------------------------------------

SYSTEM_PREAMBLE = (
    "You are an Indian Income Tax document parser. You extract structured data "
    "from official tax documents and bank statements. You NEVER infer, guess, "
    "fill in, or compute values that are not literally present in the document. "
    "If a field is not visible, return null for that field. All amounts are in "
    "Indian Rupees (INR). All dates use ISO format YYYY-MM-DD. All Financial "
    'Years use the canonical format "FYYYYY-YY" with NO space (e.g. '
    '"FY2024-25"). All Assessment Years use "AYYYYY-YY" (e.g. "AY2025-26"). '
    "Respond with ONLY a single JSON object matching the provided schema — no "
    "prose, no markdown fences, no commentary."
)


PER_TYPE_PROMPTS: dict[str, str] = {
    "form16": (
        "This is an Indian Form 16 (Certificate of TDS on salary issued by an "
        "employer under Section 203 of the Income Tax Act). Extract employer, "
        "employee, assessment_year, financial_year, period, salary_breakdown, "
        "chapter_via_deductions, tds_quarterly and total_tds_deducted. For "
        "amounts not present in the certificate, return null. Return ONLY the JSON."
    ),
    "form_26as": (
        "This is an Indian Form 26AS — Annual Tax Statement from TRACES. Extract "
        "assessment_year, permanent_account_number, name_of_assessee, "
        "part_a_tds_on_salary, part_a1_tds_other_than_salary, "
        "part_b_details_of_tax_deducted_at_source_for_15g_15h, "
        "part_c_details_of_tax_paid_other_than_tds_or_tcs, part_d_details_of_refund, "
        "part_e_high_value_transactions, and grand_total_tds. For any section not "
        "present, return null (NOT an empty array). Return ONLY the JSON."
    ),
    "ais_tis": (
        "This is an Indian Annual Information Statement (AIS) or Tax Information "
        "Summary (TIS). Extract pan, financial_year, and every row of "
        "reported_information. Return ONLY the JSON."
    ),
    "salary_slip": (
        "This is a monthly salary slip. Extract employee, employer, pay_period, "
        "earnings, deductions, gross_earnings_total, total_deductions, net_pay, "
        "bank_account_credited (last 4 digits if present). Return ONLY the JSON."
    ),
    "bank_pdf": (
        "This is an Indian bank statement (PDF). Extract account_holder_name, "
        "account_number_masked, bank_name, branch, statement_period, "
        "opening_balance, closing_balance, and every transaction row. For each "
        "transaction: txn_date (YYYY-MM-DD), value_date, description, "
        "cheque_or_ref_number, debit_amount (null if credit), credit_amount "
        "(null if debit), balance_after, and a best-effort counterparty_hint "
        "from the description (else null). Do NOT infer category, head of "
        "income, or tax treatment — categorization is a separate stage. Return "
        "ONLY the JSON."
    ),
    "capital_gains_statement": (
        "This is an Indian brokerage / portfolio capital-gains statement for a "
        "given financial year. The file is typically a CSV / TSV with multiple "
        "sections, each section having its own header row: EQUITY SHORT-TERM "
        "(Section 111A), EQUITY LONG-TERM (Section 112A), MUTUAL FUND "
        "REDEMPTIONS, EQUITY INTRADAY (speculative business), F&O (non-"
        "speculative business), DIVIDEND INCOME, SUMMARY. Extract:\n"
        "  - financial_year (e.g. FY2025-26), broker_name, client_code if present\n"
        "  - equity_stcg_111a:    array of equity trades closed within 12 months\n"
        "  - equity_ltcg_112a:    array of equity trades held > 12 months\n"
        "  - mutual_fund_redemptions: array, with tax_treatment from the row\n"
        "  - equity_intraday:     array of speculative-business intraday trades\n"
        "  - fno_trades:          array of F&O contracts closed in the FY\n"
        "  - dividends:           array with TDS u/s 194 and net_credit\n"
        "  - summary:             the totals/summary block if present\n"
        "All dates ISO YYYY-MM-DD. All amounts in INR. Realised P&L is signed "
        "(losses negative). Return ONLY the JSON."
    ),
    "broker_pnl": (
        "This is a brokerage P&L statement. Use the same extraction schema as "
        "capital_gains_statement. Return ONLY the JSON."
    ),
}


CLASSIFY_PROMPT = (
    "Classify this Indian financial document into exactly one of these types:\n"
    "  - form16: TDS certificate on salary issued by employer (Section 203)\n"
    "  - form_26as: TRACES Annual Tax Statement\n"
    "  - ais_tis: Annual Information Statement / Tax Information Summary\n"
    "  - salary_slip: monthly payslip from employer\n"
    "  - bank_pdf: bank account statement (account number, transactions, balance)\n"
    "  - capital_gains_statement: brokerage/portfolio statement with stock/MF "
    "trades, ISIN codes, buy/sell dates, realised P&L (Schedule CG data)\n"
    "  - broker_pnl: broker P&L summary (variant of capital_gains_statement)\n"
    "  - unknown_pdf: none of the above apply with reasonable confidence\n"
    "Return ONLY a JSON object with keys: doc_type, confidence (0..1), reasoning. "
    "Pick the single most specific match."
)


# ---------------------------------------------------------------------------
# Stub fixtures — one per doc_type, schema-valid, used in stub mode.
# ---------------------------------------------------------------------------

_STUB_FIXTURES: dict[str, dict] = {
    "form16": {
        "employer": {"name": "ACME Software Pvt Ltd (stub)", "tan": "BLRA12345E", "pan": None, "address": None},
        "employee": {"name": "Stub Employee", "pan": "ABCDE1234F", "designation": None},
        "assessment_year": "AY2025-26",
        "financial_year": "FY2024-25",
        "period": {"from_date": "2024-04-01", "to_date": "2025-03-31"},
        "salary_breakdown": {
            "gross_salary": "1200000.00",
            "section_17_1_salary": "1100000.00",
            "section_17_2_perquisites": "50000.00",
            "section_17_3_profits_in_lieu": None,
            "exempt_allowances": [
                {"name": "HRA", "amount": "180000.00"},
                {"name": "LTA", "amount": "30000.00"},
            ],
            "standard_deduction": "50000.00",
            "professional_tax": "2400.00",
            "net_salary": "1067600.00",
        },
        "chapter_via_deductions": [
            {"section": "80C", "amount": "150000.00"},
            {"section": "80D", "amount": "25000.00"},
        ],
        "tds_quarterly": [],
        "total_tds_deducted": "84000.00",
    },
    "form_26as": {
        "assessment_year": "AY2025-26",
        "permanent_account_number": "ABCDE1234F",
        "name_of_assessee": "Stub Assessee",
        "part_a_tds_on_salary": [],
        "part_a1_tds_other_than_salary": [],
        "part_b_details_of_tax_deducted_at_source_for_15g_15h": None,
        "part_c_details_of_tax_paid_other_than_tds_or_tcs": [],
        "part_d_details_of_refund": None,
        "part_e_high_value_transactions": None,
        "grand_total_tds": "84000.00",
    },
    "ais_tis": {
        "pan": "ABCDE1234F",
        "financial_year": "FY2024-25",
        "reported_information": [],
    },
    "salary_slip": {
        "employee": {"name": "Stub Employee", "employee_id": "EMP-001", "designation": None, "department": None, "pan": None},
        "employer": {"name": "ACME Software Pvt Ltd (stub)", "tan": None, "pan": None, "address": None},
        "pay_period": {"month": "April", "year": 2024, "from_date": "2024-04-01", "to_date": "2024-04-30"},
        "earnings": [
            {"name": "Basic", "amount": "55000.00"},
            {"name": "HRA", "amount": "15000.00"},
        ],
        "deductions": [
            {"name": "Provident Fund", "amount": "6600.00"},
            {"name": "Professional Tax", "amount": "200.00"},
        ],
        "gross_earnings_total": "70000.00",
        "total_deductions": "6800.00",
        "net_pay": "63200.00",
        "bank_account_credited": "6789",
    },
    "capital_gains_statement": {
        "financial_year": "FY2025-26",
        "broker_name": "Stub Broker",
        "client_code": None,
        "equity_stcg_111a": [
            {
                "symbol": "HCLTECH", "isin": "INE860A01027", "quantity": "25",
                "buy_date": "2025-06-01", "buy_price": "313.11", "buy_value": "7827.75",
                "sell_date": "2025-10-20", "sell_price": "325.06", "sell_value": "8126.50",
                "realised_pnl": "298.75", "holding_days": 141,
            },
        ],
        "equity_ltcg_112a": [
            {
                "symbol": "LT", "isin": "INE018A01030", "quantity": "100",
                "buy_date": "2023-10-22", "buy_price": "2090.99", "buy_value": "209099.00",
                "sell_date": "2025-10-12", "sell_price": "2551.14", "sell_value": "255114.00",
                "realised_pnl": "46015.00", "holding_days": 721,
            },
        ],
        "mutual_fund_redemptions": [],
        "equity_intraday": [],
        "fno_trades": [],
        "dividends": [
            {
                "symbol": "TCS", "date": "2025-07-15",
                "dividend_per_share": "65", "quantity_held": "100",
                "gross_dividend": "6500.00", "tds_194": "650",
                "net_credit": "5850.00",
            }
        ],
        "summary": [
            {
                "category": "Equity STCG (Section 111A)",
                "sale_value": "982019.25", "cost": "972697.95",
                "realised_pnl": "9321.30",
                "applicable_tax_rate": "20% (post 23-Jul-2024)",
            },
        ],
        "totals": None,
    },
    "broker_pnl": {
        "financial_year": "FY2025-26",
        "broker_name": "Stub Broker",
        "client_code": None,
        "equity_stcg_111a": [],
        "equity_ltcg_112a": [],
        "mutual_fund_redemptions": [],
        "equity_intraday": [],
        "fno_trades": [],
        "dividends": [],
        "summary": [],
        "totals": None,
    },
    "bank_pdf": {
        "account_holder_name": "Stub Account Holder",
        "account_number_masked": "XXXXXXXX6789",
        "bank_name": "HDFC Bank (stub)",
        "branch": "Andheri East, Mumbai",
        "statement_period": {"from_date": "2025-04-01", "to_date": "2026-03-31"},
        "opening_balance": "87450.00",
        "closing_balance": "396827.37",
        "transactions": [
            {
                "txn_date": "2025-04-05",
                "value_date": "2025-04-05",
                "description": "UPI-RAVI MEHTA-LANDLORD@OKHDFC-RENT",
                "cheque_or_ref_number": "UPI786579303",
                "debit_amount": "28000.00",
                "credit_amount": None,
                "balance_after": "59450.00",
                "counterparty_hint": "RAVI MEHTA",
            },
            {
                "txn_date": "2025-04-30",
                "value_date": "2025-04-30",
                "description": "NEFT-CR-ACMESOFT-SAL APR25",
                "cheque_or_ref_number": "ACMESALXXX",
                "debit_amount": None,
                "credit_amount": "114583.33",
                "balance_after": "118514.46",
                "counterparty_hint": "ACMESOFT",
            },
        ],
    },
}


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class GeminiExtractor:
    """Single entry point for Layer 3.

    Lifetime: cached as a module-level singleton via `get_extractor()`. The
    real-mode constructor calls `vertexai.init(...)` once; stub mode is a no-op.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self.model_name = settings.vertex_gemini_model
        self.is_stub = self.model_name == "stub"
        self._model = None
        if not self.is_stub:
            self._init_real(
                project_id=settings.gcp_project_id,
                region=settings.gcp_region,
                api_key_b64=settings.vertex_api_key,
            )

    def _init_real(
        self,
        *,
        project_id: str | None,
        region: str,
        api_key_b64: str | None,
    ) -> None:
        # Resolve credentials from one of the two supported modes.
        creds, derived_project = _resolve_credentials(api_key_b64)
        if project_id is None:
            project_id = derived_project
        if not project_id:
            logger.warning(
                "VERTEX_GEMINI_MODEL=%s but no project_id available (neither "
                "GCP_PROJECT_ID nor VERTEX_API_KEY's project_id). Falling back to stub.",
                self.model_name,
            )
            self.is_stub = True
            return
        try:
            import vertexai  # type: ignore[import-not-found]
            from vertexai.generative_models import GenerativeModel  # type: ignore[import-not-found]
        except ImportError:
            logger.warning(
                "google-cloud-aiplatform not installed — falling back to stub. "
                "Run: pip install google-cloud-aiplatform"
            )
            self.is_stub = True
            return
        try:
            if creds is not None:
                vertexai.init(project=project_id, location=region, credentials=creds)
            else:
                # SDK will pick up GOOGLE_APPLICATION_CREDENTIALS or ADC.
                vertexai.init(project=project_id, location=region)
            self._model = GenerativeModel(self.model_name)
            logger.info(
                "Vertex AI initialised: project=%s region=%s model=%s creds=%s",
                project_id, region, self.model_name,
                "explicit (VERTEX_API_KEY)" if creds else "ADC / GOOGLE_APPLICATION_CREDENTIALS",
            )
        except Exception:
            logger.exception("Vertex AI init failed — falling back to stub.")
            self.is_stub = True
            self._model = None

    # ----- public surface -----

    def classify(
        self,
        *,
        file_bytes: bytes | None = None,
        mime_type: str = "application/pdf",
        text_sample: str | None = None,
        fallback_hint: str | None = None,
        # Back-compat: existing callers pass pdf_bytes=.
        pdf_bytes: bytes | None = None,
    ) -> ClassificationProbe:
        """Ask Gemini what kind of document this is. Accepts either:
          - `file_bytes` + `mime_type` (any supported MIME), or
          - `text_sample` (when the file is plain text / CSV and we want to
             send only the first few KB),
          - or back-compat `pdf_bytes`.
        In stub mode returns `fallback_hint` (or 'unknown_pdf') at conf 0.5.
        """
        if pdf_bytes is not None and file_bytes is None:
            file_bytes = pdf_bytes
            mime_type = "application/pdf"

        if self.is_stub or self._model is None:
            return ClassificationProbe(
                doc_type=fallback_hint or "unknown_pdf",  # type: ignore[arg-type]
                confidence=0.5,
                reasoning="stub mode — no Vertex AI call",
            )
        from vertexai.generative_models import GenerationConfig, Part  # type: ignore[import-not-found]
        parts = [Part.from_text(SYSTEM_PREAMBLE), Part.from_text(CLASSIFY_PROMPT)]
        if text_sample is not None:
            parts.append(Part.from_text(f"```\n{text_sample[:20000]}\n```"))
        elif file_bytes is not None:
            parts.append(Part.from_data(mime_type=mime_type, data=file_bytes))
        try:
            resp = self._model.generate_content(
                parts,
                generation_config=GenerationConfig(
                    temperature=0.0,
                    top_p=1.0,
                    # Output budget intentionally uncapped — let the model use
                    # its full default ceiling. Thinking-model variants (2.5
                    # Flash, 2.5 Pro) charge reasoning tokens against this
                    # budget too, so any explicit cap risks MAX_TOKENS
                    # truncation. We surface a clear error if it still hits.
                    response_mime_type="application/json",
                ),
            )
            raw = _extract_text(resp)
            data = json.loads(raw)
            return ClassificationProbe.model_validate(data)
        except (ValidationError, json.JSONDecodeError, Exception) as e:
            logger.warning("Gemini classify failed: %s", e)
            return ClassificationProbe(
                doc_type=fallback_hint or "unknown_pdf",  # type: ignore[arg-type]
                confidence=0.0,
                reasoning=f"classify failed: {e}",
            )

    def extract(
        self,
        *,
        doc_type: str,
        file_bytes: bytes | None = None,
        mime_type: str = "application/pdf",
        text_sample: str | None = None,
        # Back-compat for callers from the PDF path.
        pdf_bytes: bytes | None = None,
    ) -> ExtractionResult:
        """Extract structured fields for the given doc_type. Accepts PDF or
        any text/* / text/csv via either `file_bytes` or `text_sample`.
        Raises ExtractionError if validation fails irrecoverably."""
        if pdf_bytes is not None and file_bytes is None:
            file_bytes = pdf_bytes
            mime_type = "application/pdf"

        schema_cls = schema_for(doc_type)
        if schema_cls is None:
            raise ExtractionError(f"No extraction schema for doc_type={doc_type!r}")

        if self.is_stub or self._model is None:
            fixture = _STUB_FIXTURES.get(doc_type)
            if fixture is None:
                raise ExtractionError(f"No stub fixture for doc_type={doc_type!r}")
            try:
                schema_cls.model_validate(fixture)
            except ValidationError as e:
                raise ExtractionError(f"Stub fixture failed schema validation: {e}") from e
            return ExtractionResult(
                doc_type=doc_type,
                payload=fixture,
                confidence=0.5,
                model_used="stub",
                extracted_at=_now_iso(),
            )

        prompt = PER_TYPE_PROMPTS.get(doc_type)
        if prompt is None:
            raise ExtractionError(f"No extraction prompt for doc_type={doc_type!r}")

        # Inline the JSON Schema so the model is constrained to our Pydantic
        # shape. Vertex's `response_schema` doesn't accept $defs / $ref, so
        # passing it via the prompt is the most reliable path with the
        # deprecated SDK. Validated afterwards by Pydantic in any case.
        schema_text = json.dumps(
            schema_cls.model_json_schema(),
            indent=2,
            ensure_ascii=False,
        )
        schema_instruction = (
            "Return JSON matching EXACTLY this JSON Schema. Use only the keys "
            "defined here — do not invent new keys, do not omit listed keys "
            "(use null when a value isn't visible).\n\n"
            f"```json\n{schema_text}\n```"
        )

        from vertexai.generative_models import GenerationConfig, Part  # type: ignore[import-not-found]
        parts = [
            Part.from_text(SYSTEM_PREAMBLE),
            Part.from_text(prompt),
            Part.from_text(schema_instruction),
        ]
        if text_sample is not None:
            parts.append(Part.from_text(f"```\n{text_sample[:60000]}\n```"))
        elif file_bytes is not None:
            parts.append(Part.from_data(mime_type=mime_type, data=file_bytes))
        else:
            raise ExtractionError("extract() requires file_bytes or text_sample.")

        try:
            resp = self._model.generate_content(
                parts,
                generation_config=GenerationConfig(
                    temperature=0.0,
                    top_p=1.0,
                    # Output budget intentionally uncapped — bank statements
                    # with 100+ transactions plus the model's reasoning trace
                    # can run very long. The truncation handler below converts
                    # any MAX_TOKENS finish into a clear, actionable error
                    # instead of a cryptic JSON parse failure.
                    response_mime_type="application/json",
                ),
            )
            raw = _extract_text(resp)
        except ExtractionError:
            raise
        except Exception as e:
            raise ExtractionError(f"Vertex AI call failed: {e}") from e

        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            # Truncated mid-JSON is the canonical MAX_TOKENS-with-partial-output
            # failure mode for big documents. Surface the specific cause + a
            # remediation hint, not the cryptic JSON parse message.
            cand = (getattr(resp, "candidates", None) or [None])[0]
            finish_reason = getattr(cand, "finish_reason", None) if cand else None
            finish_name = getattr(finish_reason, "name", str(finish_reason))
            usage = getattr(resp, "usage_metadata", None)
            output_tokens = getattr(usage, "candidates_token_count", None) if usage else None
            thoughts = getattr(usage, "thoughts_token_count", None) if usage else None
            if finish_name in ("MAX_TOKENS", "8"):
                raise ExtractionError(
                    f"Gemini truncated output mid-JSON (finish_reason=MAX_TOKENS, "
                    f"output_tokens={output_tokens}, thoughts_token_count={thoughts}). "
                    "The document is too large for a single extraction pass. "
                    "Either (a) split the file into smaller PDFs (one statement "
                    "period at a time), or (b) raise max_output_tokens further, "
                    "or (c) switch to a non-thinking model so the entire budget "
                    "goes to output."
                ) from e
            raise ExtractionError(
                f"Model returned non-JSON (finish_reason={finish_name}): {e}; "
                f"raw[:200]={raw[:200]!r}"
            ) from e

        try:
            validated = schema_cls.model_validate(data).model_dump(mode="json")
        except ValidationError as e:
            raise ExtractionError(f"Model output failed schema validation: {e}") from e

        return ExtractionResult(
            doc_type=doc_type,
            payload=validated,
            confidence=0.85,   # Gemini doesn't give per-field; ai_assisted floor.
            model_used=self.model_name,
            extracted_at=_now_iso(),
        )


def _resolve_credentials(api_key_b64: str | None) -> tuple[Any, str | None]:
    """Return (credentials_object | None, project_id | None).

    Three credential paths, tried in order:
      1. VERTEX_API_KEY env var → decode base64 → SA JSON
      2. A service-account JSON file on disk. Looks for, in order:
           - $GOOGLE_APPLICATION_CREDENTIALS
           - Backend/data/secrets/vertex-sa.json (the path documented in
             FILING_FLOW.md §4.1)
      3. Nothing → return (None, None); vertexai.init() falls back to ADC.

    In modes 1 and 2, project_id is extracted from the JSON so the caller
    doesn't have to set GCP_PROJECT_ID separately.
    """
    info = _info_from_b64(api_key_b64) or _info_from_disk()
    if info is None:
        return None, None
    try:
        from google.oauth2 import service_account  # type: ignore[import-not-found]
    except ImportError:
        logger.error(
            "google-auth not installed — cannot build credentials. "
            "Run: pip install google-cloud-aiplatform"
        )
        return None, info.get("project_id")
    try:
        creds = service_account.Credentials.from_service_account_info(
            info,
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
    except Exception as e:
        logger.error("Failed to build service-account credentials: %s", e)
        return None, info.get("project_id")
    return creds, info.get("project_id")


def _info_from_b64(api_key_b64: str | None) -> dict | None:
    if not api_key_b64:
        return None
    import base64
    import re

    cleaned = re.sub(r"\s+", "", api_key_b64)
    cleaned += "=" * (-len(cleaned) % 4)
    try:
        decoded = base64.b64decode(cleaned, validate=False).decode("utf-8")
    except Exception as e:
        logger.error(
            "VERTEX_API_KEY is not valid base64: %s "
            "(len=%d, head=%r). Falling back to file-based credentials. "
            "Re-generate with: "
            "`[Convert]::ToBase64String([IO.File]::ReadAllBytes('vertex-sa.json'))` (PowerShell).",
            e, len(api_key_b64), api_key_b64[:24],
        )
        return None
    try:
        info = json.loads(decoded)
    except json.JSONDecodeError as e:
        logger.error("VERTEX_API_KEY decoded but is not valid JSON: %s", e)
        return None
    if not isinstance(info, dict) or "private_key" not in info:
        logger.error("VERTEX_API_KEY JSON missing required service-account fields.")
        return None
    return info


def _info_from_disk() -> dict | None:
    import os
    from pathlib import Path

    from app.config import BACKEND_ROOT

    candidates: list[Path] = []
    env_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if env_path:
        candidates.append(Path(env_path))
    candidates.append(BACKEND_ROOT / "data" / "secrets" / "vertex-sa.json")

    for path in candidates:
        if path and path.is_file():
            try:
                with path.open("r", encoding="utf-8") as fh:
                    info = json.load(fh)
                if isinstance(info, dict) and "private_key" in info:
                    logger.info("Loaded Vertex service-account JSON from %s", path)
                    return info
                logger.error("File at %s exists but is not a valid SA JSON.", path)
            except Exception as e:
                logger.error("Failed to read service-account JSON at %s: %s", path, e)
    return None


def _extract_text(resp: Any) -> str:
    """Pull the concatenated text out of a Vertex AI GenerateContentResponse,
    tolerating both the .text helper and the candidates[0].content.parts walk
    in case the helper raises on safety blocks. Surfaces specific reasons
    (MAX_TOKENS, safety blocks) so callers can act on them."""
    try:
        text = getattr(resp, "text", None)
    except Exception:
        text = None
    if isinstance(text, str) and text.strip():
        return text
    candidates = getattr(resp, "candidates", None) or []
    if candidates:
        cand = candidates[0]
        parts = getattr(getattr(cand, "content", None), "parts", []) or []
        joined = "".join(getattr(p, "text", "") for p in parts).strip()
        if joined:
            return joined
        finish_reason = getattr(cand, "finish_reason", None)
        finish_name = getattr(finish_reason, "name", str(finish_reason))
        if finish_name in ("MAX_TOKENS", "8"):
            usage = getattr(resp, "usage_metadata", None)
            thoughts = getattr(usage, "thoughts_token_count", None) if usage else None
            raise ExtractionError(
                "Gemini hit MAX_TOKENS without producing output text "
                f"(thoughts_token_count={thoughts}). Increase max_output_tokens "
                "or switch to a non-thinking model."
            )
        if finish_name and finish_name != "STOP":
            raise ExtractionError(
                f"Gemini stopped early with finish_reason={finish_name} and no text."
            )
    raise ExtractionError("Empty response from Gemini.")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# Singleton accessor
# ---------------------------------------------------------------------------

_singleton: Optional[GeminiExtractor] = None


def get_extractor() -> GeminiExtractor:
    global _singleton
    if _singleton is None:
        _singleton = GeminiExtractor()
    return _singleton


# Re-exports for the documents router
__all__ = [
    "ExtractionResult",
    "ExtractionError",
    "GeminiExtractor",
    "get_extractor",
    "AisExtraction",
    "BankPdfExtraction",
    "CapitalGainsExtraction",
    "Form16Extraction",
    "Form26ASExtraction",
    "SalarySlipExtraction",
]
