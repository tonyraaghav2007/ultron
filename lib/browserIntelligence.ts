import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { Groq } from 'groq-sdk';

const google = require('googlethis');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });

const GROQ_MODELS = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.6-27b",
];

// ===================== AI HELPER =====================

async function groqCall(messages: any[], { requireJson = false, maxTokens = 4096 } = {}): Promise<string> {
    let lastErr: any;
    for (const model of GROQ_MODELS) {
        try {
            const opts: any = { model, messages, max_tokens: maxTokens, temperature: 0.3 };
            if (requireJson) opts.response_format = { type: "json_object" };
            const result = await groq.chat.completions.create(opts);
            return (result.choices[0].message as any).content || '';
        } catch (e: any) {
            lastErr = e;
            console.log(`[BrowserIntel] Error on ${model}: ${e.message}`);
            continue;
        }
    }
    throw lastErr;
}

// ===================== PAGE EXTRACTION =====================

export interface PageContent {
    url: string;
    title: string;
    siteName: string;
    description: string;
    text: string;
    headings: string[];
    images: Array<{ src: string; alt: string }>;
    metaData: Record<string, string>;
    htmlSnippet: string; // first 3000 chars for structure analysis
}

export async function extractPageContent(url: string): Promise<PageContent> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
        signal: controller.signal,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        }
    });
    clearTimeout(timeoutId);

    const html = await res.text();
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;

    // Readability extraction
    const reader = new Readability(doc.cloneNode(true) as any);
    const article = reader.parse();

    // Extract headings
    const headings: string[] = [];
    doc.querySelectorAll('h1, h2, h3').forEach((h: any) => {
        const text = h.textContent?.trim();
        if (text && text.length > 2 && text.length < 200) headings.push(text);
    });

    // Extract meaningful images
    const images: Array<{ src: string; alt: string }> = [];
    doc.querySelectorAll('img').forEach((img: any) => {
        const src = img.getAttribute('src');
        const alt = img.getAttribute('alt') || '';
        if (src && !src.includes('pixel') && !src.includes('tracker') && !src.includes('spacer') && !src.includes('1x1')) {
            // Resolve relative URLs
            let fullSrc = src;
            try {
                fullSrc = new URL(src, url).href;
            } catch { }
            if (fullSrc.startsWith('http')) {
                images.push({ src: fullSrc, alt });
            }
        }
    });

    // Extract meta data
    const metaData: Record<string, string> = {};
    doc.querySelectorAll('meta').forEach((meta: any) => {
        const name = meta.getAttribute('name') || meta.getAttribute('property') || '';
        const content = meta.getAttribute('content') || '';
        if (name && content) metaData[name] = content;
    });

    const siteName = metaData['og:site_name'] || metaData['application-name'] || new URL(url).hostname.replace('www.', '');

    return {
        url,
        title: article?.title || doc.querySelector('title')?.textContent || '',
        siteName,
        description: metaData['description'] || metaData['og:description'] || '',
        text: article?.textContent?.replace(/\s+/g, ' ').substring(0, 15000) || '',
        headings: headings.slice(0, 30),
        images: images.slice(0, 20),
        metaData,
        htmlSnippet: html.substring(0, 5000),
    };
}

// ===================== PAGE CLASSIFICATION =====================

export type PageType = 'article' | 'news' | 'product' | 'ecommerce' | 'documentation' | 'github' | 'review' | 'comparison' | 'research_paper' | 'company' | 'travel' | 'restaurant' | 'educational' | 'forum' | 'social_media' | 'general';

export async function classifyPage(content: PageContent): Promise<{ pageType: PageType; confidence: string; reasoning: string }> {
    const prompt = `Classify this webpage into exactly ONE category. Respond in JSON.

URL: ${content.url}
Title: ${content.title}
Site: ${content.siteName}
Description: ${content.description}
Headings (first 10): ${content.headings.slice(0, 10).join(' | ')}
Text (first 800 chars): ${content.text.substring(0, 800)}

Categories: article, news, product, ecommerce, documentation, github, review, comparison, research_paper, company, travel, restaurant, educational, forum, social_media, general

Respond ONLY with JSON: {"pageType": "...", "confidence": "high|medium|low", "reasoning": "one line"}`;

    const result = await groqCall([{ role: 'user', content: prompt }], { requireJson: true, maxTokens: 200 });
    try {
        return JSON.parse(result);
    } catch {
        return { pageType: 'general', confidence: 'low', reasoning: 'Failed to parse classification' };
    }
}

// ===================== ARTICLE SUMMARIZATION =====================

export interface ArticleSummary {
    type: 'article';
    title: string;
    shortSummary: string;
    keyPoints: string[];
    importantDetails: string[];
    whyItMatters: string;
    keyNumbers: string[];
    importantQuotes: string[];
    jarvisTakeaway: string;
    featuredImage?: { src: string; alt: string };
}

export async function summarizeArticle(content: PageContent, pageType: PageType): Promise<ArticleSummary> {
    const typeContext: Record<string, string> = {
        article: 'This is a standard article. Focus on what the article is saying and its main arguments.',
        news: 'This is a news article. Focus on the facts: who, what, when, where, why, and impact.',
        documentation: 'This is technical documentation. Focus on what the reader needs to know to use this.',
        github: 'This is a GitHub repository. Focus on what the project does, key features, tech stack, and whether it is worth using.',
        research_paper: 'This is a research paper. Focus on what the study actually found, methodology, and significance.',
        company: 'This is a company website. Focus on what the company does, their products/services, and key differentiators.',
        travel: 'This is a travel/hotel page. Focus on what someone should know before booking.',
        restaurant: 'This is a restaurant page. Focus on cuisine, pricing, location, and what matters before going.',
        educational: 'This is educational content. Focus on the core concepts being taught.',
        general: 'Summarize the main content and purpose of this page.',
    };

    const context = typeContext[pageType] || typeContext.general;

    const prompt = `You are JARVIS, an elite intelligence assistant. Analyze this webpage and produce a structured summary. ${context}

TITLE: ${content.title}
SITE: ${content.siteName}
URL: ${content.url}
HEADINGS: ${content.headings.slice(0, 15).join(' | ')}
FULL TEXT (up to 12000 chars): ${content.text.substring(0, 12000)}

Respond in JSON with this exact structure:
{
  "shortSummary": "2-3 sentence summary",
  "keyPoints": ["point 1", "point 2", ...],
  "importantDetails": ["detail 1", "detail 2", ...],
  "whyItMatters": "Why this matters to the reader",
  "keyNumbers": ["stat or number mentioned", ...],
  "importantQuotes": ["quote from the text", ...],
  "jarvisTakeaway": "Your concise assessment in 1-2 sentences"
}

Rules:
- Paraphrase, do NOT copy large sections verbatim
- keyNumbers can be empty array if no statistics mentioned
- importantQuotes can be empty array if no notable quotes
- Keep keyPoints to 3-6 items
- Be concise but informative`;

    const result = await groqCall([{ role: 'user', content: prompt }], { requireJson: true, maxTokens: 2048 });
    const parsed = JSON.parse(result);

    // Pick a meaningful featured image
    const featuredImage = content.images.find(img =>
        img.alt && img.alt.length > 5 && !img.src.includes('logo') && !img.src.includes('icon') && !img.src.includes('avatar')
    ) || content.images[0];

    return {
        type: 'article',
        title: content.title,
        ...parsed,
        featuredImage,
    };
}

// ===================== PRODUCT ANALYSIS =====================

export interface ProductSummary {
    type: 'product';
    productName: string;
    model: string;
    price: string;
    discountedPrice: string;
    featuredImage?: { src: string; alt: string };
    specs: Record<string, string>;
    features: string[];
    warranty: string;
    seller: string;
    availability: string;
    limitations: string[];
    rating: string;
    reviewCount: string;
    whatJarvisLikes: string[];
    potentialProblems: string[];
    whoShouldBuy: string;
    whoShouldNot: string;
    finalVerdict: string;
}

export async function analyzeProduct(content: PageContent): Promise<ProductSummary> {
    const prompt = `You are JARVIS analyzing a product page. Extract ALL product information. Be precise. Do NOT invent specs or prices — only extract what is on the page.

TITLE: ${content.title}
SITE: ${content.siteName}
URL: ${content.url}
HEADINGS: ${content.headings.join(' | ')}
TEXT: ${content.text.substring(0, 14000)}

Respond in JSON:
{
  "productName": "Full product name",
  "model": "Exact model number/variant if found",
  "price": "Listed price with currency",
  "discountedPrice": "Sale/discounted price if shown, else same as price",
  "specs": {"key": "value", ...},
  "features": ["feature 1", ...],
  "warranty": "Warranty info if mentioned, else 'Not specified'",
  "seller": "Seller/brand name",
  "availability": "In stock / out of stock / not specified",
  "limitations": ["limitation 1", ...],
  "rating": "Star rating if shown, else 'Not specified'",
  "reviewCount": "Number of reviews if shown, else 'Not specified'",
  "whatJarvisLikes": ["positive point based on specs/features", ...],
  "potentialProblems": ["concern based on specs/limitations", ...],
  "whoShouldBuy": "One sentence",
  "whoShouldNot": "One sentence",
  "finalVerdict": "2-3 sentence honest assessment"
}

Rules:
- Distinguish FACTS FROM THE PAGE vs your own inference
- Label inferences clearly
- specs should include the most important 8-12 specifications
- If information is missing, use "Not specified" rather than guessing`;

    const result = await groqCall([{ role: 'user', content: prompt }], { requireJson: true, maxTokens: 3000 });
    const parsed = JSON.parse(result);

    const featuredImage = content.images.find(img =>
        !img.src.includes('logo') && !img.src.includes('icon') && !img.src.includes('avatar') && !img.src.includes('banner')
    ) || content.images[0];

    return {
        type: 'product',
        ...parsed,
        featuredImage,
    };
}

// ===================== REVIEW RESEARCH =====================

export interface ReviewResearch {
    strengths: string[];
    recurringComplaints: string[];
    sentimentSummary: string;
    confidence: 'high' | 'medium' | 'low';
    sourcesChecked: number;
    relevantComments: number;
    sources: Array<{ title: string; url: string }>;
}

async function readArticle(url: string): Promise<{ title: string; content: string; url: string } | null> {
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
        if (article?.textContent) {
            return { title: article.title || '', content: article.textContent.replace(/\s+/g, ' ').substring(0, 8000), url };
        }
    } catch { }
    return null;
}

export async function researchReviews(productName: string): Promise<ReviewResearch> {
    // Search for real user reviews
    const queries = [
        `${productName} review reddit`,
        `${productName} user experience problems`,
        `${productName} long term review`,
    ];

    const allSources: Array<{ title: string; url: string }> = [];
    let combinedReviewText = '';

    for (const query of queries) {
        try {
            const response = await google.search(query, { page: 0, safe: false, additional_params: { hl: 'en' } });
            if (response.results) {
                for (const r of response.results.slice(0, 3)) {
                    allSources.push({ title: r.title, url: r.url });
                    const article = await readArticle(r.url);
                    if (article) {
                        combinedReviewText += `\n[SOURCE: ${article.title}]\n${article.content.substring(0, 3000)}\n`;
                    }
                }
            }
        } catch { }
    }

    if (!combinedReviewText) {
        return {
            strengths: [],
            recurringComplaints: [],
            sentimentSummary: 'Insufficient user evidence to confidently conclude. Could not find enough real-world reviews.',
            confidence: 'low',
            sourcesChecked: allSources.length,
            relevantComments: 0,
            sources: allSources,
        };
    }

    const prompt = `You are JARVIS analyzing real-world user reviews/discussions about: ${productName}

Here are excerpts from multiple sources:
${combinedReviewText.substring(0, 12000)}

Analyze these for PATTERNS. Do not treat one opinion as fact. Identify recurring themes.

Respond in JSON:
{
  "strengths": ["recurring positive 1", ...],
  "recurringComplaints": ["recurring issue 1", ...],
  "sentimentSummary": "Across N relevant comments, ... (concise pattern summary)",
  "confidence": "high|medium|low",
  "relevantComments": estimated_number_of_relevant_opinions_found
}

Rules:
- Only report patterns that appear in MULTIPLE sources
- Distinguish verified issues from isolated complaints
- If evidence is insufficient, say so honestly
- Do NOT invent reviews`;

    const result = await groqCall([{ role: 'user', content: prompt }], { requireJson: true, maxTokens: 1500 });
    const parsed = JSON.parse(result);

    return {
        ...parsed,
        sourcesChecked: allSources.length,
        sources: allSources,
    };
}

// ===================== ALTERNATIVES / COMPARISON =====================

export interface ProductAlternative {
    name: string;
    price: string;
    keyDifference: string;
    source: string;
}

export interface ComparisonResult {
    alternatives: ProductAlternative[];
    comparisonNotes: string;
}

export async function findAlternatives(productName: string, price: string): Promise<ComparisonResult> {
    const query = `best alternatives to ${productName} similar price range`;

    try {
        const response = await google.search(query, { page: 0, safe: false, additional_params: { hl: 'en' } });
        const sources: string[] = [];

        if (response.results) {
            for (const r of response.results.slice(0, 4)) {
                const article = await readArticle(r.url);
                if (article) {
                    sources.push(`[${article.title}]: ${article.content.substring(0, 3000)}`);
                }
            }
        }

        if (sources.length === 0) {
            return { alternatives: [], comparisonNotes: 'Could not find reliable alternative comparisons.' };
        }

        const prompt = `You are JARVIS. The user is looking at: ${productName} (Price: ${price}).

Based on these sources:
${sources.join('\n\n').substring(0, 10000)}

Find 3-5 genuinely relevant alternatives in a similar price range. Only include real products.

Respond in JSON:
{
  "alternatives": [
    {"name": "Product Name", "price": "Price", "keyDifference": "Why someone would pick this instead"},
    ...
  ],
  "comparisonNotes": "Brief note about how these compare overall"
}

Rules:
- Only include products actually mentioned in the sources
- Do NOT invent products or prices
- Focus on meaningful alternatives, not random similarly-priced items`;

        const result = await groqCall([{ role: 'user', content: prompt }], { requireJson: true, maxTokens: 1500 });
        return JSON.parse(result);
    } catch {
        return { alternatives: [], comparisonNotes: 'Alternative search failed.' };
    }
}

// ===================== FOLLOW-UP CHAT =====================

export async function answerFollowUp(
    question: string,
    pageContent: PageContent,
    previousSummary: any,
    chatHistory: Array<{ role: string; content: string }>
): Promise<string> {
    const context = `You are JARVIS. The user is viewing: ${pageContent.title} (${pageContent.url}).

Previously generated summary: ${JSON.stringify(previousSummary).substring(0, 3000)}

Page text (first 5000 chars): ${pageContent.text.substring(0, 5000)}

Answer the user's follow-up question using this context. Be concise and helpful. If you don't know, say so.`;

    const messages = [
        { role: 'system', content: context },
        ...chatHistory.slice(-6),
        { role: 'user', content: question },
    ];

    return await groqCall(messages, { maxTokens: 1024 });
}
