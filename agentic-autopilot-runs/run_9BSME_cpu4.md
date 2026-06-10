# Incident PR Autopilot Evidence

Run ID: run_9BSME_cpu4
Incident: Critical checkout incident: Cannot read properties of undefined (reading 'user') in checko
Fingerprint: b0987afd69a19b981aba2984
Severity: critical
Source: slack

## Suspected Cause
The checkout handler assumes a session object exists before reading `session.user.id`. Sentry evidence points to a null/undefined session during checkout.

## Target File
src/app/checkout/actions.ts

## Validated Diff
```diff
diff --git a/src/app/checkout/actions.ts b/src/app/checkout/actions.ts
--- a/src/app/checkout/actions.ts
+++ b/src/app/checkout/actions.ts
@@
-const userId = session.user.id;
+if (!session?.user?.id) {
+  redirect('/login?next=/checkout');
+}
+const userId = session.user.id;

```
