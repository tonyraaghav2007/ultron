import PDFDocument from "pdfkit";
import { Document, Paragraph, TextRun, Packer, HeadingLevel, AlignmentType } from "docx";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";

export interface DocumentRecord {
  id: string;
  filename: string;
  filePath: string;
  format: "pdf" | "docx";
  title?: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

const REGISTRY_PATH = path.join(process.cwd(), "knowledge_base", "document_registry.json");
let documentRegistry: DocumentRecord[] = [];

// Initialize registry from disk or scan Desktop
function initRegistry() {
  try {
    const kbDir = path.join(process.cwd(), "knowledge_base");
    if (!fs.existsSync(kbDir)) {
      fs.mkdirSync(kbDir, { recursive: true });
    }
    if (fs.existsSync(REGISTRY_PATH)) {
      const data = fs.readFileSync(REGISTRY_PATH, "utf-8");
      documentRegistry = JSON.parse(data);
    }
  } catch (e) {
    documentRegistry = [];
  }

  // Also scan user Desktop for any existing .docx or .pdf files to index them
  try {
    const desktopPath = path.join(os.homedir(), "Desktop");
    if (fs.existsSync(desktopPath)) {
      const files = fs.readdirSync(desktopPath);
      for (const file of files) {
        if (file.endsWith(".docx") || file.endsWith(".pdf")) {
          const filePath = path.join(desktopPath, file);
          const format = file.endsWith(".docx") ? "docx" : "pdf";
          const exists = documentRegistry.some(d => d.filePath.toLowerCase() === filePath.toLowerCase());
          if (!exists) {
            let extracted = "";
            if (format === "docx") {
              try {
                extracted = extractTextFromDocxSync(filePath);
              } catch {}
            }
            documentRegistry.push({
              id: `doc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              filename: file,
              filePath,
              format,
              content: extracted || `(Binary ${format.toUpperCase()} document on Desktop)`,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
          }
        }
      }
    }
  } catch (err) {
    console.error("Error scanning desktop documents:", err);
  }
}

// Call on startup
initRegistry();

function saveRegistry() {
  try {
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(documentRegistry, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save document registry:", e);
  }
}

export function extractTextFromDocxSync(filePath: string): string {
  try {
    const pyScript = path.join(process.cwd(), "lib", "docxReader.py");
    const out = execFileSync("python", [pyScript, filePath], { encoding: "utf-8", timeout: 8000 });
    return out.trim();
  } catch (e: any) {
    console.warn(`Docx text extraction failed for ${filePath}:`, e.message);
    return "";
  }
}

export async function extractDocumentText(filePath: string): Promise<string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  if (filePath.endsWith(".docx")) {
    const text = extractTextFromDocxSync(filePath);
    if (text) return text;
  }

  if (filePath.endsWith(".txt") || filePath.endsWith(".md") || filePath.endsWith(".json") || filePath.endsWith(".csv")) {
    return fs.readFileSync(filePath, "utf-8");
  }

  // Look up in registry
  const match = documentRegistry.find(d => d.filePath.toLowerCase() === filePath.toLowerCase());
  if (match && match.content) {
    return match.content;
  }

  return `[Content extracted from ${path.basename(filePath)}]`;
}

export function getActiveDocuments(): DocumentRecord[] {
  return documentRegistry;
}

export async function createDocument(
  content: string,
  format: "pdf" | "docx",
  filename: string,
  targetDir?: string
): Promise<string> {
  const dir = targetDir || path.join(os.homedir(), "Desktop");
  const baseName = filename.replace(/\.(pdf|docx)$/i, "");
  const finalFilename = `${baseName}.${format}`;
  const dest = path.join(dir, finalFilename);

  if (format === "pdf") {
    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(dest);
      doc.pipe(stream);
      
      const lines = content.split("\n");
      for (const line of lines) {
        if (line.startsWith("# ")) {
          doc.fontSize(18).text(line.replace("# ", "").trim(), { underline: true }).moveDown(0.5);
        } else if (line.startsWith("## ")) {
          doc.fontSize(14).text(line.replace("## ", "").trim()).moveDown(0.3);
        } else if (line.startsWith("### ")) {
          doc.fontSize(12).text(line.replace("### ", "").trim()).moveDown(0.2);
        } else if (line.trim().length === 0) {
          doc.moveDown(0.5);
        } else {
          doc.fontSize(11).text(line);
        }
      }
      doc.end();
      stream.on("finish", () => resolve());
      stream.on("error", reject);
    });
  } else {
    // Generate clean DOCX with structured paragraphs & headings
    const lines = content.split("\n");
    const paragraphs: Paragraph[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (line.startsWith("# ")) {
        paragraphs.push(new Paragraph({
          text: line.replace("# ", "").trim(),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 200, after: 100 }
        }));
      } else if (line.startsWith("## ")) {
        paragraphs.push(new Paragraph({
          text: line.replace("## ", "").trim(),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 150, after: 80 }
        }));
      } else if (line.startsWith("### ")) {
        paragraphs.push(new Paragraph({
          text: line.replace("### ", "").trim(),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 100, after: 50 }
        }));
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        paragraphs.push(new Paragraph({
          children: [new TextRun(line.substring(2))],
          bullet: { level: 0 },
          spacing: { after: 50 }
        }));
      } else {
        paragraphs.push(new Paragraph({
          children: [new TextRun(line)],
          spacing: { after: 100 }
        }));
      }
    }

    const doc = new Document({
      sections: [{
        properties: {},
        children: paragraphs
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(dest, buffer);
  }

  // Update or insert into registry
  const existingIdx = documentRegistry.findIndex(d => d.filePath.toLowerCase() === dest.toLowerCase());
  const now = new Date().toISOString();
  const record: DocumentRecord = {
    id: existingIdx >= 0 ? documentRegistry[existingIdx].id : `doc_${Date.now()}`,
    filename: finalFilename,
    filePath: dest,
    format,
    content,
    createdAt: existingIdx >= 0 ? documentRegistry[existingIdx].createdAt : now,
    updatedAt: now,
  };

  if (existingIdx >= 0) {
    documentRegistry[existingIdx] = record;
  } else {
    documentRegistry.push(record);
  }
  saveRegistry();

  return dest;
}

// Find document by index, name, or path
export function resolveDocument(identifier: string): DocumentRecord | null {
  const norm = identifier.trim().toLowerCase();

  // Try numerical index (1-based: "1", "2", "first", "second", etc.)
  if (norm === "1" || norm === "first" || norm === "1st" || norm === "the first one" || norm === "first one") {
    return documentRegistry[0] || null;
  }
  if (norm === "2" || norm === "second" || norm === "2nd" || norm === "the second one" || norm === "second one") {
    return documentRegistry[1] || null;
  }
  if (norm === "3" || norm === "third" || norm === "3rd") {
    return documentRegistry[2] || null;
  }
  if (norm === "latest" || norm === "last" || norm === "recent" || norm === "the latest one" || norm === "the last one") {
    return documentRegistry[documentRegistry.length - 1] || null;
  }

  // Exact path or filename match
  for (const doc of documentRegistry) {
    if (doc.filePath.toLowerCase() === norm || doc.filename.toLowerCase() === norm) {
      return doc;
    }
  }

  // Substring match
  for (const doc of documentRegistry) {
    const cleanDocName = doc.filename.toLowerCase().replace(/\.(docx|pdf)$/, "");
    if (cleanDocName.includes(norm) || norm.includes(cleanDocName)) {
      return doc;
    }
  }

  // Check if file exists directly on Desktop
  const desktopPath = path.join(os.homedir(), "Desktop");
  const candidates = [
    path.join(desktopPath, identifier),
    path.join(desktopPath, `${identifier}.docx`),
    path.join(desktopPath, `${identifier}.pdf`),
    identifier
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const format = c.endsWith(".pdf") ? "pdf" : "docx";
      let content = "";
      if (format === "docx") {
        content = extractTextFromDocxSync(c);
      }
      return {
        id: `disk_${Date.now()}`,
        filename: path.basename(c),
        filePath: c,
        format,
        content,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }
  }

  return null;
}

export async function editDocument(
  identifier: string,
  newContent: string,
  mode: "replace" | "append" | "prepend" = "replace"
): Promise<{ path: string; summary: string }> {
  const doc = resolveDocument(identifier);
  if (!doc) {
    // If not found, create it anew
    const dest = await createDocument(newContent, "docx", identifier);
    return {
      path: dest,
      summary: `Document '${identifier}' was not found, so I created it as a new document at ${dest}.`
    };
  }

  let finalContent = "";
  if (mode === "append") {
    finalContent = `${doc.content.trim()}\n\n${newContent.trim()}`;
  } else if (mode === "prepend") {
    finalContent = `${newContent.trim()}\n\n${doc.content.trim()}`;
  } else {
    finalContent = newContent;
  }

  // Overwrite the file at the existing path with updated content
  const dest = await createDocument(finalContent, doc.format, doc.filename, path.dirname(doc.filePath));

  return {
    path: dest,
    summary: `Successfully updated '${doc.filename}' (${mode} mode) at ${dest}. The original file was modified in-place.`
  };
}

export async function mergeDocuments(
  identifiers: string[],
  outputFilename: string,
  format: "pdf" | "docx" = "docx"
): Promise<{ path: string; summary: string }> {
  if (identifiers.length === 0) {
    throw new Error("No documents specified to merge.");
  }

  const resolvedDocs: DocumentRecord[] = [];
  for (const id of identifiers) {
    const doc = resolveDocument(id);
    if (doc) {
      // If content is empty, attempt extraction
      if (!doc.content && doc.filePath && fs.existsSync(doc.filePath)) {
        doc.content = await extractDocumentText(doc.filePath);
      }
      resolvedDocs.push(doc);
    }
  }

  if (resolvedDocs.length === 0) {
    throw new Error(`None of the requested documents (${identifiers.join(", ")}) could be found to merge.`);
  }

  // Combine contents with clear section headers
  const mergedSections: string[] = [];
  for (let i = 0; i < resolvedDocs.length; i++) {
    const doc = resolvedDocs[i];
    const headerTitle = doc.filename.replace(/\.(docx|pdf)$/i, "");
    mergedSections.push(`# Part ${i + 1}: ${headerTitle}\n\n${doc.content.trim()}`);
  }

  const mergedContent = mergedSections.join("\n\n" + "=".repeat(60) + "\n\n");
  const dest = await createDocument(mergedContent, format, outputFilename);

  const mergedNames = resolvedDocs.map(d => d.filename).join(" and ");
  return {
    path: dest,
    summary: `Successfully merged ${mergedNames} into a unified document saved at: ${dest}.`
  };
}
