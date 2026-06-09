import { NextResponse } from "next/server";
import { checkReadiness } from "@/lib/composio";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await checkReadiness());
}
