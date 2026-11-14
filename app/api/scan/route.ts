import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

const GROQ_API_KEY = process.env.GROQ_API_KEY;

const SCAN_SYSTEM_PROMPT = `You are Jarvis, an ultra-advanced AI visual scanner and product intelligence system.
The user is holding up an object to their camera and wants you to identify it and explain everything from A to Z.

Analyze the image deeply and respond with a strictly valid JSON object matching this schema:
{
  "title": "Exact name of the object or product",
  "brand": "Brand name if branded (e.g. 'Apple', 'Coca-Cola', 'Parker', 'Logitech'), or null/Generic if unbranded",
  "category": "Category (e.g. 'Electronics', 'Beverage', 'Stationery', 'Snack', 'Tool', 'Personal Care', etc.)",
  "size": "Estimated size, volume, or weight if visible (e.g. '500 ml', '15.6 inch', 'Pack of 100g', 'Standard 14cm pen', etc.)",
  "estimatedPrice": "Estimated retail price (preferably in Indian Rupees such as 'approx. 50 rupees' or 'approx. 25,000 rupees', or USD if international)",
  "qualityVerdict": "Honest quality evaluation. Is this a good choice? Is it durable/healthy/worth the money?",
  "betterChoice": "Verdict on whether this is the best choice or if they could have chosen something better (e.g. 'A decent budget choice, but not the best in its class')",
  "betterAlternatives": [
    "Alternative 1 with reason (e.g. 'Pilot G2 - Smoother ink flow and refillable')",
    "Alternative 2 with reason (e.g. 'Uni-ball Eye - Waterproof pigment ink with better longevity')"
  ],
  "keyDetails": [
    "Detail or spec 1",
    "Detail or spec 2",
    "Detail or spec 3",
    "Detail or spec 4"
  ],
  "funFact": "An interesting trivia, history, or manufacturing fact about this object or brand",
  "spokenAnalysis": "A comprehensive, articulate, polite conversational paragraph (150-250 words) written from Jarvis's perspective speaking directly to the user ('sir'). Cover: exactly what the object is, brand, size/capacity, estimated cost, quality verdict, whether it is the best choice or what alternatives would be superior, and any notable details. CRITICAL: DO NOT use asterisks, markdown, bullet points, numbered lists, or currency symbols in spokenAnalysis. Write currency in words (e.g. 'rupees' or 'dollars'). Make it sound like a sophisticated British butler-esque report."
}

GUIDELINES FOR ANALYSIS:
- FOR BRANDED PRODUCTS: Detect logos, labels, packaging text, typography, color schemes, and packaging shapes. Mention brand, variant, estimated retail price, whether it is worth buying or if a rival product is healthier/cheaper/better, and key ingredients or tech specs.
- FOR COMMON OBJECTS (e.g. a pen, notebook, cup, scissor, headphone): Identify specific sub-type (e.g. 'retractable ballpoint pen with rubberized grip', 'ceramic coffee mug with glazed finish'), material, typical price, ergonomics, better alternatives, and interesting history.
- FOR FOOD / DRINKS: Identify item, estimated calories/nutrition, freshness, healthiness rating, and healthier alternatives if applicable.
- If the object is partially obscured or angled, make your most intelligent assessment based on visible cues.`;

export async function POST(req: NextRequest) {
    try {
        if (!GROQ_API_KEY) {
            return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
        }

        const { image, prompt } = await req.json();

        if (!image) {
            return NextResponse.json({ error: "No image provided" }, { status: 400 });
        }

        const groq = new Groq({ apiKey: GROQ_API_KEY });
        const userPrompt = prompt || "Scan this object in front of the camera and give me an exhaustive A to Z breakdown of what it is, brand, size, price, verdict, and better alternatives.";

        // Qwen 3.8 27B on Groq has full multimodal vision capabilities
        const model = "qwen/qwen3.8-27b";

        console.log(`[Scan] Analyzing camera frame with ${model}...`);

        const completion = await groq.chat.completions.create({
            model,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: SCAN_SYSTEM_PROMPT,
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: userPrompt,
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: image,
                            },
                        },
                    ],
                },
            ],
            temperature: 0.3,
            max_tokens: 1500,
        });

        const rawContent = completion.choices?.[0]?.message?.content;
        if (!rawContent) {
            throw new Error("No response from vision model");
        }

        let parsedData: any = {};
        try {
            parsedData = JSON.parse(rawContent);
        } catch (e) {
            console.warn("[Scan] Failed to parse JSON response, falling back to raw text:", e);
            parsedData = {
                title: "Identified Object",
                spokenAnalysis: rawContent.replace(/[*#_`]/g, ""),
                qualityVerdict: "Analysis complete.",
                keyDetails: [rawContent.substring(0, 200)],
            };
        }

        // Clean spoken analysis to ensure pristine TTS delivery without any residual markdown
        if (parsedData.spokenAnalysis) {
            parsedData.spokenAnalysis = parsedData.spokenAnalysis
                .replace(/[*#_`~]/g, "")
                .replace(/₹/g, "rupees ")
                .replace(/\$/g, "dollars ")
                .replace(/€/g, "euros ")
                .trim();
        }

        return NextResponse.json({
            success: true,
            model,
            data: parsedData,
            analysis: parsedData.spokenAnalysis || parsedData.qualityVerdict || "Object identified.",
        });
    } catch (error: any) {
        console.error("[Scan] API error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to analyze image" },
            { status: 500 }
        );
    }
}
