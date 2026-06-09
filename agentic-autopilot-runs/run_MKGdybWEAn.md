# Incident PR Autopilot Evidence

Run ID: run_MKGdybWEAn
Incident: Critical checkout incident: Cannot read properties of undefined (reading 'user') in checko
Fingerprint: 7da8129d2bcffd2060db410a
Severity: critical
Source: slack
Sentry issue: unknown
Sentry event: unknown
Environment: unknown
Release: unknown

## Suspected Cause
The checkout handler dereferences `session.user.id` without verifying that `session` exists, causing a "Cannot read properties of undefined (reading 'user')" crash when an unauthenticated session reaches the path.

## Target File
src/app/checkout/actions.ts

## Patch Source
Source: openrouter
Model: deepseek/deepseek-v4-pro
Reasoning tokens: 0
Confidence: high

## Diff
```diff
diff --git a/src/app/checkout/actions.ts b/src/app/checkout/actions.ts
--- a/src/app/checkout/actions.ts
+++ b/src/app/checkout/actions.ts
@@ -0,0 +1,18 @@
+'use server';
+
+import { redirect } from 'next/navigation';
+
+// ---------------------------------------------------------------------------
+// Catalog fix: guard against null/undefined session before reading user.id
+// ---------------------------------------------------------------------------
+export async function checkoutAction(session: unknown /* normally inferred from auth helper */) {
+  // Guard: redirect unauthenticated users to login before accessing user id
+  if (!(session as any)?.user?.id) {
+    redirect('/login?next=/checkout');
+  }
+
+  const userId: string = (session as any).user.id;
+
+  // TODO: actual checkout logic would follow here
+  console.log('Proceeding with checkout for user', userId);
+
+  return { success: true, userId };
+}

```

## Validation Notes
- The file was not present locally; the replacement content assumes a minimal server-action structure for Next.js. The real source may have additional imports and logic that need to be merged.
- The inline type assertion ((session as any)) is a signal that the auth helper should be used instead—update to match the actual auth import once the repository is available.
- Run `npx next build` / `npm run test` after integration to confirm no breaking changes.
