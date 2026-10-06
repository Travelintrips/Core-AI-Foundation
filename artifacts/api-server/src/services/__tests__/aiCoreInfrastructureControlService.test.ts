import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../aiAuditService.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

import {
  detectAiCoreInfrastructureOperation,
  executeAiCoreInfrastructureOperation,
} from "../aiCoreInfrastructureControlService.js";

describe("AI Core Hostinger infrastructure control", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["Hostinger list docker projects", "HOSTINGER_DOCKER_LIST"],
    ["Hostinger cek SSH public key", "HOSTINGER_VPS_SSH_KEY_LIST"],
    ['Hostinger pasang SSH public key name=chatgpt key="ssh-ed25519 AAAATEST chatgpt"', "HOSTINGER_VPS_SSH_KEY_ATTACH"],
    ["Hostinger cek logs docker project=myapp", "HOSTINGER_DOCKER_LOGS"],
    ["Hostinger deploy docker project=myapp content=https://example.test/docker-compose.yml", "HOSTINGER_DOCKER_DEPLOY"],
    ["Hostinger update environment docker project=myapp content=https://example.test/docker-compose.yml env=A=2", "HOSTINGER_DOCKER_DEPLOY"],
    ["Hostinger masukkan secret project=myapp key=OPENAI_API_KEY value=secret-value", "HOSTINGER_DOCKER_ENV_SET"],
    ["Hostinger set env project=myapp env=API_KEY=secret-value", "HOSTINGER_DOCKER_ENV_SET"],
    ["Hostinger buat DNS record domain=example.com name=@ type=TXT content=\"hello world\"", "HOSTINGER_DNS_RECORD_CREATE"],
    ["Hostinger update DNS record domain=example.com name=www type=CNAME content=app.example.com", "HOSTINGER_DNS_RECORD_UPDATE"],
    ["Hostinger hapus DNS record domain=example.com name=old type=A", "HOSTINGER_DNS_RECORD_DELETE"],
    ["Hostinger stop docker project=myapp", "HOSTINGER_DOCKER_STOP"],
    ["Hostinger buat subdomain domain=example.com subdomain=api target=203.0.113.10", "HOSTINGER_DNS_SUBDOMAIN_CREATE"],
    ["Hostinger buat hosting subdomain username=user123 domain=example.com subdomain=api", "HOSTINGER_SUBDOMAIN_CREATE"],
    ["Hostinger cek dns subdomain domain=example.com", "HOSTINGER_DNS_LIST"],
    ["Hostinger list subdomain domain=example.com", "HOSTINGER_SUBDOMAIN_LIST"],
    ["Hostinger cek domain tersedia name=mybrand tlds=com|net", "HOSTINGER_DOMAIN_AVAILABILITY"],
    ["Hostinger cari hosting username dan hosting domain", "HOSTINGER_HOSTING_DISCOVERY"],
  ])("detects %s", (message, expected) => {
    expect(detectAiCoreInfrastructureOperation(message)).toBe(expected);
  });

  it.each([
    ["GCP cek status konfigurasi GCP Billing Export", null],
    ["GCP check BigQuery billing export status", null],
    ["Google Cloud cek biaya dan usage cost Workspace", null],
    ["GCP cek tagihan bulanan", null],
  ])("does not route billing intent into Compute VM operations for %s", (message, expected) => {
    expect(detectAiCoreInfrastructureOperation(message)).toBe(expected);
  });

  it.each([
    ["GCP start VM because status terakhir TERMINATED", "GCP_VM_START"],
    ["Google Cloud nyalakan ollama vm, status sekarang TERMINATED", "GCP_VM_START"],
    ["GCP restart VM setelah cek status", "GCP_VM_RESTART"],
    ["GCP stop VM setelah check status", "GCP_VM_STOP"],
    ["GCP cek status VM, jangan start", "GCP_VM_STATUS"],
    ["GCP read-only check status VM; jangan restart", "GCP_VM_STATUS"],
    ["GCP start VM karena TERMINATED. Jangan restart/reset.", "GCP_VM_START"],
    ["GCP nyalakan VM, jangan reboot", "GCP_VM_START"],
    ["GCP restart VM, jangan stop", "GCP_VM_RESTART"],
    ["GCP stop VM, jangan restart", "GCP_VM_STOP"],
    ["GCP cek status VM, jangan start VM", "GCP_VM_STATUS"],
  ])("routes GCP action intent correctly for %s", (message, expected) => {
    expect(detectAiCoreInfrastructureOperation(message)).toBe(expected);
  });

  it.each([
    [
      "cek konfigurasi runtime aktual AI Core tanpa melakukan perubahan. service utama berjalan di Hostinger atau GCloud, dan apakah worker GCloud auto-start saat ada job lalu auto-stop setelah idle?",
      "HOSTINGER_VPS_STATUS",
    ],
    [
      "Hostinger read-only audit VPS: cek apakah service auto-start/auto-stop; do not make changes",
      "HOSTINGER_VPS_STATUS",
    ],
    [
      "GCP audit worker read-only, verifikasi auto-start dan auto-stop tanpa melakukan perubahan",
      "GCP_VM_STATUS",
    ],
    [
      "Hostinger cek docker project=myapp read-only; lihat apakah container restart otomatis, jangan ubah apa pun",
      "HOSTINGER_DOCKER_STATUS",
    ],
  ])("fails closed for explicit read-only infrastructure inspection: %s", (message, expected) => {
    expect(detectAiCoreInfrastructureOperation(message)).toBe(expected);
  });

  it.each([
    ["Hostinger nyalakan VPS sekarang", "HOSTINGER_VPS_START"],
    ["Hostinger matikan VPS sekarang", "HOSTINGER_VPS_STOP"],
    ["GCP start VM sekarang", "GCP_VM_START"],
    ["GCP stop VM sekarang", "GCP_VM_STOP"],
  ])("still allows explicit mutating infrastructure commands: %s", (message, expected) => {
    expect(detectAiCoreInfrastructureOperation(message)).toBe(expected);
  });

  it("registers and attaches a Hostinger SSH public key without returning the key material", async () => {
    const publicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestOnly chatgpt";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 778899,
        name: "chatgpt-ai-task",
        key: publicKey,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 991122,
        state: "success",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAiCoreInfrastructureOperation({
      operation: "HOSTINGER_VPS_SSH_KEY_ATTACH",
      message: `Hostinger pasang SSH public key name=chatgpt-ai-task key="${publicKey}"`,
      env: {
        HOSTINGER_API_TOKEN: "token",
        HOSTINGER_VPS_ID: "1792369",
      },
    });

    expect(result.mutating).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe(
      "https://developers.hostinger.com/api/vps/v1/public-keys",
    );
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      name: "chatgpt-ai-task",
      key: publicKey,
    });
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toBe(
      "https://developers.hostinger.com/api/vps/v1/public-keys/attach/1792369",
    );
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body))).toEqual({
      ids: [778899],
    });
    expect(result.data).toEqual({
      id: 778899,
      name: "chatgpt-ai-task",
      attached: true,
      virtualMachineId: "1792369",
    });
    expect(JSON.stringify(result)).not.toContain("AAAAC3NzaC1lZDI1NTE5AAAAITestOnly");
  });

  it("lists attached Hostinger SSH keys without returning key material", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      data: [{ id: 778899, name: "chatgpt-ai-task", key: "ssh-ed25519 SECRET" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAiCoreInfrastructureOperation({
      operation: "HOSTINGER_VPS_SSH_KEY_LIST",
      message: "Hostinger cek SSH public key",
      env: {
        HOSTINGER_API_TOKEN: "token",
        HOSTINGER_VPS_ID: "1792369",
      },
    });

    expect(result.mutating).toBe(false);
    expect(result.data).toEqual([{ id: 778899, name: "chatgpt-ai-task" }]);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("auto-discovers the only accessible Docker project when no project is configured", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { project_name: "aicore" },
      ]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        project_name: "aicore",
        state: "running",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAiCoreInfrastructureOperation({
      operation: "HOSTINGER_DOCKER_STATUS",
      message: "Hostinger cek docker status",
      env: {
        HOSTINGER_API_TOKEN: "token",
        HOSTINGER_VPS_ID: "1792369",
      },
    });

    expect(result.mutating).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe(
      "https://developers.hostinger.com/api/vps/v1/virtual-machines/1792369/docker",
    );
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toBe(
      "https://developers.hostinger.com/api/vps/v1/virtual-machines/1792369/docker/aicore",
    );
  });

  it("fails closed when Docker project discovery is ambiguous", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([
        { project_name: "aicore" },
        { project_name: "n8n" },
      ]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(executeAiCoreInfrastructureOperation({
      operation: "HOSTINGER_DOCKER_STATUS",
      message: "Hostinger cek docker status",
      env: {
        HOSTINGER_API_TOKEN: "token",
        HOSTINGER_VPS_ID: "1792369",
      },
    })).rejects.toThrow(
      "Multiple Hostinger Docker projects are accessible (aicore, n8n). Specify project=<name> or configure HOSTINGER_DOCKER_PROJECT.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("updates one Docker environment secret without returning its value", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        content: "services:\n  app:\n    image: example/app",
        environment: "EXISTING=1\nAPI_KEY=old",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAiCoreInfrastructureOperation({
      operation: "HOSTINGER_DOCKER_ENV_SET",
      message: "Hostinger masukkan secret project=myapp key=API_KEY value=new-secret",
      env: {
        HOSTINGER_API_TOKEN: "token",
        HOSTINGER_VPS_ID: "1792369",
      },
    });

    expect(result.mutating).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [readUrl, readInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(readUrl).toBe("https://developers.hostinger.com/api/vps/v1/virtual-machines/1792369/docker/myapp");
    expect(readInit.method).toBe("GET");

    const [applyUrl, applyInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(applyUrl).toBe("https://developers.hostinger.com/api/vps/v1/virtual-machines/1792369/docker");
    expect(applyInit.method).toBe("POST");
    expect(JSON.parse(String(applyInit.body))).toEqual({
      project_name: "myapp",
      content: "services:\n  app:\n    image: example/app",
      environment: "EXISTING=1\nAPI_KEY=new-secret",
    });
    expect(JSON.stringify(result)).not.toContain("new-secret");
    expect(result.data).toMatchObject({
      project: "myapp",
      key: "API_KEY",
      value: "[REDACTED]",
      environmentVariableCount: 2,
    });
  });

  it("creates a generic TXT DNS record after validation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ valid: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAiCoreInfrastructureOperation({
      operation: "HOSTINGER_DNS_RECORD_CREATE",
      message: 'Hostinger buat DNS record domain=example.com name=@ type=TXT content="hello world" ttl=600',
      env: { HOSTINGER_API_TOKEN: "token" },
    });

    expect(result.mutating).toBe(true);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      overwrite: false,
      zone: [{
        name: "@",
        type: "TXT",
        ttl: 600,
        records: [{ content: "hello world" }],
      }],
    });
  });

  it("falls back from a configured subdomain to the parent Hostinger DNS zone", async () => {
    const fetchMock = vi.fn()
      // Hostinger can validate a subdomain-shaped zone name but reject the PUT
      // because only the parent DNS zone is actually managed.
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Request accepted" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Not found" }), { status: 404 }))
      // Probe the parent zone, then validate and apply there.
      .mockResolvedValueOnce(new Response(JSON.stringify([{ name: "@", type: "A", ttl: 300, records: [] }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Request accepted" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Request accepted" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAiCoreInfrastructureOperation({
      operation: "HOSTINGER_DNS_RECORD_CREATE",
      message: "Hostinger buat DNS record name=_smoke type=TXT content=test ttl=300",
      env: {
        HOSTINGER_API_TOKEN: "token",
        HOSTINGER_HOSTING_DOMAIN: "aicore.cstlogistic.co.id",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe(
      "https://developers.hostinger.com/api/dns/v1/zones/aicore.cstlogistic.co.id/validate",
    );
    expect((fetchMock.mock.calls[2] as [string, RequestInit])[0]).toBe(
      "https://developers.hostinger.com/api/dns/v1/zones/cstlogistic.co.id",
    );
    expect((fetchMock.mock.calls[3] as [string, RequestInit])[0]).toBe(
      "https://developers.hostinger.com/api/dns/v1/zones/cstlogistic.co.id/validate",
    );
    expect(JSON.parse(String((fetchMock.mock.calls[3] as [string, RequestInit])[1].body))).toMatchObject({
      zone: [{ name: "_smoke.aicore", type: "TXT", ttl: 300 }],
    });
    expect((fetchMock.mock.calls[4] as [string, RequestInit])[0]).toBe(
      "https://developers.hostinger.com/api/dns/v1/zones/cstlogistic.co.id",
    );
    expect(result.data).toMatchObject({
      domain: "cstlogistic.co.id",
      requestedDomain: "aicore.cstlogistic.co.id",
      name: "_smoke.aicore",
      type: "TXT",
    });
  });

  it("maps subdomain apex records to the delegated prefix on the parent DNS zone", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Not found" }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Request accepted" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Request accepted" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAiCoreInfrastructureOperation({
      operation: "HOSTINGER_DNS_RECORD_CREATE",
      message: "Hostinger buat DNS record domain=aicore.cstlogistic.co.id name=@ type=TXT content=test",
      env: { HOSTINGER_API_TOKEN: "token" },
    });

    expect(JSON.parse(String((fetchMock.mock.calls[2] as [string, RequestInit])[1].body))).toMatchObject({
      zone: [{ name: "aicore", type: "TXT" }],
    });
    expect(result.data).toMatchObject({
      domain: "cstlogistic.co.id",
      requestedDomain: "aicore.cstlogistic.co.id",
      name: "aicore",
    });
  });

  it("falls back to the parent DNS zone when Hostinger returns DNS:4005 invalid-domain 422", async () => {
    const invalidZone = JSON.stringify({
      message: "[DNS:4005] Domain name is not valid!",
      correlation_id: "test-correlation",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(invalidZone, { status: 422 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Request accepted" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Request accepted" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAiCoreInfrastructureOperation({
      operation: "HOSTINGER_DNS_RECORD_CREATE",
      message: "Hostinger buat DNS record name=_smoke type=TXT content=test ttl=300",
      env: {
        HOSTINGER_API_TOKEN: "token",
        HOSTINGER_HOSTING_DOMAIN: "aicore.cstlogistic.co.id",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe(
      "https://developers.hostinger.com/api/dns/v1/zones/aicore.cstlogistic.co.id/validate",
    );
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toBe(
      "https://developers.hostinger.com/api/dns/v1/zones/cstlogistic.co.id",
    );
    expect((fetchMock.mock.calls[2] as [string, RequestInit])[0]).toBe(
      "https://developers.hostinger.com/api/dns/v1/zones/cstlogistic.co.id/validate",
    );
    expect(JSON.parse(String((fetchMock.mock.calls[2] as [string, RequestInit])[1].body))).toMatchObject({
      zone: [{ name: "_smoke.aicore", type: "TXT", ttl: 300 }],
    });
    expect(result.data).toMatchObject({
      domain: "cstlogistic.co.id",
      requestedDomain: "aicore.cstlogistic.co.id",
      name: "_smoke.aicore",
    });
  });

  it("updates a DNS record with overwrite enabled", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ valid: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await executeAiCoreInfrastructureOperation({
      operation: "HOSTINGER_DNS_RECORD_UPDATE",
      message: "Hostinger update DNS record domain=example.com name=www type=CNAME content=app.example.com",
      env: { HOSTINGER_API_TOKEN: "token" },
    });

    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toMatchObject({
      overwrite: true,
      zone: [{ name: "www", type: "CNAME" }],
    });
  });

  it("deletes a generic DNS record by name and type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAiCoreInfrastructureOperation({
      operation: "HOSTINGER_DNS_RECORD_DELETE",
      message: "Hostinger hapus DNS record domain=example.com name=old type=A",
      env: { HOSTINGER_API_TOKEN: "token" },
    });

    expect(result.mutating).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://developers.hostinger.com/api/dns/v1/zones/example.com");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toEqual({
      filters: [{ name: "old", type: "A" }],
    });
  });

  it("deploys a Docker Compose project with optional environment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAiCoreInfrastructureOperation({
      operation: "HOSTINGER_DOCKER_DEPLOY",
      message: 'Hostinger deploy docker project=myapp content="https://example.test/docker-compose.yml" env="A=1"',
      env: {
        HOSTINGER_API_TOKEN: "token",
        HOSTINGER_VPS_ID: "1792369",
      },
    });

    expect(result.mutating).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://developers.hostinger.com/api/vps/v1/virtual-machines/1792369/docker");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      project_name: "myapp",
      content: "https://example.test/docker-compose.yml",
      environment: "A=1",
    });
  });

  it("creates a hosting subdomain through the official endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAiCoreInfrastructureOperation({
      operation: "HOSTINGER_SUBDOMAIN_CREATE",
      message: "Hostinger buat subdomain username=user123 domain=example.com subdomain=api public=true",
      env: { HOSTINGER_API_TOKEN: "token" },
    });

    expect(result.mutating).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://developers.hostinger.com/api/hosting/v1/accounts/user123/websites/example.com/subdomains",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      subdomain: "api",
      is_using_public_directory: true,
    });
  });

  it("validates then adds a VPS subdomain DNS record without overwriting existing records", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ valid: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAiCoreInfrastructureOperation({
      operation: "HOSTINGER_DNS_SUBDOMAIN_CREATE",
      message: "Hostinger buat subdomain domain=example.com subdomain=api target=203.0.113.10 ttl=300",
      env: { HOSTINGER_API_TOKEN: "token" },
    });

    expect(result.mutating).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [validateUrl, validateInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(validateUrl).toBe("https://developers.hostinger.com/api/dns/v1/zones/example.com/validate");
    expect(validateInit.method).toBe("POST");
    expect(JSON.parse(String(validateInit.body))).toEqual({
      overwrite: false,
      zone: [{
        name: "api",
        type: "A",
        ttl: 300,
        records: [{ content: "203.0.113.10" }],
      }],
    });
    const [updateUrl, updateInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(updateUrl).toBe("https://developers.hostinger.com/api/dns/v1/zones/example.com");
    expect(updateInit.method).toBe("PUT");
  });

  it("discovers hosting usernames and domains read-only", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        data: [
          {
            domain: "example.com",
            username: "u123456789",
            order_id: "order-1",
            website_type: "nodejs",
            is_enabled: true,
            root_directory: "/home/u123456789/domains/example.com/public_html",
          },
        ],
        meta: { total: 1 },
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAiCoreInfrastructureOperation({
      operation: "HOSTINGER_HOSTING_DISCOVERY",
      message: "Hostinger cari hosting username dan hosting domain",
      env: { HOSTINGER_API_TOKEN: "token" },
    });

    expect(result.mutating).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://developers.hostinger.com/api/hosting/v1/websites");
    expect(init.method).toBe("GET");
    expect(result.data).toMatchObject({
      suggested_configuration: [
        {
          HOSTINGER_HOSTING_USERNAME: "u123456789",
          HOSTINGER_HOSTING_DOMAIN: "example.com",
        },
      ],
    });
  });

  it("resolves a multi-domain hosting target without HOSTINGER_HOSTING_DOMAIN", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([
        { subdomain: "api", root_directory: "public_html/api" },
      ]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAiCoreInfrastructureOperation({
      operation: "HOSTINGER_SUBDOMAIN_LIST",
      message: "Hostinger cek subdomain domain=sportcenter.travelintrips.co.id",
      env: {
        HOSTINGER_API_TOKEN: "token",
        HOSTINGER_HOSTING_USERNAME: "u684045296",
      },
    });

    expect(result.mutating).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [subdomainUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(subdomainUrl).toBe(
      "https://developers.hostinger.com/api/hosting/v1/accounts/u684045296/websites/sportcenter.travelintrips.co.id/subdomains",
    );
    expect(init.method).toBe("GET");
    expect(result.data).toMatchObject({
      target: {
        username: "u684045296",
        domain: "sportcenter.travelintrips.co.id",
      },
      subdomains: [
        { subdomain: "api", root_directory: "public_html/api" },
      ],
    });
  });

  it("checks domain availability without making a purchase", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ available: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAiCoreInfrastructureOperation({
      operation: "HOSTINGER_DOMAIN_AVAILABILITY",
      message: "Hostinger cek domain tersedia name=mybrand tlds=com|net alternatives=true",
      env: { HOSTINGER_API_TOKEN: "token" },
    });

    expect(result.mutating).toBe(false);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://developers.hostinger.com/api/domains/v1/availability");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      domain: "mybrand",
      tlds: ["com", "net"],
      with_alternatives: true,
    });
  });
});
