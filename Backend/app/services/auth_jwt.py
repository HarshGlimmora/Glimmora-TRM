"""HS256 JWT sign/verify using only the standard library.

Used to verify short-lived tokens minted by the Next.js proxy. The shared secret
(`AUTH_SHARED_SECRET`) must match exactly on both sides. See FILING_FLOW.md §3.1.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time


class JwtError(ValueError):
    """Raised for any verification failure — malformed, bad signature, expired."""


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def sign_hs256(payload: dict, secret: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    h = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    p = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{h}.{p}".encode("ascii")
    sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{h}.{p}.{_b64url_encode(sig)}"


def verify_hs256(token: str, secret: str, *, leeway_sec: int = 0) -> dict:
    parts = token.split(".")
    if len(parts) != 3:
        raise JwtError("malformed_token")
    h_b64, p_b64, s_b64 = parts

    try:
        header = json.loads(_b64url_decode(h_b64).decode("utf-8"))
    except Exception as e:
        raise JwtError("malformed_header") from e
    if header.get("alg") != "HS256" or header.get("typ") not in ("JWT", None):
        raise JwtError("unsupported_alg")

    signing_input = f"{h_b64}.{p_b64}".encode("ascii")
    expected = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    try:
        received = _b64url_decode(s_b64)
    except Exception as e:
        raise JwtError("malformed_signature") from e
    if not hmac.compare_digest(expected, received):
        raise JwtError("bad_signature")

    try:
        payload = json.loads(_b64url_decode(p_b64).decode("utf-8"))
    except Exception as e:
        raise JwtError("malformed_payload") from e

    exp = payload.get("exp")
    if exp is not None and time.time() > float(exp) + leeway_sec:
        raise JwtError("expired")
    nbf = payload.get("nbf")
    if nbf is not None and time.time() + leeway_sec < float(nbf):
        raise JwtError("not_yet_valid")
    return payload
