// Public encryption key provisioned on the isolated PCHP worker (not a secret).
// Credential issuance still requires a real owner/admin session and same-origin guard.
export const PCHP_WORKER_TOKEN_PUBLIC_KEY_BASE64 = "MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAiN3dWQVVoPMnRBrBbCEPp/ss1qTS3VZVmZAtmSCW7tU9efAlYPpQKe6DGKDAl9cayhEgvjU+vE5REpJbVIsi733y/emWsR4MQNrTpqwVn6ycLtn6hkCTZZdHsVYXoMLX+zPe91Ko6mFxE+5PKmwzBGJYFUjT7wzDOgwwVzKQQ+pxDzQvxNVYLb8J+WBISGKTP3vxT3JmR40cSZwhxrMrlQcoWiGxcpVLU8KoAcnlpOtUStCI0nuovUmdziolkmQ8DxlmRcO6cluuU90FGxtOCJM0q++u3U/pgmktZHKWOeWP+rGxnlBt80/KhP8IAKaBhm/Z1Fl8JngR2tLhwVQ0sLezO+LMyEE5mPj+Va71t++THnM+CFYREH1EjtpLV6ml2Edb8EbZSYwv493/MBy/e/7k2/X6UwrgjzWbajnKeZVUSwvupE9DjuapmSfBiyHkeRPQTxl9Tcj7oQ6pErlcfWbVFfIvbmK9dlxgKbbkO9cEydVB4SMs1V5g3Q2dUOjfAgMBAAE=";

export async function encryptPchpWorkerToken(token: string): Promise<string> {
  const der = Uint8Array.from(atob(PCHP_WORKER_TOKEN_PUBLIC_KEY_BASE64), ch => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey("spki", der, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, new TextEncoder().encode(token));
  return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}

export async function preflightPchpEncryption(): Promise<void> {
  const encrypted = await encryptPchpWorkerToken("PCHP_PREISSUE_VALIDATION");
  if (atob(encrypted).length !== 384) throw new Error("PCHP credential encryption unavailable");
}

export function downloadEncryptedPchpCredential(encrypted: string): void {
  if (atob(encrypted).length !== 384) throw new Error("Invalid encrypted credential length");
  const url = URL.createObjectURL(new Blob([encrypted + "\n"], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "HS-PCHP-20261025-token-encrypted.b64";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
