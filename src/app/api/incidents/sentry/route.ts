import { NextResponse } from "next/server";
import { normalizeSentryIncident, verifyComposioWebhookSignature } from "@/lib/incidents";
import { enqueueIncident } from "@/lib/worker";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature =
      request.headers.get("x-composio-signature") ??
      request.headers.get("composio-signature") ??
      request.headers.get("x-signature");

    if (!verifyComposioWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: "Invalid Composio webhook signature" }, { status: 401 });
    }

    const body = rawBody ? JSON.parse(rawBody) : {};
    const incident = normalizeSentryIncident(body);
    const result = await enqueueIncident(incident);

    return NextResponse.json({ runId: result.runId, created: result.created });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start Sentry incident run" },
      { status: 400 }
    );
  }
}
