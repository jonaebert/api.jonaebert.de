from fastapi import APIRouter, Depends, HTTPException
import httpx
from ..dependencies import get_cms_client, _cms_get

router = APIRouter()


@router.get("/", description="Get copyrights for images")
async def get_all_copyright_info(
    limit: int = 30,
    client: httpx.AsyncClient = Depends(get_cms_client)
):
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


@router.get("/{image_id}", description="Get copyright for one image")
async def get_one_copyright_info(
    image_id: str,
    client: httpx.AsyncClient = Depends(get_cms_client)
):
    return await fetch_one_copyright(image_id, client)
