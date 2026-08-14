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
  daemonProcess = spawn("python", [scriptPath], {
    stdio: "inherit",
    windowsHide: true,
  });

  daemonProcess.on("close", () => {
    daemonProcess = null;
  });
}

export function sendMouseCommand(payload: any) {
  if (!globalMouseModeEnabled) return;
  
  if (!daemonProcess) {
    startDaemon();
  }

  const message = Buffer.from(JSON.stringify(payload));
  udpClient.send(message, UDP_PORT, "127.0.0.1", (err) => {
    if (err) console.error("UDP send error:", err);
  });
}
