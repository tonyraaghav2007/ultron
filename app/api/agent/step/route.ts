import { NextResponse } from 'next/server';
import { sendMouseCommand, startDaemon } from '@/lib/mouseClient';
import Groq from 'groq-sdk';

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const SYSTEM_PROMPT = `You are a helpful, autonomous UI assistant. Your goal is to help the user accomplish their task by looking at the screen and interacting with the UI.

You must respond in pure JSON format containing the exact action you want to take next.
Do not include markdown blocks like \`\`\`json, just the raw JSON object.

CRITICAL INSTRUCTIONS:
- You may see a futuristic "Ultron" HUD (a glowing orb, system stats, audio bars, or "AGENT MODE" text) overlaid on the screen. IGNORE IT entirely. It is a transparent overlay. Look *behind* it to see the actual desktop apps.
- If the user wants to use the Windows Start Menu, Taskbar, or system tray, and you do not see it at the bottom of the screen, the user has an AUTO-HIDE TASKBAR. You MUST move the mouse to the very bottom edge of the screen (e.g. {"action": "move", "x": 0.5, "y": 0.999}) to reveal it first!

Valid actions:
1. Move Mouse & Click:
{"action": "click", "x": 0.5, "y": 0.5, "reason": "clicking the search bar"}
x and y are percentages of the screen width and height (0.0 to 1.0).

2. Move Mouse Only (Useful to reveal auto-hide taskbar):
{"action": "move", "x": 0.5, "y": 0.999, "reason": "moving mouse to bottom edge to reveal taskbar"}

3. Type text:
{"action": "type", "text": "hello world", "reason": "typing in the search query"}
This will type the exact string.

4. Press a special key:
{"action": "key", "key": "win", "reason": "pressing windows key to open start menu"}
Valid keys: "enter", "escape", "backspace", "tab", "up", "down", "left", "right", "win"

5. Double Click:
{"action": "double_click", "x": 0.5, "y": 0.5, "reason": "opening the folder"}

6. Finish Task:
{"action": "done", "reason": "task is completed"}

Always provide a brief 'reason' for your action. Think step by step in your reasoning.
`;

export async function POST(req: Request) {
    try {
        const { goal } = await req.json();

        if (!goal) {
            return NextResponse.json({ error: "Goal is required" }, { status: 400 });
        }

        // Ensure daemon is running
        startDaemon();

        // 1. Fetch screenshot from the python daemon (with retry for cold starts)
        let screenshotResponse: Response | undefined;
        let retries = 3;
        while (retries > 0) {
            try {
                screenshotResponse = await fetch('http://127.0.0.1:5006/screenshot', {
                     cache: 'no-store'
                });
                break; // success
            } catch (error) {
                retries--;
                if (retries === 0) {
                    return NextResponse.json({ error: "Could not connect to daemon. Is it running?" }, { status: 500 });
                }
                // wait 500ms before retrying
                await new Promise(r => setTimeout(r, 500));
            }
        }

        if (!screenshotResponse || !screenshotResponse.ok) {
            return NextResponse.json({ error: "Failed to capture screenshot" }, { status: 500 });
        }

        const arrayBuffer = await screenshotResponse.arrayBuffer();
        const base64Image = Buffer.from(arrayBuffer).toString('base64');
        const dataUrl = `data:image/jpeg;base64,${base64Image}`;

        // 2. Call Groq Vision API
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: SYSTEM_PROMPT,
                },
                {
                    role: "user",
                    content: [
                        { type: "text", text: `User Goal: ${goal}\nWhat is your next action based on this screenshot?` },
                        { type: "image_url", image_url: { url: dataUrl } },
                    ],
                }
            ],
            model: "qwen-2.5-vl-72b-instruct", // Standard Groq Qwen Vision Model
            temperature: 0.1,
            max_tokens: 1024,
            response_format: { type: "json_object" },
        });

        const replyContent = chatCompletion.choices[0]?.message?.content || "{}";
        
        // 3. Parse and execute action
        let actionData;
        try {
            let cleanedContent = replyContent;
            
            // Explicitly remove <think>...</think> if it exists
            const thinkMatch = cleanedContent.match(/<think>[\s\S]*?<\/think>/);
            if (thinkMatch) {
                cleanedContent = cleanedContent.replace(thinkMatch[0], "").trim();
            }
            
            // Qwen might output markdown. Just extract the JSON object:
            const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
            cleanedContent = jsonMatch ? jsonMatch[0] : "{}";
            actionData = JSON.parse(cleanedContent);
        } catch (parseError) {
            console.error("Failed to parse LLM response:", replyContent);
            return NextResponse.json({ error: "Invalid LLM response format", details: replyContent }, { status: 500 });
        }

        console.log("Agent decided:", actionData);

        // 4. Send command to daemon
        if (actionData.action === 'click' || actionData.action === 'double_click') {
            if (actionData.x !== undefined && actionData.y !== undefined) {
                // Move first
                sendMouseCommand({ action: "move", x: actionData.x, y: actionData.y });
                // Then click (wait a tiny bit in the daemon ideally, or just send consecutively)
                setTimeout(() => {
                    sendMouseCommand({ action: actionData.action });
                }, 50);
            }
        } else if (actionData.action === 'move') {
            if (actionData.x !== undefined && actionData.y !== undefined) {
                sendMouseCommand({ action: "move", x: actionData.x, y: actionData.y });
            }
        } else if (actionData.action === 'type') {
            sendMouseCommand({ action: "type", text: actionData.text });
        } else if (actionData.action === 'key') {
            sendMouseCommand({ action: "key", key: actionData.key });
        } else if (actionData.action === 'done') {
            // Do nothing, handled by client
        } else {
             console.warn("Unknown action:", actionData.action);
        }

        return NextResponse.json({ success: true, action: actionData, screenshot: dataUrl });

    } catch (error: any) {
        console.error("Agent step error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
