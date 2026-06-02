import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env in development
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
