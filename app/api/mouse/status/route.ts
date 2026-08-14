import { NextResponse } from "next/server";
import { globalMouseModeEnabled } from "@/lib/mouseClient";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ enabled: globalMouseModeEnabled });
}
