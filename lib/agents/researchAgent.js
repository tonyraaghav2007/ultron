const fs = require('fs');
const path = require('path');
const google = require('googlethis');
const Groq = require('groq-sdk');
const PDFDocument = require('pdfkit');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
require('dotenv').config({ path: path.join(process.cwd(), '.env.local') });

async function main() {
    const topic = process.argv[2];
    if (!topic) {
        console.error("No topic provided.");
        process.exit(1);
    }

    const progressFile = path.join(process.cwd(), '.research_progress.json');
    const updateProgress = (pct, msg) => {
        fs.writeFileSync(progressFile, JSON.stringify({ topic, percent: pct, message: msg }));
    };

    try {
        updateProgress(2, "Booting up Deep Think Neural Pathways...");
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        const groqModels = [
            "openai/gpt-oss-120b",
            "openai/gpt-oss-20b",
            "qwen/qwen3.6-27b",
            "allam-2-7b",
            "groq/compound"
        ];
        
        async function groqCall(messages, requireJson = false) {
            let lastErr;
            for (let model of groqModels) {
                try {
                    const opts = { model, messages };
                    if (requireJson) opts.response_format = { type: "json_object" };
                    return await groq.chat.completions.create(opts);
                } catch (e) {
                    lastErr = e;
                    console.log(`Error on ${model}: ${e.message}. Trying next...`);
                    continue;
                }
            }
            throw lastErr;
        }

        updateProgress(5, "Brainstorming optimal search strategies...");
        const queryPlanner = await groqCall([
            { role: "system", content: "You are a master researcher. Generate 3 highly-specific Google search queries to thoroughly research this topic. Return ONLY a JSON object with a 'queries' array of strings. Topic: " + topic }
        ], true);
        
        let queries = [];
        try {
            const parsed = JSON.parse(queryPlanner.choices[0].message.content);
            queries = parsed.queries || [topic, topic + " technical details", topic + " history and future"];
        } catch(e) {
            queries = [topic, topic + " technical details", topic + " history and future"];
        }

        let articleUrls = new Set();
        
        for (let i = 0; i < queries.length; i++) {
            updateProgress(10 + (i * 5), `Scouring web for: "${queries[i]}"...`);
            const searchResponse = await google.search(queries[i], { page: 0, safe: false });
            if (searchResponse.results) {
                for (let j = 0; j < Math.min(3, searchResponse.results.length); j++) {
                    articleUrls.add(searchResponse.results[j].url);
                }
            }
            await new Promise(r => setTimeout(r, 2000)); 
        }

        const urlsToRead = Array.from(articleUrls).slice(0, 5); 
        let compiledNotes = "";

        updateProgress(30, `Found ${urlsToRead.length} highly relevant articles. Initiating deep reading...`);

        for (let i = 0; i < urlsToRead.length; i++) {
            const url = urlsToRead[i];
            updateProgress(35 + (i * 8), `Deep reading article ${i+1}/${urlsToRead.length}: ${url}...`);
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                const res = await fetch(url, { 
                    signal: controller.signal,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                });
                clearTimeout(timeoutId);
                
                const html = await res.text();
                const doc = new JSDOM(html, { url });
                let reader = new Readability(doc.window.document);
                let article = reader.parse();
                
                if (article && article.textContent) {
                    let chunk = article.textContent.replace(/\s+/g, ' ').substring(0, 8000); // Take first 8k chars to respect context limits
                    compiledNotes += `\n\n--- NOTES FROM ${url} ---\nTITLE: ${article.title}\nCONTENT: ${chunk}\n`;
                }
            } catch (e) {
                console.log(`Failed to read ${url}`);
            }
            // Simulate human reading time for the UI so the user knows it's actually doing work
            await new Promise(r => setTimeout(r, 4000));
        }

        updateProgress(80, "Cross-referencing data and synthesizing master report...");
        
        const finalReportResult = await groqCall([
            { role: "system", content: "You are an elite research AI writing a final PDF report. Your job is to take the following compiled article notes and synthesize them into a comprehensive, highly-detailed, beautiful Markdown report on the requested topic. Include an executive summary, structured sections, technical details, bullet points, and a conclusion. Never mention that you are an AI or using search data. Speak as if you are a master of the topic. If the notes are lacking, rely on your deep internal knowledge." },
            { role: "user", content: `TOPIC: ${topic}\n\nCOMPILED NOTES:\n${compiledNotes.substring(0, 20000)}` }
        ]);
        const finalReport = finalReportResult.choices[0].message.content;

        updateProgress(90, "Writing to Long-term Memory & Generating PDF Document...");
        
        const kbDir = path.join(process.cwd(), "knowledge_base");
        if (!fs.existsSync(kbDir)) fs.mkdirSync(kbDir);
        
        const safeTopicName = topic.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        fs.writeFileSync(path.join(kbDir, `${safeTopicName}.md`), finalReport);

        const pdfDest = path.join(require('os').homedir(), "Desktop", `Research_${safeTopicName}.pdf`);
        const doc = new PDFDocument({ margin: 50 });
        const stream = fs.createWriteStream(pdfDest);
        doc.pipe(stream);
        
        doc.fontSize(20).font('Helvetica-Bold').text(`Research Report: ${topic}`, { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).font('Helvetica').text(finalReport.replace(/\*\*/g, '').replace(/#/g, ''));
        doc.end();

        await new Promise(r => stream.on("finish", r));

        updateProgress(100, `Done! Saved to memory and PDF generated at ${pdfDest}`);
        
        setTimeout(() => {
            if (fs.existsSync(progressFile)) fs.unlinkSync(progressFile);
            process.exit(0);
        }, 10000);

    } catch (e) {
        console.error(e);
        updateProgress(0, "Deep research failed: " + e.message);
        setTimeout(() => {
            if (fs.existsSync(progressFile)) fs.unlinkSync(progressFile);
            process.exit(1);
        }, 5000);
    }
}

main();
