import { NextResponse } from "next/server";
import { normalizeSlackIncident } from "@/lib/incidents";
import { enqueueIncident } from "@/lib/worker";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({
      text: "Critical checkout incident: Cannot read properties of undefined (reading 'user') in checkout session path"
    }));
    const incident = normalizeSlackIncident(body);
    const result = await enqueueIncident(incident);

    return NextResponse.json({ runId: result.runId, created: result.created });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start Slack demo run" },
      { status: 400 }
    );
  }
}
