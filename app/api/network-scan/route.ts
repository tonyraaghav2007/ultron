import { NextResponse } from "next/server";
import { scanNetwork } from "@/lib/networkScan";

export async function GET() {
  try {
    const result = await scanNetwork({ activeScan: true });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Network scan error:", error);
    return NextResponse.json({ error: "Failed to scan network" }, { status: 500 });
  }
}
