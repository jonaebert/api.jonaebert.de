from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
import logging
import os
import re
import time
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
from ics import Calendar, Event
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager

# Application start time
APP_START_MONO = time.monotonic()
APP_START_TS = datetime.now(timezone.utc).isoformat()

# Load .env in development (override system env values)
env_name = os.getenv('COOLIFY_BRANCH', None)
if env_name is None:
    dotenv_path = Path(__file__).resolve().parent / '.env'
    if dotenv_path.exists():
        load_dotenv(dotenv_path=dotenv_path, override=True)

# Environment variables
JE_CMS_API_BASE_URL: str = os.getenv("JE_CMS_API_BASE_URL", None)
JE_CMS_API_TOKEN: str = os.getenv("JE_CMS_API_TOKEN", None)
JE_WEB_BASE_URL: str = os.getenv("JE_WEB_BASE_URL", None)
JE_API_ROOT_PATH: str = os.getenv("ROOT_PATH", None)
JE_API_CORS_ORIGINS: str = os.getenv("JE_API_CORS_ORIGINS", None)
JE_API_CORS_ORIGINS_REGEX: str = os.getenv("JE_API_CORS_ORIGINS_REGEX", None)

# Ensure root path starts with a slash
if JE_API_ROOT_PATH and not JE_API_ROOT_PATH.startswith("/"):
    JE_API_ROOT_PATH = f"/{JE_API_ROOT_PATH}"


logger = logging.getLogger("fastapi.cms")

# Lifespan context manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    missing = [
        name
        for name, value in (
            ("JE_CMS_API_BASE_URL", JE_CMS_API_BASE_URL),
            ("JE_CMS_API_TOKEN", JE_CMS_API_TOKEN),
            ("JE_WEB_BASE_URL", JE_WEB_BASE_URL),
            ("JE_API_CORS_ORIGINS", JE_API_CORS_ORIGINS),
        )
        if not value
    ]
    if missing:
        raise RuntimeError(
            f"Missing required environment variables: {', '.join(missing)}"
        )
    app.state.cms_client = httpx.AsyncClient(
        base_url=f"{JE_CMS_API_BASE_URL}/api",
        headers={"Authorization": f"Bearer {JE_CMS_API_TOKEN}"},
        timeout=10.0,
    )
    yield
    await app.state.cms_client.aclose()

# FastAPI app instance
app = FastAPI(
    title="Jona Ebert (they/them)",
    version="26.6.0",
    summary="Jona Ebert's Personal Website API",
    lifespan=lifespan,
    root_path=JE_API_ROOT_PATH,
)

# CORS middleware


def parse_cors_origins(origins_str: str) -> list[str]:
    if not origins_str:
        return []
    # Split by comma OR whitespace/newlines, trim, drop empties
    origins = re.split(r"[,\s]+", origins_str.strip())
    return [p for p in (s.strip() for s in origins) if p]


origins = parse_cors_origins(JE_API_CORS_ORIGINS)


# CORS configuration
if "*" in origins:
    raise RuntimeError(
        "CORS allow_credentials=True is incompatible with wildcard origin '*'. "
        "Please specify explicit origins in JE_API_CORS_ORIGINS."
    )

cors_args = {
    "allow_origins": origins,
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
    "expose_headers": ["Content-Disposition"],
}
if JE_API_CORS_ORIGINS_REGEX is not None:
    origins_regexes = parse_cors_origins(JE_API_CORS_ORIGINS_REGEX)
    if origins_regexes:
        cors_args["allow_origin_regex"] = "|".join(
            f"(?:{r})" for r in origins_regexes)

app.add_middleware(CORSMiddleware, **cors_args)

# Dependency to get CMS client


def _get_cms_client() -> httpx.AsyncClient:
    return app.state.cms_client

# Helper to create safe ICS filenames


def _safe_ics_filename(subject: str) -> str:
    normalized = subject.translate(str.maketrans({
        "ä": "ae",
        "ö": "oe",
        "ü": "ue",
        "Ä": "Ae",
        "Ö": "Oe",
        "Ü": "Ue",
        "ß": "ss",
    }))
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "_", normalized).strip("_")
    return cleaned or "event"

# Helper to perform CMS GET requests


async def _cms_get(path: str, params: dict, client: httpx.AsyncClient) -> tuple[dict, int]:
    try:
        response = await client.get(
            path,
            params=params,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        logger.warning("CMS HTTP error %s for %s",
                       e.response.status_code, path)
        raise HTTPException(
            status_code=e.response.status_code, detail=e.response.text) from e
    except httpx.RequestError as e:
        logger.exception("CMS request error for %s", path, exc_info=e)
        raise HTTPException(
            status_code=502, detail="Upstream CMS request failed") from e

    try:
        return response.json(), response.status_code
    except ValueError as e:
        logger.exception(
            "CMS returned non-JSON response for %s", path, exc_info=e)
        raise HTTPException(
            status_code=502, detail="Upstream CMS invalid JSON") from e


# Fetch blog posts from the CMS


@app.get("/blog/posts/", description="Fetch blog posts from the CMS", tags=["blog"])
async def get_blog_posts(limit: int = 30, client: httpx.AsyncClient = Depends(_get_cms_client)):
    params = {
        "pagination[page]": 1,
        "pagination[pageSize]": limit,
        "populate[author][populate][avatar]": "true",
        "populate[copyright]": "true",
        "populate[cover]": "true",
        "sort": "createdAt:desc",
    }

    blog_json, _ = await _cms_get("/articles", params, client)
    blog_posts = blog_json.get("data")
    if not isinstance(blog_posts, list):
        raise HTTPException(
            status_code=502, detail="CMS response missing data")

    return blog_posts[:limit]

# Fetch one blog post from the CMS


@app.get("/blog/post/{post_id}", description="Fetch one blog post from the CMS", tags=["blog"])
async def get_one_blog_post(post_id: str, client: httpx.AsyncClient = Depends(_get_cms_client)):
    params = {
        "populate[author][populate][avatar]": "true",
        "populate[blocks][on][shared.text][populate]": "*",
        "populate[blocks][on][shared.media][populate]": "*",
        "populate[blocks][on][shared.copyright][populate]": "*",
        "populate[blocks][on][shared.slider][populate]": "*",
        "populate[blocks][on][shared.quote][populate]": "*",
        "populate[copyright]": "true",
        "populate[cover]": "true",
        "sort": "createdAt:desc",
    }

    blog_json, _ = await _cms_get(f"/articles/{post_id}", params, client)
    blog_post = blog_json.get("data")
    if not isinstance(blog_post, dict):
        raise HTTPException(status_code=404, detail="Post not found")

    return blog_post

# Fetch events from the CMS


@app.get("/calendar/events/", description="Fetch calendar events from the CMS", tags=["calendar"])
async def get_calendar_events(limit: int = 30, client: httpx.AsyncClient = Depends(_get_cms_client)):
    now = datetime.now(timezone.utc)
    window_end = now + timedelta(days=90)
    params = {
        "filters[start][$lte]": window_end.isoformat(),
        "filters[end][$gte]": now.isoformat(),
        "pagination[page]": 1,
        "pagination[pageSize]": limit,
        "populate[copyright]": "true",
        "populate[cover]": "true",
        "sort": "start:asc",
    }

    calendar_json, _ = await _cms_get("/events", params, client)
    calendar_events = calendar_json.get("data")
    if not isinstance(calendar_events, list):
        raise HTTPException(
            status_code=502, detail="CMS response missing data")

    return calendar_events[:limit]

# Fetch one event post from the CMS


async def fetch_one_calendar_event(event_id: str, client: httpx.AsyncClient):
    params = {
        "populate[copyright]": "true",
        "populate[cover]": "true",
    }

    calendar_json, _ = await _cms_get(f"/events/{event_id}", params, client)
    calendar_event = calendar_json.get("data")
    if not isinstance(calendar_event, dict):
        raise HTTPException(status_code=404, detail="Event not found")

    return calendar_event


@app.get("/calendar/event/{event_id}", description="Fetch one calendar event from the CMS", tags=["calendar"])
async def get_one_calendar_event(event_id: str, client: httpx.AsyncClient = Depends(_get_cms_client)):
    return await fetch_one_calendar_event(event_id, client)


def parse_iso_dt(value: str) -> datetime:
    # Parse ISO 8601 datetime string to datetime object
    v = value.strip()
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    parsed = datetime.fromisoformat(v)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


@app.get("/calendar/event/{event_id}/ics", description="Create ICS file for an event", tags=["calendar"])
async def download_event_ics(event_id: str, client: httpx.AsyncClient = Depends(_get_cms_client)):
    ev = await fetch_one_calendar_event(event_id, client)

    # Mapping CMS event to ICS event
    uid = ev.get("uid") or ev.get(
        "documentId") or str(ev.get("id") or event_id)
    subject = ev.get("subject") or "Event"
    description = ev.get("description") or ""
    location = ev.get("location") or ""
    base = JE_WEB_BASE_URL.rstrip("/")
    if not urlparse(base).scheme:
        base = f"https://{base}"
    url: str = f"{base}/calendar/{event_id}"
    state: str = (ev.get("state") or "").lower()

    start_raw = ev.get("start")
    end_raw = ev.get("end")
    if not start_raw or not end_raw:
        raise HTTPException(
            status_code=422, detail="Event is missing start/end")

    try:
        dt_start = parse_iso_dt(start_raw)
        dt_end = parse_iso_dt(end_raw)
    except (ValueError, OSError) as e:
        raise HTTPException(
            status_code=422, detail="Invalid start/end date format") from e

    cal = Calendar()
    e = Event()
    e.uid = uid
    e.name = subject
    e.begin = dt_start
    e.end = dt_end
    if description:
        e.description = description
    if location:
        e.location = location

    if state in {"confirmed", "tentative", "cancelled"}:
        e.status = state.lower()
    if url:
        e.url = url

    cal.events.add(e)

    ics_text = cal.serialize()

    filename = f'{_safe_ics_filename(subject)}.ics'
    return Response(
        content=ics_text,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'},
    )

# Fetch all copyright info for images from the CMS


@app.get("/copyrights/", description="Get copyrights for images", tags=["copyright"])
async def get_all_copyright_info(limit: int = 30, client: httpx.AsyncClient = Depends(_get_cms_client)):
    params = {
        "populate[media]": "true",
        "pagination[page]": 1,
        "pagination[pageSize]": limit,
    }

    copyright_json, _ = await _cms_get("/copyrights", params, client)
    copyright_info = copyright_json.get("data")
    if not isinstance(copyright_info, list):
        raise HTTPException(
            status_code=502, detail="CMS response missing data")

    return copyright_info[:limit]


# Fetch one copyright info for images from the CMS


async def fetch_one_copyright(image_id: str, client: httpx.AsyncClient):
    params = {
        "filters[media][documentId][$eq]": image_id,
        "pagination[page]": 1,
        "pagination[pageSize]": 1,
    }

    copyright_json, _ = await _cms_get("/copyrights", params, client)
    copyright_info = copyright_json.get("data")
    if not isinstance(copyright_info, list):
        raise HTTPException(status_code=404, detail="Copyright not found")

    return copyright_info


@app.get("/copyright/{image_id}", description="Get copyright for one image", tags=["copyright"])
async def get_one_copyright_info(image_id: str, client: httpx.AsyncClient = Depends(_get_cms_client)):
    return await fetch_one_copyright(image_id, client)

# Health check endpoint that verifies CMS connectivity and returns overall status


@app.get("/health", description="Health check endpoint", tags=["health"])
async def health_check(client: httpx.AsyncClient = Depends(_get_cms_client)):
    params = {
        "pagination[page]": 1,
        "pagination[pageSize]": 1,
    }

    results = {}
    for endpoint in ("articles", "events", "copyrights"):
        try:
            _, status_code = await _cms_get(f"/{endpoint}", params, client)
            results[endpoint] = {"status": "ok", "status_code": status_code}
        except HTTPException as e:
            details = {"status": "error",
                       "status_code": e.status_code, "detail": str(e.detail)}
            results[endpoint] = details

    cms_ok = all(item["status"] == "ok" for item in results.values())
    cms_status = {
        "status": "ok" if cms_ok else "error",
        "checks": results,
    }

    payload = {
        "status": "ok" if cms_ok else "error",
        "version": app.version,
        "started_at": APP_START_TS,
        "uptime_seconds": int(time.monotonic() - APP_START_MONO),
        "cms": cms_status,
    }
    status_code = 200 if cms_ok else 503
    return JSONResponse(content=payload, status_code=status_code)
