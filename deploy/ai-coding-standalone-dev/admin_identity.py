import base64
import json

from supabase_identity import SUPABASE_URL, verified_identity


def admin_identity(token, connection):
    user = verified_identity(token)
    if not user:
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        payload = json.loads(
            base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4))
        )
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    if (
        payload.get("iss") != SUPABASE_URL + "/auth/v1"
        or payload.get("aud") != "authenticated"
        or payload.get("sub") != user["user_id"]
        or payload.get("aal") != "aal2"
    ):
        return None
    row = connection.execute(
        "SELECT role,enabled FROM admin_identities WHERE user_id=?",
        (user["user_id"],),
    ).fetchone()
    if not row or not row[1] or row[0] not in ("super_admin", "admin"):
        return None
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "role": row[0],
        "auth_method": "supabase_aal2",
    }
