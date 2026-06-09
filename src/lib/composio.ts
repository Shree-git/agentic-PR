import {
  REQUIRED_TOOLKITS,
  type ComposioLogEvidence,
  type ReadinessCheck,
  type Toolkit,
  type ToolExecutionInput,
  type ToolResult
} from "./types";
import { getLedger } from "./ledger";

export const DEFAULT_TOOL_SLUGS = {
  linear_issue: "LINEAR_CREATE_LINEAR_ISSUE",
  github_commit: "GITHUB_COMMIT_MULTIPLE_FILES",
  github_pr: "GITHUB_CREATE_A_PULL_REQUEST",
  slack_update: "SLACK_SEND_MESSAGE",
  sheets_audit: "GOOGLESHEETS_UPSERT_ROWS"
} as const;

export async function checkReadiness(): Promise<ReadinessCheck> {
  const mode = getComposioMode();
  const userId = getComposioUserId();

  if (mode === "mock") {
    return {
      mode,
      ready: true,
      judgeReady: false,
      userId,
      toolkits: REQUIRED_TOOLKITS.map((toolkit) => ({ toolkit, connected: true, reason: "mock mode" })),
      preflight: [
        {
          key: "mode",
          label: "Real Composio mode",
          ok: false,
          required: true,
          reason: "Judge demo requires COMPOSIO_MODE=real and live connected accounts."
        }
      ]
    };
  }

  const preflight = buildConfigPreflight();
  try {
    const { Composio } = await import("@composio/core");
    const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
    const session = await (composio as any).create(userId, { toolkits: [...REQUIRED_TOOLKITS] });
    const result = await session.toolkits();
    const items = Array.isArray(result?.items) ? result.items : [];
    const toolkits = REQUIRED_TOOLKITS.map((toolkit) => {
      const found = items.find((item: any) => item.slug === toolkit);
      return {
        toolkit,
        connected: Boolean(found?.connection?.isActive),
        reason: found?.connection?.isActive ? undefined : "not connected"
      };
    });
    preflight.push(...(await buildToolPreflight(session)));
    const ready = toolkits.every((toolkit) => toolkit.connected);
    const judgeReady = ready && preflight.every((item) => !item.required || item.ok);

    return {
      mode,
      userId,
      ready,
      judgeReady,
      toolkits,
      preflight
    };
  } catch (error) {
    return {
      mode,
      userId,
      ready: false,
      judgeReady: false,
      toolkits: REQUIRED_TOOLKITS.map((toolkit) => ({
        toolkit,
        connected: false,
        reason: error instanceof Error ? error.message : "Composio readiness check failed"
      })),
      preflight: [
        ...preflight,
        {
          key: "composio_session",
          label: "Composio session",
          ok: false,
          required: true,
          reason: error instanceof Error ? error.message : "Composio readiness check failed"
        }
      ]
    };
  }
}

export async function createConnectionLink(toolkit: Toolkit, callbackUrl?: string): Promise<string> {
  if (getComposioMode() === "mock") {
    throw new Error("Connection links are only available in real Composio mode.");
  }

  const { Composio } = await import("@composio/core");
  const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  const session = await (composio as any).create(getComposioUserId(), { toolkits: [toolkit] });
  const connectionRequest = await session.authorize(
    toolkit,
    callbackUrl ? { callbackUrl } : undefined
  );
  const redirectUrl = connectionRequest?.redirectUrl ?? connectionRequest?.redirect_url;

  if (!redirectUrl) {
    throw new Error(`Composio did not return a redirect URL for ${toolkit}.`);
  }

  return String(redirectUrl);
}

export async function executeTool(input: ToolExecutionInput): Promise<ToolResult> {
  const ledger = await getLedger();
  const started = Date.now();
  ledger.startStep(input);

  const attempts = [0, 1, 2];
  let lastFailure: ToolResult | null = null;

  for (const attempt of attempts) {
    const result = await executeOnce(input, started);
    if (result.ok) {
      ledger.finishStep({
        runId: input.runId,
        idempotencyKey: input.idempotencyKey,
        status: "success",
        latencyMs: result.latencyMs,
        composioLogId: result.logId,
        data: result.data
      });
      return result;
    }

    lastFailure = result;
    if (!result.retryable || attempt === attempts.length - 1) break;
    await delay(150 * Math.pow(2, attempt));
  }

  const failure = lastFailure ?? {
    ok: false as const,
    errorCode: "UNKNOWN",
    message: "Tool execution failed without a response",
    retryable: false,
    latencyMs: Date.now() - started
  };

  ledger.finishStep({
    runId: input.runId,
    idempotencyKey: input.idempotencyKey,
    status: "failed",
    latencyMs: failure.latencyMs,
    errorCode: failure.errorCode,
    message: failure.message,
    data: { arguments: input.arguments }
  });

  return failure;
}

async function executeOnce(input: ToolExecutionInput, started: number): Promise<ToolResult> {
  if (getComposioMode() === "mock") return executeMockTool(input, started);

  try {
    const { Composio } = await import("@composio/core");
    const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
    const session = await (composio as any).create(getComposioUserId(), {
      toolkits: [input.toolkit],
      preload: { tools: [input.toolSlug] }
    });
    const response = await session.execute(input.toolSlug, input.arguments);
    const latencyMs = Date.now() - started;

    if (response?.error) {
      return {
        ok: false,
        errorCode: classifyError(response.error),
        message: String(response.error),
        retryable: isRetryable(response.error),
        latencyMs
      };
    }

    return {
      ok: true,
      data: asRecord(response?.data),
      logId: response?.logId ?? `missing-log-${input.idempotencyKey}`,
      latencyMs
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      errorCode: classifyError(message),
      message,
      retryable: isRetryable(message),
      latencyMs: Date.now() - started
    };
  }
}

function executeMockTool(input: ToolExecutionInput, started: number): ToolResult {
  const now = Date.now();
  const base = `https://example.com/mock/${input.runId}`;
  const dataByStep: Record<string, Record<string, unknown>> = {
    linear_issue: {
      id: `LIN-${input.runId.slice(-4).toUpperCase()}`,
      url: `${base}/linear`,
      title: input.arguments.title
    },
    github_pr: {
      id: `PR-${input.runId.slice(-4).toUpperCase()}`,
      url: `${base}/github-pr`,
      number: 42,
      title: input.arguments.title
    },
    slack_update: {
      id: `SLACK-${input.runId.slice(-4).toUpperCase()}`,
      url: `${base}/slack`,
      channel: process.env.DEMO_SLACK_CHANNEL ?? "incident-response"
    },
    sheets_audit: {
      id: `SHEET-${input.runId.slice(-4).toUpperCase()}`,
      url: `${base}/sheet`,
      row: 7
    }
  };

  return {
    ok: true,
    data: dataByStep[input.step] ?? { id: input.idempotencyKey, url: base },
    logId: `mock-log-${input.idempotencyKey}`,
    latencyMs: now - started
  };
}

export function toolSlugFor(step: keyof typeof DEFAULT_TOOL_SLUGS): string {
  const envKey = `TOOL_${step.toUpperCase()}`;
  return process.env[envKey] ?? DEFAULT_TOOL_SLUGS[step];
}

export async function hydrateComposioLog(input: {
  logId: string;
  toolkit: Toolkit;
  toolSlug: string;
}): Promise<ComposioLogEvidence> {
  const apiPath = `/api/v3.1/logs/tool_execution/${input.logId}`;
  if (getComposioMode() === "mock" || input.logId.startsWith("mock-log-")) {
    return {
      logId: input.logId,
      toolkit: input.toolkit,
      toolSlug: input.toolSlug,
      status: "success",
      durationMs: null,
      requestSummary: { mode: "mock" },
      responseSummary: { mode: "mock" },
      apiPath,
      warning: "Mock execution log; not valid judge evidence."
    };
  }

  try {
    const { Composio } = await import("@composio/core");
    const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
    const raw = await (composio as any).logs?.tools?.retrieve?.(input.logId);
    if (!raw) throw new Error("Composio SDK did not expose logs.tools.retrieve");
    return redactComposioLog(input, raw, apiPath);
  } catch (error) {
    return {
      logId: input.logId,
      toolkit: input.toolkit,
      toolSlug: input.toolSlug,
      status: "unknown",
      durationMs: null,
      requestSummary: {},
      responseSummary: {},
      apiPath,
      warning: error instanceof Error ? error.message : "Failed to hydrate Composio log"
    };
  }
}

export function getComposioMode(): "mock" | "real" {
  if (process.env.COMPOSIO_MODE === "real") return "real";
  if (process.env.COMPOSIO_API_KEY && process.env.COMPOSIO_MODE !== "mock") return "real";
  return "mock";
}

export function getComposioUserId(): string {
  return process.env.COMPOSIO_USER_ID ?? "hackathon-demo-user";
}

function buildConfigPreflight(): ReadinessCheck["preflight"] {
  const requiredEnv: Array<[string, string | undefined]> = [
    ["COMPOSIO_API_KEY", process.env.COMPOSIO_API_KEY],
    ["COMPOSIO_USER_ID", process.env.COMPOSIO_USER_ID],
    ["DEMO_GITHUB_OWNER", process.env.DEMO_GITHUB_OWNER],
    ["DEMO_GITHUB_REPO", process.env.DEMO_GITHUB_REPO],
    ["DEMO_LINEAR_TEAM_ID or DEMO_LINEAR_TEAM", process.env.DEMO_LINEAR_TEAM_ID ?? process.env.DEMO_LINEAR_TEAM],
    ["DEMO_SLACK_CHANNEL", process.env.DEMO_SLACK_CHANNEL],
    ["DEMO_SHEET_ID", process.env.DEMO_SHEET_ID]
  ];

  return [
    {
      key: "mode",
      label: "Real Composio mode",
      ok: getComposioMode() === "real",
      required: true,
      reason: getComposioMode() === "real" ? undefined : "Set COMPOSIO_MODE=real for judge execution."
    },
    ...requiredEnv.map(([label, value]) => ({
      key: `env_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      label,
      ok: hasRealValue(label, value),
      required: true,
      reason: hasRealValue(label, value) ? undefined : `${label} is missing or still uses a demo placeholder.`
    }))
  ];
}

async function buildToolPreflight(session: any): Promise<ReadinessCheck["preflight"]> {
  const slugs = (Object.keys(DEFAULT_TOOL_SLUGS) as Array<keyof typeof DEFAULT_TOOL_SLUGS>).map((step) => toolSlugFor(step));
  try {
    const tools = typeof session.tools === "function" ? await session.tools() : null;
    const items = Array.isArray(tools?.items) ? tools.items : Array.isArray(tools) ? tools : [];
    if (!items.length) {
      return [
        {
          key: "tool_schema",
          label: "Tool schema availability",
          ok: true,
          required: false,
          reason: "Composio SDK did not return tool schema list; live execution will still preload tools."
        }
      ];
    }
    return slugs.map((slug) => {
      const found = items.some((item: any) => item.slug === slug || item.name === slug || item.key === slug);
      return {
        key: `tool_${slug}`,
        label: slug,
        ok: found,
        required: false,
        reason: found ? undefined : "Tool slug was not found in the session schema list; execution still preloads the slug at run time."
      };
    });
  } catch (error) {
    return [
      {
        key: "tool_schema",
        label: "Tool schema availability",
        ok: false,
        required: false,
        reason: error instanceof Error ? error.message : "Tool schema preflight failed"
      }
    ];
  }
}

function hasRealValue(label: string, value: unknown): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  if (label === "COMPOSIO_USER_ID") return true;
  const normalized = value.toLowerCase();
  if (normalized.includes("demo") || normalized.includes("example")) return false;
  if (label.includes("GITHUB_OWNER") && normalized === "demo-org") return false;
  if (label.includes("GITHUB_REPO") && normalized === "incident-fixtures") return false;
  if (label.includes("SHEET") && normalized === "demo-sheet") return false;
  return true;
}

function redactComposioLog(
  input: { logId: string; toolkit: Toolkit; toolSlug: string },
  raw: Record<string, unknown>,
  apiPath: string
): ComposioLogEvidence {
  return {
    logId: input.logId,
    toolkit: input.toolkit,
    toolSlug: input.toolSlug,
    status: normalizeLogStatus(raw.status),
    durationMs: durationFromLog(raw),
    requestSummary: limitRecord(redactValue(raw.payloadReceived ?? firstNetworkRequest(raw))),
    responseSummary: limitRecord(redactValue(raw.response ?? firstNetworkResponse(raw))),
    apiPath
  };
}

function normalizeLogStatus(value: unknown): ComposioLogEvidence["status"] {
  if (value === "success" || value === "failed" || value === "error" || value === "warning" || value === "info") {
    return value;
  }
  return "unknown";
}

function durationFromLog(raw: Record<string, unknown>): number | null {
  if (typeof raw.totalDuration === "number") return raw.totalDuration;
  if (typeof raw.totalDuration === "string") {
    const parsed = Number(raw.totalDuration.replace(/[^\d.]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof raw.startTime === "number" && typeof raw.endTime === "number") return raw.endTime - raw.startTime;
  return null;
}

function firstNetworkRequest(raw: Record<string, unknown>): unknown {
  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  for (const step of steps as Array<Record<string, unknown>>) {
    const logs = Array.isArray(step.logs) ? step.logs : [];
    const found = (logs as Array<Record<string, unknown>>).find((log) => log.request);
    if (found?.request) return found.request;
  }
  return {};
}

function firstNetworkResponse(raw: Record<string, unknown>): unknown {
  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  for (const step of steps as Array<Record<string, unknown>>) {
    const logs = Array.isArray(step.logs) ? step.logs : [];
    const found = (logs as Array<Record<string, unknown>>).find((log) => log.response);
    if (found?.response) return found.response;
  }
  return {};
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 10).map(redactValue);
  if (!value || typeof value !== "object") return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/authorization|token|secret|password|api[_-]?key|cookie/i.test(key)) {
      redacted[key] = "[redacted]";
    } else {
      redacted[key] = redactValue(item);
    }
  }
  return redacted;
}

function limitRecord(value: unknown): Record<string, unknown> {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : { value };
  const json = JSON.stringify(record);
  if (json.length <= 3000) return record;
  return {
    truncated: true,
    preview: json.slice(0, 3000)
  };
}

function classifyError(value: unknown): string {
  const message = String(value).toLowerCase();
  if (message.includes("401") || message.includes("auth") || message.includes("unauthorized")) return "AUTH";
  if (message.includes("429") || message.includes("rate")) return "RATE_LIMIT";
  if (message.includes("timeout") || message.includes("network")) return "NETWORK";
  if (message.includes("500") || message.includes("502") || message.includes("503")) return "UPSTREAM";
  return "TOOL_ERROR";
}

function isRetryable(value: unknown): boolean {
  const code = classifyError(value);
  return code === "RATE_LIMIT" || code === "NETWORK" || code === "UPSTREAM";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : { value };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
