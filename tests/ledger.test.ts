import { describe, expect, it } from "vitest";
import { RunLedger } from "@/lib/ledger";
import { normalizeSlackIncident } from "@/lib/incidents";

describe("run ledger", () => {
  it("deduplicates runs by incident fingerprint", async () => {
    const ledger = await RunLedger.open({ persistToDisk: false });
    const incident = normalizeSlackIncident({
      text: "Critical checkout incident: Cannot read properties of undefined (reading 'user')"
    });

    const first = ledger.createOrGetRun(incident);
    const second = ledger.createOrGetRun(incident);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
  });

  it("records step attempts under the same idempotency key", async () => {
    const ledger = await RunLedger.open({ persistToDisk: false });
    const incident = normalizeSlackIncident({ text: "checkout session crash" });
    const { run } = ledger.createOrGetRun(incident);

    ledger.startStep({
      runId: run.id,
      step: "linear_issue",
      toolkit: "linear",
      toolSlug: "LINEAR_CREATE_ISSUE",
      idempotencyKey: `${run.id}:linear_issue`
    });
    ledger.startStep({
      runId: run.id,
      step: "linear_issue",
      toolkit: "linear",
      toolSlug: "LINEAR_CREATE_ISSUE",
      idempotencyKey: `${run.id}:linear_issue`
    });

    const bundle = ledger.getBundle(run.id);
    expect(bundle.steps).toHaveLength(1);
    expect(bundle.steps[0]?.attempts).toBe(2);
  });
});
