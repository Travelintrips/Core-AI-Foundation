"""Read only safe Retry-After metadata. Never logs response bodies/credentials."""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

def safe_retry_after(response):
    if not isinstance(response, dict) or response.get("status") != 429:
        return {}
    headers = response.get("headers")
    value = None
    if isinstance(headers, dict):
        for key, item in headers.items():
            if isinstance(key, str) and key.lower() == "retry-after":
                value = item
                break
    if value is None:
        value = response.get("retryAfter")
    if value is None:
        return {}  # Provider did not expose Retry-After; apply ordinary 429 cooldown.
    if not isinstance(value, str) or len(value) > 90:
        return {"retryAfterInvalid": True}
    value = value.strip()
    if value.isdecimal():
        seconds = int(value)
        return {"retryAfterSeconds": seconds} if seconds <= 86400 else {"retryAfterInvalid": True}
    try:
        date = parsedate_to_datetime(value)
        if date.tzinfo is None:
            return {"retryAfterInvalid": True}
        return {"retryAfterUtc": date.astimezone(timezone.utc).isoformat()}
    except (ValueError, TypeError, OverflowError):
        return {"retryAfterInvalid": True}
