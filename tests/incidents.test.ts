import { describe, expect, it } from "vitest";
import { normalizeSlackIncident, normalizeSentryIncident } from "@/lib/incidents";

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
      event: {
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
  });
});
