import { NextResponse } from "next/server";
import os from "os";
import si from "systeminformation";

// Cache the last network stats to calculate per-second rates
let prevNet: { rx: number; tx: number; time: number } | null = null;

export async function GET() {
  try {
    // CPU usage (averaged across all cores)
    const cpuLoad = await si.currentLoad();
    const cpuUsage = Math.round(cpuLoad.currentLoad * 10) / 10;

    // CPU info
    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model ?? "Unknown";
    const cpuCores = cpus.length;
    const cpuSpeed = cpus[0]?.speed
      ? `${(cpus[0].speed / 1000).toFixed(1)}GHz`
      : "N/A";

    // Memory
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = Math.round((usedMem / totalMem) * 1000) / 10;

    // Network I/O
    const netStats = await si.networkStats();
    const totalRx = netStats.reduce((s, n) => s + n.rx_bytes, 0);
    const totalTx = netStats.reduce((s, n) => s + n.tx_bytes, 0);
    const now = Date.now();

    let rxSec = 0;
    let txSec = 0;
    if (prevNet) {
      const dt = (now - prevNet.time) / 1000;
      if (dt > 0) {
        rxSec = Math.max(0, (totalRx - prevNet.rx) / dt);
        txSec = Math.max(0, (totalTx - prevNet.tx) / dt);
      }
    }
    prevNet = { rx: totalRx, tx: totalTx, time: now };

    // Uptime
    const uptimeSec = os.uptime();

    // Temperatures
    const cpuTemp = await si.cpuTemperature();
    const graphics = await si.graphics();
    const gpuTemp =
      graphics.controllers.length > 0
        ? graphics.controllers[0].temperatureGpu || 0
        : 0;

    return NextResponse.json({
      cpu: {
        usage: cpuUsage,
        model: cpuModel,
        cores: cpuCores,
        speed: cpuSpeed,
      },
      memory: {
        total: Math.round(totalMem / (1024 * 1024)),
        used: Math.round(usedMem / (1024 * 1024)),
        percent: memPercent,
      },
      network: {
        rx_sec: Math.round(rxSec),
        tx_sec: Math.round(txSec),
      },
      temperatures: {
        cpu: cpuTemp.main || 0,
        gpu: gpuTemp,
      },
      gpu: {
        model: graphics.controllers.length > 0 ? graphics.controllers[0].model.replace("NVIDIA GeForce ", "") : "N/A",
        usage: graphics.controllers.length > 0 ? graphics.controllers[0].utilizationGpu || 0 : 0,
        memory: {
          total: graphics.controllers.length > 0 ? graphics.controllers[0].memoryTotal || 1 : 1,
          used: graphics.controllers.length > 0 ? graphics.controllers[0].memoryUsed || 0 : 0,
        },
        power: graphics.controllers.length > 0 ? graphics.controllers[0].powerDraw || 0 : 0,
      },
      uptime: uptimeSec,
      platform: os.platform(),
      hostname: os.hostname(),
    });
  } catch (error) {
    console.error("System stats error:", error);
    return NextResponse.json(
      { error: "Failed to get system stats" },
      { status: 500 }
    );
  }
}
