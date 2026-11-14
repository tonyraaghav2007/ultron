import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { File } from 'buffer'; // Need a File-like object or just use standard fetch FormData

// Use standard fetch instead of the SDK for audio to avoid node/browser File object incompatibilities in edge environments
const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

export async function POST(req: Request) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as globalThis.File | null;

        if (!file) {
            return NextResponse.json({ error: "Audio file is required" }, { status: 400 });
        }

        if (!process.env.GROQ_API_KEY) {
             return NextResponse.json({ error: "GROQ_API_KEY is missing" }, { status: 500 });
        }

        // We can just forward the formData directly to Groq
        const groqFormData = new FormData();
        groqFormData.append('file', file);
        groqFormData.append('model', 'whisper-large-v3-turbo'); // Whisper turbo is extremely fast
        groqFormData.append('response_format', 'json');
        groqFormData.append('language', 'en'); // Force English language

        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
            },
            body: groqFormData
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error("Groq Transcription Error:", response.status, errText);
            return NextResponse.json({ error: "Failed to transcribe audio" }, { status: response.status });
        }

        const data = await response.json();
        let rawText = (data.text || "").trim();

        // Common Whisper hallucinations that occur on near-silence/ambient noise
        const SILENCE_HALLUCINATIONS = [
            /^thank you\.?$/i,
            /^thank you very much\.?$/i,
            /^thanks for watching\.?$/i,
            /^thanks for watching!$/i,
            /^you\.?$/i,
            /^bye\.?$/i,
            /^so\.?$/i,
            /^[.\s]+$/,
            /^\[.*\]$/,
            /^\(.*\)$/,
            /^subtitles by/i,
            /^transcribed by/i,
            /^amara\.org/i,
        ];

        const isHallucination = SILENCE_HALLUCINATIONS.some(rx => rx.test(rawText));
        if (isHallucination) {
            console.log(`[Whisper] Filtered phantom hallucination on silence: "${rawText}"`);
            rawText = "";
        }

        return NextResponse.json({ text: rawText });

    } catch (error: any) {
        console.error("Transcription error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
