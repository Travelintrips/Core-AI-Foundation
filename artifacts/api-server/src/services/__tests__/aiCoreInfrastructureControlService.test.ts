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
    ["Hostinger cek logs docker project=myapp", "HOSTINGER_DOCKER_LOGS"],
    ["Hostinger deploy docker project=myapp content=https://example.test/docker-compose.yml", "HOSTINGER_DOCKER_DEPLOY"],
    ["Hostinger update environment docker project=myapp content=https://example.test/docker-compose.yml env=A=2", "HOSTINGER_DOCKER_DEPLOY"],
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
    ["GCP start VM because status terakhir TERMINATED", "GCP_VM_START"],
    ["Google Cloud nyalakan ollama vm, status sekarang TERMINATED", "GCP_VM_START"],
    ["GCP restart VM setelah cek status", "GCP_VM_RESTART"],
    ["GCP stop VM setelah check status", "GCP_VM_STOP"],
    ["GCP cek status VM, jangan start", "GCP_VM_STATUS"],
    ["GCP read-only check status VM; jangan restart", "GCP_VM_STATUS"],
  ])("routes GCP action intent correctly for %s", (message, expected) => {
    expect(detectAiCoreInfrastructureOperation(message)).toBe(expected);
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
