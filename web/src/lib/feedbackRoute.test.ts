import { describe, expect, it, vi } from "vitest";
import feedback from "../../../api/feedback.js";

function response() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    setHeader() {},
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; },
    end(body?: string) { this.body = body ?? null; },
  };
}

describe("retired feedback API", () => {
  it("returns 410 without sending email", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = response();
    await feedback({ method: "POST", headers: {}, query: {}, body: { message: "hello" } } as never, res as never);

    expect(res.statusCode).toBe(410);
    expect(res.body).toMatchObject({ error: "api_error" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
