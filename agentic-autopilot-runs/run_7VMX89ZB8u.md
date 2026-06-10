# Incident PR Autopilot Evidence

Run ID: run_7VMX89ZB8u
Incident: Critical checkout incident: Cannot read properties of undefined (reading 'user') in checko
Fingerprint: ef1c5078182ba44f4d530428
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

## Patch Source
Source: catalog
Model: n/a
Reasoning tokens: n/a
Confidence: high

## Diff
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

## Validation Notes
- The patch came from a deterministic catalog fallback.
- Review and run the target repository tests before merge.
