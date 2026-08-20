import dgram from "dgram";
import { spawn, ChildProcess } from "child_process";
import path from "path";

let daemonProcess: ChildProcess | null = null;
const udpClient = dgram.createSocket("udp4");
const UDP_PORT = 5005;

// Global state for mouse mode
export let globalMouseModeEnabled = false;

export function setMouseMode(enabled: boolean) {
  globalMouseModeEnabled = enabled;
  if (enabled) {
    startDaemon();
  }
}

export function startDaemon() {
  if (daemonProcess) return;

  const scriptPath = path.join(process.cwd(), "mouse_daemon.py");
  
  // Use a log file so we can debug why it crashes
  const fs = require('fs');
  const out = fs.openSync(path.join(process.cwd(), 'daemon_out.log'), 'a');
  const err = fs.openSync(path.join(process.cwd(), 'daemon_err.log'), 'a');

  // Kill orphaned instances to free port 5005 & 5006 (Windows)
  try {
      require('child_process').execSync('taskkill /F /IM python.exe /T', { stdio: 'ignore' });
  } catch (e) {
      // Ignored if no python process found
  }

  daemonProcess = spawn("python", [scriptPath], {
    stdio: ['ignore', out, err],
    windowsHide: true,
  });

  daemonProcess.on("close", () => {
    daemonProcess = null;
  });
}

export function sendMouseCommand(payload: any) {
  if (!globalMouseModeEnabled) {
      // In agent mode we might not have globalMouseModeEnabled to true by default
      // but we still want to send commands. So let's ensure daemon is running.
      if (!daemonProcess) startDaemon();
  } else {
      if (!daemonProcess) startDaemon();
  }
  
  const message = Buffer.from(JSON.stringify(payload));
  udpClient.send(message, UDP_PORT, "127.0.0.1", (err) => {
    if (err) console.error("UDP send error:", err);
  });
}

// Helper methods for Agent
export function agentClick() {
  sendMouseCommand({ action: "click" });
}

export function agentDoubleClick() {
  sendMouseCommand({ action: "double_click" });
}

export function agentType(text: string) {
  sendMouseCommand({ action: "type", text });
}

export function agentKey(key: string) {
  sendMouseCommand({ action: "key", key });
}

export function agentMove(x: number, y: number) {
  sendMouseCommand({ action: "move", x, y });
}
