import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const filePath = url.searchParams.get("path");
    
    if (!filePath) {
        return new NextResponse("No path provided", { status: 400 });
    }

    try {
        if (!fs.existsSync(filePath)) {
            return new NextResponse("File not found", { status: 404 });
        }
        
        const fileBuffer = fs.readFileSync(filePath);
        return new NextResponse(fileBuffer, {
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `inline; filename="${path.basename(filePath)}"`
            }
        });
    } catch (e: any) {
        return new NextResponse(e.message, { status: 500 });
    }
}
