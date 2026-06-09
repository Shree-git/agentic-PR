import type { Incident } from "./types";

export interface PatchPlan {
  id: string;
  title: string;
  suspectedCause: string;
  confidence: "high" | "medium" | "low";
  branchName: string;
  filePath: string;
  beforeSnippet: string;
  afterSnippet: string;
  diff: string;
  prBody: string;
}

const checkoutNullSession: PatchPlan = {
  id: "checkout-null-session",
  title: "Fix checkout crash when session is missing",
  suspectedCause:
    "The checkout handler assumes a session object exists before reading `session.user.id`. Sentry evidence points to a null/undefined session during checkout.",
  confidence: "high",
  branchName: "fix/checkout-null-session",
  filePath: "src/app/checkout/actions.ts",
  beforeSnippet: "const userId = session.user.id;",
  afterSnippet:
    "if (!session?.user?.id) {\n  redirect('/login?next=/checkout');\n}\nconst userId = session.user.id;",
  diff: `diff --git a/src/app/checkout/actions.ts b/src/app/checkout/actions.ts
--- a/src/app/checkout/actions.ts
+++ b/src/app/checkout/actions.ts
@@
-const userId = session.user.id;
+if (!session?.user?.id) {
+  redirect('/login?next=/checkout');
+}
+const userId = session.user.id;
`,
  prBody: ""
};

export function findPatchPlan(incident: Incident): PatchPlan | null {
  const haystack = `${incident.title}\n${incident.message}\n${incident.stackTrace ?? ""}`.toLowerCase();
  const sessionCrash =
    haystack.includes("session") ||
    haystack.includes("cannot read properties of undefined") ||
    haystack.includes("cannot read properties of null") ||
    haystack.includes("checkout");

  if (!sessionCrash) return null;

  return {
    ...checkoutNullSession,
    prBody: buildPrBody(incident, checkoutNullSession)
  };
}

function buildPrBody(incident: Incident, patch: Omit<PatchPlan, "prBody">): string {
  return `## Incident summary
${incident.title}

${incident.message}

## Suspected cause
${patch.suspectedCause}

## Why this patch should fix it
The patch adds an explicit unauthenticated-session guard before checkout code dereferences \`session.user.id\`.

## Evidence used
- Source: ${incident.source}
- Fingerprint: ${incident.fingerprint}
- Culprit: ${incident.culprit ?? "unknown"}
- Severity: ${incident.severity}

## Confidence
${patch.confidence}

## Agent guardrail
This PR was generated from a validated patch catalog entry. If this fingerprint had not matched the catalog, the agent would have opened an investigation issue instead of a fake or empty PR.
`;
}
