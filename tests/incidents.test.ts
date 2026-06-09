import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeSlackIncident, normalizeSentryIncident, verifyComposioWebhookSignature } from "@/lib/incidents";

describe("incident normalization", () => {
  it("creates a stable Slack incident fingerprint", () => {
    const payload = {
      text: "Critical checkout incident: Cannot read properties of undefined (reading 'user')",
      user_name: "demo",
      channel_name: "incident-response"
    };

    const first = normalizeSlackIncident(payload);
    const second = normalizeSlackIncident(payload);

    expect(first.fingerprint).toEqual(second.fingerprint);
    expect(first.source).toBe("slack");
    expect(first.severity).toBe("critical");
  });

  it("extracts Sentry issue and exception evidence", () => {
    const incident = normalizeSentryIncident({
      issue: { id: "ISSUE-1", title: "Checkout session crash", culprit: "checkout/actions.ts" },
      project: { slug: "storefront" },
      event: {
        event_id: "EVENT-1",
        environment: "production",
        release: "web@1.2.3",
        tags: { browser: "Chrome" },
        level: "fatal",
        exception: {
          values: [{ type: "TypeError", value: "Cannot read properties of undefined (reading 'user')" }]
        }
      }
    });

    expect(incident.fingerprint).toHaveLength(24);
    expect(incident.title).toBe("Checkout session crash");
    expect(incident.severity).toBe("critical");
    expect(incident.stackTrace).toContain("Cannot read properties");
    expect(incident.context?.issueId).toBe("ISSUE-1");
    expect(incident.context?.eventId).toBe("EVENT-1");
    expect(incident.context?.project).toBe("storefront");
    expect(incident.context?.environment).toBe("production");
    expect(incident.context?.release).toBe("web@1.2.3");
    expect(incident.context?.tags?.browser).toBe("Chrome");
  });

  it("extracts real Sentry webhook data envelopes", () => {
    const incident = normalizeSentryIncident({
      action: "created",
      data: {
        issue: {
          id: "ISSUE-2",
          title: "Critical checkout incident: Cannot read properties of undefined (reading 'user')",
          culprit: "checkout/session"
        },
        project: { slug: "gita-ai" },
        event: {
          event_id: "EVENT-2",
          message: "Checkout session path failed",
          level: "critical",
          environment: "production",
          exception: {
            values: [
              {
                type: "TypeError",
                value: "Cannot read properties of undefined (reading 'user')",
                stacktrace: { frames: [{ filename: "src/app/checkout/actions.ts" }] }
              }
            ]
          }
        }
      }
    });

    expect(incident.title).toContain("Critical checkout incident");
    expect(incident.message).toBe("Checkout session path failed");
    expect(incident.severity).toBe("critical");
    expect(incident.context?.issueId).toBe("ISSUE-2");
    expect(incident.context?.eventId).toBe("EVENT-2");
    expect(incident.context?.project).toBe("gita-ai");
  });

  it("extracts Composio trigger metadata and provider payload", () => {
    const incident = normalizeSentryIncident({
      id: "trigger-log-1",
      meta: {
        provider: "sentry",
        triggerName: "SENTRY_NEW_ISSUE",
        triggerProviderPayload: JSON.stringify({
          issue: { id: "ISSUE-3", title: "Checkout trigger crash" },
          event: { event_id: "EVENT-3", level: "error", message: "Trigger payload worked" }
        })
      }
    });

    expect(incident.title).toBe("Checkout trigger crash");
    expect(incident.context?.eventId).toBe("EVENT-3");
    expect(incident.context?.triggerLogId).toBe("trigger-log-1");
    expect(incident.context?.triggerProvider).toBe("sentry");
    expect(incident.context?.triggerName).toBe("SENTRY_NEW_ISSUE");
  });

  it("verifies Composio webhook signatures when a secret is configured", () => {
    const body = JSON.stringify({ ok: true });
    const signature = createHmac("sha256", "secret").update(body).digest("hex");

    expect(verifyComposioWebhookSignature(body, `sha256=${signature}`, "secret")).toBe(true);
    expect(verifyComposioWebhookSignature(body, "sha256=deadbeef", "secret")).toBe(false);
    expect(verifyComposioWebhookSignature(body, null, "secret")).toBe(false);
  });
});
