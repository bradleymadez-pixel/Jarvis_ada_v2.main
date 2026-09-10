"""
auth.py

Simple password-based login for JARVIS, used only when running in HOSTED_MODE
(a publicly reachable cloud server). In local/Electron mode there's no need
for this - the app only talks to localhost.

How it works:
1. Set AUTH_PASSWORD in your .env (a password you choose - not your Gemini
   or Spotify credentials, just a password for logging into your own Jarvis).
2. The frontend shows a login screen. It POSTs the password to /api/login.
3. On a correct password, the server hands back a random session token.
4. The frontend reconnects its socket with that token attached.
5. The server only allows socket connections that present a valid token,
   when HOSTED_MODE is on.

This is intentionally simple (one shared password, in-memory tokens) since
this is a personal single-user assistant, not a multi-tenant product. Tokens
reset if the server restarts - you'd just log in again.
"""

import os
import hmac
import secrets
import time

# How long a login session stays valid, in seconds. Default: 30 days.
TOKEN_TTL_SECONDS = int(os.getenv("AUTH_TOKEN_TTL_SECONDS", str(30 * 24 * 60 * 60)))

# token -> expiry timestamp
_valid_tokens = {}


def is_auth_configured():
    return bool(os.getenv("AUTH_PASSWORD"))


def check_password(password: str) -> bool:
    expected = os.getenv("AUTH_PASSWORD", "")
    if not expected:
        # No password configured - refuse everything rather than silently
        # allowing access. (Configure AUTH_PASSWORD before going live.)
        return False
    if not password:
        return False
    return hmac.compare_digest(password, expected)


def issue_token() -> str:
    token = secrets.token_urlsafe(32)
    _valid_tokens[token] = time.time() + TOKEN_TTL_SECONDS
    return token


def verify_token(token: str) -> bool:
    if not token:
        return False
    expiry = _valid_tokens.get(token)
    if expiry is None:
        return False
    if time.time() > expiry:
        del _valid_tokens[token]
        return False
    return True


def revoke_token(token: str):
    _valid_tokens.pop(token, None)
