import { NextResponse } from 'next/server';
import { EdgeTTS } from 'node-edge-tts';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const text = searchParams.get('text');

    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    // Use Ryan (a very natural sounding British male voice, with slightly lower pitch)
    const tts = new EdgeTTS({ 
      voice: 'en-GB-RyanNeural',
      pitch: '-5Hz', // slightly lower pitched
      rate: '+0%' 
    });
    
    // Create a temporary file path
    const tempFile = path.join(os.tmpdir(), `tts_${Date.now()}.mp3`);
    
    await tts.ttsPromise(text, tempFile);
    
    // Read the file buffer
    const audioBuffer = fs.readFileSync(tempFile);
    
    // Clean up
    try { fs.unlinkSync(tempFile); } catch (e) {}

    // Return the audio as a stream/buffer
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length.toString(),
      },
    });
  } catch (error: any) {
    console.error("TTS error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
