# Incident PR Autopilot Evidence

Run ID: run_wS61Y-rRTm
Incident: Critical checkout incident: Cannot read properties of undefined (reading 'user')
Fingerprint: f1ad38edc2b0be76542baf46
Severity: critical
Source: sentry
Sentry issue: gita-ai-real-sentry-3d3ca1adf36404acfe3af5f0db166145
Sentry event: 3d3ca1adf36404acfe3af5f0db166145
Environment: production
Release: incident-pr-autopilot@20260609T033343Z

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
