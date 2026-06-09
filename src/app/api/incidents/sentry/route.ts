import { NextResponse } from "next/server";
import { normalizeSentryIncident } from "@/lib/incidents";
import { enqueueIncident } from "@/lib/worker";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
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
