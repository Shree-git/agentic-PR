# Incident PR Autopilot Evidence

Run ID: run_XZEkDv2kQE
Incident: Critical checkout incident: Cannot read properties of undefined (reading 'user') in checko
Fingerprint: 52df4e7e5e2641f02ef4dae1
Severity: critical
Source: slack
Sentry issue: unknown
Sentry event: unknown
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
