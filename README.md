# Incident PR Autopilot

Composio-first hackathon demo: an incident trigger creates a Linear issue, opens a GitHub PR with a deterministic patch, posts a Slack update, writes a Google Sheets audit row, and renders a judge-facing evidence console.

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, click **Setup**, then run the mock demo from the home page.

The app runs in mock mode when `COMPOSIO_API_KEY` is not set. Real execution uses Composio sessions and `session.execute(...)` through the shared `executeTool` wrapper.

## Connect Composio apps

1. Copy `.env.example` to `.env.local`.
2. Set `COMPOSIO_API_KEY`, `COMPOSIO_USER_ID`, and `COMPOSIO_MODE=real`.
3. Run `npm run dev`.
4. Open `/setup`.
5. Press **Connect** next to each missing toolkit and complete the hosted Composio auth flow.
6. Return to `/setup`; when all five toolkits show connected, run the demo.

The setup page calls Composio manual auth with `session.authorize(toolkit)` and redirects to the returned Connect Link.

## API

- `POST /api/demo/slack` starts the judge-safe Slack fallback flow.
- `POST /api/incidents/sentry` accepts a Sentry-like webhook payload.
- `GET /api/runs/:runId` returns the run ledger, steps, and artifacts.
- `GET /api/runs/:runId/export` returns the execution log JSON.
- `GET /api/setup/status` checks Composio readiness.
- `POST /api/setup/connect` creates a Composio Connect Link for a required toolkit.

## Test

```bash
npm test
npm run typecheck
```
