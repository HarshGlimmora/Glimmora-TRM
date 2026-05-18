"""FastAPI router for the in-product assistant.

  POST /api/v1/chatbot/answer

Request body:
    {
      "question": "what is recent activity",
      "page_id":  "dashboard",
      "role":     "taxpayer" | "consultant" | null
    }

Response body (always 200 — refusals and misses are still well-formed):
    {
      "answer":      "...",
      "citation":    "Dashboard › Recent activity",
      "kind":        "answer" | "refusal" | "miss",
      "page":        { "id": "dashboard", "label": "Overview", "section": "Dashboard" },
      "suggestions": ["...", "...", "..."]
    }

The endpoint is authenticated through the same JWT path every other v1
endpoint uses, but it does no data lookups — the response depends only on
the question, the page, and the user's role.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, get_current_user
from app.chatbot.knowledge import page as page_lookup, suggestions_for
from app.chatbot.matcher import best_match
from app.chatbot.safety import screen


router = APIRouter(prefix="/api/v1/chatbot", tags=["chatbot"])


class AnswerRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=500)
    page_id: str = Field(default="unknown", max_length=64)
    role: Literal["taxpayer", "consultant"] | None = None


class PageInfo(BaseModel):
    id: str
    label: str
    section: str


class AnswerResponse(BaseModel):
    answer: str
    citation: str
    kind: Literal["answer", "refusal", "miss"]
    page: PageInfo
    suggestions: list[str]


_MISS_MESSAGE = (
    "I'm not sure I caught that — try rephrasing in plain language, or pick "
    "one of the suggestions below. I can explain what a page is for, what a "
    "field means, or what to do next."
)


@router.post("/answer", response_model=AnswerResponse)
def answer(
    body: AnswerRequest,
    user: CurrentUser = Depends(get_current_user),
) -> AnswerResponse:
    # Authentication is required — `user` ensures the JWT is valid. We don't
    # log the question against the user, but the auth boundary stops the
    # endpoint being used as an open relay.
    _ = user

    page = page_lookup(body.page_id)
    page_info = PageInfo(id=page.id, label=page.label, section=page.section)
    page_suggestions = suggestions_for(page.id)

    verdict = screen(body.question)
    if verdict.blocked:
        return AnswerResponse(
            answer=verdict.message or _MISS_MESSAGE,
            citation=verdict.citation or "Glimmora Tax · Help",
            kind="refusal",
            page=page_info,
            suggestions=page_suggestions,
        )

    hit = best_match(body.question, page.id, body.role)
    if hit is None:
        return AnswerResponse(
            answer=_MISS_MESSAGE,
            citation=f"{page.section} · Help",
            kind="miss",
            page=page_info,
            suggestions=page_suggestions,
        )

    return AnswerResponse(
        answer=hit.entry.answer,
        citation=hit.entry.citation,
        kind="answer",
        page=page_info,
        suggestions=page_suggestions,
    )


class SuggestionsResponse(BaseModel):
    page: PageInfo
    suggestions: list[str]


@router.get("/suggestions", response_model=SuggestionsResponse)
def suggestions(
    page_id: str = "unknown",
    user: CurrentUser = Depends(get_current_user),
) -> SuggestionsResponse:
    _ = user
    page = page_lookup(page_id)
    return SuggestionsResponse(
        page=PageInfo(id=page.id, label=page.label, section=page.section),
        suggestions=suggestions_for(page.id),
    )
