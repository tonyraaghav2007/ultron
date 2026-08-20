import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

// --- Clipboard History ---
let clipboardHistory: string[] = [];
let isPollingClipboard = false;

async function fetchCurrentClipboard(): Promise<string> {
  try {
    if (os.platform() === "win32") {
      const { stdout } = await execAsync('powershell -command "Get-Clipboard"', { timeout: 2000 });
      return stdout.trim();
    } else if (os.platform() === "darwin") {
      const { stdout } = await execAsync("pbpaste", { timeout: 2000 });
      return stdout.trim();
    } else {
      const { stdout } = await execAsync("xclip -selection clipboard -o", { timeout: 2000 });
      return stdout.trim();
    }
  } catch {
    return "";
  }
}

export function startClipboardPoller() {
  if (isPollingClipboard) return;
  isPollingClipboard = true;

  setInterval(async () => {
    const text = await fetchCurrentClipboard();
    if (text && text.length > 0) {
      if (clipboardHistory.length === 0 || clipboardHistory[0] !== text) {
        clipboardHistory.unshift(text);
        if (clipboardHistory.length > 10) {
          clipboardHistory.pop();
        }
      }
    }
  }, 3000); // Check every 3 seconds
}

export function getClipboardHistory(): string[] {
  return clipboardHistory;
}

// --- App Launcher ---
export async function openApplication(target: string): Promise<string> {
  try {
    let cmd = "";
    if (os.platform() === "win32") {
      // Use powershell Start-Process to ensure it spawns visibly on the desktop
      cmd = `powershell -WindowStyle Hidden -Command "Start-Process '${target}'"`;
    } else if (os.platform() === "darwin") {
      cmd = `open "${target}"`;
    } else {
      cmd = `xdg-open "${target}"`;
    }
    await execAsync(cmd, { timeout: 5000 });
    return `Successfully opened ${target}`;
  } catch (error: any) {
    try {
        if (os.platform() === "win32") {
            await execAsync(`start ${target}`, { timeout: 5000 });
            return `Successfully opened ${target}`;
        }
    } catch {
        // ignore
    }
    return `Failed to open ${target}: ${error.message}`;
  }
}

// --- YouTube Control ---
export async function searchYoutube(query: string): Promise<string> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  return openApplication(url);
}

// --- Uptime Monitor ---
export async function checkWebsiteUptime(url: string): Promise<string> {
  try {
    if (!url.startsWith("http")) {
      url = "https://" + url;
    }
    const start = Date.now();
    const res = await fetch(url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(5000) });
    const ms = Date.now() - start;
    if (res.ok) {
      return `Website is UP. Response time: ${ms}ms. Status: ${res.status}`;
    } else {
      return `Website returned error status: ${res.status} ${res.statusText}`;
    }
  } catch (error: any) {
    return `Website appears to be DOWN or unreachable. Error: ${error.message}`;
  }
}

// --- Mouse Control ---
import { setMouseMode, globalMouseModeEnabled } from "./mouseClient";

export function toggleMouseMode(enabled: boolean): string {
  setMouseMode(enabled);
  return `Mouse mode is now ${enabled ? "ENABLED" : "DISABLED"}.`;
}

// --- File System Access ---
export function listDirectory(dirPath: string): string {
  try {
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      return `Error: ${dirPath} is not a directory.`;
    }
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    const items = files.map((file) => {
      return `${file.isDirectory() ? "[DIR]" : "[FILE]"} ${file.name}`;
    });
    return `Contents of ${dirPath}:\n` + items.join("\n");
  } catch (error: any) {
    return `Failed to list directory: ${error.message}`;
  }
}

export function readFileContent(filePath: string): string {
  try {
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      return `Error: ${filePath} is a directory. Use list_directory instead.`;
    }
    // Limit to 10,000 characters to avoid overwhelming the AI
    let content = fs.readFileSync(filePath, "utf-8");
    if (content.length > 10000) {
      content = content.substring(0, 10000) + "\n\n...[CONTENT TRUNCATED DUE TO LENGTH]...";
    }
    return content;
  } catch (error: any) {
    return `Failed to read file: ${error.message}`;
  }
}

// --- Web Search ---
import google from "googlethis";

export async function searchWeb(query: string): Promise<string> {
  try {
    const options = {
      page: 0, 
      safe: false, // Safe Search
      additional_params: {
        hl: 'en'
      }
    };
    
    const response = await google.search(query, options);
    
    if (!response || !response.results || response.results.length === 0) {
      // Check if there is a dictionary/knowledge panel result
      if (response.dictionary) {
          return `Definition: ${response.dictionary.word}\n${response.dictionary.phonetic}\n${(response.dictionary as any).meaning || ""}`;
      }
      if (response.knowledge_panel) {
          return `Knowledge: ${response.knowledge_panel.title}\n${response.knowledge_panel.description}`;
      }
      return "No results found on the web for that query.";
    }
    
    // Limit to top 5 results to save tokens
    const topResults = response.results.slice(0, 5).map((r, i) => {
        return `Result ${i + 1}:\nTitle: ${r.title}\nDescription: ${r.description}\n`;
    });
    
    let extra = "";
    if (response.dictionary) {
        extra += `Definition: ${response.dictionary.word}\n${(response.dictionary as any).meaning || ""}\n\n`;
    }
    if (response.knowledge_panel) {
        extra += `Knowledge Panel: ${response.knowledge_panel.title}\n${response.knowledge_panel.description}\n\n`;
    }
    
    return `Web Search Results for "${query}":\n\n${extra}${topResults.join("\n")}`;
  } catch (error: any) {
    return `Failed to search the web: ${error.message}`;
  }
}

// --- Website Builder ---
export async function generateWebsiteDesign(theme: string, userInput: string): Promise<string> {
  try {
    const prompt = encodeURIComponent(`Award-winning UI/UX web design landing page mockup for ${theme}, ${userInput}, modern sleek website interface, dribbble, behance, high resolution, professional typography, 4k desktop view`);
    const url = `https://image.pollinations.ai/prompt/${prompt}?width=1920&height=1080&nologo=true`;
    const imagePath = path.join(os.homedir(), "Desktop", "design_mockup.jpg");
    
    // Download image
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(imagePath, Buffer.from(buffer));

    // --- Intelligent Typography Selection ---
    const themeLower = (theme + " " + userInput).toLowerCase();
    let displayFont = "Clash Display";
    let bodyFont = "Satoshi";
    let typographyRationale = "Modern geometric sans-serif pairing for a clean, contemporary feel.";

    if (themeLower.match(/luxury|premium|fashion|boutique|jewelry|hotel/)) {
      displayFont = "Playfair Display";
      bodyFont = "Plus Jakarta Sans";
      typographyRationale = "High-contrast editorial serif paired with a refined geometric sans. Creates a luxurious, sophisticated personality.";
    } else if (themeLower.match(/restaurant|food|cafe|bakery|wine|dining/)) {
      displayFont = "Cormorant Garamond";
      bodyFont = "Lato";
      typographyRationale = "Elegant oldstyle serif with a warm humanist sans-serif. Evokes craftsmanship and hospitality.";
    } else if (themeLower.match(/tech|saas|startup|app|software|fintech|crypto/)) {
      displayFont = "Space Grotesk";
      bodyFont = "Inter";
      typographyRationale = "Technical grotesk with a highly legible UI font. Clean, precise, and trustworthy.";
    } else if (themeLower.match(/creative|agency|portfolio|art|design|studio/)) {
      displayFont = "Syne";
      bodyFont = "DM Sans";
      typographyRationale = "Expressive display typeface with a neutral companion. Signals creativity without sacrificing readability.";
    } else if (themeLower.match(/construction|industrial|automotive|manufacturing/)) {
      displayFont = "Oswald";
      bodyFont = "Source Sans 3";
      typographyRationale = "Condensed industrial heading font with a workmanlike body font. Strong, reliable, no-nonsense.";
    } else if (themeLower.match(/health|medical|wellness|spa|yoga|fitness/)) {
      displayFont = "Outfit";
      bodyFont = "Nunito Sans";
      typographyRationale = "Soft, rounded geometric fonts that feel approachable, calm, and trustworthy.";
    } else if (themeLower.match(/education|school|university|learn|course/)) {
      displayFont = "Fraunces";
      bodyFont = "Work Sans";
      typographyRationale = "Warm optical-size serif with a friendly sans. Feels academic but modern and accessible.";
    } else if (themeLower.match(/minimal|clean|simple|elegant/)) {
      displayFont = "Manrope";
      bodyFont = "Manrope";
      typographyRationale = "Single-family system for maximum minimalism. Weight contrast creates hierarchy without visual noise.";
    }

    // --- Intelligent Color Direction ---
    let colorDirection = "";
    if (themeLower.match(/luxury|premium|fashion|jewelry/)) {
      colorDirection = `- Background: #0A0A0A (rich black) or #FAF8F5 (warm ivory)
- Surface: #1A1A1A or #FFFFFF
- Primary Text: #F5F0EB or #1A1A1A  
- Secondary Text: #8A8580 (warm gray)
- Accent: #C9A96E (muted gold) — use sparingly on CTAs and key details only
- Interactive: accent with 10% opacity on hover backgrounds
- Avoid: bright neon colors, rainbow gradients, generic blue`;
    } else if (themeLower.match(/restaurant|food|cafe|bakery/)) {
      colorDirection = `- Background: #FBF8F3 (warm off-white) or #1C1917 (warm dark)
- Surface: #FFFFFF or #292524
- Primary Text: #1C1917 or #FAFAF9
- Secondary Text: #78716C (stone gray)
- Accent: #B45309 (warm amber) or #991B1B (deep red) — used on one CTA per section maximum
- Interactive: subtle background tint shifts on hover
- Avoid: cold blues, tech-startup neons, clinical whites`;
    } else if (themeLower.match(/tech|saas|fintech|crypto/)) {
      colorDirection = `- Background: #09090B (near-black) or #FAFAFA (cool white)
- Surface: #18181B or #FFFFFF with 1px border #E4E4E7
- Primary Text: #FAFAFA or #09090B
- Secondary Text: #71717A (zinc)
- Accent: #6366F1 (indigo) or #3B82F6 (blue) — only on primary CTAs and key data
- Interactive: ring focus states, subtle scale transforms
- Avoid: excessive gradients, glassmorphism overuse, neon green on black`;
    } else if (themeLower.match(/health|wellness|spa|yoga/)) {
      colorDirection = `- Background: #F5F5F0 (sage white) or #FEFCE8 (warm cream)
- Surface: #FFFFFF
- Primary Text: #1A2E1A (deep green) or #292524
- Secondary Text: #6B7280
- Accent: #4D7C0F (earthy green) or #0D9488 (teal)
- Interactive: gentle opacity transitions, no harsh state changes
- Avoid: aggressive reds, neon colors, dark moody themes`;
    } else {
      colorDirection = `- Choose a coherent palette based on the brand personality
- Define: background, surface, primary text, secondary text, accent, interactive states
- Use accent color intentionally — max 2-3 accent-colored elements per viewport
- Ensure minimum 4.5:1 contrast ratio for all text
- Avoid: generic blue/purple AI gradients, neon-on-black, excessive gradient backgrounds`;
    }

    // --- Layout Direction ---
    let layoutDirection = "";
    if (themeLower.match(/luxury|fashion|editorial|magazine/)) {
      layoutDirection = `- Asymmetric editorial grid with oversized photography
- Generous whitespace (section padding: 120-160px)
- Full-bleed hero with overlapping text
- Varied section densities — alternate dense and sparse sections
- Consider split layouts, offset columns, overlapping elements`;
    } else if (themeLower.match(/portfolio|agency|creative|studio/)) {
      layoutDirection = `- Dynamic asymmetric grid with intentional tension
- Large-scale project showcases with hover reveals
- Unusual grid breaks — not everything needs to be 12-column
- Mix horizontal scroll sections with vertical flow
- Consider masonry or bento-style layouts for work showcase`;
    } else if (themeLower.match(/saas|software|app|dashboard/)) {
      layoutDirection = `- Clean, structured grid with clear information hierarchy
- Feature sections with visual demonstrations (not just icon + text cards)
- Alternate between full-width and contained sections
- Use real UI previews or mockups instead of abstract illustrations
- Social proof section with logos, not generic "trusted by" text`;
    } else {
      layoutDirection = `- Design the layout around the STORY, not around components
- Do NOT default to: Hero → Three Cards → Features → Testimonials → Pricing → CTA → Footer
- Every section must answer: WHY DOES THIS SECTION EXIST?
- Vary section density and rhythm — not every section should feel the same
- Use the grid intentionally — break it when there is a reason to`;
    }

    // --- Build the comprehensive design spec ---
    const specContent = `# Website Design Specification

## Project Context
- **Theme**: ${theme}
- **Full Brief**: ${userInput}

---

## 1. Brand Personality & Creative Direction

Analyze the brief above and establish a SPECIFIC brand personality.
Do NOT default to "modern and clean." Choose from personalities like:
sophisticated, editorial, technical, playful, luxurious, brutalist, 
cinematic, minimal, energetic, experimental, warm, clinical, rebellious.

The website must feel like it was designed by an exceptional human designer
who deeply understood this specific brand — NOT like a template.

---

## 2. Typography System

**Display Font**: ${displayFont}
**Body Font**: ${bodyFont}
**Rationale**: ${typographyRationale}

Load from Google Fonts CDN. Define a complete type scale:

| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Hero Headline | 64-96px (clamp) | 700-800 | 1.0-1.1 | -0.02em |
| Section Headline | 40-56px (clamp) | 600-700 | 1.15 | -0.01em |
| Sub-headline | 24-32px | 500-600 | 1.3 | 0 |
| Body Large | 18-20px | 400 | 1.6 | 0.01em |
| Body | 16px | 400 | 1.6 | 0.01em |
| Caption/Label | 12-14px | 500 | 1.4 | 0.05em (uppercase) |

Typography IS the visual identity. Treat it as such.

---

## 3. Color Palette

${colorDirection}

Rules:
- Define all colors as CSS custom properties
- Create dark/light variants if appropriate for the brand
- Accent color appears on MAX 2-3 elements per viewport
- Use opacity and tints instead of new colors for states
- Test contrast ratios — WCAG AA minimum

---

## 4. Layout & Composition

${layoutDirection}

Anti-patterns to AVOID:
- Centered everything
- Identical card grids (3 cards, same size, same spacing)
- Excessive rounded corners on every element
- Generic glassmorphism backgrounds
- Floating decorative blobs or shapes with no purpose
- Identical spacing between every section
- Generic pill buttons everywhere

---

## 5. Content-Driven Sections

For EVERY section you build, answer: **"Why does this section exist?"**

Do NOT think: "Hero component." 
Think: "What must the user understand in the first 5 seconds?"

Do NOT think: "Three feature cards."
Think: "What is the strongest way to communicate these three ideas?"

If a section does not have a strong reason to exist, REMOVE IT.

---

## 6. Motion & Interaction Design

Motion must have a PURPOSE. Use for:
- Hierarchy (draw attention to what matters)
- Continuity (smooth transitions between states)
- Feedback (confirm user actions)
- Discovery (reveal content meaningfully)

Do NOT:
- Fade everything in on scroll
- Add bounce animations to every element
- Use loading spinners as decoration
- Animate things that don't need animation

Create 2-3 MEMORABLE interactions instead of 20 generic ones.
Respect \`prefers-reduced-motion\`.

---

## 7. Design System (Define BEFORE building components)

Create CSS custom properties for:
\`\`\`
--font-display, --font-body
--color-bg, --color-surface, --color-text, --color-text-secondary, --color-accent, --color-interactive
--space-xs (4px), --space-sm (8px), --space-md (16px), --space-lg (32px), --space-xl (64px), --space-2xl (128px)
--radius-sm, --radius-md, --radius-lg
--shadow-sm, --shadow-md, --shadow-lg
--container-sm (640px), --container-md (768px), --container-lg (1024px), --container-xl (1280px)
--transition-fast, --transition-normal, --transition-slow
\`\`\`

Build ALL components from this system. No ad-hoc styles.

---

## 8. Responsive Strategy

- Mobile-first CSS
- Breakpoints: 640px, 768px, 1024px, 1280px, 1536px
- Typography must scale fluidly (use clamp())
- Navigation must transform appropriately (hamburger on mobile)
- Touch targets minimum 44x44px on mobile
- Test at: 375px, 768px, 1024px, 1440px, 1920px

---

## 9. Implementation Requirements

- Semantic HTML5 (header, main, nav, section, article, footer)
- Full keyboard navigation
- ARIA labels where needed
- \`alt\` text on all images
- \`lang\` attribute on html
- Proper heading hierarchy (single h1, sequential h2-h6)
- Performance: minimize DOM depth, lazy-load images, efficient CSS

---

## 10. Visual QA Checklist (Builder MUST verify after building)

- [ ] Would an experienced human designer approve this?
- [ ] Does it look like a TEMPLATE or does it have PERSONALITY?
- [ ] Is there clear visual hierarchy? (primary → secondary → supporting)
- [ ] If I removed the logo, would I recognize this brand?
- [ ] Is typography intentional or default?
- [ ] Are there any generic AI patterns? (centered everything, blob backgrounds, identical cards)
- [ ] Does every section have a reason to exist?
- [ ] Is spacing consistent but varied where appropriate?
- [ ] Do interactions feel designed or bolted on?
- [ ] Does it work on mobile, tablet, and desktop?
`;
    const specPath = path.join(os.homedir(), "Desktop", "design_spec.md");
    fs.writeFileSync(specPath, specContent, "utf-8");

    await openApplication(imagePath);
    return `Successfully generated the design mockup image and opened it at ${imagePath}. Also saved a comprehensive design specification at ${specPath}. The user is looking at the image now.`;
  } catch (error: any) {
    return `Failed to generate design: ${error.message}`;
  }
}

export async function buildWebsiteWithAntigravity(specPath: string, outputDirName: string, customImagePath?: string): Promise<string> {
  try {
    // Automatically append timestamp to guarantee a new project and never overwrite
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const uniqueOutputDirName = `${outputDirName}_${timestamp}`;
    
    const outputDir = path.join(os.homedir(), "Desktop", uniqueOutputDirName);
    const builderScript = path.join(process.cwd(), "lib", "antigravity_builder.py");
    
    // Spawn the background script completely detached to prevent blocking the Next.js server
    const { spawn } = require("child_process");
    
    const args = ["/C", "start", "cmd.exe", "/K", `python "${builderScript}" --spec "${specPath}" --output-dir "${outputDir}"`];
    if (customImagePath) {
      args[4] += ` --image "${customImagePath}"`;
    }
    
    const child = spawn("cmd.exe", args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();
    return `Successfully spawned Antigravity agent. It is building the new website in ${outputDir} right now.`;
  } catch (error: any) {
    return `Failed to spawn Antigravity agent: ${error.message}`;
  }
}

// --- Document Generation ---
import { createDocument } from "./documentGenerator";
export async function generateDocument(content: string, format: "pdf" | "docx", filename: string): Promise<string> {
    try {
        const dest = await createDocument(content, format, filename);
        return `Successfully generated document and saved it to: ${dest}. Tell the user the document is ready on their desktop.`;
    } catch (e: any) {
        return `Failed to generate document: ${e.message}`;
    }
}

// --- Deep Research & Knowledge Base ---
import { searchKnowledge, getAllResearchJobs, getResearchJob, getResearchClaims, getResearchSources } from "./memoryDb";

export async function initiateDeepResearch(topic: string, mode: string = "standard"): Promise<string> {
    try {
        const researchScript = path.join(process.cwd(), "lib", "agents", "researchEngine.js");
        const { spawn } = require("child_process");
        
        // Sanitize the topic for command line
        const safeTopic = topic.replace(/"/g, '\\"');
        const safeMode = ["quick", "standard", "deep"].includes(mode) ? mode : "standard";
        
        const child = spawn("cmd.exe", ["/C", `node "${researchScript}" "${safeTopic}" "${safeMode}"`], {
            detached: true,
            stdio: "ignore",
            windowsHide: true
        });
        child.unref();
        
        const timeEstimates: Record<string, string> = {
            quick: "1-3 minutes",
            standard: "5-8 minutes",
            deep: "15-25 minutes"
        };
        
        return `Successfully spawned the Deep Research Engine in ${safeMode.toUpperCase()} mode to research: ${topic}. Estimated time: ${timeEstimates[safeMode]}. The research dashboard is now visible on the user's screen. Tell them the research is running in the background and they can keep talking to you while it works.`;
    } catch (error: any) {
        return `Failed to spawn research engine: ${error.message}`;
    }
}

export async function searchKnowledgeBase(query: string): Promise<string> {
    try {
        // First search the structured SQLite knowledge
        const { jobs, claims } = searchKnowledge(query);
        
        let results = "";
        
        if (jobs.length > 0) {
            results += "--- RESEARCH KNOWLEDGE FOUND ---\n";
            for (const job of jobs.slice(0, 3)) {
                results += `\n[TOPIC: ${job.topic}]\n`;
                results += `Researched: ${job.started_at} | Mode: ${job.mode} | Confidence: ${job.confidence}\n`;
                results += `Sources: ${job.source_count} (${job.primary_source_count} primary) | Claims: ${job.claim_count}\n`;
                if (job.summary) {
                    results += `Summary: ${job.summary.substring(0, 2000)}\n`;
                }
            }
        }
        
        if (claims.length > 0) {
            results += "\n--- RELEVANT CLAIMS ---\n";
            for (const claim of claims.slice(0, 15)) {
                results += `- [${claim.confidence.toUpperCase()}] ${claim.claim}\n`;
            }
        }
        
        // Also check the markdown knowledge base for backward compatibility
        if (!results) {
            const kbDir = path.join(process.cwd(), "knowledge_base");
            if (fs.existsSync(kbDir)) {
                const files = fs.readdirSync(kbDir);
                for (const file of files) {
                    if (file.endsWith(".md")) {
                        const content = fs.readFileSync(path.join(kbDir, file), "utf-8");
                        if (content.toLowerCase().includes(query.toLowerCase()) || file.toLowerCase().includes(query.toLowerCase())) {
                            results += `\n[From legacy knowledge: ${file}]:\n${content.substring(0, 2000)}...\n`;
                        }
                    }
                }
            }
        }
        
        return results || "No relevant information found in the knowledge base. I have not researched this topic yet.";
    } catch (error: any) {
        return `Failed to search knowledge base: ${error.message}`;
    }
}

export function getResearchLibrary(): string {
    try {
        const jobs = getAllResearchJobs();
        if (jobs.length === 0) return "The research library is empty. No topics have been researched yet.";
        
        let library = "--- JARVIS RESEARCH LIBRARY ---\n\n";
        for (const job of jobs) {
            const status = job.status === 'completed' ? '✓' : job.status === 'failed' ? '✗' : '●';
            library += `${status} ${job.topic}\n`;
            library += `  Mode: ${job.mode} | Status: ${job.status} | Confidence: ${job.confidence || 'N/A'}\n`;
            library += `  Sources: ${job.source_count} | Claims: ${job.claim_count} | Version: v${job.knowledge_version}\n`;
            library += `  Date: ${job.started_at}${job.duration_seconds ? ` | Duration: ${Math.ceil(job.duration_seconds / 60)}min` : ''}\n`;
            library += `  ID: ${job.id}\n\n`;
        }
        return library;
    } catch (error: any) {
        return `Failed to load research library: ${error.message}`;
    }
}

export function getResearchDetail(researchId: string): string {
    try {
        const job = getResearchJob(researchId);
        if (!job) return `No research found with ID: ${researchId}`;
        
        let detail = `--- RESEARCH DETAIL: ${job.topic} ---\n\n`;
        detail += `Status: ${job.status} | Mode: ${job.mode} | Confidence: ${job.confidence}\n`;
        detail += `Sources: ${job.source_count} (${job.primary_source_count} primary) | Claims: ${job.claim_count} | Contradictions: ${job.contradiction_count}\n`;
        detail += `Version: v${job.knowledge_version} | Date: ${job.started_at}\n\n`;
        
        if (job.summary) {
            detail += `SUMMARY:\n${job.summary.substring(0, 3000)}\n\n`;
        }
        
        const claims = getResearchClaims(researchId);
        if (claims.length > 0) {
            detail += `KEY CLAIMS:\n`;
            for (const c of claims.slice(0, 20)) {
                detail += `- [${c.confidence.toUpperCase()}] ${c.claim}\n`;
            }
            detail += '\n';
        }
        
        const sources = getResearchSources(researchId);
        if (sources.length > 0) {
            detail += `SOURCES:\n`;
            for (const s of sources) {
                detail += `- ${s.title} (${s.source_type}, authority: ${s.authority}${s.is_primary ? ', PRIMARY' : ''})\n  ${s.url}\n`;
            }
        }
        
        return detail;
    } catch (error: any) {
        return `Failed to load research detail: ${error.message}`;
    }
}

export async function showRouteMap(destination: string): Promise<string> {
    return `[UI_CMD:MAP:${destination}] Holographic map sequence initiated for ${destination}. The map is now visible on screen.`;
}

export async function openPdfInUi(pdfPath: string): Promise<string> {
    return `[UI_CMD:OPEN_PDF:${pdfPath}] I am projecting the document onto your interface now.`;
}

// --- Fitness Tracker ---
export { logLift, logBodyweight, getFitnessHistory, markWorkoutPromptCompleted, hasBeenPromptedForWorkoutToday } from "./fitnessMemory";

// --- Core Persistent Memory ---
export { addMemory as saveCoreMemory, searchMemories as searchCoreMemory, getAllMemories as getCoreMemories } from "./memoryDb";

