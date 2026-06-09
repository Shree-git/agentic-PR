import { NextResponse } from "next/server";
import { createConnectionLink } from "@/lib/composio";
import { REQUIRED_TOOLKITS, type Toolkit } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const toolkit = body?.toolkit as Toolkit;

    if (!REQUIRED_TOOLKITS.includes(toolkit)) {
      return NextResponse.json({ error: "Unsupported toolkit" }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const redirectUrl = await createConnectionLink(toolkit, `${origin}/setup?connected=${toolkit}`);

    return NextResponse.json({ redirectUrl });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create Composio connection link" },
      { status: 500 }
    );
  }
}
