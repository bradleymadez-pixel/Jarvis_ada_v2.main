"""
spotify_agent.py

Basic Spotify control for A.D.A, independent of the Gemini AI brain.

Two modes are supported:

1. LAUNCH MODE (works on Free or Premium, no user login needed):
   Searches Spotify's public catalog (via the "Client Credentials" flow, which
   only needs a Client ID/Secret, no user OAuth) and then opens the track's
   Spotify link. Opening a Spotify link launches the installed Spotify app
   (desktop/mobile) and starts playing it immediately, or opens the web
   player if the app isn't installed - exactly like clicking a link a human
   would share with you. This is how "play X on Spotify" works for everyone,
   Free accounts included.

2. REMOTE CONTROL MODE (Premium only, requires one-time OAuth login):
   Uses Spotify's Web Playback API to pause/skip/set volume/resume on an
   already-active device. Spotify blocks these specific calls for Free
   accounts with a 403 error - that's a Spotify restriction ADA can't get
   around. Kept here in case you upgrade later.

Setup required either way (one-time, done by the human running ADA):
1. Go to https://developer.spotify.com/dashboard and log in with your Spotify account.
2. Click "Create app". Fill in any name/description.
3. Set "Redirect URI" to: http://127.0.0.1:8888/callback (only used by remote control mode)
4. Save. Copy the "Client ID" and "Client Secret" it gives you.
5. Add these to your .env file:
     SPOTIFY_CLIENT_ID=your_client_id_here
     SPOTIFY_CLIENT_SECRET=your_client_secret_here
     SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback
"""

import os
import webbrowser
from dotenv import load_dotenv

load_dotenv()

SCOPES = "user-modify-playback-state user-read-playback-state user-read-currently-playing"


class SpotifyAgent:
    def __init__(self):
        self.client_id = os.getenv("SPOTIFY_CLIENT_ID")
        self.client_secret = os.getenv("SPOTIFY_CLIENT_SECRET")
        self.redirect_uri = os.getenv("SPOTIFY_REDIRECT_URI", "http://127.0.0.1:8888/callback")
        self.sp = None            # OAuth client, for remote control mode (Premium)
        self._cc_sp = None        # Client Credentials client, for search-only mode (any account)
        self._configured = bool(self.client_id and self.client_secret)

    def _ensure_search_client(self):
        """Lazily build a search-only client (Client Credentials flow).
        No user login required, works for Free or Premium accounts."""
        if self._cc_sp is not None:
            return
        if not self._configured:
            raise RuntimeError(
                "Spotify is not configured. Add SPOTIFY_CLIENT_ID and "
                "SPOTIFY_CLIENT_SECRET to your .env file first."
            )
        import spotipy
        from spotipy.oauth2 import SpotifyClientCredentials

        auth_manager = SpotifyClientCredentials(
            client_id=self.client_id,
            client_secret=self.client_secret,
        )
        self._cc_sp = spotipy.Spotify(auth_manager=auth_manager)

    def _ensure_client(self):
        """Lazily build the spotipy client (avoids opening a browser/login until needed)."""
        if self.sp is not None:
            return
        if not self._configured:
            raise RuntimeError(
                "Spotify is not configured. Add SPOTIFY_CLIENT_ID and "
                "SPOTIFY_CLIENT_SECRET to your .env file first."
            )
        import spotipy
        from spotipy.oauth2 import SpotifyOAuth

        auth_manager = SpotifyOAuth(
            client_id=self.client_id,
            client_secret=self.client_secret,
            redirect_uri=self.redirect_uri,
            scope=SCOPES,
            cache_path=".spotify_cache",
            open_browser=True,
        )
        self.sp = spotipy.Spotify(auth_manager=auth_manager)

    def is_configured(self):
        return self._configured

    def _get_active_device(self):
        devices = self.sp.devices().get("devices", [])
        if not devices:
            return None
        # Prefer an already-active device, else just take the first available one.
        for d in devices:
            if d.get("is_active"):
                return d
        return devices[0]

    def search_track(self, query, limit=1):
        """Search Spotify's catalog for a track. Works on Free or Premium accounts,
        and doesn't require the user to log in (app-only search)."""
        self._ensure_search_client()
        results = self._cc_sp.search(q=query, type="track", limit=limit)
        items = results.get("tracks", {}).get("items", [])
        return [
            {
                "uri": t["uri"],
                "id": t["id"],
                "url": t["external_urls"]["spotify"],
                "name": t["name"],
                "artist": ", ".join(a["name"] for a in t["artists"]),
                "album": t["album"]["name"],
            }
            for t in items
        ]

    def launch_search(self, query):
        """Search for a track by name and open its Spotify link.
        This launches the installed Spotify app (or web player) and starts
        playing it immediately - works on Free accounts, no OAuth login needed.
        Requires the machine ADA is running on to have a browser/Spotify app
        and a display (won't do anything useful in a headless sandbox)."""
        tracks = self.search_track(query, limit=1)
        if not tracks:
            return None
        webbrowser.open(tracks[0]["url"])
        return tracks[0]

    def play(self, uri=None):
        """Resume playback, or play a specific track/album/playlist URI if given.
        Requires Premium + an active device."""
        self._ensure_client()
        device = self._get_active_device()
        device_id = device["id"] if device else None
        if uri:
            if uri.startswith("spotify:track:"):
                self.sp.start_playback(device_id=device_id, uris=[uri])
            else:
                self.sp.start_playback(device_id=device_id, context_uri=uri)
        else:
            self.sp.start_playback(device_id=device_id)
        return True

    def play_search(self, query):
        """Search for a track by name and immediately play the first result."""
        tracks = self.search_track(query, limit=1)
        if not tracks:
            return None
        self.play(uri=tracks[0]["uri"])
        return tracks[0]

    def pause(self):
        self._ensure_client()
        self.sp.pause_playback()
        return True

    def next_track(self):
        self._ensure_client()
        self.sp.next_track()
        return True

    def previous_track(self):
        self._ensure_client()
        self.sp.previous_track()
        return True

    def set_volume(self, percent):
        self._ensure_client()
        percent = max(0, min(100, int(percent)))
        self.sp.volume(percent)
        return True

    def get_current(self):
        self._ensure_client()
        current = self.sp.current_playback()
        if not current or not current.get("item"):
            return None
        item = current["item"]
        return {
            "name": item["name"],
            "artist": ", ".join(a["name"] for a in item["artists"]),
            "album": item["album"]["name"],
            "is_playing": current.get("is_playing", False),
            "progress_ms": current.get("progress_ms"),
            "duration_ms": item.get("duration_ms"),
        }
