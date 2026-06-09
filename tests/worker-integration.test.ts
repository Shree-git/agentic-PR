import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunLedger, setLedgerForTests } from "@/lib/ledger";
import { normalizeSlackIncident } from "@/lib/incidents";
import type { PatchPlan } from "@/lib/patch-catalog";
import type { OpenRouterPatchResult } from "@/lib/openrouter";

const mocks = vi.hoisted(() => ({
  patchResult: null as OpenRouterPatchResult | null
}));

vi.mock("@/lib/openrouter", () => ({
  generateOpenRouterPatch: vi.fn(async () => {
    if (mocks.patchResult) return mocks.patchResult;
    return {
      patch: null,
      model: "test-model",
      reasoningTokens: null,
      rawResponse: "",
      skippedReason: "test default"
    };
  })
}));

const validPatch: PatchPlan = {
  id: "openrouter-valid",
  title: "Fix checkout session guard",
  suspectedCause: "Checkout reads session.user.id before checking the session.",
  confidence: "high",
  source: "openrouter",
  model: "test-model",
  reasoningTokens: 0,
  branchName: "fix/session-guard",
  filePath: "src/app/checkout/actions.ts",
  replacementContent: [
    "import { redirect } from 'next/navigation';",
    "",
    "export async function checkout(session: { user?: { id?: string } } | null) {",
    "  if (!session?.user?.id) {",
    "    redirect('/login?next=/checkout');",
    "  }",
    "  const userId = session.user.id;",
    "  return userId;",
    "}"
  ].join("\n"),
  beforeSnippet: "const userId = session.user.id;",
  afterSnippet: "guarded session",
  diff: "diff --git a/src/app/checkout/actions.ts b/src/app/checkout/actions.ts\n+import { redirect } from 'next/navigation';\n+export async function checkout(session: { user?: { id?: string } } | null) {\n+  if (!session?.user?.id) {",
  validationNotes: ["Run npm test"],
  prBody: ""
};

async function seedRun() {
  const ledger = await RunLedger.open({ persistToDisk: false });
  setLedgerForTests(ledger);
  const incident = normalizeSlackIncident({
    text: "Critical checkout incident: Cannot read properties of undefined (reading 'user') in checkout session path"
  });
  const { run } = ledger.createOrGetRun(incident);
  return { ledger, run };
}

describe("worker processRun", () => {
  beforeEach(() => {
    mocks.patchResult = null;
    setLedgerForTests(null);
    process.env.COMPOSIO_MODE = "mock";
    delete process.env.COMPOSIO_API_KEY;
  });

  it("runs the full mock execution path and hydrates mock Composio log evidence", async () => {
    mocks.patchResult = {
      patch: validPatch,
      model: "test-model",
      reasoningTokens: 0,
      rawResponse: "{}"
    };
    const { ledger, run } = await seedRun();
    const { processRun } = await import("@/lib/worker");

    await processRun(run.id);

    const bundle = ledger.getBundle(run.id);
    expect(bundle.run.status).toBe("complete");
    expect(bundle.steps.find((step) => step.step === "github_pr")?.status).toBe("success");
    expect(bundle.steps.find((step) => step.step === "composio_log_hydration")?.data).toMatchObject({
      logs: expect.arrayContaining([expect.objectContaining({ toolSlug: "LINEAR_CREATE_LINEAR_ISSUE" })])
    });
  });

  it("marks the run needs_auth when real Composio readiness fails", async () => {
    process.env.COMPOSIO_MODE = "real";
    const { ledger, run } = await seedRun();
    const { processRun } = await import("@/lib/worker");

    await processRun(run.id);

    const bundle = ledger.getBundle(run.id);
    expect(bundle.run.status).toBe("needs_auth");
    expect(bundle.run.errorMessage).toBeTruthy();
  });

  it("rejects snippet patches and finishes as investigation-only without opening a PR", async () => {
    mocks.patchResult = {
      patch: {
        ...validPatch,
        id: "snippet",
        replacementContent: "if (!session?.user?.id) {\n  redirect('/login');\n}\nconst userId = session.user.id;"
      },
      model: "test-model",
      reasoningTokens: 0,
      rawResponse: "{}"
    };
    const { ledger, run } = await seedRun();
    const { processRun } = await import("@/lib/worker");

    await processRun(run.id);

    const bundle = ledger.getBundle(run.id);
    expect(bundle.run.status).toBe("partial");
    expect(bundle.steps.find((step) => step.step === "patch_validation")?.status).toBe("skipped");
    expect(bundle.steps.find((step) => step.step === "github_pr")?.status).toBe("skipped");
  });
});
