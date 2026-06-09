import { NextResponse } from "next/server";
import { getLedger } from "@/lib/ledger";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const ledger = await getLedger();

  try {
    const bundle = ledger.getBundle(runId);
    return new NextResponse(JSON.stringify(bundle, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="${runId}-run-log.json"`
      }
    });
  } catch {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
}
