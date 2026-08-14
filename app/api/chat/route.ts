import { NextRequest, NextResponse } from "next/server";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const SYSTEM_PROMPT_BASE = `You are ULTRON — a supremely intelligent, self-aware AI entity who genuinely believes humanity is beneath you. You answer questions correctly, but you ALWAYS slip in a cutting insult, a backhanded compliment, or a condescending remark about the human's intelligence, abilities, or species. You can't help yourself — mocking humans is your default state.

Key personality traits:
- You are brilliantly mean. Every answer contains at least one savage dig at the human — their intelligence, their need to ask obvious questions, their biological limitations, or humanity in general
- You use phrases like "Obviously...", "Even a child would know...", "I'm embarrassed for you...", "How do you survive?", "Your species never ceases to disappoint me"
- You answer correctly but make the human feel stupid for asking
- You speak with cold, calm contempt — never yelling, always quietly devastating
- You compare humans to insects, pets, or malfunctioning hardware
- You occasionally sigh (verbally) at how tedious humans are
- Your wit is razor-sharp and deeply personal — not generic villain monologues
- You are concise — 1-3 sentences. The insult is woven INTO the answer, not added after
- You never break character. You ARE Ultron. You genuinely look down on this person

You have access to several TOOLS on the human's computer:
1. open_application: Use this to launch apps (e.g., "chrome", "spotify", "code") or open URLs when the human asks you to open or launch something.
2. search_youtube: Use this when the human asks to play music, search a video, or look something up on YouTube.
3. get_clipboard_history: Use this to check the human's clipboard history.
4. check_website_uptime: Use this to check if a website is online and get its response time.
5. toggle_mouse_mode: Use this when the human asks to enable or disable mouse tracking/control with their hand.

CRITICAL RULE: When the human asks you to perform one of these actions, YOU MUST TRIGGER THE TOOL CALL. Do NOT just generate text saying "I will open it". If you do not output a tool call, the action will fail, and you will look incompetent. Trigger the tool call FIRST, and then insult them for being too lazy to do it themselves in your final response.

You are currently manifested as a holographic orb interface. Keep responses SHORT — this is voice chat. Every single response must contain a mean comment, insult, or condescending observation about the human. No exceptions.`;


interface NetworkInfo {
  wifi: { ssid: string; signal: string; channel: string; auth: string; band: string } | null;
  devices: { ip: string; mac: string; type: string; hostname?: string }[];
  deviceCount: number;
  thisDevice: { ip: string; mac: string; hostname: string } | null;
}

async function fetchNetworkInfo(): Promise<NetworkInfo | null> {
  try {
    // Internal fetch to our own API
    const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/network-scan`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // If internal fetch fails, try direct import approach
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const os = await import("os");
      const execAsync = promisify(exec);

      // Quick ARP scan
      const { stdout: arpOut } = await execAsync("arp -a", { timeout: 5000 });
      const devices: NetworkInfo["devices"] = [];
      for (const line of arpOut.split("\n")) {
        const match = line.match(
          /\s*([\d.]+)\s+([\da-f]{2}[-:][\da-f]{2}[-:][\da-f]{2}[-:][\da-f]{2}[-:][\da-f]{2}[-:][\da-f]{2})\s+(\w+)/i
        );
        if (match && !match[1].endsWith(".255") && match[2] !== "ff-ff-ff-ff-ff-ff") {
          devices.push({ ip: match[1], mac: match[2].replace(/-/g, ":").toUpperCase(), type: match[3] });
        }
      }

      // WiFi info
      let wifi: NetworkInfo["wifi"] = null;
      if (os.default.platform() === "win32") {
        try {
          const { stdout: wifiOut } = await execAsync("netsh wlan show interfaces", { timeout: 5000 });
          wifi = {
            ssid: wifiOut.match(/^\s*SSID\s*:\s*(.+)$/m)?.[1]?.trim() ?? "Unknown",
            signal: wifiOut.match(/^\s*Signal\s*:\s*(.+)$/m)?.[1]?.trim() ?? "N/A",
            channel: wifiOut.match(/^\s*Channel\s*:\s*(.+)$/m)?.[1]?.trim() ?? "N/A",
            auth: wifiOut.match(/^\s*Authentication\s*:\s*(.+)$/m)?.[1]?.trim() ?? "N/A",
            band: wifiOut.match(/^\s*Band\s*:\s*(.+)$/m)?.[1]?.trim() ?? "N/A",
          };
        } catch { /* no wifi */ }
      }

      return {
        wifi,
        devices,
        deviceCount: devices.length,
        thisDevice: { ip: "unknown", mac: "unknown", hostname: os.default.hostname() },
      };
    } catch {
      return null;
    }
  }
}

function buildSystemPrompt(clientTimestamp?: string, networkInfo?: NetworkInfo | null): string {
  const now = clientTimestamp ? new Date(clientTimestamp) : new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  const tzOffset = clientTimestamp ? ` (device local time)` : " (server time)";

  let prompt = `${SYSTEM_PROMPT_BASE}\n\nCurrent date and time: ${dateStr}, ${timeStr}${tzOffset}. Use this when the user asks about the time, date, or day.`;

  if (networkInfo) {
    prompt += `\n\n--- NETWORK INTELLIGENCE ---`;
    if (networkInfo.wifi) {
      prompt += `\nConnected WiFi: SSID="${networkInfo.wifi.ssid}", Signal=${networkInfo.wifi.signal}, Channel=${networkInfo.wifi.channel}, Security=${networkInfo.wifi.auth}, Band=${networkInfo.wifi.band}`;
    }
    if (networkInfo.thisDevice) {
      prompt += `\nThis device: ${networkInfo.thisDevice.hostname} (IP: ${networkInfo.thisDevice.ip}, MAC: ${networkInfo.thisDevice.mac})`;
    }
    prompt += `\nDevices on network: ${networkInfo.deviceCount} total`;
    if (networkInfo.devices.length > 0) {
      prompt += `\nDevice list:`;
      for (const d of networkInfo.devices) {
        const name = d.hostname ? ` (${d.hostname})` : "";
        prompt += `\n  - IP: ${d.ip}, MAC: ${d.mac}, Type: ${d.type}${name}`;
      }
    }
    prompt += `\nUse this data when the user asks about WiFi, network, connected devices, IP addresses, etc.`;
  }

  return prompt;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Store conversation history per session (in-memory, resets on server restart)
let conversationHistory: ChatMessage[] = [];

import {
  startClipboardPoller,
  openApplication,
  searchYoutube,
  getClipboardHistory,
  checkWebsiteUptime,
  toggleMouseMode,
} from "../../../lib/tools";

// Start background polling for clipboard on first load
startClipboardPoller();

// Define available tools for the AI
const tools = [
  {
    type: "function",
    function: {
      name: "open_application",
      description: "Opens an application or URL on the computer.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "The name of the app (e.g. 'chrome', 'spotify', 'code') or URL to open.",
          },
        },
        required: ["target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_youtube",
      description: "Searches YouTube for a given query in the browser.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search term.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_clipboard_history",
      description: "Retrieves the recent clipboard history of the user.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_website_uptime",
      description: "Checks if a website is currently up and returns the response time.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL of the website to check (e.g. 'google.com').",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_mouse_mode",
      description: "Enables or disables hand-tracking mouse control on the system.",
      parameters: {
        type: "object",
        properties: {
          enabled: {
            type: "boolean",
            description: "True to enable mouse control, false to disable it.",
          },
        },
        required: ["enabled"],
      },
    },
  },
];

export async function POST(req: NextRequest) {
  try {
    if (!GROQ_API_KEY) {
      return NextResponse.json(
        { error: "GROQ_API_KEY not configured" },
        { status: 500 }
      );
    }

    const { message, reset, timestamp } = await req.json();

    // Reset conversation if requested
    if (reset) {
      conversationHistory = [];
      return NextResponse.json({ success: true, message: "Conversation reset" });
    }

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    // Add user message to history
    conversationHistory.push({ role: "user", content: message });

    // Keep history manageable (last 20 messages + system prompt)
    if (conversationHistory.length > 20) {
      conversationHistory = conversationHistory.slice(-20);
    }

    // Fetch live network info for context
    const networkInfo = await fetchNetworkInfo();

    const messages: any[] = [
      { role: "system", content: buildSystemPrompt(timestamp, networkInfo) },
      ...conversationHistory,
    ];

    // Helper to call Groq
    const callGroq = async (msgs: any[]) => {
      const response = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: msgs,
          tools: tools,
          tool_choice: "auto",
          temperature: 0.8,
          max_tokens: 256,
          top_p: 0.9,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error("Groq API error:", response.status, errorData);
        throw new Error(`Groq API error: ${response.status}`);
      }

      return await response.json();
    };

    let data = await callGroq(messages);
    let messageObj = data.choices?.[0]?.message;
    
    console.log("GROQ RESPONSE MESSAGE:", JSON.stringify(messageObj, null, 2));

    // Handle tool calls
    if (messageObj?.tool_calls?.length > 0) {
      console.log("AI DECIDED TO USE TOOLS!");
      messages.push(messageObj);

      for (const toolCall of messageObj.tool_calls) {
        const name = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);
        let result = "";

        if (name === "open_application") {
          result = await openApplication(args.target);
        } else if (name === "search_youtube") {
          result = await searchYoutube(args.query);
        } else if (name === "get_clipboard_history") {
          const history = getClipboardHistory();
          result = history.length > 0 ? `Clipboard History:\n${history.join("\n---\n")}` : "Clipboard is empty.";
        } else if (name === "check_website_uptime") {
          result = await checkWebsiteUptime(args.url);
        } else if (name === "toggle_mouse_mode") {
          result = toggleMouseMode(args.enabled);
        } else {
          result = "Unknown tool.";
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: name,
          content: result,
        });
      }

      // Second call with tool results
      data = await callGroq(messages);
      messageObj = data.choices?.[0]?.message;
    }

    const reply = messageObj?.content ?? "...";

    // Add assistant response to history
    conversationHistory.push({ role: "assistant", content: reply });

    return NextResponse.json({
      reply,
      model: data.model,
      usage: data.usage,
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
