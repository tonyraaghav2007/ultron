import { NextRequest, NextResponse } from "next/server";
import { sendMouseCommand } from "@/lib/mouseClient";

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    // data should contain { x, y, action }
    sendMouseCommand(data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Mouse API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
