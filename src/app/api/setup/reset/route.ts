import { NextResponse } from "next/server";
import { resetToolkitConnection } from "@/lib/composio";
import { REQUIRED_TOOLKITS, type Toolkit } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const toolkit = body?.toolkit as Toolkit;

    if (!REQUIRED_TOOLKITS.includes(toolkit)) {
      return NextResponse.json({ error: "Unsupported toolkit" }, { status: 400 });
    }

    const result = await resetToolkitConnection(toolkit);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reset Composio connection" },
      { status: 500 }
    );
  }
}
