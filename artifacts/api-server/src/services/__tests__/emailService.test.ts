import { describe, expect, it } from "vitest";
import { classifyEmailTransportError } from "../emailService.js";

describe("emailService diagnostics", () => {
  it("classifies missing SMTP configuration", () => {
    expect(classifyEmailTransportError("SMTP not configured (missing SMTP_HOST/SMTP_USER/SMTP_PASS)"))
      .toBe("MISSING_CONFIG");
  });

  it("classifies SMTP authentication failures without exposing credentials", () => {
    expect(classifyEmailTransportError("Invalid login: 535 5.7.8 Authentication failed"))
      .toBe("AUTH_FAILED");
  });

  it("classifies common transport failures", () => {
    expect(classifyEmailTransportError("connect ETIMEDOUT 203.0.113.1:465"))
      .toBe("CONNECTION_TIMEOUT");
    expect(classifyEmailTransportError("connect ECONNREFUSED 203.0.113.1:587"))
      .toBe("CONNECTION_REFUSED");
    expect(classifyEmailTransportError("self signed certificate in certificate chain"))
      .toBe("TLS_ERROR");
    expect(classifyEmailTransportError("getaddrinfo ENOTFOUND smtp.example.test"))
      .toBe("DNS_ERROR");
  });
});
