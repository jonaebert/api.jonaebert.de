from fastapi import Request, HTTPException
import httpx
import logging
from datetime import datetime, timezone
import re

logger = logging.getLogger("fastapi.cms")


async def get_cms_client(request: Request) -> httpx.AsyncClient:
    return request.app.state.cms_client


def parse_cors_origins(origins_str: str) -> list[str]:
    if not origins_str:
        return []
    origins = re.split(r"[,\s]+", origins_str.strip())
    return [p for p in (s.strip() for s in origins) if p]


def _safe_ics_filename(subject: str) -> str:
    normalized = subject.translate(str.maketrans({
        "ä": "ae", "ö": "oe", "ü": "ue",
        "Ä": "Ae", "Ö": "Oe", "Ü": "Ue",
        "ß": "ss",
    }))
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "_", normalized).strip("_")
    return cleaned or "event"


async def _cms_get(path: str, params: dict, client: httpx.AsyncClient) -> tuple[dict, int]:
    try:
        response = await client.get(path, params=params)
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


def parse_iso_dt(value: str) -> datetime:
    v = value.strip()
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    parsed = datetime.fromisoformat(v)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed
