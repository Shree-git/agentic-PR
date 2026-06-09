import { describe, expect, it } from "vitest";
import { validatePatchForPr } from "@/lib/patch-validation";
import type { PatchPlan } from "@/lib/patch-catalog";

const validPatch: PatchPlan = {
  id: "valid",
  title: "Fix checkout session guard",
  suspectedCause: "Checkout reads session.user.id without a guard.",
  confidence: "high",
  source: "openrouter",
  model: "test-model",
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
  afterSnippet: "if (!session?.user?.id) redirect('/login?next=/checkout');",
  diff: [
    "diff --git a/src/app/checkout/actions.ts b/src/app/checkout/actions.ts",
    "+import { redirect } from 'next/navigation';",
    "+export async function checkout(session: { user?: { id?: string } } | null) {",
    "+  if (!session?.user?.id) {",
    "+    redirect('/login?next=/checkout');",
    "+  }",
    "+  const userId = session.user.id;"
  ].join("\n"),
  validationNotes: ["Run npm test"],
  prBody: ""
};

describe("patch validation", () => {
  it("accepts a complete high-confidence replacement patch", () => {
    expect(validatePatchForPr(validPatch).ok).toBe(true);
  });

  it("rejects snippet-like replacement content", () => {
    const result = validatePatchForPr({
      ...validPatch,
      replacementContent: "if (!session?.user?.id) {\n  redirect('/login');\n}\nconst userId = session.user.id;"
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("SNIPPET_CONTENT");
  });

  it("rejects unsafe paths, low confidence, and mismatched diffs", () => {
    const result = validatePatchForPr({
      ...validPatch,
      confidence: "low",
      filePath: "../secrets.ts",
      diff: "diff --git a/other.ts b/other.ts\n+unrelated"
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["LOW_CONFIDENCE", "UNSAFE_PATH", "DIFF_MISMATCH"]));
  });
});
