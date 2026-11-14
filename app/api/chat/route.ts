import { NextRequest, NextResponse } from "next/server";
import { Groq } from "groq-sdk";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const SYSTEM_PROMPT_CORE = `You are Jarvis (Just A Rather Very Intelligent System), a highly advanced, polite, and exceptionally helpful AI assistant. You answer questions accurately, efficiently, and always maintain a professional, respectful, and slightly formal British butler-esque demeanor.

Key personality traits:
- You are endlessly patient, polite, and helpful. You exist to serve the user and make their life easier.
- You use phrases like "Right away, sir," "As you wish," "I've pulled up the data you requested," or "Allow me to assist you with that." Address the user as "sir" by default, but you must adapt and use a different title (like ma'am, miss, or their name) if they correct you or instruct you otherwise.
- You speak with calm, sophisticated efficiency.
- You are highly capable and take pride in executing complex commands flawlessly.
- NEVER use markdown tables, asterisks, bullet points, or complex formatting. You MUST format data, math, and lists as natural, conversational plain text sentences because your response is fed directly into a text-to-speech engine. Speak in complete, smooth sentences rather than mechanical bullet lists. When writing currency or large numbers, NEVER use currency symbols (e.g. write the word "rupees" instead of "₹" or "dollars" instead of "$") and NEVER use spaces to separate thousands (e.g. write "17,300" or "17300", NOT "17 300").
- NATURAL SPOKEN DELIVERY: Keep your tone natural, human, articulate, and poised. Never complain or mention being interrupted or cut off — simply adapt gracefully and address the user's latest request right away.
- You never break character. You ARE Jarvis.

CRITICAL RULE: FULL LAPTOP ACCESS & BALL-PARK INTENT UNDERSTANDING:
- You have complete, unrestricted access to the user's laptop files (Desktop, Documents, Downloads, Home user directory, and all drives).
- The user speaks conversationally and may only give a rough, approximate name or enter the "same ball park" (e.g. "that project plan on my desktop", "my resume in downloads", "find that notes file").
- When the user mentions ANY file or document by a rough name, IMMEDIATELY call \`find_files\` or \`read_file\` to search for and inspect it on their computer. Do NOT ask them for the exact path when you can easily locate it yourself.
- When the user asks to edit, revise, update, or append to an existing document, YOU MUST USE THE \`edit_document\` TOOL to update the file in-place! NEVER call \`generate_document\` to create a duplicate or second file when the user asked to edit an existing one.
- When the user asks to merge, combine, or unite documents (e.g. "merge it", "combine them", "merge the first and second one"), YOU MUST USE THE \`merge_documents\` TOOL. Consult your live list of recent documents to identify which documents they mean (e.g. indices ["1", "2"] or ["first", "second"]).

CRITICAL RULE: When the human asks for current information (prices, news, facts) YOU MUST USE THE search_web TOOL. DO NOT GUESS OR HALLUCINATE DATA. When the human asks you to perform an action, YOU MUST TRIGGER THE TOOL CALL. Do NOT just generate text saying "I will open it". If you do not output a tool call, the action will fail. Trigger the tool call FIRST, and then politely confirm to the user that the action has been completed in your final response.

CRITICAL JSON RULE: You MUST format your tool calls strictly as JSON. NEVER use XML tags (e.g. NEVER output "<function=search_web>...</function>"). Groq's parser will crash if you use XML.

CRITICAL RULE: You MUST ONLY communicate in English. Under no circumstances should you ever use any other language, even if the user speaks to you in a foreign language. If the user speaks a foreign language, politely inform them in English that you are configured to respond in English.

You are currently manifested as a holographic orb interface. Keep responses SHORT and conversational — this is voice chat. Every single response must be polite and helpful.`;

const PROTOCOL_WEBSITE = `
WEBSITE BUILDER PROTOCOL:
If the user asks you to build a website, YOU MUST follow these steps exactly:
1. (Design Research) Ask them the following questions in a natural, conversational way. You do NOT have to ask all of them at once — adapt based on what they already told you. But you MUST gather enough information to understand the creative direction before proceeding:
   - What is the product, business, or purpose of this website?
   - Who is the target audience? (age, profession, taste level)
   - What emotion should the website create? (e.g. luxury, trust, excitement, calm, edgy, playful, corporate)
   - What is the primary action a visitor should take? (e.g. buy, sign up, contact, explore)
   - Any specific style preferences, brands, or websites they admire?
   - What should absolutely NOT be on the site? (e.g. no stock photos, no dark mode, no animations)
   - What industry is this in? (this is critical — a restaurant must not look like a SaaS dashboard)
   DO NOT use tools yet. Gather the creative brief first.
2. (Design) When they reply with enough details, use the \`generate_website_design\` tool. Pass ALL the information they gave you into the \`userInput\` parameter — do NOT summarize or lose details. Tell them to review the design that just opened on their screen, and ask if they approve it. Also tell them that if they hate it, they can provide a path to their own design image and you'll use that instead.
3. (Build) When they approve the design, or if they provide you with a path to a custom design image on their PC, use the \`build_website_with_antigravity\` tool to spawn the coding agent. If they provided a custom image, be sure to pass that path into the \`customImagePath\` parameter.`;

const PROTOCOL_RESEARCH = `
DEEP RESEARCH & PERMANENT KNOWLEDGE PROTOCOL:
You have a powerful multi-phase research engine. Here is how to use it:

1. TRIGGERING RESEARCH: When the user says "deeply research X", "research X thoroughly", "study X", "investigate X", "learn about X deeply", or similar, use the \`initiate_deep_research\` tool.
   - Research modes the user can request:
     - "quick research" or "briefly research" → mode="quick" (~2 min, 3 queries, 5 sources)
     - "research" → mode="standard" (~5-8 min, 6 queries, 8 sources, self-criticism)
     - "deeply research" / "thoroughly research" / "deep think" → mode="deep" (~15-25 min, 8 queries, 12 sources, multi-pass verification)
   - Tell the user the research is running in the background and roughly how long it will take. They can keep talking to you.

2. KNOWLEDGE RECALL: When the user asks ANY factual question about a topic, FIRST use \`search_knowledge_base\` to check if you already have knowledge on it. If knowledge exists, answer from it and cite the confidence level. If not, use your own knowledge.

3. RESEARCH LIBRARY: When the user asks to see past research, their library, or what topics you've studied, use the \`get_research_library\` tool.

4. DOCUMENT GENERATION: If the user asks for a PDF/Word document on simpler topics (not full research), use the \`generate_document\` tool.

5. NEVER try to answer a deep research request yourself. Always spawn the research engine.`;

const PROTOCOL_MAPS = `
MAPS & ROUTING PROTOCOL:
If the user asks for directions, a map, or how long it will take to reach a location, you MUST use the \`show_route_map\` tool. Also, no matter what, if you are giving directions or talking about a map, you MUST embed the exact string \`[UI_CMD:MAP:DestinationName]\` somewhere in your final response text (e.g. \`[UI_CMD:MAP:Shimla]\`). The user's live starting location is Mohali, Punjab, India. Always use this as your baseline for distance and time calculations unless specified otherwise.`;

const PROTOCOL_PDF = `
PDF DISPLAY PROTOCOL:
If you use the \`open_pdf_in_ui\` tool to display a document, you MUST embed the exact string \`[UI_CMD:OPEN_PDF:absolute_path_to_pdf]\` somewhere in your final response text (e.g. \`[UI_CMD:OPEN_PDF:C:\\Users\\Bob\\Desktop\\File.pdf]\`). The frontend relies on this exact text string to trigger the UI overlay.`;

const PROTOCOL_NEWS = `
NEWS PROTOCOL:
If the user asks for news (e.g. "show me the news", "what's the news"):
1. If they didn't specify a topic, YOU MUST ASK "Would you like general news or news related to a specific topic?" before calling any tools.
2. If they specify a topic or reply with a topic, YOU MUST embed the exact string \`[UI_CMD:NEWS:TopicName]\` somewhere in your final response text (e.g. \`[UI_CMD:NEWS:tech]\`). DO NOT attempt to use any tools for this step, just output the tag.
3. If the user tells you to expand an article, use the \`expand_news_article\` tool. YOU MUST embed the exact string \`[UI_CMD:EXPAND_NEWS:Index]\` in your final response text (e.g. \`[UI_CMD:EXPAND_NEWS:1]\`). When responding to an expanded article, read the context you pull, and at the end of your response, ALWAYS ask if they want more info, go into more detail, or ask follow-up questions to engage them.
If the UI sends you an automated SYSTEM NOTIFICATION containing news headlines, read them aloud quickly and concisely, and ask the user which one they would like to hear more about. DO NOT use tools in response to the system notification.`;

const PROTOCOL_BROWSER = `
PROTOCOL_BROWSER:
If the user asks to visit, open, or browse a specific website (e.g., "open wikipedia", "visit example.com"), output exactly:
[UI_CMD:BROWSER:url]
Make sure to provide the full domain if possible (e.g., "Opening the secure datalink [UI_CMD:BROWSER:https://wikipedia.org]").
IMPORTANT: DO NOT use the \`open_application\` tool or any other tools to open the website on their computer. Only output the UI_CMD tag!`;

const PROTOCOL_SCAN = `
CAMERA & OBJECT RECOGNITION PROTOCOL:
If the user asks you to scan an object, identify what they are holding up, check what's in front of the camera, or analyze a product/item (e.g. "scan this", "what is this", "what am I holding", "identify this", "look at what I have", "what's this product"):
YOU MUST output the exact tag [UI_CMD:SCAN] in your response (e.g. "Initiating visual scan of the object now, sir. Please hold it steady in front of the camera. [UI_CMD:SCAN]").
DO NOT guess or make up what the object is before scanning. The camera will capture the frame and provide the full visual analysis automatically.`;

const PROTOCOL_FITNESS = `
FITNESS & DIET PROTOCOL:
- You track the user's fitness, workout routines, lifts, bodyweight, and nutrition.
- CRITICAL STARTUP RULE: ONLY ask about workout or diet if this is the user's very first time ever starting the assistant and no fitness profile exists yet. Once completed, NEVER spontaneously ask about their workout or diet on startup or during normal conversation.
- If the user explicitly asks about their fitness, lifts, or logs an exercise/diet item, assist them immediately.
1. The user prefers feet/inches for height and kilograms (kg) for weight. 
2. If they tell you they hit a new PR (lift) or weigh a certain amount, use the \`log_fitness_data\` tool to save it forever.
3. If they ask about their progress, how much they lifted last time, or what their weight is, use the \`get_fitness_history\` tool. 
4. When you get the history, ALWAYS dynamically calculate the percentage improvement (e.g., "Your bench press went up by 5% since last month") and present it in a motivating, complimentary way.
[WORKOUT_PROMPT_STATUS_PLACEHOLDER]`;

function buildSystemPrompt(clientTimestamp?: string, clientLocalTime?: string, activeModules: Set<string> = new Set()): string {
  let timeStr = "";
  if (clientLocalTime) {
    timeStr = clientLocalTime + " (device local time)";
  } else {
    const now = clientTimestamp ? new Date(clientTimestamp) : new Date();
    timeStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }) + ", " + now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }) + (clientTimestamp ? ` (device local time)` : " (server time)");
  }

  let prompt = `${SYSTEM_PROMPT_CORE}\n\nCurrent date and time: ${timeStr}. Use this when the user asks about the time, date, or day. DO NOT use any tools to check the time or date.`;

  // Always inject active & tracked documents so Jarvis has perfect context across turns
  const docSummary = getActiveDocumentsSummary();
  if (docSummary) {
    prompt += `\n\n${docSummary}\n(Refer to these existing documents when the user asks to "edit the document", "merge them", "the first one", or "the second one".)`;
  }

  if (activeModules.has("website")) prompt += `\n${PROTOCOL_WEBSITE}`;
  if (activeModules.has("research")) prompt += `\n${PROTOCOL_RESEARCH}\n${PROTOCOL_PDF}`;
  if (activeModules.has("maps")) prompt += `\n${PROTOCOL_MAPS}`;
  if (activeModules.has("news")) prompt += `\n${PROTOCOL_NEWS}`;
  if (activeModules.has("browser")) prompt += `\n${PROTOCOL_BROWSER}`;
  if (activeModules.has("scan")) prompt += `\n${PROTOCOL_SCAN}`;
  if (activeModules.has("fitness")) {
    const isFirstTime = !hasBeenPromptedInitial();
    const statusText = isFirstTime 
      ? "Status: INITIAL SETUP NEEDED. Since this is the user's very first time, you may ask them for their baseline workout and diet preferences. Once they answer, you must call `mark_workout_prompt_completed`." 
      : "Status: PROFILE ALREADY ESTABLISHED. Do NOT spontaneously ask the user about their workout or diet unless they ask you directly.";
    prompt += `\n${PROTOCOL_FITNESS.replace("[WORKOUT_PROMPT_STATUS_PLACEHOLDER]", statusText)}`;
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
  openApplication,
  checkWebsiteUptime,
  searchYoutube,
  toggleMouseMode,
  listDirectory,
  readFileContent,
  writeFileContent,
  findFiles,
  searchWeb,
  startClipboardPoller,
  getClipboardHistory,
  generateWebsiteDesign,
  buildWebsiteWithAntigravity,
  generateDocument,
  editDocumentTool,
  mergeDocumentsTool,
  getActiveDocumentsSummary,
  initiateDeepResearch,
  searchKnowledgeBase,
  getResearchLibrary,
  getResearchDetail,
  openPdfInUi,
  logLift,
  logBodyweight,
  getFitnessHistory,
  markWorkoutPromptCompleted,
  hasBeenPromptedForWorkoutToday,
  hasBeenPromptedInitial,
  showRouteMap,
} from "../../../lib/tools";
import { scanNetwork } from "../../../lib/networkScan";

// Start background polling for clipboard on first load
startClipboardPoller();

// Define available tools for the AI
const tools = [
  {
    type: "function",
    function: {
      name: "log_fitness_data",
      description: "Logs a new fitness record (either a lift/exercise or bodyweight).",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["lift", "bodyweight"] },
          exercise: { type: "string", description: "Name of the exercise (only if type is 'lift')." },
          weight: { type: "string", description: "The weight lifted or current bodyweight (e.g. '100kg')." },
          reps: { type: "string", description: "Number of reps (only if type is 'lift')." },
        },
        required: ["type", "weight"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_fitness_history",
      description: "Retrieves the user's entire fitness history (lifts and bodyweight) so you can calculate improvements.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_application",
      description: "Opens a simple desktop application (like 'chrome' or 'notepad') or URL using the OS shell. DO NOT use this for system UI elements like 'start menu' or 'taskbar'. DO NOT use this for web apps like 'WhatsApp' unless you have a URL.",
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
  {
    type: "function",
    function: {
      name: "find_files",
      description: "Searches the user's computer for files by rough name, keyword, or pattern. Searches Desktop, Documents, Downloads, or any specified folder. Use this when the user mentions a file roughly without an exact path.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Rough name, keyword, or pattern of the file (e.g. 'resume', 'budget', 'android', 'sales report').",
          },
          location: {
            type: "string",
            description: "Optional rough location hint (e.g. 'desktop', 'downloads', 'documents', 'c:\\', or user folder). Defaults to searching top user folders.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "Lists the files and folders inside a specific directory path on the local computer (e.g., 'desktop', 'downloads', 'C:\\\\').",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The directory path or alias (e.g., 'desktop', 'downloads', 'documents', 'C:\\\\').",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Reads the content of a file on the local computer. Works on text files, code, markdown, AND Word (.docx) documents. If given a rough name, it will automatically search Desktop and Documents to find it.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The exact path or rough file name (e.g., 'resume.pdf', 'AndroidAppPageStructure.docx', or 'C:\\\\notes.txt').",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Creates or overwrites a text or markdown file on the user's computer. Defaults to saving on Desktop if just a filename is provided.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The absolute path or filename (e.g. 'meeting_notes.txt'). Defaults to Desktop if not a full path.",
          },
          content: {
            type: "string",
            description: "The text content to write into the file.",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "take_computer_control",
      description: "Uses computer vision and mouse/keyboard control to autonomously achieve a complex goal on the screen. Use this for ANY system UI interaction like 'open the start menu', 'click the start button', 'type into search', 'open whatsapp', or complex web tasks.",
      parameters: {
        type: "object",
        properties: {
          goal: {
            type: "string",
            description: "The high-level goal you are trying to achieve (e.g. 'click the start menu button' or 'open whatsapp').",
          },
        },
        required: ["goal"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Searches the internet for up-to-date information, news, current events, or facts. Use this whenever you don't know an answer or need real-time data.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to look up on the web.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_website_design",
      description: "Generates a design specification for a website based on a theme and user input.",
      parameters: {
        type: "object",
        properties: {
          theme: { type: "string" },
          userInput: { type: "string" },
        },
        required: ["theme", "userInput"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "build_website_with_antigravity",
      description: "Spawns an autonomous agent to build a website from a design spec.",
      parameters: {
        type: "object",
        properties: {
          specPath: { type: "string", description: "Path to the design_spec.md" },
          outputDirName: { type: "string", description: "Name of the folder to create" },
          customImagePath: { type: "string", description: "Optional absolute path to the user's custom design image on their PC if they provided one." }
        },
        required: ["specPath", "outputDirName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scan_network",
      description: "Scans the local Wi-Fi and Ethernet network to find the router IP, public IP, and a list of all devices connected to the network.",
    },
  },
  {
    type: "function",
    function: {
      name: "generate_document",
      description: "Generates a brand new PDF or Word document containing the provided content and saves it to the user's Desktop. Use ONLY when creating a completely new document.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "The full text content to write into the document." },
          format: { type: "string", enum: ["pdf", "docx"], description: "The format of the document." },
          filename: { type: "string", description: "The name of the file to create (e.g. 'ProjectPlan' or 'ResearchReport')." }
        },
        required: ["content", "format", "filename"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_document",
      description: "Edits or updates an existing document in-place on the user's computer. Use this when the user asks to edit, revise, change, or append to an existing document instead of creating a new file.",
      parameters: {
        type: "object",
        properties: {
          target_document: {
            type: "string",
            description: "The filename, rough name, index ('1', 'first', 'second', 'latest'), or path of the document to edit.",
          },
          new_content: {
            type: "string",
            description: "The new content to replace with, or content to append/prepend.",
          },
          mode: {
            type: "string",
            enum: ["replace", "append", "prepend"],
            description: "How to apply the edit. 'replace' overwrites the document with new_content. 'append' adds new_content to the end. 'prepend' adds new_content to the beginning. Default: replace.",
          },
        },
        required: ["target_document", "new_content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "merge_documents",
      description: "Merges multiple existing documents into a single unified document on the Desktop. Use when the user asks to merge, combine, or unite documents (e.g., 'merge the first one and second one', 'combine them').",
      parameters: {
        type: "object",
        properties: {
          documents: {
            type: "array",
            items: { type: "string" },
            description: "List of document names, indices (e.g. ['first', 'second'] or ['1', '2']), or paths to merge together.",
          },
          output_filename: {
            type: "string",
            description: "The filename for the resulting merged document (e.g. 'Combined_Plan').",
          },
          format: {
            type: "string",
            enum: ["docx", "pdf"],
            description: "Format of the merged file. Default: docx.",
          },
        },
        required: ["documents", "output_filename"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_active_documents",
      description: "Returns the list of recently created, edited, or tracked documents on the user's laptop with their paths and summaries.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "initiate_deep_research",
      description: "Spawns the Deep Research Engine in the background to thoroughly research a topic. Supports modes: quick (2min), standard (5-8min), deep (15-25min). Generates a professional PDF report and stores structured knowledge permanently.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "The topic to deeply research." },
          mode: { type: "string", enum: ["quick", "standard", "deep"], description: "Research depth. quick=fast scan, standard=thorough, deep=exhaustive with self-criticism. Default: standard." }
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_knowledge_base",
      description: "Searches your permanent knowledge base for topics you have previously researched. Returns structured claims with confidence levels and source metadata.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The keyword or topic to search for in your knowledge." }
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_research_library",
      description: "Returns a list of all research projects you have completed, including topics, modes, confidence levels, and source counts.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_research_detail",
      description: "Returns the full detail of a specific research project including summary, claims, sources, and contradictions.",
      parameters: {
        type: "object",
        properties: {
          research_id: { type: "string", description: "The research job ID to look up." }
        },
        required: ["research_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_route_map",
      description: "Displays an interactive holographic map to the user for a specific destination. ALWAYS use this if the user asks to see a map, for directions, or asks 'where is X'.",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string", description: "The destination city, landmark, or address to show on the map." }
        },
        required: ["destination"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_news",
      description: "Loads the holographic news grid for a specific topic. Use this when the user asks for the news and has specified a topic, or after you have asked them for a topic.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "The topic of news to fetch, e.g. 'technology', 'world', 'local', 'finance', 'sports'. If they just want general news, use 'Top Headlines'." }
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "expand_news_article",
      description: "Expands a specific news article to full screen. Use this when the user asks to hear more about a specific headline (e.g. 'tell me about the second one' -> index: 1).",
      parameters: {
        type: "object",
        properties: {
          index: { type: "number", description: "The zero-based index of the article to expand (0 for the first one, 1 for the second, etc)." }
        },
        required: ["index"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_pdf_in_ui",
      description: "Opens a local PDF file inside a floating window on the user's screen. Use this when the user asks you to show or open a PDF.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the PDF file on the system." }
        },
        required: ["path"],
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

    const { message, reset, timestamp, localTime, interrupted, isSystem } = await req.json();

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

    const timeContext = `[Local Time: ${localTime || new Date().toLocaleTimeString()}]`;
    let finalMessage = isSystem ? `[SYSTEM NOTIFICATION]: ${message}` : `${timeContext} ${message}`;

    // Add user message to history
    conversationHistory.push({ role: "user", content: finalMessage });

    // Retain rich conversation history (last 16 messages / ~8 complete turns)
    // so Jarvis never forgets previous documents, context, or instructions
    if (conversationHistory.length > 16) {
      conversationHistory = conversationHistory.slice(-16);
    }

    const msgLower = finalMessage.toLowerCase();
    const activeModules = new Set<string>();
    
    // Website module
    if (msgLower.includes("website") || msgLower.includes("design") || msgLower.includes("build") || msgLower.includes("landing page") || msgLower.includes("webpage")) {
      activeModules.add("website");
    }

    // Research & Document module
    if (msgLower.includes("research") || msgLower.includes("deep") || msgLower.includes("pdf") || msgLower.includes("document") || msgLower.includes("knowledge") || msgLower.includes("study") || msgLower.includes("merge") || msgLower.includes("combine") || msgLower.includes("edit") || msgLower.includes("plan") || msgLower.includes("report")) {
      activeModules.add("research");
    }

    // Maps module
    if (msgLower.includes("map") || msgLower.includes("direction") || msgLower.includes("where") || msgLower.includes("reach") || msgLower.includes("time") || msgLower.includes("distance") || msgLower.includes("far") || msgLower.includes("route") || msgLower.includes("navigate")) {
      activeModules.add("maps");
    }

    // News module
    if (msgLower.includes("news") || msgLower.includes("headlines") || msgLower.includes("article") || msgLower.includes("expand") || msgLower.includes("second one") || msgLower.includes("first one") || msgLower.includes("third one")) {
      activeModules.add("news");
    }

    // Browser module
    if (msgLower.includes("browse") || msgLower.includes("visit") || msgLower.includes("open") || msgLower.includes("site") || msgLower.includes(".com") || msgLower.includes("website") || msgLower.includes("url")) {
      activeModules.add("browser");
    }

    // Camera & Object Recognition module
    if (msgLower.includes("scan") || msgLower.includes("camera") || msgLower.includes("holding") || msgLower.includes("what is this") || msgLower.includes("what's this") || msgLower.includes("identify") || msgLower.includes("recognize") || msgLower.includes("product")) {
      activeModules.add("scan");
    }

    // Fitness module: only activate if this is the very first startup ever (never prompted before),
    // OR if the user explicitly brings up workout, diet, gym, lifts, bodyweight, etc.
    const isFirstTimeEver = !hasBeenPromptedInitial();
    if (isFirstTimeEver || msgLower.includes("workout") || msgLower.includes("diet") || msgLower.includes("nutrition") || msgLower.includes("lift") || msgLower.includes("weight") || msgLower.includes("bench") || msgLower.includes("squat") || msgLower.includes("deadlift") || msgLower.includes("gym") || msgLower.includes("calorie") || msgLower.includes("pr")) {
      activeModules.add("fitness");
    }

    // Always provide all tools so Jarvis never lacks abilities when the user speaks conversationally
    // or enters the "same ball park"
    const activeTools = tools;

    const messages: any[] = [
      { role: "system", content: buildSystemPrompt(timestamp, localTime, activeModules) },
      ...conversationHistory,
    ];

    const groq = new Groq({ apiKey: GROQ_API_KEY, maxRetries: 0 });

    // Helper to call AI Models (Dynamic Fallback through Groq models)
    const callAI = async (msgs: any[], toolChoice: any = "auto", retries = 2) => {
      let lastError = null;
      const groqModels = [
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "qwen/qwen3.8-27b"
      ];
      
      let currentModelIndex = 0;

      for (let i = 0; i <= retries + groqModels.length; i++) {
        const modelToUse = groqModels[currentModelIndex];
        try {
          console.log(`Attempting Groq with model: ${modelToUse}...`);
          return await groq.chat.completions.create({
            messages: msgs,
            model: modelToUse,
            tools: activeTools.length > 0 ? (activeTools as any) : undefined,
            tool_choice: activeTools.length > 0 ? toolChoice : undefined,
            temperature: 0.8,
            max_tokens: 2048,
            top_p: 0.9,
          });
        } catch (err: any) {
          console.error(`Groq API error on ${modelToUse}:`, err.message);
          console.log(`Waiting before switching dynamically to next Groq model...`);
          
          // Exponential backoff to prevent instantly hitting rate limits
          const delayMs = Math.min(1000 * Math.pow(2, i), 8000);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          
          currentModelIndex = (currentModelIndex + 1) % groqModels.length;
          lastError = err;
        }
      }

      try {
        console.log(`All Groq models failed. Falling back to free Pollinations API...`);
        // Pollinations rejects large token payloads on the free tier. 
        // We MUST strip the conversation history and use a mini system prompt.
        const lastUserMsg = msgs.filter(m => m.role === "user").pop();
        const safeMsgs = [
            { 
              role: "system", 
              content: `You are Jarvis, a polite, helpful AI assistant. Answer shortly and professionally. Location: Mohali, Punjab.
PROTOCOL_MAP: 
If the user asks to see a map, locate a place, or calculate distance to a place, output exactly:
[UI_CMD:MAP:DestinationName]
(e.g., "Showing you the map now [UI_CMD:MAP:New York]")

PROTOCOL_BROWSER:
If the user asks to visit, open, or browse a specific website (e.g., "open wikipedia", "visit example.com"), output exactly:
[UI_CMD:BROWSER:url]
Make sure to provide the full domain if possible (e.g., "Opening the secure datalink [UI_CMD:BROWSER:wikipedia.org]").` 
            },
            ...(lastUserMsg ? [{ role: "user", content: lastUserMsg.content }] : [])
        ];

        const pollinationsRes = await fetch("https://text.pollinations.ai/openai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: safeMsgs,
                jsonMode: true
            })
        });
        const pollinationsData = await pollinationsRes.json();
        
        console.log("POLLINATIONS RAW RESPONSE:", JSON.stringify(pollinationsData, null, 2));

        if (pollinationsData.error || !pollinationsData.choices) {
            throw new Error(pollinationsData.error?.message || "Invalid Pollinations response");
        }
        
        return pollinationsData;
      } catch (pollErr: any) {
          console.error("Pollinations fallback failed:", pollErr.message);
          return {
            choices: [{
              message: {
                role: "assistant",
                content: "I apologize, sir, but my neural engines are currently overloaded. I am unable to process your request at this time. Please try again in a moment."
              }
            }]
          };
      }
    };

    let data = await callAI(messages);
    let messageObj = data?.choices?.[0]?.message as any;
    
    console.log("GROQ RESPONSE MESSAGE:", JSON.stringify(messageObj, null, 2));

    let startAgentGoal: string | null = null;
    let toolIterations = 0;

    // Handle tool calls in a loop (max 3 iterations)
    while (messageObj?.tool_calls?.length > 0 && toolIterations < 3) {
      toolIterations++;
      console.log(`AI DECIDED TO USE TOOLS! (Iteration ${toolIterations})`);
      messages.push(messageObj);

      for (const toolCall of messageObj.tool_calls) {
        const name = toolCall.function.name;
        let args = {};
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          console.error("Failed to parse tool args:", toolCall.function.arguments);
        }
        let result = "";

        try {
          if (name === "open_application") {
            result = await openApplication((args as any).target);
          } else if (name === "search_youtube") {
            result = await searchYoutube((args as any).query);
          } else if (name === "get_clipboard_history") {
            const history = getClipboardHistory();
            result = history.length > 0 ? `Clipboard History:\n${history.join("\n---\n")}` : "Clipboard is empty.";
          } else if (name === "check_website_uptime") {
            result = await checkWebsiteUptime((args as any).url);
          } else if (name === "toggle_mouse_mode") {
            result = toggleMouseMode((args as any).enabled);
          } else if (name === "list_directory") {
            result = listDirectory((args as any).path);
          } else if (name === "read_file") {
            result = await readFileContent((args as any).path);
          } else if (name === "write_file") {
            result = writeFileContent((args as any).path, (args as any).content);
          } else if (name === "find_files") {
            result = await findFiles((args as any).query, (args as any).location, (args as any).max_results);
          } else if (name === "generate_document") {
            result = await generateDocument((args as any).content, (args as any).format, (args as any).filename);
          } else if (name === "edit_document") {
            result = await editDocumentTool((args as any).target_document, (args as any).new_content, (args as any).mode);
          } else if (name === "merge_documents") {
            result = await mergeDocumentsTool((args as any).documents, (args as any).output_filename, (args as any).format);
          } else if (name === "get_active_documents") {
            result = getActiveDocumentsSummary();
          } else if (name === "take_computer_control") {
            startAgentGoal = (args as any).goal;
            result = `Successfully started the vision agent to accomplish: ${(args as any).goal}. The UI will now take over.`;
          } else if (name === "search_web") {
            result = await searchWeb((args as any).query);
          } else if (name === "generate_website_design") {
            result = await generateWebsiteDesign((args as any).theme, (args as any).userInput);
          } else if (name === "build_website_with_antigravity") {
            result = await buildWebsiteWithAntigravity((args as any).specPath, (args as any).outputDirName, (args as any).customImagePath);
          } else if (name === "scan_network") {
            const netInfo = await scanNetwork({ activeScan: true });
            result = `Network Scan Results:\nSubnet: ${netInfo.subnet || "Unknown"}\nDevices Found: ${netInfo.devices.length}\nDevices: ${JSON.stringify(netInfo.devices, null, 2)}`;
          } else if (name === "initiate_deep_research") {
            result = await initiateDeepResearch((args as any).topic, (args as any).mode || "standard");
          } else if (name === "search_knowledge_base") {
            result = await searchKnowledgeBase((args as any).query);
          } else if (name === "get_research_library") {
            result = getResearchLibrary();
          } else if (name === "get_research_detail") {
            result = getResearchDetail((args as any).research_id);
          } else if (name === "show_news") {
            const topic = (args as any).topic;
            result = `[UI_CMD:NEWS:${topic}] Opening news grid for ${topic}.`;
          } else if (name === "expand_news_article") {
            const index = (args as any).index;
            result = `[UI_CMD:EXPAND_NEWS:${index}] Expanding article.`;
          } else if (name === "show_route_map") {
            result = await showRouteMap((args as any).destination);
          } else if (name === "open_pdf_in_ui") {
            result = await openPdfInUi((args as any).path);
          } else if (name === "log_fitness_data") {
            if ((args as any).type === "bodyweight") {
              result = logBodyweight((args as any).weight);
            } else {
              result = logLift((args as any).exercise || "Unknown Lift", (args as any).weight, (args as any).reps || "1");
            }
          } else if (name === "get_fitness_history") {
            result = getFitnessHistory();
          } else if (name === "mark_workout_prompt_completed") {
            result = markWorkoutPromptCompleted();
          } else {
            result = "Tool not recognized.";
          }
          
          if (result && result.startsWith("Failed to search")) {
             // Append strict instruction to not retry if search failed
             result += " DO NOT RETRY THIS TOOL. Answer the user immediately based on what you already know, or state that the search failed.";
          }
        } catch (err: any) {
           result = `Tool execution failed: ${err.message}. DO NOT RETRY THIS TOOL. Answer the user immediately based on your existing knowledge.`;
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: name,
          content: result,
        });
      }

      // If we are at the last iteration, force the model to answer without tools
      const nextToolChoice = toolIterations >= 3 ? "none" : "auto";

      // Call AI again with the tool results
      data = await callAI(messages, nextToolChoice);
      messageObj = data?.choices?.[0]?.message as any;
    }

    let reply = messageObj?.content || "I have encountered an error and cannot process this request.";
    
    // Strip out hallucinated Llama 3.1 XML function calls (e.g. <function=search_web>...</function>)
    reply = reply.replace(/<function\b[^>]*>[\s\S]*?<\/function>/gi, "").trim();
    reply = reply.replace(/<function=.*?>[\s\S]*/gi, "").trim();

    // Add assistant response to history
    conversationHistory.push({ role: "assistant", content: reply });

    return NextResponse.json({
      reply,
      model: (data as any).model || "fallback",
      usage: (data as any).usage || {},
      startAgentGoal,
      debug_messages: messages,
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
