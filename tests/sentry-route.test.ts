import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/incidents/sentry/route";

describe("Sentry incident route", () => {
  afterEach(() => {
    delete process.env.COMPOSIO_WEBHOOK_SECRET;
  });

  it("rejects invalid Composio signatures before creating a run", async () => {
    process.env.COMPOSIO_WEBHOOK_SECRET = "secret";
    const response = await POST(
      new Request("http://localhost/api/incidents/sentry", {
        method: "POST",
        headers: { "x-composio-signature": "sha256=deadbeef" },
        body: JSON.stringify({ data: { event: { message: "test" } } })
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Invalid Composio webhook signature" });
  });
});
