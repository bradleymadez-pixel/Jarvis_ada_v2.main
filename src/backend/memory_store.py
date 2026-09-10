"""
memory_store.py

Persistent, cross-device memory for JARVIS using Supabase (hosted Postgres,
free tier, no credit card needed: https://supabase.com).

Why Supabase and not just files: on a free hosting tier (like Render's),
the local filesystem gets wiped on every restart/redeploy. A separate
database keeps memory alive independent of the compute host - and since
every device just talks to the same backend/database, memory is naturally
shared across every device you use to talk to Jarvis, like Iron Man's
Jarvis being "in" every suit.

One-time setup (done by the human, not by code):
1. Create a free project at https://supabase.com
2. In the SQL editor, run:

    create table jarvis_memory (
        id bigint generated always as identity primary key,
        sender text not null,
        text text not null,
        created_at timestamptz not null default now()
    );

   (Row Level Security can stay off for this table - it's a personal,
   single-user assistant, and the key below is kept private in your
   server's environment variables, never exposed to visitors.)

3. In Project Settings > API, copy the "Project URL" and the "anon public"
   key (or "service_role" key for full access).
4. Add to your .env:
     SUPABASE_URL=https://your-project.supabase.co
     SUPABASE_KEY=your_anon_or_service_key

If these aren't set, every function here quietly no-ops (returns empty /
does nothing) so the app still runs fine locally without a database - you
just won't get cross-device memory until it's configured.
"""

import os
from datetime import datetime, timezone

import requests

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
TABLE = "jarvis_memory"

REQUEST_TIMEOUT = 5  # seconds - don't let a slow/unreachable DB stall conversation


def is_configured():
    return bool(SUPABASE_URL and SUPABASE_KEY)


def _headers(prefer=None):
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def save_entry(sender: str, text: str):
    """Append one message (a completed utterance, not a partial delta) to
    persistent memory. Silently no-ops if not configured or text is empty."""
    if not is_configured() or not text or not text.strip():
        return
    url = f"{SUPABASE_URL}/rest/v1/{TABLE}"
    payload = {
        "sender": sender,
        "text": text.strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        resp = requests.post(url, json=payload, headers=_headers(), timeout=REQUEST_TIMEOUT)
        if resp.status_code not in (200, 201):
            print(f"[memory_store] Unexpected save response {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        print(f"[memory_store] Failed to save entry: {e}")


def get_recent(limit: int = 200):
    """Fetch the most recent `limit` messages, returned oldest-first."""
    if not is_configured():
        return []
    url = (
        f"{SUPABASE_URL}/rest/v1/{TABLE}"
        f"?select=sender,text,created_at&order=created_at.desc&limit={limit}"
    )
    try:
        resp = requests.get(url, headers=_headers(), timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        rows = resp.json()
        return list(reversed(rows))
    except Exception as e:
        print(f"[memory_store] Failed to fetch memory: {e}")
        return []


def get_recent_as_text(limit: int = 200) -> str:
    """Same as get_recent(), flattened into one text block ready to inject
    into the AI's context (matches the format the old manual memory-upload
    feature used)."""
    rows = get_recent(limit)
    if not rows:
        return ""
    return "\n".join(f"{r['sender']}: {r['text']}" for r in rows)
