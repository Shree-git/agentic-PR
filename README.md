# Incident PR Autopilot

Composio-first hackathon demo: an incident trigger creates a Linear issue, asks OpenRouter for a code fix, opens a GitHub PR, posts a Slack update, writes a Google Sheets audit row, and renders a judge-facing evidence console.

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, click **Setup**, then run the demo from the home page.

The app runs in mock mode when `COMPOSIO_API_KEY` is not set. Mock mode is for local development only. The judge demo CTA stays blocked until `/setup` reports real Composio mode, connected toolkits, non-placeholder target config, and preflight readiness.

Patch planning uses `OPENROUTER_API_KEY` when configured and defaults to `OPENROUTER_MODEL=deepseek/deepseek-v4-pro`. If OpenRouter is not configured or declines to patch, the worker falls back to the deterministic patch catalog.

## 90-second judge demo

Problem: incident response still requires a human to copy Sentry context into Linear, ask for a fix, open a GitHub PR, tell Slack, and preserve audit evidence. Incident PR Autopilot owns that workflow end to end.

Demo path:

1. Open `/setup` and show **Judge preflight**. Every required check must pass.
2. Return to `/` and click **Start incident-to-PR run**.
3. Watch `/runs/:runId` move through Normalize -> Patch validation -> Linear -> GitHub -> Sheets -> Slack -> Composio log hydration.
4. Open the proof bundle links: Linear issue, GitHub PR, Google Sheets row, Slack message, and hydrated Composio logs.
5. Click **Export JSON** and show the redacted execution trace with tool slugs, latency, attempts, artifacts, and Composio log evidence.

Winning proof:

- **Composio primary execution layer:** all external app actions go through `executeTool`, which calls `session.execute(...)`.
- **3+ apps:** Linear, GitHub, Slack, Google Sheets, plus Sentry trigger support.
- **Autonomous final action:** after the trigger, the agent creates/updates all artifacts without a final human click.
- **Auditability:** every external action stores a Composio log ID and the final hydration step stores redacted request/response evidence.
- **Safety:** OpenRouter patches pass a strict validation gate before GitHub writes. Snippets, unsafe paths, low confidence, malformed output, and mismatched diffs become investigation-only runs.

## Connect Composio apps

1. Copy `.env.example` to `.env.local`.
2. Set `COMPOSIO_API_KEY`, `COMPOSIO_USER_ID`, `OPENROUTER_API_KEY`, `COMPOSIO_MODE=real`, and all `DEMO_*` target IDs.
3. Run `npm run dev`.
4. Open `/setup`.
5. Press **Connect** next to each missing toolkit and complete the hosted Composio auth flow.
6. Return to `/setup`; when the connection matrix and judge preflight pass, run the demo.

The setup page calls Composio manual auth with `session.authorize(toolkit)` and redirects to the returned Connect Link.

For Sentry trigger demos, configure the Composio trigger webhook to `POST /api/incidents/sentry`. If `COMPOSIO_WEBHOOK_SECRET` is set, incoming trigger payloads must include a matching `sha256=` signature header.

## API

- `POST /api/demo/slack` starts the judge-safe Slack fallback flow.
- `POST /api/incidents/sentry` accepts Composio Sentry trigger payloads and legacy Sentry-like webhook payloads.
- `GET /api/runs/:runId` returns the run ledger, steps, and artifacts.
- `GET /api/runs/:runId/export` returns the execution log JSON.
- `GET /api/setup/status` checks Composio readiness.
- `POST /api/setup/connect` creates a Composio Connect Link for a required toolkit.

## Test

```bash
npm test
npm run typecheck
```
