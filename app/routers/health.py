from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
import httpx
import time
from ..globals import APP_START_MONO, APP_START_TS
from ..dependencies import get_cms_client, _cms_get

router = APIRouter()


@router.get("/", description="Health check endpoint")
async def health_check(request: Request, client: httpx.AsyncClient = Depends(get_cms_client)):
    params = {
        "pagination[page]": 1,
        "pagination[pageSize]": 1,
    }

    app_version = request.app.version if hasattr(
        request.app, "version") else "unknown"

    results = {}
    for endpoint in ("articles", "events", "copyrights"):
        try:
            _, status_code = await _cms_get(f"/{endpoint}", params, client)
            results[endpoint] = {"status": "ok", "status_code": status_code}
        except HTTPException as e:
            details = {
                "status": "error",
                "status_code": e.status_code,
                "detail": str(e.detail)
            }
            results[endpoint] = details

    cms_ok = all(item["status"] == "ok" for item in results.values())
    cms_status = {
        "status": "ok" if cms_ok else "error",
        "checks": results,
    }

    payload = {
        "status": "ok" if cms_ok else "error",
        "version": app_version,
        "started_at": APP_START_TS,
        "uptime_seconds": int(time.monotonic() - APP_START_MONO),
        "cms": cms_status,
    }
    status_code = 200 if cms_ok else 503
    return JSONResponse(content=payload, status_code=status_code)
