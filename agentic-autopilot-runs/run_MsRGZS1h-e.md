# Incident PR Autopilot Evidence

Run ID: run_MsRGZS1h-e
Incident: Critical checkout incident: Cannot read properties of undefined (reading 'user')
Fingerprint: b756ae76e42d0bfa1241f625
Severity: critical
Source: sentry
Sentry issue: gita-ai-real-sentry-0d300bb9f186f470669299caf80bab0b
Sentry event: 0d300bb9f186f470669299caf80bab0b
Environment: unknown
Release: unknown

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
