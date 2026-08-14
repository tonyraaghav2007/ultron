"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createOrbScene, type OrbSceneApi } from "@/lib/orbScene";
import { HandTracker, type TrackerStatus } from "@/lib/handTracker";
import { AudioAnalyser, type AudioLevels } from "@/lib/audioAnalyser";
import { VoiceEngine, type VoiceState } from "@/lib/voiceEngine";

type CameraState = "off" | "starting" | "on" | "error";

const MODE_LABEL: Record<TrackerStatus["mode"], string> = {
  idle: "STANDBY",
  spin: "SPIN",
  zoom: "ZOOM",
};

interface SystemStats {
  cpu: { usage: number; model: string; cores: number; speed: string };
  memory: { total: number; used: number; percent: number };
  network: { rx_sec: number; tx_sec: number };
  temperatures: { cpu: number; gpu: number };
  uptime: number;
  platform: string;
  hostname: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB/s`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB/s`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${h}h ${m}m`;
}

const VOICE_STATE_LABEL: Record<VoiceState, string> = {
  idle: "ACTIVATE ULTRON",
  wake_listening: "SAY \"ULTRON\"",
  listening: "LISTENING…",
  thinking: "PROCESSING…",
  speaking: "ULTRON SPEAKS",
};

export default function JarvisOrb() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<OrbSceneApi | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const audioRef = useRef<AudioAnalyser | null>(null);
  const audioRafRef = useRef<number>(0);
  const systemIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceRef = useRef<VoiceEngine | null>(null);
  const systemActiveRef = useRef(false);

  const [camera, setCamera] = useState<CameraState>("off");
  const [status, setStatus] = useState<TrackerStatus>({ hands: 0, mode: "idle" });
  const [error, setError] = useState<string | null>(null);

  // Audio reactive state
  const [audioActive, setAudioActive] = useState(false);
  const [audioLevels, setAudioLevels] = useState<AudioLevels>({ bass: 0, mid: 0, treble: 0, overall: 0 });

  // System monitor state
  const [systemActive, setSystemActive] = useState(false);
  systemActiveRef.current = systemActive;
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);

  // Voice interaction state
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState<string>("");
  const [response, setResponse] = useState<string>("");
  const [chatLog, setChatLog] = useState<Array<{ role: "user" | "ultron"; text: string }>>([]);

  // ——— Scene lifecycle ———
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = createOrbScene(container);
    sceneRef.current = scene;
    return () => {
      trackerRef.current?.stop();
      trackerRef.current = null;
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // ——— Voice engine init ———
  useEffect(() => {
    const engine = new VoiceEngine({
      onStateChange: setVoiceState,
      onTranscript: (text, isFinal) => {
        setTranscript(text);
        if (isFinal) {
          setChatLog((prev) => [...prev.slice(-8), { role: "user", text }]);
        }
      },
      onResponse: (text) => {
        setResponse(text);
        setChatLog((prev) => [...prev.slice(-8), { role: "ultron", text }]);
      },
      onError: (err) => setError(err),
      onSpeakingLevel: (level) => {
        sceneRef.current?.setAudioLevels(
          level * 0.8,
          level * 0.5,
          level * 0.3,
          level * 0.6,
        );
      },
      onWakeWordDetected: () => {
        setTranscript("");
        setError(null);
      },
    });
    voiceRef.current = engine;

    // Load voices (some browsers need a delay)
    window.speechSynthesis.getVoices();

    return () => {
      engine.dispose();
      voiceRef.current = null;
    };
  }, []);

  // ——— Gesture controls ———
  const stopGestures = useCallback(() => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    setCamera("off");
    setStatus({ hands: 0, mode: "idle" });
  }, []);

  const startGestures = useCallback(async () => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay || trackerRef.current) return;

    setCamera("starting");
    setError(null);
    sceneRef.current?.setDormant(false);

    const tracker = new HandTracker(video, overlay, {
      onRotate: (dt, dp) => sceneRef.current?.rotateBy(dt, dp),
      onZoom: (factor) => sceneRef.current?.zoomBy(factor),
      onStatus: setStatus,
      onPulse: (count) => {
        if (count === 1) sceneRef.current?.cycleColor();
        else if (count === 2) {
          // Kill all active features
          if (voiceRef.current && voiceRef.current.state !== "idle") {
            voiceRef.current.stopAll();
          }
          if (audioRef.current) stopAudio();
          if (systemActiveRef.current) stopSystem();
          // Enter dormant mode — grey, no glow
          sceneRef.current?.setDormant(true);
          // Stop gestures last (after a tiny delay so the pulse is fully processed)
          setTimeout(() => stopGestures(), 200);
        }
      },
    });
    trackerRef.current = tracker;

    try {
      await tracker.start();
      setCamera("on");
    } catch (err) {
      trackerRef.current = null;
      tracker.stop();
      setCamera("error");
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "CAMERA ACCESS DENIED"
          : "TRACKING INIT FAILED",
      );
    }
  }, []);

  const toggleGestures = useCallback(() => {
    if (trackerRef.current) stopGestures();
    else void startGestures();
  }, [startGestures, stopGestures]);

  // ——— Audio reactive controls ———
  const stopAudio = useCallback(() => {
    if (audioRafRef.current) cancelAnimationFrame(audioRafRef.current);
    audioRafRef.current = 0;
    audioRef.current?.stop();
    audioRef.current = null;
    setAudioActive(false);
    setAudioLevels({ bass: 0, mid: 0, treble: 0, overall: 0 });
    sceneRef.current?.setAudioLevels(0, 0, 0, 0);
  }, []);

  const startAudio = useCallback(async () => {
    if (audioRef.current) return;
    const analyser = new AudioAnalyser();
    try {
      await analyser.start();
      audioRef.current = analyser;
      setAudioActive(true);
      sceneRef.current?.setDormant(false);

      const pump = () => {
        if (!audioRef.current?.running) return;
        const levels = audioRef.current.getLevels();
        setAudioLevels(levels);
        sceneRef.current?.setAudioLevels(levels.bass, levels.mid, levels.treble, levels.overall);
        audioRafRef.current = requestAnimationFrame(pump);
      };
      pump();
    } catch {
      analyser.stop();
      setError("MIC ACCESS DENIED");
    }
  }, []);

  const toggleAudio = useCallback(() => {
    if (audioRef.current) stopAudio();
    else void startAudio();
  }, [startAudio, stopAudio]);

  // ——— System monitor controls ———
  const stopSystem = useCallback(() => {
    if (systemIntervalRef.current) {
      clearInterval(systemIntervalRef.current);
      systemIntervalRef.current = null;
    }
    setSystemActive(false);
    setSystemStats(null);
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/system-stats");
      if (!res.ok) return;
      const data: SystemStats = await res.json();
      setSystemStats(data);

      const snippets = [
        `CPU ${data.cpu.usage}%`,
        `${data.cpu.cores} CORES`,
        `${data.cpu.speed}`,
        `CPU TEMP ${data.temperatures.cpu > 0 ? `${Math.round(data.temperatures.cpu)}°C` : "N/A"}`,
        `GPU TEMP ${data.temperatures.gpu > 0 ? `${Math.round(data.temperatures.gpu)}°C` : "N/A"}`,
        `RAM ${data.memory.percent}%`,
        `${(data.memory.used / 1024).toFixed(1)}/${(data.memory.total / 1024).toFixed(1)}GB`,
        `NET ↓${formatBytes(data.network.rx_sec)}`,
        `NET ↑${formatBytes(data.network.tx_sec)}`,
        `UP ${formatUptime(data.uptime)}`,
        data.hostname.toUpperCase(),
        data.platform.toUpperCase(),
        `>> MONITOR`,
        `SYS OK`,
        `LOAD ${data.cpu.usage > 80 ? "HIGH" : data.cpu.usage > 50 ? "MED" : "LOW"}`,
      ];
      sceneRef.current?.updateSystemText(snippets);
    } catch {
      // Silently handle fetch errors
    }
  }, []);

  const startSystem = useCallback(() => {
    setSystemActive(true);
    sceneRef.current?.setDormant(false);
    void fetchStats();
    systemIntervalRef.current = setInterval(() => void fetchStats(), 2000);
  }, [fetchStats]);

  const toggleSystem = useCallback(() => {
    if (systemActive) stopSystem();
    else startSystem();
  }, [systemActive, startSystem, stopSystem]);

  // ——— Voice controls ———
  const toggleVoice = useCallback(() => {
    const engine = voiceRef.current;
    if (!engine) return;

    if (engine.state === "idle") {
      // Start always-on wake word listening
      setError(null);
      setTranscript("");
      sceneRef.current?.setDormant(false);
      engine.startWakeListening();
    } else {
      // Stop everything
      engine.stopAll();
    }
  }, []);

  // Manual push-to-talk (spacebar) — bypasses wake word
  const manualVoice = useCallback(() => {
    const engine = voiceRef.current;
    if (!engine) return;
    if (engine.state === "thinking" || engine.state === "speaking") return;
    setError(null);
    setTranscript("");
    sceneRef.current?.setDormant(false);
    engine.manualListen();
  }, []);

  // ——— Cleanup on unmount ———
  useEffect(() => {
    return () => {
      stopAudio();
      stopSystem();
    };
  }, [stopAudio, stopSystem]);

  // ——— Reset audio levels when Ultron stops speaking ———
  useEffect(() => {
    if ((voiceState === "idle" || voiceState === "wake_listening") && !audioActive) {
      sceneRef.current?.setAudioLevels(0, 0, 0, 0);
    }
  }, [voiceState, audioActive]);

  // ——— Keyboard shortcuts ———
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if an input is focused
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case "+":
        case "=":
          sceneRef.current?.zoomIn();
          break;
        case "-":
        case "_":
          sceneRef.current?.zoomOut();
          break;
        case "r":
        case "R":
          sceneRef.current?.resetView();
          break;
        case "g":
        case "G":
          toggleGestures();
          break;
        case "a":
        case "A":
          toggleAudio();
          break;
        case "s":
        case "S":
          toggleSystem();
          break;
        case " ":
          e.preventDefault();
          manualVoice();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleGestures, toggleAudio, toggleSystem, manualVoice]);

  const cameraOn = camera === "on";
  const isVoiceBusy = voiceState === "thinking" || voiceState === "speaking";

  return (
    <>
      <div ref={containerRef} className="orb-root" />

      <div className="overlay-vignette" />
      <div className="overlay-grain" />
      <div className="overlay-scanlines" />

      {/* Camera feed — top-left */}
      <div className={`hud camera-feed-topleft${cameraOn ? " visible" : ""}`}>
        <div className="camera-panel visible">
          <video ref={videoRef} muted playsInline className="camera-video" />
          <canvas ref={overlayRef} width={208} height={156} className="camera-overlay" />
          <div className="camera-status">
            {status.hands > 0
              ? `${status.hands} HAND${status.hands > 1 ? "S" : ""} · ${MODE_LABEL[status.mode]}`
              : "SHOW HANDS"}
          </div>
        </div>
      </div>

      {/* Audio level meter — top-right */}
      {audioActive && (
        <div className="hud audio-meter">
          <div className="audio-meter-label">AUDIO</div>
          <div className="audio-meter-bars">
            <div className="audio-bar-track">
              <div className="audio-bar bass" style={{ height: `${audioLevels.bass * 100}%` }} />
              <span className="audio-bar-label">B</span>
            </div>
            <div className="audio-bar-track">
              <div className="audio-bar mid" style={{ height: `${audioLevels.mid * 100}%` }} />
              <span className="audio-bar-label">M</span>
            </div>
            <div className="audio-bar-track">
              <div className="audio-bar treble" style={{ height: `${audioLevels.treble * 100}%` }} />
              <span className="audio-bar-label">T</span>
            </div>
          </div>
        </div>
      )}

      {/* Voice interaction panel — top center */}
      <div className={`hud voice-panel${voiceState !== "idle" || chatLog.length > 0 ? " visible" : ""}`}>
        {/* Chat log */}
        {chatLog.length > 0 && (
          <div className="voice-chat-log">
            {chatLog.slice(-4).map((msg, i) => (
              <div key={i} className={`voice-chat-msg ${msg.role}`}>
                <span className="voice-chat-role">{msg.role === "user" ? "YOU" : "ULTRON"}</span>
                <span className="voice-chat-text">{msg.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* Current state indicator */}
        {voiceState !== "idle" && (
          <div className={`voice-state ${voiceState}`}>
            <div className="voice-state-indicator">
              <span className="voice-pulse" />
              <span className="voice-pulse" />
              <span className="voice-pulse" />
            </div>
            <span className="voice-state-label">{VOICE_STATE_LABEL[voiceState]}</span>
          </div>
        )}

        {/* Live transcript */}
        {voiceState === "listening" && transcript && (
          <div className="voice-transcript">&quot;{transcript}&quot;</div>
        )}
      </div>

      {/* System stats panel — bottom-left */}
      {systemActive && systemStats && (
        <div className="hud system-panel">
          <div className="system-panel-title">SYSTEM MONITOR</div>
          <div className="system-stat">
            <span className="system-label">CPU</span>
            <span className="system-value">{systemStats.cpu.usage}%</span>
            <div className="system-bar-track">
              <div
                className={`system-bar${systemStats.cpu.usage > 80 ? " high" : systemStats.cpu.usage > 50 ? " med" : ""}`}
                style={{ width: `${systemStats.cpu.usage}%` }}
              />
            </div>
          </div>
          <div className="system-stat">
            <span className="system-label">RAM</span>
            <span className="system-value">{systemStats.memory.percent}%</span>
            <div className="system-bar-track">
              <div
                className={`system-bar${systemStats.memory.percent > 80 ? " high" : systemStats.memory.percent > 50 ? " med" : ""}`}
                style={{ width: `${systemStats.memory.percent}%` }}
              />
            </div>
          </div>
          <div className="system-stat">
            <span className="system-label">NET ↓</span>
            <span className="system-value">{formatBytes(systemStats.network.rx_sec)}</span>
          </div>
          <div className="system-stat">
            <span className="system-label">NET ↑</span>
            <span className="system-value">{formatBytes(systemStats.network.tx_sec)}</span>
          </div>
          <div className="system-stat">
            <span className="system-label">UP</span>
            <span className="system-value">{formatUptime(systemStats.uptime)}</span>
          </div>
          <div className="system-stat host">
            <span className="system-value">{systemStats.hostname}</span>
          </div>
        </div>
      )}

      {/* Controls — bottom-right */}
      <div className="hud hud-controls">
        {error && <div className="hud-error">{error}</div>}

        <div className="hud-row">
          <button
            type="button"
            className={`hud-btn voice-btn ${voiceState}`}
            onClick={toggleVoice}
            disabled={isVoiceBusy}
            aria-pressed={voiceState === "listening"}
          >
            {VOICE_STATE_LABEL[voiceState]}
          </button>
        </div>
        <div className="hud-row">
          <button
            type="button"
            className="hud-btn"
            aria-pressed={cameraOn}
            onClick={toggleGestures}
            disabled={camera === "starting"}
          >
            {camera === "starting" ? "INITIALIZING…" : cameraOn ? "GESTURES ON" : "GESTURES OFF"}
          </button>
        </div>
        <div className="hud-row">
          <button
            type="button"
            className="hud-btn"
            aria-pressed={audioActive}
            onClick={toggleAudio}
          >
            {audioActive ? "AUDIO ON" : "AUDIO OFF"}
          </button>
          <button
            type="button"
            className="hud-btn"
            aria-pressed={systemActive}
            onClick={toggleSystem}
          >
            {systemActive ? "SYSTEM ON" : "SYSTEM OFF"}
          </button>
        </div>
        <div className="hud-row">
          <button type="button" className="hud-btn" onClick={() => sceneRef.current?.resetView()}>
            RESET
          </button>
        </div>
      </div>
    </>
  );
}
