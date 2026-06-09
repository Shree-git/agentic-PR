import { NextResponse } from "next/server";
import { getLedger } from "@/lib/ledger";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const ledger = await getLedger();

  try {
    return NextResponse.json(ledger.getBundle(runId));
  } catch {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
}
