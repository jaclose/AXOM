import { describe, expect, it, vi } from "vitest";
import { requireBodyObject, withApi } from "../../../lib/api/http.js";

function mockRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    statusCode: 200,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = String(value);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    end(body?: string) {
      this.body = body ?? null;
      return this;
    },
  };
}

describe("withApi CORS policy", () => {
  it.each([
    "http://localhost:5173",
    "http://127.0.0.1:5187",
    "https://axom.app",
    "https://axom-jacloses-projects.vercel.app",
    "tauri://localhost",
    "http://tauri.localhost",
  ])("allows configured first-party origin %s", async (origin) => {
    const route = withApi(["GET"], async (_req, res) => res.json({ ok: true }));
    const res = mockRes();

    await route({ method: "GET", headers: { origin }, query: {} }, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(origin);
    expect(res.headers["vary"]).toBe("Origin");
  });

  it("rejects unexpected origins", async () => {
    const handler = vi.fn();
    const route = withApi(["GET"], handler);
    const res = mockRes();
    await route({ method: "GET", headers: { origin: "https://evil.example" }, query: {} }, res as never);

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: "origin_not_allowed" });
    expect(handler).not.toHaveBeenCalled();
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["vary"]).toBe("Origin");
  });

  it("rejects malformed and opaque origins instead of treating them as originless", async () => {
    const handler = vi.fn();
    const route = withApi(["GET"], handler);

    for (const origin of ["null", "not an origin", "https://axom.app/path", "https://axom.app/?x=1"]) {
      const res = mockRes();
      await route({ method: "GET", headers: { origin }, query: {} }, res as never);

      expect(res.statusCode).toBe(403);
      expect(handler).not.toHaveBeenCalled();
      expect(res.headers["vary"]).toBe("Origin");
    }
  });

  it("answers allowed preflight without invoking the route handler", async () => {
    const handler = vi.fn();
    const route = withApi(["GET", "POST"], handler);
    const res = mockRes();

    await route({
      method: "OPTIONS",
      headers: {
        origin: "https://axom.app",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type, authorization",
      },
      query: {},
    }, res as never);

    expect(res.statusCode).toBe(204);
    expect(handler).not.toHaveBeenCalled();
    expect(res.headers["access-control-allow-origin"]).toBe("https://axom.app");
    expect(res.headers["access-control-allow-methods"]).toBe("GET, POST, OPTIONS");
    expect(res.headers["access-control-allow-headers"]).toBe("Content-Type, Authorization, X-Requested-With");
    expect(res.headers["vary"]).toBe("Origin");
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("does not advertise methods the endpoint does not support", async () => {
    const route = withApi(["GET"], async (_req, res) => res.json({ ok: true }));
    const res = mockRes();

    await route({ method: "OPTIONS", headers: { origin: "https://axom.app" }, query: {} }, res as never);

    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toBe("GET, OPTIONS");
    expect(res.headers["access-control-allow-methods"]).not.toContain("PATCH");
  });

  it("allows originless native/local requests without adding a wildcard origin", async () => {
    const handler = vi.fn();
    const route = withApi(["GET"], (_req, res) => {
      handler();
      res.json({ ok: true });
    });
    const res = mockRes();

    await route({ method: "GET", headers: {}, query: {} }, res as never);

    expect(res.statusCode).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(res.headers["vary"]).toBe("Origin");
  });

  it("rejects API JSON bodies above the route-specific byte limit", () => {
    expect(() => requireBodyObject({ method: "POST", headers: {}, query: {}, body: { data: "x".repeat(100) } }, 32)).toThrow(/too large/);
  });

  it("rejects disallowed preflight methods and headers", async () => {
    const route = withApi(["GET"], async (_req, res) => res.json({ ok: true }));
    for (const request of [
      { "access-control-request-method": "DELETE" },
      { "access-control-request-method": "GET", "access-control-request-headers": "x-evil-header" },
    ]) {
      const res = mockRes();
      await route({ method: "OPTIONS", headers: { origin: "https://axom.app", ...request }, query: {} }, res as never);
      expect(res.statusCode).toBe(403);
      expect(res.headers["access-control-allow-origin"]).toBe("https://axom.app");
    }
  });

  it("normalizes configured origin casing, default ports, and trailing slashes", async () => {
    vi.stubEnv("AXOM_ALLOWED_ORIGINS", " HTTPS://CUSTOM.AXOM.TEST:443/ , https://custom.axom.test/");
    try {
      const route = withApi(["GET"], async (_req, res) => res.json({ ok: true }));
      const res = mockRes();
      await route({ method: "GET", headers: { origin: "https://custom.axom.test" }, query: {} }, res as never);
      expect(res.statusCode).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe("https://custom.axom.test");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("accepts the ALLOWED_ORIGINS compatibility alias without wildcard matching", async () => {
    vi.stubEnv("AXOM_ALLOWED_ORIGINS", "");
    vi.stubEnv("ALLOWED_ORIGINS", "https://preview.axom.test, https://*.unsafe.test");
    try {
      const route = withApi(["GET"], async (_req, res) => res.json({ ok: true }));
      const allowed = mockRes();
      await route({ method: "GET", headers: { origin: "https://preview.axom.test" }, query: {} }, allowed as never);
      expect(allowed.statusCode).toBe(200);

      const wildcard = mockRes();
      await route({ method: "GET", headers: { origin: "https://child.unsafe.test" }, query: {} }, wildcard as never);
      expect(wildcard.statusCode).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not trust localhost by default in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("AXOM_ALLOWED_ORIGINS", "");
    try {
      const route = withApi(["GET"], async (_req, res) => res.json({ ok: true }));
      const res = mockRes();
      await route({ method: "GET", headers: { origin: "http://localhost:5173" }, query: {} }, res as never);
      expect(res.statusCode).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
