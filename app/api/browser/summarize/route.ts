import { NextRequest, NextResponse } from 'next/server';
import {
    extractPageContent,
    classifyPage,
    summarizeArticle,
    analyzeProduct,
    researchReviews,
    findAlternatives,
    answerFollowUp,
    PageContent,
} from '../../../../lib/browserIntelligence';

// In-memory session cache for follow-up questions
let cachedPageContent: PageContent | null = null;
let cachedSummary: any = null;
let chatHistory: Array<{ role: string; content: string }> = [];

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { url, action, question } = body;

        // ============ FOLLOW-UP CHAT ============
        if (action === 'followup' && question && cachedPageContent && cachedSummary) {
            chatHistory.push({ role: 'user', content: question });
            const answer = await answerFollowUp(question, cachedPageContent, cachedSummary, chatHistory);
            chatHistory.push({ role: 'assistant', content: answer });
            return NextResponse.json({ type: 'followup', answer });
        }

        // ============ RESEARCH REVIEWS (opt-in expansion) ============
        if (action === 'research_reviews' && cachedSummary?.productName) {
            const reviews = await researchReviews(cachedSummary.productName);
            return NextResponse.json({ type: 'reviews', data: reviews });
        }

        // ============ FIND ALTERNATIVES (opt-in expansion) ============
        if (action === 'find_alternatives' && cachedSummary?.productName) {
            const comparison = await findAlternatives(cachedSummary.productName, cachedSummary.price || '');
            return NextResponse.json({ type: 'comparison', data: comparison });
        }

        // ============ MAIN SUMMARIZE FLOW ============
        if (!url) {
            return NextResponse.json({ error: 'URL is required' }, { status: 400 });
        }

        // Phase 1: Extract
        const content = await extractPageContent(url);
        cachedPageContent = content;
        chatHistory = [];

        // Phase 2: Classify
        const classification = await classifyPage(content);

        // Phase 3: Summarize based on type
        const productTypes = ['product', 'ecommerce'];
        let summary: any;

        if (productTypes.includes(classification.pageType)) {
            summary = await analyzeProduct(content);
        } else {
            summary = await summarizeArticle(content, classification.pageType);
        }

        cachedSummary = summary;

        return NextResponse.json({
            type: summary.type,
            pageType: classification.pageType,
            confidence: classification.confidence,
            data: summary,
            images: content.images.slice(0, 6),
            siteName: content.siteName,
        });
    } catch (error: any) {
        console.error('[BrowserIntel] Summarize error:', error);
        return NextResponse.json(
            { error: `Analysis failed: ${error.message}` },
            { status: 500 }
        );
    }
}
