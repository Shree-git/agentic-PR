import { NextResponse } from "next/server";
import { getLedger } from "@/lib/ledger";
import { buildRunIntegrationDetails } from "@/lib/worker";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const ledger = await getLedger();

  try {
    const bundle = ledger.getBundle(runId);
    const incident = ledger.getIncident(runId);
    const integrationDetails = buildRunIntegrationDetails({
      run: bundle.run,
      incident,
      bundle
    });

    return new NextResponse(JSON.stringify({ ...bundle, integrationDetails }, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="${runId}-run-log.json"`
      }
    });
  } catch {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
}
