import PDFDocument from "pdfkit";
import { Document, Paragraph, TextRun, Packer } from "docx";
import fs from "fs";
import path from "path";
import os from "os";

export async function createDocument(content: string, format: "pdf" | "docx", filename: string): Promise<string> {
    const desktopPath = path.join(os.homedir(), "Desktop");
    
    if (format === "pdf") {
        const dest = path.join(desktopPath, filename.endsWith(".pdf") ? filename : filename + ".pdf");
        return new Promise((resolve, reject) => {
            const doc = new PDFDocument();
            const stream = fs.createWriteStream(dest);
            doc.pipe(stream);
            doc.fontSize(12).text(content);
            doc.end();
            stream.on("finish", () => resolve(dest));
            stream.on("error", reject);
        });
    } else {
        const dest = path.join(desktopPath, filename.endsWith(".docx") ? filename : filename + ".docx");
        const paragraphs = content.split("\n").map(line => {
            return new Paragraph({
                children: [new TextRun(line)]
            });
        });
        
        const doc = new Document({
            sections: [{
                properties: {},
                children: paragraphs
            }]
        });
        
        const buffer = await Packer.toBuffer(doc);
        fs.writeFileSync(dest, buffer);
        return dest;
    }
}
