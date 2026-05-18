"""Glimmora Tax in-product assistant.

A small, deterministic help engine that answers user-facing questions about
the product (pages, fields, statuses, flows) and refuses anything outside
that scope (technical internals, legal advice, sensitive identifiers, etc).

The module is organised as:

    chatbot/
      knowledge.py   — page registry + Q/A entries + suggestion chips
      safety.py      — pre-flight refusal patterns (technical / sensitive)
      matcher.py     — page-aware scoring of a question against the KB
      router.py      — FastAPI router exposing /api/v1/chatbot/answer

The matcher is rule-based on purpose. It is fast (<10 ms), deterministic,
and cannot hallucinate — important for a tax product where wrong answers
have a cost. The knowledge base is the single source of truth and lives in
`knowledge.py`.
"""

from app.chatbot.router import router

__all__ = ["router"]
