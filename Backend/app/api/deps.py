"""FastAPI dependencies — request-scoped auth + shared utilities.

The Next.js layer is the auth authority. It resolves the browser cookie and
mints a short-lived HS256 JWT signed with `AUTH_SHARED_SECRET`, then forwards
it as `Authorization: Bearer <token>` to FastAPI. This module decodes that
JWT and exposes a `CurrentUser` to downstream endpoints. See FILING_FLOW.md
§3.1.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Header, HTTPException, status

from app.config import get_settings
from app.services.auth_jwt import JwtError, verify_hs256


@dataclass(frozen=True)
class CurrentUser:
    id: str
    role: str | None = None
    email: str | None = None
    phone: str | None = None
    name: str | None = None


def _unauthorized(message: str) -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        detail={"code": "unauthorized", "message": message},
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization:
        raise _unauthorized("Missing Authorization header.")
    if not authorization.lower().startswith("bearer "):
        raise _unauthorized("Authorization header must use the Bearer scheme.")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise _unauthorized("Empty bearer token.")

    settings = get_settings()
    secret = settings.auth_shared_secret
    if not secret:
        # Misconfiguration on the backend, not the client — but surface as 401
        # because the proxy could not have signed a verifiable token anyway.
        raise _unauthorized("Backend auth not configured.")

    try:
        payload = verify_hs256(token, secret)
    except JwtError as e:
        raise _unauthorized(f"Invalid token: {e}") from e

    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub:
        raise _unauthorized("Token has no subject.")
    role = payload.get("role")
    email = payload.get("email")
    phone = payload.get("phone")
    name = payload.get("name")
    return CurrentUser(
        id=sub,
        role=role if isinstance(role, str) else None,
        email=email if isinstance(email, str) else None,
        phone=phone if isinstance(phone, str) else None,
        name=name if isinstance(name, str) else None,
    )
