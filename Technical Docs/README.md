# GlimmoraTax

> A deterministic, trust-first tax filing assistant for India.
> **AI assists. Rules decide. RAG explains.**

GlimmoraTax helps Indian taxpayers file their returns by reading their documents (Form 16, bank statements, 26AS, AIS/TIS, salary slips), categorizing transactions, comparing Old vs New regime, and producing a fully auditable tax summary — where every number traces back to a specific government rule.

---

## Why GlimmoraTax?

Most tax tools either drown you in questions or hand you an AI-generated number you can't verify. GlimmoraTax does neither:

- **Every rupee is traceable.** Each calculation links to a versioned rule with a Finance Act / Section reference.
- **AI is bounded.** AI only helps read documents and suggest categories for ambiguous items. It never computes your tax.
- **You control your data.** Three explicit consents gate every step. Revoke anytime.
- **Built for trust, not features.** Narrow MVP scope, deep on accuracy and auditability.

---

## Core Principle: Three Layers

| Layer | Role | Authority |
|---|---|---|
| **Rules Engine** | Computes tax from DB-stored rules | **Decides** |
| **AI (OpenAI)** | Reads PDFs, suggests categories | **Suggests only** |
| **RAG Assistant** | Answers tax questions in plain English | **Explains only** |

If AI breaks, the engine still produces a correct tax number (with manual categorization). If RAG breaks, the filing flow is unaffected.

---

## User Roles

| Role | What They Do |
|---|---|
| **Taxpayer** | Files their own return |
| **Consultant (CA)** | Reviews client filings — only after the client grants explicit access |
| **Officer L1–L5** | Government reviewers; can flag filings for fraud |
| **Judicial Officer** | Reviews fraud cases escalated by officers; can assign to enforcement |
| **Enforcement Agency** | Investigates cases assigned by judiciary |
| **Admin** | Manages tax rules (dual approval), users, system config |

---

## Key Workflows

### 1. Taxpayer Filing
```
Register → Consent → Upload docs → Review extracted txns → Compare regimes → Tax summary → PDF
```

### 2. Regime Switch Warning
If a taxpayer's previous filing used a different regime, the system warns before allowing the switch — India's tax law restricts regime switching for certain taxpayer types (notably those with business/professional income, who can switch back only once). See [ARCHITECTURE.md §6](ARCHITECTURE.md#6-regime-switch-warning) and [API_CONTRACTS.md §5.2](API_CONTRACTS.md#52-filing-calculation).

### 3. Consultant Access
A CA cannot see any user's data unless explicitly granted access by that taxpayer. When granted, the CA receives a notification containing the taxpayer's PAN, and the taxpayer appears in the CA's client list. The CA can also search for any client they have access to by PAN. See [ARCHITECTURE.md §7](ARCHITECTURE.md#7-consultant-access-workflow).

### 4. Fraud → Judicial → Enforcement Chain
```
Officer reviews filing
   │
   ├─ Flags as suspicious → fraud case created (status: flagged)
   │
   ▼
Officer requests judicial review
   │
   ▼ status: judicial_review
Judicial Officer reviews full case + all taxpayer data
   │
   ├─ Dismiss → status: closed
   │
   ▼ assign to enforcement
status: enforcement_assigned
   │
   ▼
Enforcement Agency gets time-bound, audited read access to investigate
```
Every transition is audited. Enforcement access is always time-bound and case-referenced. See [ARCHITECTURE.md §8](ARCHITECTURE.md#8-fraud--judicial--enforcement-workflow).

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14, TailwindCSS, TypeScript |
| Backend | FastAPI, Python 3.11, SQLAlchemy |
| Database | PostgreSQL 16 + pgvector |
| OCR | PaddleOCR, pdfplumber |
| AI | OpenAI (gpt-4o-mini, text-embedding-3-small) |
| RAG | Custom Python (no LangChain) |
| Storage | Local filesystem (S3-ready abstraction) |
| Auth | JWT (RS256) + bcrypt |

---

## Project Documents

| Doc | Purpose |
|---|---|
| [README.md](README.md) | Overview, roles, workflows (this file) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, components, data flows, trust model |
| [API_CONTRACTS.md](API_CONTRACTS.md) | Full API request/response schemas |
| [DEMO_PLAN.md](DEMO_PLAN.md) | 12-minute demo script + fallback plans |

The original product plan (MVP scope, phased tasks, success metrics, compliance) lives in the implementation plan v3.

---

## Quick Start

```bash
# Prereqs: Python 3.11, Node 18+, Postgres 16 with pgvector

# Backend
cd backend
poetry install
cp .env.example .env       # fill in OPENAI_API_KEY, DATABASE_URL
alembic upgrade head
python -m app.seed.india_rules        # seed FY2024-25 rules
python -m app.rag.ingest --dir docs/  # ingest tax knowledge
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
pnpm install
pnpm dev                   # http://localhost:3000
```

---

## What's NOT in MVP

- E-filing directly with the IT Department portal
- Scanned / photographed documents (PDF & CSV only)
- GST filings, multi-country support
- Mobile apps
- Autonomous AI agents / LangChain
- Background workers (Celery) — using FastAPI BackgroundTasks for MVP

Tracked for v1.1+ in the implementation plan.

---

## License & Status

Internal project. MVP target: 9 weeks (see implementation plan §12).

> **Design Principle:** *Trust > Features.* Ship narrow, accurate, and auditable.
