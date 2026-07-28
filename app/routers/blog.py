from fastapi import APIRouter, Depends, HTTPException, Query
import httpx
from ..dependencies import get_cms_client, _cms_get

router = APIRouter()


@router.get("/posts/", description="Fetch blog posts from the CMS")
async def get_blog_posts(
    limit: int = Query(
        30, description="Number of posts to return", gt=0, le=100),
    category: str | None = Query(
        None, description="Filter posts by category slug (e.g. 'news', 'projects')", example="braunschweig-2031"),
    client: httpx.AsyncClient = Depends(get_cms_client)
):
    params = {
        "pagination[page]": 1,
        "pagination[pageSize]": limit,
        "populate[author][populate][avatar]": "true",
        "populate[cover]": "true",
        "sort": "createdAt:desc",
    }
    if category:
        params["filters[category][slug][$eq]"] = category

    blog_json, _ = await _cms_get("/articles", params, client)
    blog_posts = blog_json.get("data")
    if not isinstance(blog_posts, list):
        raise HTTPException(
            status_code=502, detail="CMS response missing data")

    return blog_posts[:limit]


@router.get("/post/{post_id}", description="Fetch one blog post from the CMS")
async def get_one_blog_post(
    post_id: str,
    client: httpx.AsyncClient = Depends(get_cms_client)
):
    params = {
        "populate[author][populate][avatar]": "true",
        "populate[blocks][on][shared.text][populate]": "*",
        "populate[blocks][on][shared.media][populate]": "*",
        "populate[blocks][on][shared.slider][populate]": "*",
        "populate[blocks][on][shared.quote][populate]": "*",
        "populate[cover]": "true",
        "sort": "createdAt:desc",
    }

    blog_json, _ = await _cms_get(f"/articles/{post_id}", params, client)
    blog_post = blog_json.get("data")
    if not isinstance(blog_post, dict):
        raise HTTPException(status_code=404, detail="Post not found")

    return blog_post
