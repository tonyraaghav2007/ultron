import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
    try {
        const progressFile = path.join(process.cwd(), '.research_progress.json');
        if (fs.existsSync(progressFile)) {
            const data = fs.readFileSync(progressFile, "utf-8");
            const parsed = JSON.parse(data);
            // Return the full rich progress data from the new engine
            return NextResponse.json(parsed);
        } else {
            return NextResponse.json({ status: "idle" });
        }
    } catch (e) {
        return NextResponse.json({ status: "idle" });
    }
}
