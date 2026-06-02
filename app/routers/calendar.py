from fastapi import APIRouter, Depends, HTTPException, Response
from datetime import datetime, timedelta, timezone
import httpx
from ..dependencies import (
    get_cms_client,
    _cms_get,
    _safe_ics_filename,
    parse_iso_dt
)
from ..config import JE_WEB_BASE_URL
from ics import Calendar, Event
from urllib.parse import urlparse

router = APIRouter()


@router.get("/events/", description="Fetch calendar events from the CMS")
async def get_calendar_events(
    limit: int = 30,
    client: httpx.AsyncClient = Depends(get_cms_client)
):
    now = datetime.now(timezone.utc)
    window_end = now + timedelta(days=90)
    params = {
        "filters[start][$lte]": window_end.isoformat(),
        "filters[end][$gte]": now.isoformat(),
        "pagination[page]": 1,
        "pagination[pageSize]": limit,
        "populate[cover]": "true",
        "sort": "start:asc",
    }

    calendar_json, _ = await _cms_get("/events", params, client)
    calendar_events = calendar_json.get("data")
    if not isinstance(calendar_events, list):
        raise HTTPException(
            status_code=502, detail="CMS response missing data")

    return calendar_events[:limit]


async def fetch_one_calendar_event(event_id: str, client: httpx.AsyncClient):
    params = {
        "populate[cover]": "true",
    }

    calendar_json, _ = await _cms_get(f"/events/{event_id}", params, client)
    calendar_event = calendar_json.get("data")
    if not isinstance(calendar_event, dict):
        raise HTTPException(status_code=404, detail="Event not found")

    return calendar_event


@router.get("/event/{event_id}", description="Fetch one calendar event from the CMS")
async def get_one_calendar_event(
    event_id: str,
    client: httpx.AsyncClient = Depends(get_cms_client)
):
    return await fetch_one_calendar_event(event_id, client)


@router.get("/event/{event_id}/ics", description="Create ICS file for an event")
async def download_event_ics(
    event_id: str,
    client: httpx.AsyncClient = Depends(get_cms_client)
):
    ev = await fetch_one_calendar_event(event_id, client)

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
