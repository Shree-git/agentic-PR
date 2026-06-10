# Incident PR Autopilot Evidence

Run ID: run_80i8LhB7Fo
Incident: Critical checkout incident: Cannot read properties of undefined (reading 'user')
Fingerprint: 2776a75e5ec8865ed664c19e
Severity: critical
Source: sentry
Sentry issue: gita-ai-real-sentry-5d05697c2c4a1c5d78288dadfc33b2cf
Sentry event: 5d05697c2c4a1c5d78288dadfc33b2cf
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
