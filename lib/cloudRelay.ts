import { supabase } from './supabaseClient';
import fs from 'fs';
import path from 'path';
import { Groq } from 'groq-sdk';
import { EdgeTTS } from 'node-edge-tts';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });

let isRelayRunning = false;

export function startCloudRelay() {
    if (isRelayRunning) return;
    isRelayRunning = true;
    console.log("[JARVIS] Cloud Relay Started. Listening for remote commands...");

    // Setup heartbeat listener
    const presenceChannel = supabase.channel('jarvis-presence');
    presenceChannel
        .on('broadcast', { event: 'ping' }, () => {
            presenceChannel.send({
                type: 'broadcast',
                event: 'pong',
                payload: { status: 'online' }
            });
        })
        .subscribe();

    // Subscribe to new messages from the user
    supabase
        .channel('jarvis-commands')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'messages', filter: "sender=eq.'user'" },
            async (payload) => {
                const message = payload.new;
                if (message.status === 'pending') {
                    console.log(`[JARVIS] Received remote command: ${message.content}`);
                    
                    // Mark as processing
                    await supabase
                        .from('messages')
                        .update({ status: 'processing' })
                        .eq('id', message.id);

                    // Handle audio transcription if needed
                    let commandText = message.content;
                    
                    if (message.type === 'audio_command') {
                        console.log(`[JARVIS] Received audio command, transcribing via Groq...`);
                        try {
                            // The content is expected to be a base64 string "data:audio/m4a;base64,..."
                            const base64Data = message.content.split(',')[1] || message.content;
                            const audioBuffer = Buffer.from(base64Data, 'base64');
                            const tmpPath = path.join(process.cwd(), `tmp_${Date.now()}.m4a`);
                            fs.writeFileSync(tmpPath, audioBuffer);

                            const transcription = await groq.audio.transcriptions.create({
                                file: fs.createReadStream(tmpPath),
                                model: "whisper-large-v3",
                            });
                            
                            commandText = transcription.text;
                            console.log(`[JARVIS] Transcribed: "${commandText}"`);
                            fs.unlinkSync(tmpPath);
                        } catch (err) {
                            console.error("[JARVIS] Transcription failed:", err);
                            commandText = "I could not understand the audio.";
                        }
                    }

                    // Route the command to the local Jarvis API
                    let finalResponseText = '';
                    try {
                        const res = await fetch('http://localhost:3000/api/chat', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                messages: [{ role: 'user', content: commandText }]
                            })
                        });

                        const text = await res.text();
                        // Vercel AI SDK sends chunks like 0:"text"
                        const lines = text.split('\n');
                        for (const line of lines) {
                            if (line.startsWith('0:')) {
                                try {
                                    finalResponseText += JSON.parse(line.substring(2));
                                } catch (e) {}
                            }
                        }
                        if (!finalResponseText) finalResponseText = text; // fallback
                    } catch (err) {
                        finalResponseText = "I'm sorry sir, but I encountered an error connecting to my core processor.";
                    }

                    // If the original message was audio, we should synthesize a voice response
                    let finalType = 'text';
                    let finalContent = finalResponseText;

                    if (message.type === 'audio_command') {
                        try {
                            const tts = new EdgeTTS();
                            const ttsPath = path.join(process.cwd(), `response_${Date.now()}.mp3`);
                            await tts.ttsPromise(finalResponseText, ttsPath);
                            
                            const audioBuffer = fs.readFileSync(ttsPath);
                            const base64Audio = `data:audio/mp3;base64,${audioBuffer.toString('base64')}`;
                            
                            finalType = 'audio_response';
                            finalContent = base64Audio;
                            
                            fs.unlinkSync(ttsPath);
                        } catch (e) {
                            console.error("[JARVIS] TTS generation failed", e);
                        }
                    }

                    // Reply with result
                    await supabase
                        .from('messages')
                        .insert([{
                            sender: 'jarvis',
                            type: finalType,
                            content: finalContent,
                            status: 'completed'
                        }]);
                }
            }
        )
        .subscribe();
}

export async function sendScreenshotToPhone(imagePath: string, messageText: string = "Here is the screenshot.") {
    // 1. Upload to Supabase Storage
    // const fileBody = fs.readFileSync(imagePath);
    // const fileName = path.basename(imagePath);
    // await supabase.storage.from('jarvis-media').upload(fileName, fileBody);
    // const { data } = supabase.storage.from('jarvis-media').getPublicUrl(fileName);
    
    // 2. Insert message
    // await supabase.from('messages').insert([{
    //     sender: 'jarvis',
    //     type: 'image',
    //     content: data.publicUrl,
    //     status: 'completed'
    // }]);
    
    console.log("[JARVIS] sendScreenshotToPhone called (mocked until keys are added).");
}
