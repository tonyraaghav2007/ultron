const Groq = require('groq-sdk');
require('dotenv').config({path: '.env.local'});
const fs = require('fs');

const SYSTEM_PROMPT = `You are a helpful, autonomous UI assistant. Your goal is to help the user accomplish their task by looking at the screen and interacting with the UI.

You must respond in pure JSON format containing the exact action you want to take next.
Do not include markdown blocks like \`\`\`json, just the raw JSON object.

Valid actions:
1. Move Mouse & Click:
{"action": "click", "x": 0.5, "y": 0.5, "reason": "clicking the search bar"}
x and y are percentages of the screen width and height (0.0 to 1.0).

2. Type text:
{"action": "type", "text": "hello world", "reason": "typing in the search query"}
This will type the exact string.

3. Press a special key:
{"action": "key", "key": "enter", "reason": "submitting the form"}
Valid keys: "enter", "escape", "backspace", "tab", "up", "down", "left", "right"

4. Double Click:
{"action": "double_click", "x": 0.5, "y": 0.5, "reason": "opening the folder"}

5. Finish Task:
{"action": "done", "reason": "task is completed"}

Always provide a brief 'reason' for your action. Think step by step in your reasoning.
`;

async function run() {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const buf = fs.readFileSync('out.jpg');
    const b64 = buf.toString('base64');
    const res = await groq.chat.completions.create({
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: [{type:'text', text:'User Goal: open start menu\nWhat is your next action based on this screenshot?'}, {type:'image_url', image_url: {url: 'data:image/jpeg;base64,' + b64}}]}
        ],
        model: 'qwen/qwen3.6-27b',
        max_tokens: 1024,
        temperature: 0.2
    });
    
    console.log("Raw reply:");
    console.log(res.choices[0].message.content);
}
run();
