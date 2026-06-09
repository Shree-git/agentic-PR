import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Incident } from "./types";

const sentrySchema = z.object({
  project: z.unknown().optional(),
  event: z
    .object({
      event_id: z.string().optional(),
      title: z.string().optional(),
      message: z.string().optional(),
      culprit: z.string().optional(),
      level: z.string().optional(),
      environment: z.string().optional(),
      release: z.unknown().optional(),
      tags: z.unknown().optional(),
      web_url: z.string().optional(),
      exception: z
        .object({
          values: z
            .array(
              z.object({
                type: z.string().optional(),
                value: z.string().optional(),
                stacktrace: z.unknown().optional()
              })
            )
            .optional()
        })
        .optional()
    })
    .optional(),
  issue: z
    .object({
      id: z.string().optional(),
      title: z.string().optional(),
      culprit: z.string().optional(),
      permalink: z.string().optional(),
      url: z.string().optional()
    })
    .optional()
});

const slackSchema = z.object({
  text: z.string().min(1),
  user_name: z.string().optional(),
  channel_name: z.string().optional()
});

export function normalizeSentryIncident(payload: unknown): Incident {
  const trigger = unwrapComposioTrigger(payload);
  const payloadBody = trigger?.providerPayload ?? payload;
  const parsed = sentrySchema.parse(unwrapSentryPayload(payloadBody));
  const event = parsed.event ?? {};
  const exception = event.exception?.values?.[0];
  const title = parsed.issue?.title ?? event.title ?? exception?.type ?? "Sentry incident";
  const message = event.message ?? exception?.value ?? title;
  const culprit = parsed.issue?.culprit ?? event.culprit;
  const stackTrace = JSON.stringify(exception?.stacktrace ?? payload, null, 2).slice(0, 4000);
  const stable = parsed.issue?.id ?? event.event_id ?? `${title}:${culprit ?? ""}:${message}`;

  return {
    source: "sentry",
    fingerprint: fingerprint(stable),
    title,
    severity: normalizeSeverity(event.level),
    message,
    culprit,
    stackTrace,
    context: {
      issueId: parsed.issue?.id,
      eventId: event.event_id,
      project: normalizeProject(parsed.project),
      environment: event.environment,
      release: normalizeRelease(event.release),
      url: parsed.issue?.permalink ?? parsed.issue?.url ?? event.web_url,
      triggerLogId: trigger?.logId,
      triggerProvider: trigger?.provider,
      triggerName: trigger?.name,
      tags: normalizeTags(event.tags)
    },
    raw: payload
  };
}

export function verifyComposioWebhookSignature(body: string, signature: string | null, secret = process.env.COMPOSIO_WEBHOOK_SECRET): boolean {
  if (!secret) return true;
  if (!signature) return false;

  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const candidates = signature
    .split(",")
    .map((item) => item.trim().replace(/^sha256=/, ""))
    .filter(Boolean);

  return candidates.some((candidate) => {
    try {
      const left = Buffer.from(candidate, "hex");
      const right = Buffer.from(expected, "hex");
      return left.length === right.length && timingSafeEqual(left, right);
    } catch {
      return false;
    }
  });
}

function unwrapSentryPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const record = payload as Record<string, unknown>;
  if (record.data && typeof record.data === "object") return record.data;
  return payload;
}

function unwrapComposioTrigger(payload: unknown): { providerPayload: unknown; logId?: string; provider?: string; name?: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const meta = record.meta && typeof record.meta === "object" ? (record.meta as Record<string, unknown>) : null;
  const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : null;
  const providerPayload = parseMaybeJson(
    firstDefined(record.triggerProviderPayload, record.payload, data?.payload, meta?.triggerProviderPayload, meta?.triggerClientPayload, record.data)
  );

  if (!providerPayload) return null;

  return {
    providerPayload,
    logId: firstString(record.logId, record.id, meta?.id, meta?.triggerNanoId),
    provider: firstString(record.provider, meta?.provider),
    name: firstString(record.triggerName, meta?.triggerName, record.name)
  };
}

export function normalizeSlackIncident(payload: unknown): Incident {
  const parsed = slackSchema.parse(payload);
  const title = parsed.text.slice(0, 90);

  return {
    source: "slack",
    fingerprint: fingerprint(`slack:${parsed.channel_name ?? "unknown"}:${parsed.text}`),
    title,
    severity: parsed.text.toLowerCase().includes("critical") ? "critical" : "error",
    message: parsed.text,
    culprit: parsed.user_name ? `reported by ${parsed.user_name}` : undefined,
    context: {
      project: parsed.channel_name,
      tags: parsed.channel_name ? { slack_channel: parsed.channel_name } : undefined
    },
    stackTrace: undefined,
    raw: payload
  };
}

function normalizeSeverity(level?: string): Incident["severity"] {
  if (level === "fatal" || level === "critical") return "critical";
  if (level === "warning") return "warning";
  if (level === "info" || level === "debug") return "info";
  return "error";
}

export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function normalizeProject(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return firstString(record.slug, record.name, record.id);
}

function normalizeRelease(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return firstString(record.version, record.shortVersion, record.name);
}

function normalizeTags(value: unknown): Record<string, string> | undefined {
  if (!value) return undefined;
  const tags: Record<string, string> = {};

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (Array.isArray(entry) && entry.length >= 2 && typeof entry[0] === "string") {
        tags[entry[0]] = String(entry[1]);
      } else if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        const key = firstString(record.key, record.name);
        if (key) tags[key] = String(record.value ?? record.val ?? "");
      }
    }
  } else if (typeof value === "object") {
    for (const [key, tagValue] of Object.entries(value)) {
      tags[key] = String(tagValue);
    }
  }

  return Object.keys(tags).length ? tags : undefined;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function firstString(...values: unknown[]): string | undefined {
  const found = values.find((value) => typeof value === "string" && value.length > 0);
  return found ? String(found) : undefined;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
