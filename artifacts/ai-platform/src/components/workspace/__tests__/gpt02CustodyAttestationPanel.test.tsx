import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { InternalUser } from "@/hooks/use-internal-auth";
import { Gpt02CustodyAttestationPanel, type Gpt02CustodyCredential } from "../../Gpt02CustodyAttestationPanel";

const auth = vi.hoisted(() => ({ user: null as InternalUser | null, loading: false }));
vi.mock("@/hooks/use-internal-auth", () => ({ useInternalAuth: () => auth }));

const owner: InternalUser = {
  id: 1, email: "owner@example.test", role: "owner", accountType: "internal", status: "active",
  mustChangePassword: false, lastLoginAt: null, createdAt: "2026-01-01T00:00:00Z",
};
const credential: Gpt02CustodyCredential = {
  id: "9ce5d875-5bc6-4c90-b45d-b4506da00d6b", name: "openclaw-vps-dev-consumer",
  scopes: ["agent:presence", "agent:work"], isActive: true,
};
const binding = "a".repeat(64);
const secretSentinel = "PRIVATE_RESPONSE_MUST_NEVER_BE_DISPLAYED";
const success = () => {
  const now = Date.now();
  return {
  receipt: {
    audience: "CST-DEV/GPT02/READER-CUSTODY/WORKER-ATTESTATION/v2",
    project: "xssrfshdrtdfupgqwfdw", scope: "GPT02_READER_CREDENTIAL_CUSTODY_CST_DEV",
    principal: "openclaw-vps-main", service: "openclaw-vps-dev-consumer",
    issuer: "CST_DEV_AGENT_CREDENTIAL_ADMIN", credentialId: credential.id, credentialBinding: binding,
    notBefore: now - 1_000, expiresAt: now + 3_599_000,
  },
  signature: Buffer.alloc(64, 7).toString("base64url"),
  };
};
const response = (status: number, body: unknown, contentType = "application/json") => ({
  status, ok: status >= 200 && status < 300,
  headers: new Headers({ "Content-Type": contentType, "Cache-Control": "no-store" }),
  json: vi.fn().mockResolvedValue(body),
}) as unknown as Response;

function show(credentials: Gpt02CustodyCredential[] = [credential], credentialsReady = true) {
  return render(<Gpt02CustodyAttestationPanel credentials={credentials} credentialsReady={credentialsReady} />);
}
function enterBinding(value = binding) {
  fireEvent.change(screen.getByLabelText("Binding kredensial publik (64 karakter heksadesimal)"), { target: { value } });
}
function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Terbitkan bukti custody worker" }));
}

describe("GPT02 Owner custody issuance UI", () => {
  beforeEach(() => {
    auth.user = { ...owner };
    auth.loading = false;
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("location", new URL("https://dev.cstlogistic.co.id/settings"));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not issue on render, binding input, or rerender", () => {
    const view = show();
    enterBinding();
    view.rerender(<Gpt02CustodyAttestationPanel credentials={[credential]} credentialsReady />);
    expect(screen.getByRole("button", { name: "Terbitkan bukti custody worker" })).toBeEnabled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["admin", { ...owner, role: "admin" as const }],
    ["signed out", null],
    ["inactive Owner", { ...owner, status: "disabled" }],
    ["external Owner", { ...owner, accountType: "external" }],
    ["password change pending", { ...owner, mustChangePassword: true }],
  ])("shows an Owner-login requirement without an issue button for %s", (_label, user) => {
    auth.user = user;
    show();
    expect(screen.getByRole("status").textContent).toContain("Masuk sebagai Owner internal");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not offer issuance outside the exact HTTPS DEV origin", () => {
    vi.stubGlobal("location", new URL("https://aicore.cstlogistic.co.id/settings"));
    show();
    expect(screen.getByRole("status").textContent).toContain("https://dev.cstlogistic.co.id");
    expect(screen.queryByRole("button")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", []],
    ["wrong service", [{ ...credential, name: "openclaw-pchp-dev" }]],
    ["revoked", [{ ...credential, isActive: false }]],
    ["missing presence scope", [{ ...credential, scopes: ["model:chat"] }]],
    ["ambiguous", [credential, { ...credential, id: "5e892a90-f3fb-4f33-9941-23ee4a9f1083" }]],
  ])("blocks %s credentials", (_label, credentials) => {
    show(credentials);
    expect(screen.getByRole("button", { name: "Terbitkan bukti custody worker" })).toBeDisabled();
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires a ready credential list and a valid public binding", () => {
    const view = show([credential], false);
    expect(screen.getByRole("textbox")).toBeDisabled();
    view.rerender(<Gpt02CustodyAttestationPanel credentials={[credential]} credentialsReady />);
    enterBinding("not-a-public-binding");
    submit();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Terbitkan bukti custody worker" })).toBeDisabled();
  });

  it("posts only the expected binding with the real same-origin session and displays public proof", async () => {
    const proof = success();
    vi.mocked(fetch).mockResolvedValue(response(201, proof));
    show();
    enterBinding();
    submit();
    await screen.findByText(/Bukti publik diterbitkan/);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `/api/ai/agent-runtime/credentials/${credential.id}/custody-attestation`,
      {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedCredentialBinding: binding }),
      },
    );
    expect(JSON.parse(screen.getByLabelText("Bukti custody publik JSON").textContent!)).toEqual(proof);
    expect(screen.getByText(/Verifikasi reader E2E masih belum dilakukan/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unduh bukti publik JSON" })).toBeEnabled();
  });

  it("prevents duplicate submissions while one explicit request is pending", async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise((done) => { resolve = done; }));
    show();
    enterBinding();
    const button = screen.getByRole("button", { name: "Terbitkan bukti custody worker" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    resolve(response(201, success()));
    await screen.findByText(/Bukti publik diterbitkan/);
  });

  it.each([401, 403, 409, 503])("renders a bounded HTTP %s failure without leaking a response body or retrying", async (status) => {
    const rejected = response(status, { error: secretSentinel, token: secretSentinel });
    vi.mocked(fetch).mockResolvedValue(rejected);
    show();
    enterBinding();
    submit();
    await screen.findByRole("alert");
    expect(document.body.textContent).not.toContain(secretSentinel);
    expect(rejected.json).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Unduh bukti publik JSON" })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry a request whose network outcome is unknown", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error(secretSentinel));
    show();
    enterBinding();
    submit();
    expect((await screen.findByRole("alert")).textContent).toContain("Periksa audit penerbit");
    expect(document.body.textContent).not.toContain(secretSentinel);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["extra fields", "wrong binding", "wrong target", "standard base64", "noncanonical base64url", "expired", "HTML"]) ("rejects a %s success-shaped response before display or download", async (failure) => {
    const proof = success();
    let body: unknown = proof;
    if (failure === "extra fields") body = { ...proof, token: secretSentinel };
    if (failure === "wrong binding") proof.receipt.credentialBinding = "b".repeat(64);
    if (failure === "wrong target") proof.receipt.project = "other-project";
    if (failure === "standard base64") proof.signature = Buffer.alloc(64, 7).toString("base64");
    if (failure === "noncanonical base64url") proof.signature = proof.signature.slice(0, -1) + "x";
    if (failure === "expired") {
      proof.receipt.notBefore = Date.now() - 60_000;
      proof.receipt.expiresAt = Date.now() - 1;
    }
    vi.mocked(fetch).mockResolvedValue(response(201, body, failure === "HTML" ? "text/html" : "application/json"));
    show();
    enterBinding();
    submit();
    expect((await screen.findByRole("alert")).textContent).toContain("Tidak ada berkas yang ditampilkan");
    expect(screen.queryByLabelText("Bukti custody publik JSON")).toBeNull();
    expect(screen.queryByRole("button", { name: "Unduh bukti publik JSON" })).toBeNull();
    expect(document.body.textContent).not.toContain(secretSentinel);
  });

  it("downloads only the validated public envelope on a separate explicit click", async () => {
    const proof = success();
    const createUrl = vi.fn().mockReturnValue("blob:public-proof");
    vi.stubGlobal("URL", Object.assign(class extends URL {}, {
      createObjectURL: createUrl, revokeObjectURL: vi.fn(),
    }));
    let downloadedName = "";
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download;
    });
    vi.mocked(fetch).mockResolvedValue(response(201, proof));
    show();
    enterBinding();
    submit();
    const download = await screen.findByRole("button", { name: "Unduh bukti publik JSON" });
    expect(createUrl).not.toHaveBeenCalled();
    fireEvent.click(download);
    expect(click).toHaveBeenCalledTimes(1);
    expect(downloadedName).toBe("worker-attestation.json");
    const blob = createUrl.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text())).toEqual(proof);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("hides the prior proof after the current Owner or credential changes", async () => {
    vi.mocked(fetch).mockResolvedValue(response(201, success()));
    const view = show();
    enterBinding();
    submit();
    await screen.findByText(/Bukti publik diterbitkan/);
    auth.user = { ...owner, id: 2, role: "admin" };
    view.rerender(<Gpt02CustodyAttestationPanel credentials={[credential]} credentialsReady />);
    expect(screen.queryByLabelText("Bukti custody publik JSON")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    auth.user = { ...owner };
    view.rerender(<Gpt02CustodyAttestationPanel credentials={[{ ...credential, id: "5e892a90-f3fb-4f33-9941-23ee4a9f1083" }]} credentialsReady />);
    await waitFor(() => expect(screen.queryByLabelText("Bukti custody publik JSON")).toBeNull());
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
