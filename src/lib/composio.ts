import { REQUIRED_TOOLKITS, type ReadinessCheck, type Toolkit, type ToolExecutionInput, type ToolResult } from "./types";
import { getLedger } from "./ledger";

const DEFAULT_TOOL_SLUGS = {
  linear_issue: "LINEAR_CREATE_ISSUE",
  github_pr: "GITHUB_CREATE_PULL_REQUEST",
  slack_update: "SLACK_SEND_MESSAGE",
  sheets_audit: "GOOGLESHEETS_APPEND_ROW"
} as const;

export async function checkReadiness(): Promise<ReadinessCheck> {
  const mode = getComposioMode();
  const userId = getComposioUserId();

  if (mode === "mock") {
    return {
      mode,
      ready: true,
      userId,
      toolkits: REQUIRED_TOOLKITS.map((toolkit) => ({ toolkit, connected: true, reason: "mock mode" }))
    };
  }

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

    return {
      mode,
      userId,
      ready: toolkits.every((toolkit) => toolkit.connected),
      toolkits
    };
  } catch (error) {
    return {
      mode,
      userId,
      ready: false,
      toolkits: REQUIRED_TOOLKITS.map((toolkit) => ({
        toolkit,
        connected: false,
        reason: error instanceof Error ? error.message : "Composio readiness check failed"
      }))
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

export function getComposioMode(): "mock" | "real" {
  if (process.env.COMPOSIO_MODE === "real") return "real";
  if (process.env.COMPOSIO_API_KEY && process.env.COMPOSIO_MODE !== "mock") return "real";
  return "mock";
}

export function getComposioUserId(): string {
  return process.env.COMPOSIO_USER_ID ?? "hackathon-demo-user";
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
