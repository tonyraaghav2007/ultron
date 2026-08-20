import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import si from "systeminformation";

const execAsync = promisify(exec);

export interface NetworkDevice {
  ip: string;
  mac: string;
  type: string;
  hostname?: string;
  vendor?: string;
  category?: string;
}

export interface WifiInfo {
  ssid: string;
  signal: string;
  channel: string;
  auth: string;
  band: string;
}

export interface NetworkScanResult {
  wifi: WifiInfo | null;
  devices: NetworkDevice[];
  deviceCount: number;
  thisDevice: { ip: string; mac: string; hostname: string } | null;
  scanTime: string;
  subnet?: string;
}

const vendorCache = new Map<string, string>();

// Common OUI prefixes for instant local lookup (no API needed)
const LOCAL_OUI: Record<string, string> = {
  "00:03:93": "Apple",
  "00:05:02": "Apple",
  "00:0A:27": "Apple",
  "00:0A:95": "Apple",
  "00:11:24": "Apple",
  "00:14:51": "Apple",
  "00:16:CB": "Apple",
  "00:17:F2": "Apple",
  "00:19:E3": "Apple",
  "00:1B:63": "Apple",
  "00:1C:B3": "Apple",
  "00:1D:4F": "Apple",
  "00:1E:52": "Apple",
  "00:1E:C2": "Apple",
  "00:1F:5B": "Apple",
  "00:1F:F3": "Apple",
  "00:21:E9": "Apple",
  "00:22:41": "Apple",
  "00:23:12": "Apple",
  "00:23:32": "Apple",
  "00:23:6C": "Apple",
  "00:23:DF": "Apple",
  "00:24:36": "Apple",
  "00:25:00": "Apple",
  "00:25:4B": "Apple",
  "00:25:BC": "Apple",
  "00:26:08": "Apple",
  "00:26:4A": "Apple",
  "00:26:B0": "Apple",
  "00:26:BB": "Apple",
  "AC:DE:48": "Apple",
  "F0:96:02": "Apple",
  "F8:9E:94": "Lenovo",
  "98:87:4C": "Router/Gateway",
  "00:12:FB": "Samsung",
  "00:15:B9": "Samsung",
  "00:16:6C": "Samsung",
  "00:17:C9": "Samsung",
  "00:18:AF": "Samsung",
  "00:1A:8A": "Samsung",
  "00:1B:98": "Samsung",
  "00:1D:25": "Samsung",
  "00:1E:7D": "Samsung",
  "00:1F:CC": "Samsung",
  "00:21:4C": "Samsung",
  "00:23:39": "Samsung",
  "00:23:99": "Samsung",
  "00:23:D6": "Samsung",
  "00:24:54": "Samsung",
  "00:24:90": "Samsung",
  "00:24:E9": "Samsung",
  "00:26:37": "Samsung",
  "5C:0A:5B": "Samsung",
  "64:B8:53": "Samsung",
  "94:35:0A": "Samsung",
  "B8:57:D8": "Samsung",
  "C8:BA:94": "Samsung",
  "00:1A:11": "Google",
  "00:27:19": "Google",
  "3C:5A:B4": "Google",
  "54:60:09": "Google",
  "94:EB:2C": "Google",
  "F4:F5:D8": "Google",
  "F4:F5:E8": "Google",
  "00:0E:58": "Google/Nest",
  "18:B4:30": "Google/Nest",
  "00:17:88": "Philips Hue",
  "00:24:E4": "Dell",
  "00:14:22": "Dell",
  "00:1C:23": "Dell",
  "B0:83:FE": "Dell",
  "00:50:56": "VMware",
  "00:0C:29": "VMware",
  "00:15:5D": "Microsoft/Hyper-V",
  "00:1D:D8": "Microsoft",
  "28:18:78": "Microsoft",
  "00:1E:65": "LG Electronics",
  "00:22:A9": "LG Electronics",
  "00:24:83": "LG Electronics",
  "00:26:E2": "LG Electronics",
  "64:99:5C": "LG Electronics",
  "00:04:4B": "NVIDIA",
  "00:09:6B": "Sony",
  "00:13:A9": "Sony",
  "00:16:FE": "Sony",
  "00:18:13": "Sony",
  "00:1A:80": "Sony",
  "00:1D:28": "Sony",
  "00:1E:A4": "Sony",
  "00:24:BE": "Sony",
  "00:25:53": "Sony",
  "00:0D:4B": "Roku",
  "00:1A:79": "Amazon",
  "00:FC:8B": "Amazon",
  "34:D2:70": "Amazon",
  "40:B4:CD": "Amazon",
  "44:65:0D": "Amazon",
  "68:37:E9": "Amazon",
  "74:C2:46": "Amazon",
  "84:D6:D0": "Amazon",
  "A0:02:DC": "Amazon",
  "AC:63:BE": "Amazon",
  "F0:27:2D": "Amazon",
  "F0:D2:F1": "Amazon",
  "00:08:22": "Intel",
  "00:13:02": "Intel",
  "00:13:CE": "Intel",
  "00:15:17": "Intel",
  "00:16:76": "Intel",
  "00:19:D1": "Intel",
  "00:1B:21": "Intel",
  "00:1C:BF": "Intel",
  "00:1E:64": "Intel",
  "00:1E:67": "Intel",
  "00:21:5C": "Intel",
  "00:22:FA": "Intel",
  "00:24:D6": "Intel",
  "00:26:C6": "Intel",
  "00:27:10": "Intel",
  "00:E0:4C": "Realtek",
  "00:E0:4F": "Realtek",
  "00:13:EF": "Realtek",
  "00:60:52": "Realtek",
  "00:0F:EA": "Xiaomi",
  "28:6C:07": "Xiaomi",
  "34:CE:00": "Xiaomi",
  "64:09:80": "Xiaomi",
  "74:23:44": "Xiaomi",
  "78:11:DC": "Xiaomi",
  "98:FA:E3": "Xiaomi",
  "AC:C1:EE": "Xiaomi",
  "F8:A4:5F": "Xiaomi",

  "00:46:4B": "Huawei",
  "00:66:4B": "Huawei",
  "00:9A:CD": "Huawei",
  "00:E0:FC": "Huawei",
  "28:6E:D4": "Huawei",
  "34:6B:D0": "Huawei",
  "48:DB:50": "Huawei",
  "4C:54:99": "Huawei",
  "58:2A:F7": "Huawei",
  "5C:7D:5E": "Huawei",
  "68:A0:F6": "Huawei",
  "70:72:3C": "Huawei",
  "78:D7:52": "Huawei",
  "88:53:D4": "Huawei",
  "AC:E2:D3": "Huawei",
  "B4:30:52": "Huawei",
  "C8:14:79": "Huawei",
  "D0:7A:B5": "Huawei",
  "E0:24:7F": "Huawei",
  "F4:55:95": "Huawei",
  "FC:48:EF": "Huawei",
  "B2:D6:E6": "Unknown IoT Device",
};

function getSubnetFromIp(ip: string): string {
  const parts = ip.split(".");
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

function isPrivateIp(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

function shouldSkipIp(ip: string, mac: string): boolean {
  return (
    ip.endsWith(".255") ||
    ip === "255.255.255.255" ||
    mac === "FF:FF:FF:FF:FF:FF" ||
    ip.startsWith("224.") ||
    ip.startsWith("239.") ||
    !isPrivateIp(ip)
  );
}

export function getLocalNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const results: { name: string; ip: string; mac: string; family: string }[] = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (!addr.internal && addr.family === "IPv4" && isPrivateIp(addr.address)) {
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

async function pingHost(ip: string): Promise<void> {
  const cmd =
    os.platform() === "win32"
      ? `ping -n 1 -w 200 ${ip}`
      : `ping -c 1 -W 1 ${ip}`;
  try {
    await execAsync(cmd, { timeout: 3000 });
  } catch {
    // Host unreachable — expected for most IPs
  }
}

async function activePingSweep(subnet: string): Promise<void> {
  const ips = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);
  const batchSize = 40;

  for (let i = 0; i < ips.length; i += batchSize) {
    await Promise.all(ips.slice(i, i + batchSize).map(pingHost));
  }
}

function lookupLocalVendor(mac: string): string | null {
  const prefix = mac.substring(0, 8).toUpperCase();
  return LOCAL_OUI[prefix] ?? null;
}

async function lookupVendorOnline(mac: string): Promise<string | null> {
  const prefix = mac.substring(0, 8).toUpperCase();
  if (vendorCache.has(prefix)) return vendorCache.get(prefix)!;

  try {
    const res = await fetch(`https://api.maclookup.app/v2/macs/${mac}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const vendor = data?.company || data?.vendor || null;
    if (vendor) vendorCache.set(prefix, vendor);
    return vendor;
  } catch {
    return null;
  }
}

async function lookupVendor(mac: string): Promise<string | null> {
  const local = lookupLocalVendor(mac);
  if (local) return local;
  return lookupVendorOnline(mac);
}

export function guessDeviceCategory(
  vendor: string | undefined,
  hostname?: string,
  ip?: string
): string {
  const v = (vendor || "").toLowerCase();
  const h = (hostname || "").toLowerCase();

  if (ip?.endsWith(".1") || v.includes("router") || v.includes("gateway")) return "Router/Gateway";
  if (h.includes("iphone") || h.includes("android") || h.includes("phone")) return "Phone";
  if (h.includes("ipad") || h.includes("tablet")) return "Tablet";
  if (h.includes("tv") || h.includes("roku") || h.includes("firetv")) return "Smart TV";
  if (h.includes("desktop") || h.includes("laptop") || h.includes("pc")) return "Computer";

  if (v.includes("apple")) return h ? "Apple Device" : "Apple Device (likely iPhone/iPad/Mac)";
  if (v.includes("samsung")) return h.includes("tv") ? "Smart TV" : "Samsung Device (Phone/TV)";
  if (v.includes("google") || v.includes("nest")) return "Google/Nest Device";
  if (v.includes("amazon")) return "Amazon Device (Echo/Fire TV)";
  if (v.includes("sony") || v.includes("lg electronics") || v.includes("roku")) return "Smart TV/Streaming";
  if (v.includes("xiaomi") || v.includes("huawei") || v.includes("oppo") || v.includes("oneplus")) return "Mobile Device";
  if (v.includes("intel") || v.includes("realtek") || v.includes("dell") || v.includes("lenovo") || v.includes("hp")) return "Computer/Laptop";
  if (v.includes("philips") || v.includes("signify") || v.includes("iot")) return "Smart Home Device";

  return vendor ? `${vendor} Device` : "Unknown Device";
}

async function getWifiInfo(): Promise<WifiInfo | null> {
  try {
    if (os.platform() === "win32") {
      const { stdout } = await execAsync("netsh wlan show interfaces", { timeout: 5000 });
      const ssid = stdout.match(/^\s*SSID\s*:\s*(.+)$/m)?.[1]?.trim() ?? "Unknown";
      const signal = stdout.match(/^\s*Signal\s*:\s*(.+)$/m)?.[1]?.trim() ?? "N/A";
      const channel = stdout.match(/^\s*Channel\s*:\s*(.+)$/m)?.[1]?.trim() ?? "N/A";
      const auth = stdout.match(/^\s*Authentication\s*:\s*(.+)$/m)?.[1]?.trim() ?? "N/A";
      const band =
        stdout.match(/^\s*Band\s*:\s*(.+)$/m)?.[1]?.trim() ??
        stdout.match(/^\s*Radio type\s*:\s*(.+)$/m)?.[1]?.trim() ??
        "N/A";
      return { ssid, signal, channel, auth, band };
    }

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

function parseArpTable(stdout: string): NetworkDevice[] {
  const devices: NetworkDevice[] = [];
  const seen = new Set<string>();

  for (const line of stdout.split("\n")) {
    let ip: string | undefined;
    let mac: string | undefined;
    let type = "dynamic";

    if (os.platform() === "win32") {
      const match = line.match(
        /\s*([\d.]+)\s+([\da-f]{2}[-:][\da-f]{2}[-:][\da-f]{2}[-:][\da-f]{2}[-:][\da-f]{2}[-:][\da-f]{2})\s+(\w+)/i
      );
      if (match) {
        ip = match[1];
        mac = match[2].replace(/-/g, ":").toUpperCase();
        type = match[3].toLowerCase();
      }
    } else {
      const match = line.match(
        /\(?([\d.]+)\)?\s+.*?([\da-f]{2}:[\da-f]{2}:[\da-f]{2}:[\da-f]{2}:[\da-f]{2}:[\da-f]{2})/i
      );
      if (match) {
        ip = match[1];
        mac = match[2].toUpperCase();
      }
    }

    if (!ip || !mac || seen.has(ip) || shouldSkipIp(ip, mac)) continue;
    seen.add(ip);
    devices.push({ ip, mac, type });
  }

  return devices;
}

async function resolveHostname(ip: string): Promise<string | undefined> {
  try {
    if (os.platform() === "win32") {
      const { stdout } = await execAsync(`nbtstat -A ${ip} 2>nul`, { timeout: 3000 });
      const nameMatch = stdout.match(/^\s*(\S+)\s+<00>\s+UNIQUE/m);
      if (nameMatch) return nameMatch[1];
    } else {
      const { stdout } = await execAsync(`host ${ip}`, { timeout: 3000 });
      const match = stdout.match(/domain name pointer (.+)\./);
      if (match) return match[1];
    }
  } catch {
    // hostname resolution failed
  }
  return undefined;
}

async function enrichDevices(devices: NetworkDevice[]): Promise<NetworkDevice[]> {
  const enriched = await Promise.all(
    devices.map(async (device) => {
      const [hostname, vendor] = await Promise.all([
        resolveHostname(device.ip),
        lookupVendor(device.mac),
      ]);
      const category = guessDeviceCategory(vendor ?? undefined, hostname, device.ip);
      return {
        ...device,
        ...(hostname ? { hostname } : {}),
        ...(vendor ? { vendor } : {}),
        category,
      };
    })
  );
  return enriched;
}

export async function scanNetwork(options?: { activeScan?: boolean }): Promise<NetworkScanResult> {
  const activeScan = options?.activeScan ?? true;
  const localInterfaces = getLocalNetworkInfo();
  const thisDevice = localInterfaces[0];
  const subnet = thisDevice ? getSubnetFromIp(thisDevice.ip) : null;

  const wifiPromise = getWifiInfo();

  if (activeScan && subnet) {
    await activePingSweep(subnet);
  }

  let devices: NetworkDevice[] = [];
  try {
    const { stdout } = await execAsync("arp -a", { timeout: 10000 });
    devices = parseArpTable(stdout);
  } catch {
    // ARP read failed
  }

  if (thisDevice && !devices.find((d) => d.ip === thisDevice.ip)) {
    devices.unshift({
      ip: thisDevice.ip,
      mac: thisDevice.mac,
      type: "self",
      hostname: os.hostname(),
    });
  }

  devices = await enrichDevices(devices);

  const wifi = await wifiPromise;

  return {
    wifi,
    devices,
    deviceCount: devices.length,
    thisDevice: thisDevice
      ? { ip: thisDevice.ip, mac: thisDevice.mac, hostname: os.hostname() }
      : null,
    scanTime: new Date().toISOString(),
    ...(subnet ? { subnet } : {}),
  };
}
