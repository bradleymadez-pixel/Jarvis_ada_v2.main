"""
basic_agent.py

A grab-bag of simple, useful functions for JARVIS that need no AI model and
no API key at all. Everything here either runs fully locally or calls a
free, keyless public API (Open-Meteo for weather/geocoding).

Functions:
- get_time / get_date: current local time/date on the machine ADA runs on.
- get_weather(location): current conditions + short forecast for a place name.
- take_screenshot(): grabs the primary monitor, saves a PNG, returns its path.
- get_system_stats(): CPU / RAM / disk usage of the machine.
- open_url(url_or_query): opens a URL, or if given plain text, does a Google search.
"""

import os
import base64
import webbrowser
from datetime import datetime
from pathlib import Path

import requests

SCREENSHOT_DIR = Path(__file__).parent / "screenshots"


def get_time():
    now = datetime.now()
    return {
        "time": now.strftime("%I:%M %p").lstrip("0"),
        "iso": now.isoformat(timespec="seconds"),
    }


def get_date():
    now = datetime.now()
    return {
        "date": now.strftime("%A, %B %d, %Y"),
        "iso": now.date().isoformat(),
    }


def get_weather(location: str):
    """Free, keyless weather lookup via Open-Meteo.
    1. Geocode the place name to lat/lon.
    2. Fetch current conditions + today's forecast for those coordinates.
    """
    geo_resp = requests.get(
        "https://geocoding-api.open-meteo.com/v1/search",
        params={"name": location, "count": 1},
        timeout=10,
    )
    geo_resp.raise_for_status()
    geo = geo_resp.json()
    results = geo.get("results")
    if not results:
        raise ValueError(f"Could not find a location matching '{location}'")

    place = results[0]
    lat, lon = place["latitude"], place["longitude"]
    label = ", ".join(
        filter(None, [place.get("name"), place.get("admin1"), place.get("country")])
    )

    weather_resp = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
            "daily": "temperature_2m_max,temperature_2m_min,weather_code",
            "temperature_unit": "fahrenheit",
            "wind_speed_unit": "mph",
            "timezone": "auto",
            "forecast_days": 1,
        },
        timeout=10,
    )
    weather_resp.raise_for_status()
    data = weather_resp.json()
    current = data.get("current", {})
    daily = data.get("daily", {})

    return {
        "location": label,
        "temperature_f": current.get("temperature_2m"),
        "humidity_pct": current.get("relative_humidity_2m"),
        "wind_mph": current.get("wind_speed_10m"),
        "weather_code": current.get("weather_code"),
        "high_f": (daily.get("temperature_2m_max") or [None])[0],
        "low_f": (daily.get("temperature_2m_min") or [None])[0],
    }


def take_screenshot():
    """Grabs the primary monitor. Requires an actual display - will raise
    a clear error in a headless environment (like this sandbox)."""
    import mss

    SCREENSHOT_DIR.mkdir(exist_ok=True)
    filename = SCREENSHOT_DIR / f"screenshot_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"

    with mss.mss() as sct:
        monitor = sct.monitors[1]  # 0 is "all monitors combined"; 1 is primary
        img = sct.grab(monitor)
        mss.tools.to_png(img.rgb, img.size, output=str(filename))

    with open(filename, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")

    return {"path": str(filename), "image_base64": b64}


def get_system_stats():
    import psutil

    cpu_percent = psutil.cpu_percent(interval=0.3)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")

    return {
        "cpu_percent": cpu_percent,
        "ram_percent": mem.percent,
        "ram_used_gb": round(mem.used / (1024 ** 3), 1),
        "ram_total_gb": round(mem.total / (1024 ** 3), 1),
        "disk_percent": disk.percent,
        "disk_used_gb": round(disk.used / (1024 ** 3), 1),
        "disk_total_gb": round(disk.total / (1024 ** 3), 1),
    }


def open_url(url_or_query: str):
    """Opens a URL directly, or runs a Google search if it's not a URL."""
    text = url_or_query.strip()
    if text.startswith("http://") or text.startswith("https://"):
        target = text
    elif "." in text and " " not in text:
        target = f"https://{text}"
    else:
        target = f"https://www.google.com/search?q={requests.utils.quote(text)}"
    webbrowser.open(target)
    return {"opened": target}
