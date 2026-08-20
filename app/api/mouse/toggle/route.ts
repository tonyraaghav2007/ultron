import { NextResponse } from "next/server";
import { globalMouseModeEnabled, setMouseMode } from "@/lib/mouseClient";

export async function POST() {
  setMouseMode(!globalMouseModeEnabled);
  return NextResponse.json({ enabled: globalMouseModeEnabled });
}
