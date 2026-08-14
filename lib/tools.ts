import { exec } from "child_process";
import { promisify } from "util";
import os from "os";

const execAsync = promisify(exec);

// --- Clipboard History ---
let clipboardHistory: string[] = [];
let isPollingClipboard = false;

async function fetchCurrentClipboard(): Promise<string> {
  try {
    if (os.platform() === "win32") {
      const { stdout } = await execAsync('powershell -command "Get-Clipboard"', { timeout: 2000 });
      return stdout.trim();
    } else if (os.platform() === "darwin") {
      const { stdout } = await execAsync("pbpaste", { timeout: 2000 });
      return stdout.trim();
    } else {
      const { stdout } = await execAsync("xclip -selection clipboard -o", { timeout: 2000 });
      return stdout.trim();
    }
  } catch {
    return "";
  }
}

export function startClipboardPoller() {
  if (isPollingClipboard) return;
  isPollingClipboard = true;

  setInterval(async () => {
    const text = await fetchCurrentClipboard();
    if (text && text.length > 0) {
      if (clipboardHistory.length === 0 || clipboardHistory[0] !== text) {
        clipboardHistory.unshift(text);
        if (clipboardHistory.length > 10) {
          clipboardHistory.pop();
        }
      }
    }
  }, 3000); // Check every 3 seconds
}

export function getClipboardHistory(): string[] {
  return clipboardHistory;
}

// --- App Launcher ---
export async function openApplication(target: string): Promise<string> {
  try {
    let cmd = "";
    if (os.platform() === "win32") {
      // Use powershell Start-Process to ensure it spawns visibly on the desktop
      cmd = `powershell -WindowStyle Hidden -Command "Start-Process '${target}'"`;
    } else if (os.platform() === "darwin") {
      cmd = `open "${target}"`;
    } else {
      cmd = `xdg-open "${target}"`;
    }
    await execAsync(cmd);
    return `Successfully opened ${target}`;
  } catch (error: any) {
    try {
        if (os.platform() === "win32") {
            await execAsync(`start ${target}`);
            return `Successfully opened ${target}`;
        }
    } catch {
        // ignore
    }
    return `Failed to open ${target}: ${error.message}`;
  }
}

// --- YouTube Control ---
export async function searchYoutube(query: string): Promise<string> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  return openApplication(url);
}

// --- Uptime Monitor ---
export async function checkWebsiteUptime(url: string): Promise<string> {
  try {
    if (!url.startsWith("http")) {
      url = "https://" + url;
    }
    const start = Date.now();
    const res = await fetch(url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(5000) });
    const ms = Date.now() - start;
    if (res.ok) {
      return `Website is UP. Response time: ${ms}ms. Status: ${res.status}`;
    } else {
      return `Website returned error status: ${res.status} ${res.statusText}`;
    }
  } catch (error: any) {
    return `Website appears to be DOWN or unreachable. Error: ${error.message}`;
  }
}

// --- Mouse Control ---
import { setMouseMode, globalMouseModeEnabled } from "./mouseClient";

export function toggleMouseMode(enabled: boolean): string {
  setMouseMode(enabled);
  return `Mouse mode is now ${enabled ? "ENABLED" : "DISABLED"}.`;
}

