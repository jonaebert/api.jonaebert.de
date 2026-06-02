from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
from contextlib import asynccontextmanager
import httpx

from .config import (
    JE_CMS_API_BASE_URL,
    JE_CMS_API_TOKEN,
    JE_WEB_BASE_URL,
    JE_API_ROOT_PATH,
    JE_API_CORS_ORIGINS,
    JE_API_CORS_ORIGINS_REGEX,
)
from .dependencies import parse_cors_origins
from .routers import blog, calendar, copyright, health

logger = logging.getLogger("fastapi.cms")


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

app = FastAPI(
    title="Jona Ebert (they/them)",
    version="26.6.1",
    summary="Jona Ebert's Personal Website API",
    lifespan=lifespan,
    root_path=JE_API_ROOT_PATH,
)

# CORS middleware
origins = parse_cors_origins(JE_API_CORS_ORIGINS)

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

# Include routers
app.include_router(blog.router, prefix="/blog", tags=["blog"])
app.include_router(calendar.router, prefix="/calendar", tags=["calendar"])
app.include_router(copyright.router, prefix="/copyright", tags=["copyright"])
app.include_router(health.router, prefix="/health", tags=["health"])
