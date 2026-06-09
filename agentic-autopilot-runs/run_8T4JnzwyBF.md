# Incident PR Autopilot Evidence

Run ID: run_8T4JnzwyBF
Incident: Sentry incident
Fingerprint: 9dc9cb30b977e68cb375d741
Severity: error
Source: sentry
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
