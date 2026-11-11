"""Authenticated DEV admin identity verifier for approval actions.

A normal Supabase password-authenticated session is sufficient. No separate
AAL2/TOTP challenge is required for a single Super Admin approval. The server
still verifies the signed JWT, issuer, audience, subject, and active role.
"""
import base64
import json

from supabase_identity import verified_identity, SUPABASE_URL


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
    except (ValueError, TypeError):
        return None
    if (
        payload.get("iss") != SUPABASE_URL + "/auth/v1"
        or payload.get("aud") != "authenticated"
        or payload.get("sub") != user.get("user_id")
        or payload.get("aal") not in ("aal1", "aal2")
    ):
        return None
    row = connection.execute(
        "SELECT role,enabled FROM admin_identities WHERE user_id=?",
        (user["user_id"],),
    ).fetchone()
    if not row or not row[1] or row[0] != "super_admin":
        return None
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "role": row[0],
        "auth_level": payload.get("aal"),
    }
