import time
from datetime import datetime, timezone

# Application start time
APP_START_MONO = time.monotonic()
APP_START_TS = datetime.now(timezone.utc).isoformat()
