import { createHash } from "node:crypto";
import { z } from "zod";
import type { Incident } from "./types";

const sentrySchema = z.object({
  event: z
    .object({
      event_id: z.string().optional(),
      title: z.string().optional(),
      message: z.string().optional(),
      culprit: z.string().optional(),
      level: z.string().optional(),
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
      culprit: z.string().optional()
    })
    .optional()
});

const slackSchema = z.object({
  text: z.string().min(1),
  user_name: z.string().optional(),
  channel_name: z.string().optional()
});

export function normalizeSentryIncident(payload: unknown): Incident {
  const parsed = sentrySchema.parse(payload);
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
    raw: payload
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
