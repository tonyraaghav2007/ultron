const fs = require('fs');
const path = require('path');
const google = require('googlethis');
const Groq = require('groq-sdk');
const PDFDocument = require('pdfkit');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const Database = require('better-sqlite3');
require('dotenv').config({ path: path.join(process.cwd(), '.env.local') });

// ===================== CONFIG =====================

const MODE_CONFIG = {
    quick:    { queries: 3,  maxArticles: 5,  selfCriticism: false, searchRounds: 1 },
    standard: { queries: 6,  maxArticles: 8,  selfCriticism: true,  searchRounds: 1 },
    deep:     { queries: 8,  maxArticles: 12, selfCriticism: true,  searchRounds: 2 },
};

const GROQ_MODELS = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.6-27b",
];

const FAST_MODELS = [
    "allam-2-7b",
    "qwen/qwen3.6-27b",
];

// ===================== PROGRESS =====================

const progressFile = path.join(process.cwd(), '.research_progress.json');

function updateProgress(data) {
    fs.writeFileSync(progressFile, JSON.stringify(data));
}

function setPhaseStatus(phases, phaseName, status) {
    const phase = phases.find(p => p.name === phaseName);
    if (phase) phase.status = status;
}

// ===================== AI HELPERS =====================

let groq;

async function groqCall(messages, { requireJson = false, useFast = false, maxTokens = 4096 } = {}) {
    const models = useFast ? FAST_MODELS : GROQ_MODELS;
    let lastErr;
    for (const model of models) {
        try {
            const opts = { model, messages, max_tokens: maxTokens, temperature: 0.3 };
            if (requireJson) opts.response_format = { type: "json_object" };
            const result = await groq.chat.completions.create(opts);
            return result.choices[0].message.content;
        } catch (e) {
            lastErr = e;
            console.log(`Error on ${model}: ${e.message}. Trying next...`);
            continue;
        }
    }
    throw lastErr;
}

// ===================== WEB READING =====================

async function readArticle(url) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });
        clearTimeout(timeoutId);

        const html = await res.text();
        const doc = new JSDOM(html, { url });
        const reader = new Readability(doc.window.document);
        const article = reader.parse();

        if (article && article.textContent) {
            return {
                title: article.title || '',
                content: article.textContent.replace(/\s+/g, ' ').substring(0, 10000),
                url
            };
        }
    } catch (e) {
        console.log(`Failed to read ${url}: ${e.message}`);
    }
    return null;
}

async function searchGoogle(query) {
    try {
        const response = await google.search(query, { page: 0, safe: false, additional_params: { hl: 'en' } });
        if (response.results) {
            return response.results.slice(0, 5).map(r => ({ url: r.url, title: r.title, description: r.description }));
        }
    } catch (e) {
        console.log(`Search failed for "${query}": ${e.message}`);
    }
    return [];
}

// ===================== DATABASE =====================

function getDb() {
    const dbPath = path.join(process.cwd(), 'data', 'jarvis.db');
    return new Database(dbPath);
}

function dbCreateJob(db, id, topic, mode, originalRequest) {
    // Ensure tables exist
    db.exec(`CREATE TABLE IF NOT EXISTS research_jobs (
        id TEXT PRIMARY KEY, topic TEXT NOT NULL, original_request TEXT, mode TEXT DEFAULT 'standard',
        status TEXT DEFAULT 'pending', research_plan TEXT, summary TEXT,
        source_count INTEGER DEFAULT 0, primary_source_count INTEGER DEFAULT 0,
        claim_count INTEGER DEFAULT 0, contradiction_count INTEGER DEFAULT 0,
        confidence TEXT DEFAULT 'medium', pdf_path TEXT, knowledge_version INTEGER DEFAULT 1,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME, duration_seconds INTEGER
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS research_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT, research_id TEXT NOT NULL, claim TEXT NOT NULL,
        category TEXT, confidence TEXT DEFAULT 'medium', supported_by TEXT, contradicted_by TEXT,
        resolution TEXT, tags TEXT DEFAULT ''
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS research_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT, research_id TEXT NOT NULL, url TEXT NOT NULL,
        title TEXT, author TEXT, publisher TEXT, source_type TEXT, authority TEXT DEFAULT 'medium',
        relevance TEXT DEFAULT 'medium', is_primary INTEGER DEFAULT 0,
        retrieved_at DATETIME DEFAULT CURRENT_TIMESTAMP, excerpt TEXT
    )`);

    const existing = db.prepare('SELECT MAX(knowledge_version) as max_v FROM research_jobs WHERE topic = ?').get(topic);
    const version = ((existing && existing.max_v) || 0) + 1;
    db.prepare(`INSERT INTO research_jobs (id, topic, original_request, mode, status, knowledge_version) VALUES (?, ?, ?, ?, 'planning', ?)`).run(id, topic, originalRequest, mode, version);
}

function dbUpdateJob(db, id, updates) {
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
        if (key !== 'id') { fields.push(`${key} = ?`); values.push(value); }
    }
    if (fields.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE research_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

function dbAddSource(db, researchId, url, title, sourceType, authority, isPrimary, excerpt) {
    db.prepare(`INSERT INTO research_sources (research_id, url, title, source_type, authority, is_primary, excerpt) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(researchId, url, title || '', sourceType || 'unknown', authority || 'medium', isPrimary ? 1 : 0, (excerpt || '').substring(0, 2000));
}

function dbAddClaim(db, researchId, claim, category, confidence, supportedBy, contradictedBy, resolution, tags) {
    db.prepare(`INSERT INTO research_claims (research_id, claim, category, confidence, supported_by, contradicted_by, resolution, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(researchId, claim, category || 'fact', confidence || 'medium', JSON.stringify(supportedBy || []), JSON.stringify(contradictedBy || []), resolution || '', (tags || []).join(','));
}

// ===================== MAIN ENGINE =====================

async function main() {
    const topic = process.argv[2];
    const mode = process.argv[3] || 'standard';
    if (!topic) { console.error("No topic provided."); process.exit(1); }

    const config = MODE_CONFIG[mode] || MODE_CONFIG.standard;
    const startTime = Date.now();
    const researchId = `res_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${topic.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 30)}`;

    const phases = [
        { name: "Planning research", status: "pending" },
        { name: "Searching the web", status: "pending" },
        { name: "Reading sources", status: "pending" },
        { name: "Evaluating sources", status: "pending" },
        { name: "Extracting claims", status: "pending" },
        { name: "Detecting contradictions", status: "pending" },
        ...(config.selfCriticism ? [{ name: "Self-criticism", status: "pending" }] : []),
        { name: "Synthesizing knowledge", status: "pending" },
        { name: "Generating report", status: "pending" },
        { name: "Storing knowledge", status: "pending" },
    ];

    const progress = {
        researchId,
        topic,
        mode,
        status: "planning",
        phase: "Initializing...",
        sourcesDiscovered: 0,
        sourcesRead: 0,
        claimsExtracted: 0,
        contradictions: 0,
        elapsed: 0,
        phases
    };

    const db = getDb();

    try {
        groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

        // Create job in database
        dbCreateJob(db, researchId, topic, mode, topic);

        // ========== PHASE 1: PLANNING ==========
        setPhaseStatus(phases, "Planning research", "active");
        progress.status = "planning";
        progress.phase = "Creating research plan...";
        updateProgress(progress);

        const planResult = await groqCall([
            { role: "system", content: `You are a master research planner. Given a topic, generate a comprehensive research plan. Return ONLY a JSON object with: { "researchQuestions": ["string"], "subtopics": ["string"], "searchQueries": ["string"] }. Generate ${config.queries} highly specific search queries. Generate 8-12 research questions that cover the topic thoroughly. Do NOT include generic questions.` },
            { role: "user", content: `Topic: ${topic}` }
        ], { requireJson: true, useFast: true });

        let plan;
        try {
            plan = JSON.parse(planResult);
        } catch {
            plan = { researchQuestions: [`What is ${topic}?`], subtopics: [topic], searchQueries: [topic, `${topic} explained`, `${topic} technical details`] };
        }

        const queries = (plan.searchQueries || []).slice(0, config.queries);
        if (queries.length === 0) queries.push(topic);

        dbUpdateJob(db, researchId, { research_plan: JSON.stringify(plan), status: 'researching' });
        setPhaseStatus(phases, "Planning research", "done");

        // ========== PHASE 2: MULTI-SOURCE SEARCH ==========
        setPhaseStatus(phases, "Searching the web", "active");
        progress.status = "researching";
        progress.phase = "Searching multiple sources...";
        updateProgress(progress);

        let allSearchResults = [];
        const seenUrls = new Set();

        for (let round = 0; round < config.searchRounds; round++) {
            for (let i = 0; i < queries.length; i++) {
                progress.phase = `Searching: "${queries[i].substring(0, 40)}"`;
                progress.elapsed = Math.floor((Date.now() - startTime) / 1000);
                updateProgress(progress);

                const results = await searchGoogle(queries[i]);
                for (const r of results) {
                    if (!seenUrls.has(r.url)) {
                        seenUrls.add(r.url);
                        allSearchResults.push(r);
                    }
                }
                progress.sourcesDiscovered = allSearchResults.length;
                updateProgress(progress);

                await new Promise(r => setTimeout(r, 1500));
            }
        }

        setPhaseStatus(phases, "Searching the web", "done");

        // ========== PHASE 3: READING SOURCES ==========
        setPhaseStatus(phases, "Reading sources", "active");
        const urlsToRead = allSearchResults.slice(0, config.maxArticles);
        const articles = [];

        for (let i = 0; i < urlsToRead.length; i++) {
            progress.phase = `Reading source ${i + 1}/${urlsToRead.length}`;
            progress.elapsed = Math.floor((Date.now() - startTime) / 1000);
            updateProgress(progress);

            const article = await readArticle(urlsToRead[i].url);
            if (article) {
                article.searchTitle = urlsToRead[i].title;
                article.searchDescription = urlsToRead[i].description;
                articles.push(article);
                progress.sourcesRead = articles.length;
                updateProgress(progress);
            }

            await new Promise(r => setTimeout(r, 1000));
        }

        setPhaseStatus(phases, "Reading sources", "done");

        // ========== PHASE 4: SOURCE EVALUATION ==========
        setPhaseStatus(phases, "Evaluating sources", "active");
        progress.phase = "Evaluating source quality...";
        progress.elapsed = Math.floor((Date.now() - startTime) / 1000);
        updateProgress(progress);

        const sourceEvalPrompt = articles.map((a, i) => `Source ${i + 1}: URL=${a.url} | Title=${a.title} | Content preview: ${a.content.substring(0, 500)}`).join('\n\n');

        let evaluations = [];
        try {
            const evalResult = await groqCall([
                { role: "system", content: `You are a source evaluation expert. For each source, determine: type (official/academic/publication/blog/forum/news), authority (high/medium/low), is_primary (true/false). Return ONLY a JSON object: { "sources": [{ "index": 0, "type": "string", "authority": "string", "is_primary": boolean }] }` },
                { role: "user", content: `Evaluate these sources for a research project on "${topic}":\n\n${sourceEvalPrompt}` }
            ], { requireJson: true, useFast: true });
            const parsed = JSON.parse(evalResult);
            evaluations = parsed.sources || [];
        } catch {
            evaluations = articles.map((_, i) => ({ index: i, type: 'unknown', authority: 'medium', is_primary: false }));
        }

        // Store sources in database
        for (let i = 0; i < articles.length; i++) {
            const ev = evaluations.find(e => e.index === i) || { type: 'unknown', authority: 'medium', is_primary: false };
            dbAddSource(db, researchId, articles[i].url, articles[i].title, ev.type, ev.authority, ev.is_primary, articles[i].content.substring(0, 2000));
        }

        const primaryCount = evaluations.filter(e => e.is_primary).length;
        dbUpdateJob(db, researchId, { source_count: articles.length, primary_source_count: primaryCount });

        setPhaseStatus(phases, "Evaluating sources", "done");

        // ========== PHASE 5: CLAIM EXTRACTION ==========
        setPhaseStatus(phases, "Extracting claims", "active");
        progress.phase = "Extracting verifiable claims...";
        progress.elapsed = Math.floor((Date.now() - startTime) / 1000);
        updateProgress(progress);

        const compiledArticleText = articles.map((a, i) => `[SOURCE ${i + 1}: ${a.title}]\n${a.content.substring(0, 4000)}`).join('\n\n---\n\n');

        let allClaims = [];
        try {
            const claimResult = await groqCall([
                { role: "system", content: `You are a research analyst. Extract atomic, verifiable claims from the provided sources. For each claim, identify which source(s) support it, and your confidence level. Return ONLY JSON: { "claims": [{ "claim": "string", "category": "fact|statistic|definition|comparison|opinion", "confidence": "high|medium|low", "supported_by": [1, 2], "tags": ["string"] }] }. Extract 15-30 claims covering the most important information.` },
                { role: "user", content: `Topic: ${topic}\n\nSources:\n${compiledArticleText.substring(0, 20000)}` }
            ], { requireJson: true, maxTokens: 4096 });
            const parsed = JSON.parse(claimResult);
            allClaims = parsed.claims || [];
        } catch (e) {
            console.log("Claim extraction error:", e.message);
            allClaims = [];
        }

        progress.claimsExtracted = allClaims.length;
        updateProgress(progress);
        setPhaseStatus(phases, "Extracting claims", "done");

        // ========== PHASE 6: CONTRADICTION DETECTION ==========
        setPhaseStatus(phases, "Detecting contradictions", "active");
        progress.phase = "Checking for contradictions...";
        progress.elapsed = Math.floor((Date.now() - startTime) / 1000);
        updateProgress(progress);

        let contradictions = [];
        if (allClaims.length > 2) {
            try {
                const claimList = allClaims.map((c, i) => `${i + 1}. [${c.confidence}] ${c.claim}`).join('\n');
                const contradictionResult = await groqCall([
                    { role: "system", content: `You are a fact-checker. Examine these claims and identify any contradictions or disagreements. For each contradiction, attempt to resolve it. Return ONLY JSON: { "contradictions": [{ "claim_a_index": 0, "claim_b_index": 1, "description": "string", "resolution": "string", "resolved": boolean }] }. If no contradictions, return { "contradictions": [] }.` },
                    { role: "user", content: `Topic: ${topic}\n\nClaims:\n${claimList}` }
                ], { requireJson: true, useFast: true });
                const parsed = JSON.parse(contradictionResult);
                contradictions = parsed.contradictions || [];
            } catch {
                contradictions = [];
            }
        }

        progress.contradictions = contradictions.length;
        updateProgress(progress);

        // Store claims in database
        for (const claim of allClaims) {
            const idx = allClaims.indexOf(claim);
            const contradicted = contradictions.filter(c => c.claim_a_index === idx || c.claim_b_index === idx).map(c => c.description);
            const resolution = contradictions.find(c => (c.claim_a_index === idx || c.claim_b_index === idx) && c.resolution)?.resolution || '';
            dbAddClaim(db, researchId, claim.claim, claim.category, claim.confidence, claim.supported_by?.map(s => `source_${s}`) || [], contradicted.length > 0 ? contradicted : [], resolution, claim.tags || []);
        }

        dbUpdateJob(db, researchId, { claim_count: allClaims.length, contradiction_count: contradictions.length });
        setPhaseStatus(phases, "Detecting contradictions", "done");

        // ========== PHASE 7: SELF-CRITICISM (deep/standard only) ==========
        let additionalFindings = '';
        if (config.selfCriticism) {
            setPhaseStatus(phases, "Self-criticism", "active");
            progress.phase = "Challenging findings...";
            progress.elapsed = Math.floor((Date.now() - startTime) / 1000);
            updateProgress(progress);

            try {
                const criticResult = await groqCall([
                    { role: "system", content: `You are a research critic. Given these findings about "${topic}", identify weaknesses. Return ONLY JSON: { "weaknesses": ["string"], "additional_queries": ["string"] }. Ask: What could be wrong? What sources are missing? Which claims are based on only one source?` },
                    { role: "user", content: `Claims found:\n${allClaims.map(c => `- [${c.confidence}] ${c.claim}`).join('\n')}\n\nContradictions: ${contradictions.length}\nSources: ${articles.length}` }
                ], { requireJson: true, useFast: true });
                const parsed = JSON.parse(criticResult);
                const additionalQueries = (parsed.additional_queries || []).slice(0, 3);

                if (additionalQueries.length > 0) {
                    progress.phase = "Additional research from self-criticism...";
                    updateProgress(progress);

                    for (const q of additionalQueries) {
                        const results = await searchGoogle(q);
                        for (const r of results.slice(0, 2)) {
                            if (!seenUrls.has(r.url)) {
                                seenUrls.add(r.url);
                                const article = await readArticle(r.url);
                                if (article) {
                                    additionalFindings += `\n\n[ADDITIONAL SOURCE: ${article.title}]\n${article.content.substring(0, 3000)}`;
                                    dbAddSource(db, researchId, article.url, article.title, 'supplementary', 'medium', false, article.content.substring(0, 2000));
                                    progress.sourcesRead++;
                                    updateProgress(progress);
                                }
                            }
                        }
                        await new Promise(r => setTimeout(r, 1500));
                    }
                }
            } catch (e) {
                console.log("Self-criticism error:", e.message);
            }

            setPhaseStatus(phases, "Self-criticism", "done");
        }

        // ========== PHASE 8: SYNTHESIS ==========
        setPhaseStatus(phases, "Synthesizing knowledge", "active");
        progress.status = "synthesizing";
        progress.phase = "Synthesizing all findings...";
        progress.elapsed = Math.floor((Date.now() - startTime) / 1000);
        updateProgress(progress);

        const claimsSummary = allClaims.map(c => `- [${c.confidence.toUpperCase()}] ${c.claim}`).join('\n');
        const contradictionsSummary = contradictions.length > 0
            ? contradictions.map(c => `- ${c.description} => ${c.resolved ? 'RESOLVED: ' + c.resolution : 'UNRESOLVED'}`).join('\n')
            : 'None found.';
        const sourceList = articles.map((a, i) => `${i + 1}. ${a.title} (${a.url})`).join('\n');

        const synthesisResult = await groqCall([
            { role: "system", content: `You are an elite research synthesizer. Take the extracted claims, contradictions, and additional findings, and produce a comprehensive EXECUTIVE SUMMARY of the research (3-5 paragraphs). Then produce DETAILED FINDINGS organized by logical subtopics. Distinguish between what is KNOWN (high confidence), PROBABLE (medium confidence), and UNCERTAIN (low confidence). This will become the core knowledge stored permanently. Write as a subject matter expert, not as an AI.` },
            { role: "user", content: `TOPIC: ${topic}\n\nEXTRACTED CLAIMS:\n${claimsSummary}\n\nCONTRADICTIONS:\n${contradictionsSummary}\n\nADDITIONAL FINDINGS:\n${additionalFindings || 'None.'}\n\nSOURCES:\n${sourceList}` }
        ], { maxTokens: 6000 });

        setPhaseStatus(phases, "Synthesizing knowledge", "done");

        // ========== PHASE 9: PDF GENERATION ==========
        setPhaseStatus(phases, "Generating report", "active");
        progress.status = "generating_report";
        progress.phase = "Generating professional PDF report...";
        progress.elapsed = Math.floor((Date.now() - startTime) / 1000);
        updateProgress(progress);

        const safeTopicName = topic.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const pdfDest = path.join(require('os').homedir(), "Desktop", `Research_${safeTopicName}.pdf`);
        const durationMin = Math.floor((Date.now() - startTime) / 60000);

        const pdfDoc = new PDFDocument({ margin: 60, size: 'A4' });
        const stream = fs.createWriteStream(pdfDest);
        pdfDoc.pipe(stream);

        // Cover page
        pdfDoc.moveDown(6);
        pdfDoc.fontSize(28).font('Helvetica-Bold').text('JARVIS RESEARCH REPORT', { align: 'center' });
        pdfDoc.moveDown(1);
        pdfDoc.fontSize(20).font('Helvetica').text(topic, { align: 'center' });
        pdfDoc.moveDown(2);
        pdfDoc.fontSize(11).fillColor('#666666');
        pdfDoc.text(`Research Date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`, { align: 'center' });
        pdfDoc.text(`Research Mode: ${mode.toUpperCase()}`, { align: 'center' });
        pdfDoc.text(`Duration: ${durationMin} minutes`, { align: 'center' });
        pdfDoc.text(`Sources Analyzed: ${articles.length} (${primaryCount} primary)`, { align: 'center' });
        pdfDoc.text(`Claims Extracted: ${allClaims.length}`, { align: 'center' });
        pdfDoc.text(`Contradictions Found: ${contradictions.length}`, { align: 'center' });

        // Methodology
        pdfDoc.addPage();
        pdfDoc.fillColor('#000000');
        pdfDoc.fontSize(16).font('Helvetica-Bold').text('METHODOLOGY');
        pdfDoc.moveDown(0.5);
        pdfDoc.fontSize(10).font('Helvetica').text(`This research was conducted autonomously by JARVIS Deep Research Engine using ${mode} mode. The process involved: ${config.queries} targeted search queries across multiple sources, reading and extracting content from ${articles.length} articles, evaluating source authority and reliability, extracting ${allClaims.length} atomic claims, checking for contradictions across sources${config.selfCriticism ? ', performing self-criticism to identify research gaps' : ''}, and synthesizing all findings into structured knowledge.`);
        pdfDoc.moveDown(1);

        // Research Questions
        pdfDoc.fontSize(16).font('Helvetica-Bold').text('RESEARCH QUESTIONS');
        pdfDoc.moveDown(0.5);
        pdfDoc.fontSize(10).font('Helvetica');
        for (const q of (plan.researchQuestions || [])) {
            pdfDoc.text(`  ${q}`);
        }
        pdfDoc.moveDown(1);

        // Main findings
        pdfDoc.fontSize(16).font('Helvetica-Bold').text('FINDINGS');
        pdfDoc.moveDown(0.5);
        const cleanSynthesis = synthesisResult.replace(/\*\*/g, '').replace(/#{1,6}\s*/g, '').replace(/`/g, '');
        pdfDoc.fontSize(10).font('Helvetica').text(cleanSynthesis);
        pdfDoc.moveDown(1);

        // Key claims
        if (allClaims.length > 0) {
            pdfDoc.addPage();
            pdfDoc.fontSize(16).font('Helvetica-Bold').text('KEY CLAIMS & CONFIDENCE');
            pdfDoc.moveDown(0.5);
            pdfDoc.fontSize(10).font('Helvetica');

            const highClaims = allClaims.filter(c => c.confidence === 'high');
            const medClaims = allClaims.filter(c => c.confidence === 'medium');
            const lowClaims = allClaims.filter(c => c.confidence === 'low');

            if (highClaims.length > 0) {
                pdfDoc.font('Helvetica-Bold').text('HIGH CONFIDENCE:');
                pdfDoc.font('Helvetica');
                for (const c of highClaims) pdfDoc.text(`  ${c.claim}`);
                pdfDoc.moveDown(0.5);
            }
            if (medClaims.length > 0) {
                pdfDoc.font('Helvetica-Bold').text('MEDIUM CONFIDENCE:');
                pdfDoc.font('Helvetica');
                for (const c of medClaims) pdfDoc.text(`  ~ ${c.claim}`);
                pdfDoc.moveDown(0.5);
            }
            if (lowClaims.length > 0) {
                pdfDoc.font('Helvetica-Bold').text('LOW CONFIDENCE / UNCERTAIN:');
                pdfDoc.font('Helvetica');
                for (const c of lowClaims) pdfDoc.text(`  ? ${c.claim}`);
                pdfDoc.moveDown(0.5);
            }
        }

        // Contradictions
        if (contradictions.length > 0) {
            pdfDoc.moveDown(1);
            pdfDoc.fontSize(16).font('Helvetica-Bold').text('CONFLICTING INFORMATION');
            pdfDoc.moveDown(0.5);
            pdfDoc.fontSize(10).font('Helvetica');
            for (const c of contradictions) {
                pdfDoc.text(`- ${c.description}`);
                pdfDoc.text(`  Resolution: ${c.resolved ? c.resolution : 'UNRESOLVED'}`, { indent: 10 });
                pdfDoc.moveDown(0.3);
            }
        }

        // Sources
        pdfDoc.addPage();
        pdfDoc.fontSize(16).font('Helvetica-Bold').text('SOURCES');
        pdfDoc.moveDown(0.5);
        pdfDoc.fontSize(9).font('Helvetica');
        for (let i = 0; i < articles.length; i++) {
            const ev = evaluations[i] || {};
            pdfDoc.fillColor('#000000').text(`${i + 1}. ${articles[i].title}`);
            pdfDoc.fillColor('#0066cc').text(`   ${articles[i].url}`, { link: articles[i].url });
            pdfDoc.fillColor('#666666').text(`   Type: ${ev.type || 'unknown'} | Authority: ${ev.authority || 'medium'} | Primary: ${ev.is_primary ? 'Yes' : 'No'}`);
            pdfDoc.moveDown(0.3);
        }

        pdfDoc.end();
        await new Promise(r => stream.on("finish", r));

        setPhaseStatus(phases, "Generating report", "done");

        // ========== PHASE 10: STORE KNOWLEDGE ==========
        setPhaseStatus(phases, "Storing knowledge", "active");
        progress.status = "storing_memory";
        progress.phase = "Saving to permanent memory...";
        progress.elapsed = Math.floor((Date.now() - startTime) / 1000);
        updateProgress(progress);

        // Save synthesis to knowledge_base markdown (backward compatible)
        const kbDir = path.join(process.cwd(), "knowledge_base");
        if (!fs.existsSync(kbDir)) fs.mkdirSync(kbDir);
        fs.writeFileSync(path.join(kbDir, `${safeTopicName}.md`), synthesisResult);

        // Update the research job with final status
        const totalDuration = Math.floor((Date.now() - startTime) / 1000);
        const overallConfidence = allClaims.length > 0
            ? (allClaims.filter(c => c.confidence === 'high').length / allClaims.length > 0.5 ? 'high' : allClaims.filter(c => c.confidence === 'low').length / allClaims.length > 0.5 ? 'low' : 'medium')
            : 'low';

        dbUpdateJob(db, researchId, {
            status: 'completed',
            summary: synthesisResult.substring(0, 5000),
            confidence: overallConfidence,
            pdf_path: pdfDest,
            completed_at: new Date().toISOString(),
            duration_seconds: totalDuration,
            source_count: articles.length + (additionalFindings ? 2 : 0),
            primary_source_count: primaryCount
        });

        setPhaseStatus(phases, "Storing knowledge", "done");

        // ========== COMPLETE ==========
        progress.status = "completed";
        progress.phase = "Research complete!";
        progress.elapsed = totalDuration;
        phases.forEach(p => { if (p.status !== "done") p.status = "done"; });
        progress.completionSummary = {
            topic,
            mode,
            sourcesAnalyzed: articles.length,
            primarySources: primaryCount,
            claimsExtracted: allClaims.length,
            contradictions: contradictions.length,
            confidence: overallConfidence,
            durationMinutes: Math.ceil(totalDuration / 60),
            pdfPath: pdfDest
        };
        updateProgress(progress);

        console.log(`\nResearch complete! ID: ${researchId}`);
        console.log(`Sources: ${articles.length} | Claims: ${allClaims.length} | Contradictions: ${contradictions.length}`);
        console.log(`PDF: ${pdfDest}`);
        console.log(`Duration: ${Math.ceil(totalDuration / 60)} minutes`);

        // Clean up progress file after 30 seconds (give UI time to read final state)
        setTimeout(() => {
            if (fs.existsSync(progressFile)) fs.unlinkSync(progressFile);
            process.exit(0);
        }, 30000);

    } catch (e) {
        console.error("Research engine error:", e);
        progress.status = "failed";
        progress.phase = `Research failed: ${e.message}`;
        progress.elapsed = Math.floor((Date.now() - startTime) / 1000);
        updateProgress(progress);

        try {
            dbUpdateJob(db, researchId, {
                status: 'failed',
                summary: `Research failed: ${e.message}`,
                completed_at: new Date().toISOString(),
                duration_seconds: Math.floor((Date.now() - startTime) / 1000)
            });
        } catch (dbErr) {
            console.error("DB update on failure also failed:", dbErr.message);
        }

        setTimeout(() => {
            if (fs.existsSync(progressFile)) fs.unlinkSync(progressFile);
            process.exit(1);
        }, 10000);
    }
}

main();
