# Incident PR Autopilot

Composio-first hackathon demo: an incident trigger creates a Linear issue, opens a GitHub PR with a deterministic patch, posts a Slack update, writes a Google Sheets audit row, and renders a judge-facing evidence console.

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, click **Setup**, then run the mock demo from the home page.

The app runs in mock mode when `COMPOSIO_API_KEY` is not set. Real execution uses Composio sessions and `session.execute(...)` through the shared `executeTool` wrapper.

## API

- `POST /api/demo/slack` starts the judge-safe Slack fallback flow.
- `POST /api/incidents/sentry` accepts a Sentry-like webhook payload.
- `GET /api/runs/:runId` returns the run ledger, steps, and artifacts.
- `GET /api/runs/:runId/export` returns the execution log JSON.
- `GET /api/setup/status` checks Composio readiness.

## Test

```bash
npm test
npm run typecheck
```
