import json
import os
import urllib.error
import urllib.request

EXPECTED_SUPABASE_URL = "https://xssrfshdrtdfupgqwfdw.supabase.co"
SUPABASE_URL = os.environ.get("AICODING_SUPABASE_URL", "").rstrip("/")
PUBLISHABLE_KEY = os.environ.get("AICODING_SUPABASE_PUBLISHABLE_KEY", "")


def configuration_ready():
    return (
        SUPABASE_URL == EXPECTED_SUPABASE_URL
        and 20 <= len(PUBLISHABLE_KEY) <= 512
        and not any(ch.isspace() for ch in PUBLISHABLE_KEY)
        and all(ch not in PUBLISHABLE_KEY for ch in ("'", '"', "\\"))
    )


def verified_identity(access_token):
    if not configuration_ready():
        return None
    if not isinstance(access_token, str) or not 40 <= len(access_token) <= 8192:
        return None
    req = urllib.request.Request(
        SUPABASE_URL + "/auth/v1/user",
        headers={
            "apikey": PUBLISHABLE_KEY,
            "Authorization": "Bearer " + access_token,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            user = json.load(response)
    except (urllib.error.URLError, ValueError, TimeoutError, OSError):
        return None
    if (
        not isinstance(user, dict)
        or not user.get("id")
        or not user.get("email_confirmed_at")
    ):
        return None
    return {"user_id": user["id"], "email": user.get("email", "")}
