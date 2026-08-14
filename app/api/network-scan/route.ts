import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import si from "systeminformation";

const execAsync = promisify(exec);

interface NetworkDevice {
  ip: string;
  mac: string;
  type: string; // "dynamic" | "static" | "unknown"
  hostname?: string;
}

interface WifiInfo {
  ssid: string;
  signal: string;
  channel: string;
  auth: string;
  band: string;
}

async function getWifiInfo(): Promise<WifiInfo | null> {
  try {
    if (os.platform() === "win32") {
      const { stdout } = await execAsync("netsh wlan show interfaces", { timeout: 5000 });
      const ssid = stdout.match(/^\s*SSID\s*:\s*(.+)$/m)?.[1]?.trim() ?? "Unknown";
      const signal = stdout.match(/^\s*Signal\s*:\s*(.+)$/m)?.[1]?.trim() ?? "N/A";
      const channel = stdout.match(/^\s*Channel\s*:\s*(.+)$/m)?.[1]?.trim() ?? "N/A";
      const auth = stdout.match(/^\s*Authentication\s*:\s*(.+)$/m)?.[1]?.trim() ?? "N/A";
      const band = stdout.match(/^\s*Band\s*:\s*(.+)$/m)?.[1]?.trim() ??
                    stdout.match(/^\s*Radio type\s*:\s*(.+)$/m)?.[1]?.trim() ?? "N/A";
      return { ssid, signal, channel, auth, band };
    }
    // macOS / Linux fallback using systeminformation
    const wifiNets = await si.wifiNetworks();
    if (wifiNets.length > 0) {
      const w = wifiNets[0];
      return {
        ssid: w.ssid || "Unknown",
        signal: `${w.signalLevel || "N/A"}`,
        channel: `${w.channel || "N/A"}`,
        auth: w.security?.join(", ") || "N/A",
        band: w.frequency ? `${w.frequency}MHz` : "N/A",
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function getNetworkDevices(): Promise<NetworkDevice[]> {
  const devices: NetworkDevice[] = [];

  try {
    if (os.platform() === "win32") {
      // Use ARP table to find devices on the network
      const { stdout } = await execAsync("arp -a", { timeout: 10000 });
      const lines = stdout.split("\n");

      for (const line of lines) {
        // Match lines like: 192.168.1.1     aa-bb-cc-dd-ee-ff     dynamic
        const match = line.match(
          /\s*([\d.]+)\s+([\da-f]{2}[-:][\da-f]{2}[-:][\da-f]{2}[-:][\da-f]{2}[-:][\da-f]{2}[-:][\da-f]{2})\s+(\w+)/i
        );
        if (match) {
          const ip = match[1];
          const mac = match[2].replace(/-/g, ":").toUpperCase();
          const type = match[3].toLowerCase();

          // Skip broadcast and multicast addresses
          if (
            ip.endsWith(".255") ||
            ip === "255.255.255.255" ||
            mac === "FF:FF:FF:FF:FF:FF" ||
            ip.startsWith("224.") ||
            ip.startsWith("239.")
          ) {
            continue;
          }

          devices.push({ ip, mac, type });
        }
      }
    } else {
      // Linux/macOS
      try {
        const { stdout } = await execAsync("arp -a", { timeout: 10000 });
        const lines = stdout.split("\n");
        for (const line of lines) {
          const match = line.match(/\(?([\d.]+)\)?\s+.*?([\da-f]{2}:[\da-f]{2}:[\da-f]{2}:[\da-f]{2}:[\da-f]{2}:[\da-f]{2})/i);
          if (match) {
            devices.push({
              ip: match[1],
              mac: match[2].toUpperCase(),
              type: "dynamic",
            });
          }
        }
      } catch {
        // arp not available
      }
    }

    // Try to resolve hostnames for discovered devices
    for (const device of devices) {
      try {
        if (os.platform() === "win32") {
          const { stdout } = await execAsync(`nbtstat -A ${device.ip} 2>nul`, { timeout: 3000 });
          const nameMatch = stdout.match(/^\s*(\S+)\s+<00>\s+UNIQUE/m);
          if (nameMatch) {
            device.hostname = nameMatch[1];
          }
        }
      } catch {
        // hostname resolution failed, that's fine
      }
    }
  } catch {
    // ARP scan failed
  }

  return devices;
}

// Get this device's local IP and interface info
function getLocalNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const results: { name: string; ip: string; mac: string; family: string }[] = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (!addr.internal && addr.family === "IPv4") {
        results.push({
          name,
          ip: addr.address,
          mac: addr.mac?.toUpperCase() || "N/A",
          family: addr.family,
        });
      }
    }
  }
  return results;
}

export async function GET() {
  try {
    const [wifiInfo, devices] = await Promise.all([
      getWifiInfo(),
      getNetworkDevices(),
    ]);

    const localInterfaces = getLocalNetworkInfo();
    const thisDevice = localInterfaces[0];

    // Add this device to the list if not already present
    if (thisDevice && !devices.find((d) => d.ip === thisDevice.ip)) {
      devices.unshift({
        ip: thisDevice.ip,
        mac: thisDevice.mac,
        type: "self",
        hostname: os.hostname(),
      });
    }

    return NextResponse.json({
      wifi: wifiInfo,
      devices,
      deviceCount: devices.length,
      thisDevice: thisDevice
        ? { ip: thisDevice.ip, mac: thisDevice.mac, hostname: os.hostname() }
        : null,
      scanTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Network scan error:", error);
    return NextResponse.json(
      { error: "Failed to scan network" },
      { status: 500 }
    );
  }
}
