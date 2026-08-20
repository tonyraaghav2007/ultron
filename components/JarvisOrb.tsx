"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createOrbScene, type OrbSceneApi } from "@/lib/orbScene";
import { HandTracker, type TrackerStatus } from "@/lib/handTracker";
import { AudioAnalyser, type AudioLevels } from "@/lib/audioAnalyser";
import { VoiceEngine, type VoiceState } from "@/lib/voiceEngine";
import dynamic from "next/dynamic";

const MapWidget = dynamic(() => import('./MapWidget'), { ssr: false });
const NewsWidget = dynamic(() => import('./NewsWidget'), { ssr: false });
const BrowserWidget = dynamic(() => import('./BrowserWidget'), { ssr: false });

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
  gpu: { model: string; usage: number; memory: { total: number; used: number }; power: number };
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
  idle: "STANDBY",
  wake_listening: "LISTENING FOR 'JARVIS'...",
  listening: "LISTENING…",
  thinking: "PROCESSING…",
  speaking: "JARVIS SPEAKS",
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
  const chatEndRef = useRef<HTMLDivElement>(null);

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
  const [chatLog, setChatLog] = useState<Array<{ role: "user" | "jarvis"; text: string }>>([]);

  // Agent interaction state
  const [agentActive, setAgentActive] = useState(false);
  const [agentGoal, setAgentGoal] = useState("");
  const [agentStatus, setAgentStatus] = useState("IDLE");
  const [showAgentInput, setShowAgentInput] = useState(false);
  const agentActiveRef = useRef(false);
  const isSpaceDownRef = useRef(false);

  // Deep research polling state
  const [researchState, setResearchState] = useState<{
    researchId?: string; topic?: string; mode?: string; status?: string; phase?: string;
    sourcesDiscovered?: number; sourcesRead?: number; claimsExtracted?: number;
    contradictions?: number; elapsed?: number;
    phases?: Array<{ name: string; status: string }>;
    completionSummary?: any;
    // Legacy fields
    percent?: number; message?: string;
  } | null>(null);

  // Map and PDF Mode State
  const [mapTarget, setMapTarget] = useState<string | null>(null);
  const mapTargetRef = useRef<string | null>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  useEffect(() => { mapTargetRef.current = mapTarget; }, [mapTarget]);

  const [pdfTarget, setPdfTarget] = useState<string | null>(null);

  const [newsTarget, setNewsTarget] = useState<string | null>(null);
  const [newsExpandedIndex, setNewsExpandedIndex] = useState<number | null>(null);

  const [browserTarget, setBrowserTarget] = useState<string | null>(null);

  // Throttle orb scene performance when a widget (map/pdf/news/browser) is active
  useEffect(() => {
    sceneRef.current?.setLowPowerMode(!!mapTarget || !!pdfTarget || !!newsTarget || !!browserTarget);
  }, [mapTarget, pdfTarget, newsTarget, browserTarget]);

  // Poll deep research status
  useEffect(() => {
    const interval = setInterval(async () => {
        try {
            const res = await fetch("/api/research/status");
            const data = await res.json();
            if (data.status === "idle") {
                setResearchState(null);
            } else {
                setResearchState(data);
            }
        } catch (e) {
            setResearchState(null);
        }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Sync processing state to 3D orb
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setProcessing(voiceState === "thinking");
    }
  }, [voiceState]);

  // Auto-start wake listening when idle
  useEffect(() => {
    if (voiceState === "idle" && voiceRef.current) {
      voiceRef.current.startWakeListening();
    }
  }, [voiceState]);

  // Auto-scroll chat log
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatLog]);

  // Spacebar push-to-talk & interrupt
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !agentActiveRef.current) {
        voiceRef.current?.startRecording();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && !agentActiveRef.current) {
        voiceRef.current?.stopRecording();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // ——— Scene lifecycle ———
  useEffect(() => {
    // Ping the relay API to ensure the cloud relay daemon is running
    fetch('/api/relay').catch(console.error);

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

  // ——— Agent Loop ———
  useEffect(() => {
    agentActiveRef.current = agentActive;
    if (!agentActive) return;

    let timeoutId: NodeJS.Timeout;

    const runAgentStep = async () => {
      if (!agentActiveRef.current) return;
      try {
        setAgentStatus("THINKING");
        const res = await fetch("/api/agent/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal: agentGoal })
        });

        if (!res.ok) {
          setAgentStatus("ERROR");
        } else {
          const data = await res.json();

          if (data.action?.action === "done") {
            setAgentStatus("DONE");
            setAgentActive(false);
            return; // stop loop
          }

          if (data.action && typeof data.action.action === "string") {
            setAgentStatus(`ACTING: ${data.action.action.toUpperCase()}`);
          } else if (data.action && data.action.reason) {
            setAgentStatus(`INFO: ${data.action.reason.substring(0, 20).toUpperCase()}...`);
          } else {
            setAgentStatus("ERROR: INVALID ACTION");
          }
        }
      } catch (e) {
        console.error(e);
        setAgentStatus("ERROR");
      }

      // Schedule next step
      if (agentActiveRef.current) {
        timeoutId = setTimeout(runAgentStep, 500); // reduced pause for much faster agent
      }
    };

    runAgentStep();

    return () => clearTimeout(timeoutId);
  }, [agentActive, agentGoal]);

  const toggleAgent = useCallback(() => {
    if (agentActive) {
      setAgentActive(false);
      setAgentStatus("IDLE");
    } else {
      setShowAgentInput(prev => !prev);
    }
  }, [agentActive]);

  const startAgent = useCallback(() => {
    if (agentGoal.trim()) {
      setAgentActive(true);
      setShowAgentInput(false);
    }
  }, [agentGoal]);

  // ——— Voice engine init ———
  useEffect(() => {
    const engine = new VoiceEngine({
      onStateChange: setVoiceState,
      onTranscript: (text, isFinal) => {
        setTranscript(text);
        if (isFinal) {
          setChatLog((prev) => [...prev.slice(-50), { role: "user", text }]);
        }
      },
      onResponse: (text, data) => {
        setResponse(text);
        setChatLog((prev) => [...prev.slice(-50), { role: "jarvis", text }]);

        if (data && data.startAgentGoal) {
          setAgentGoal(data.startAgentGoal);
          setAgentActive(true);
          setShowAgentInput(false);
        }

        if (data && data.mapTarget) {
            setMapTarget(data.mapTarget);
        }
        
        if (data && data.pdfTarget) {
            setPdfTarget(data.pdfTarget);
        }

        if (data && data.newsTarget) {
            setNewsTarget(data.newsTarget);
            setNewsExpandedIndex(null); // Reset expansion on new topic
        }

        if (data && data.newsExpandedIndex !== undefined) {
            setNewsExpandedIndex(data.newsExpandedIndex);
        }
        
        if (data && data.browserTarget) {
            setBrowserTarget(data.browserTarget);
        }
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
      onListeningLevel: (level) => {
        if (orbRef.current) {
          orbRef.current.style.setProperty('--mic-level', level.toString());
        }
      },
      onWakeWordDetected: () => {
        setTranscript("");
        setError(null);
        sceneRef.current?.setDormant(false);
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioContextClass) {
            const ctx = new AudioContextClass();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = "sine";
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.3);
          }
        } catch(e) {}
      },
    });
    voiceRef.current = engine;
    
    // Start listening immediately on load, but send a system message to greet first
    setTimeout(() => {
      engine.sendSystemMessage("The user just booted you up. Greet them proactively. Ask how their day was, if they've worked out yet, and what they ate today. Keep it conversational and brief.");
    }, 1000);

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
      onRotate: (dt, dp) => {
        const dist = Math.hypot((tracker as any).x - window.innerWidth / 2, (tracker as any).y - window.innerHeight / 2);
        if (mapTargetRef.current) {
          window.dispatchEvent(new CustomEvent("map-pan", { detail: { dx: dt, dy: dp } }));
        } else {
          sceneRef.current?.rotateBy(dt, dp);
        }
      },
      onZoom: (factor) => {
        if (mapTargetRef.current) {
          window.dispatchEvent(new CustomEvent("map-zoom", { detail: { factor } }));
        } else {
          sceneRef.current?.zoomBy(factor);
        }
      },
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
    // Audio visualizer conflicts with voice — voice takes priority
    if (voiceRef.current && voiceRef.current.state !== "idle") {
      setError("TURN OFF ULTRON VOICE BEFORE ENABLING AUDIO VISUALIZER");
      return;
    }
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
      setError("MIC ACCESS DENIED — allow microphone in browser settings");
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
        `GPU 0 ${data.gpu.usage}%`,
        `VRAM ${(data.gpu.memory.used / 1024).toFixed(1)}GB`,
        `${Math.round(data.gpu.power)}W`,
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

  // ——— Voice controls (Push-to-Talk) ———
  const startVoice = useCallback(() => {
    const engine = voiceRef.current;
    if (!engine) return;
    if (engine.state === "thinking" || engine.state === "speaking") return;
    if (audioRef.current) stopAudio();
    setError(null);
    setTranscript("");
    sceneRef.current?.setDormant(false);
    void engine.startRecording();
  }, [stopAudio]);

  const stopVoice = useCallback(() => {
    const engine = voiceRef.current;
    if (!engine) return;
    engine.stopRecording();
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
    if (voiceState === "idle" && !audioActive) {
      sceneRef.current?.setAudioLevels(0, 0, 0, 0);
    }
  }, [voiceState, audioActive]);

  // ——— Keyboard shortcuts ———
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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
          if (!isSpaceDownRef.current) {
            isSpaceDownRef.current = true;
            startVoice();
          }
          break;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " ") {
        e.preventDefault();
        isSpaceDownRef.current = false;
        stopVoice();
      }
    };

    const onClickAnywhere = () => {
      if (voiceRef.current && voiceRef.current.state === "idle") {
         setError(null);
         voiceRef.current.startWakeListening();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("click", onClickAnywhere);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("click", onClickAnywhere);
    };
  }, [toggleGestures, toggleAudio, toggleSystem, startVoice, stopVoice]);

  const cameraOn = camera === "on";
  const isVoiceBusy = voiceState === "thinking" || voiceState === "speaking";

  return (
    <>
      {mapTarget && (
         <div className="holographic-map-wrapper">
            <MapWidget location={mapTarget} handState={{ ...status, x: (trackerRef.current as any)?.x || 0, y: (trackerRef.current as any)?.y || 0 }} />
            <button 
              onClick={() => setMapTarget(null)}
              className="hud-btn"
              style={{
                position: "absolute",
                top: "20px",
                right: "20px",
                zIndex: 1000,
                background: "rgba(0,0,0,0.8)",
                border: "1px solid var(--hud-base)",
              }}
            >
              CLOSE MAP
            </button>
         </div>
      )}

      {newsTarget && (
         <div className="holographic-map-wrapper">
            <NewsWidget 
               topic={newsTarget} 
               expandedIndex={newsExpandedIndex}
               aiText={response}
               onExpand={setNewsExpandedIndex}
               onArticlesLoaded={(articles) => {
                  if (voiceRef.current) {
                     if (articles.length === 0) {
                         voiceRef.current.sendSystemMessage(`News fetch failed. Inform the user that there is no recent news intel on this specific topic and ask if they'd like to search something else.`);
                         return;
                     }
                     const summary = articles.map((a, i) => `${i + 1}. ${a.title}`).join('. ');
                     voiceRef.current.sendSystemMessage(`News loaded. Headlines: ${summary}. Read them aloud and ask the user if they want to expand any.`);
                  }
               }}
            />
            <button 
              onClick={() => setNewsTarget(null)}
              className="hud-btn"
              style={{
                position: "absolute",
                top: "20px",
                right: "20px",
                zIndex: 1000,
                background: "rgba(0,0,0,0.8)",
                border: "1px solid rgba(0,200,255,0.8)",
                color: "#00e5ff"
              }}
            >
              CLOSE NEWS
            </button>
         </div>
      )}

      {pdfTarget && (
        <div className="absolute top-20 left-10 w-[45vw] min-w-[600px] h-[80vh] bg-black/80 border border-orange-500/50 rounded-lg shadow-[0_0_20px_rgba(249,115,22,0.2)] overflow-hidden z-[60] flex flex-col backdrop-blur-md font-mono">
          <div className="flex justify-between items-center p-2 border-b border-orange-500/30 bg-orange-500/10 text-orange-500 text-xs tracking-[0.2em]">
            <span className="truncate pr-4">DOCUMENT_VIEWER :: {pdfTarget.split('\\').pop()?.split('/').pop()}</span>
            <button 
                onClick={() => setPdfTarget(null)} 
                className="hover:text-white px-2 py-1 bg-orange-500/20 hover:bg-orange-500/40 rounded transition-colors"
            >
                CLOSE
            </button>
          </div>
          <iframe 
            src={`/api/file?path=${encodeURIComponent(pdfTarget)}`} 
            className="w-full h-full flex-grow bg-white" 
            title="PDF Viewer"
          />
        </div>
      )}

      {browserTarget && (
         <div className="holographic-map-wrapper">
            <BrowserWidget url={browserTarget} />
            <button 
              onClick={() => setBrowserTarget(null)}
              className="hud-btn"
              style={{
                position: "absolute",
                top: "20px",
                right: "20px",
                zIndex: 1000,
                background: "rgba(0,0,0,0.8)",
                border: "1px solid var(--hud-base)",
                color: "var(--hud-base)"
              }}
            >
              CLOSE BROWSER
            </button>
         </div>
      )}

      <div ref={containerRef} className={`orb-root ${(mapTarget || newsTarget || pdfTarget || browserTarget) ? 'map-mode' : ''}`} />

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

      {/* Deep Research Dashboard - center left */}
      {researchState && (
        <div className="hud research-panel">
          <div className="research-header">
            <span className="research-header-title">DEEP RESEARCH ENGINE</span>
            {researchState.mode && <span className={`research-mode-badge ${researchState.mode}`}>{researchState.mode?.toUpperCase()}</span>}
          </div>
          <div className="research-topic">TOPIC: {researchState.topic}</div>

          {/* Phase indicators */}
          {researchState.phases && researchState.phases.length > 0 ? (
            <div className="research-phases">
              {researchState.phases.map((p, i) => (
                <div key={i} className={`research-phase-item ${p.status}`}>
                  <span className="research-phase-icon">
                    {p.status === 'done' ? '✓' : p.status === 'active' ? '◉' : '○'}
                  </span>
                  <span className="research-phase-label">{p.name}</span>
                </div>
              ))}
            </div>
          ) : (
            /* Legacy fallback for old engine format */
            <div className="research-message">{researchState.message || researchState.phase}</div>
          )}

          {/* Live stats */}
          {(researchState.sourcesRead !== undefined || researchState.claimsExtracted !== undefined) && (
            <div className="research-stats">
              <div className="research-stat">
                <span className="research-stat-value">{researchState.sourcesRead ?? 0}</span>
                <span className="research-stat-label">SOURCES</span>
              </div>
              <div className="research-stat">
                <span className="research-stat-value">{researchState.claimsExtracted ?? 0}</span>
                <span className="research-stat-label">CLAIMS</span>
              </div>
              <div className="research-stat">
                <span className="research-stat-value">{researchState.contradictions ?? 0}</span>
                <span className="research-stat-label">CONFLICTS</span>
              </div>
            </div>
          )}

          {/* Current phase detail */}
          {researchState.phase && researchState.phases && (
            <div className="research-current-phase">{researchState.phase}</div>
          )}

          {/* Elapsed time */}
          {researchState.elapsed !== undefined && researchState.elapsed > 0 && (
            <div className="research-elapsed">
              {Math.floor(researchState.elapsed / 60)}m {researchState.elapsed % 60}s elapsed
            </div>
          )}

          {/* Progress bar - use legacy percent or calculate from phases */}
          <div className="research-bar-track">
            <div className="research-bar-fill" style={{
              width: researchState.percent !== undefined
                ? `${researchState.percent}%`
                : `${researchState.phases
                    ? Math.round((researchState.phases.filter(p => p.status === 'done').length / researchState.phases.length) * 100)
                    : 0}%`
            }}></div>
          </div>

          {/* Completion summary */}
          {researchState.status === 'completed' && researchState.completionSummary && (
            <div className="research-complete-banner">
              RESEARCH COMPLETE — {researchState.completionSummary.confidence?.toUpperCase()} CONFIDENCE
            </div>
          )}
        </div>
      )}

      {/* Voice interaction panel — bottom left */}
      <div className={`hud voice-panel visible`}>
        {/* 1. Iron Man Orb and state label (Bottom-most due to column-reverse) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', pointerEvents: 'auto' }}>
          <div 
            ref={orbRef}
            className={`iron-man-orb ${voiceState === "listening" ? "dotted" : ""}`}
            style={{
              transform: voiceState === "listening" ? "scale(calc(1.1 + var(--mic-level, 0) * 0.3))" : "scale(1)",
              cursor: "pointer",
              transition: "transform 0.05s ease-out"
            }}
            onClick={() => {
              if (voiceState === "listening") {
                stopVoice();
              } else {
                if (voiceRef.current) voiceRef.current.stopAll();
              }
            }}
            title="Click to stop/interrupt"
          />
          {voiceState !== "idle" && (
            <span className="voice-state-label" style={{ fontWeight: 'bold', fontSize: '11px', textShadow: '0 0 10px hsla(var(--theme-h), 100%, 60%, 0.8)' }}>
              {VOICE_STATE_LABEL[voiceState]}
            </span>
          )}
        </div>

        {/* 2. Live transcript (Middle) */}
        {voiceState !== "idle" && transcript && (
          <div className="voice-transcript">&quot;{transcript}&quot;</div>
        )}

        {/* 3. Chat log (Top-most) */}
        {chatLog.length > 0 && (
          <div className="voice-chat-log">
            {chatLog.map((msg, i) => (
              <div key={i} className={`voice-chat-msg ${msg.role}`}>
                <span className="voice-chat-role">{msg.role === "user" ? "YOU" : "JARVIS"}</span>
                <span className="voice-chat-text">{msg.text}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* Agent panel - top right below audio if audio is present */}
      {(showAgentInput || agentActive) && (
        <div className="hud agent-panel visible" style={{ position: 'fixed', top: '20px', right: '20px', zIndex: 100, background: 'rgba(0,0,0,0.8)', border: '1px solid var(--hud-base)', padding: '15px', color: 'var(--hud-base)', width: '300px' }}>
          <div style={{ marginBottom: '10px', fontSize: '14px', letterSpacing: '1px' }}>AGENT MODE - {agentStatus}</div>
          {!agentActive && (
            <div>
              <input
                type="text"
                value={agentGoal}
                onChange={e => setAgentGoal(e.target.value)}
                placeholder="Enter goal..."
                style={{ width: '100%', background: 'transparent', border: '1px solid var(--hud-base)', color: 'var(--hud-base)', padding: '8px', marginBottom: '10px', fontFamily: '"Courier New", monospace', outline: 'none' }}
              />
              <button
                onClick={startAgent}
                className="hud-btn"
                style={{ width: '100%' }}
              >
                EXECUTE
              </button>
            </div>
          )}
        </div>
      )}

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
            <span className="system-label">GPU</span>
            <span className="system-value" style={{ fontSize: '10px' }}>{systemStats.gpu.model.substring(0, 15)}</span>
          </div>
          <div className="system-stat">
            <span className="system-label">USAGE</span>
            <span className="system-value">{systemStats.gpu.usage}%</span>
            <div className="system-bar-track">
              <div
                className={`system-bar${systemStats.gpu.usage > 80 ? " high" : systemStats.gpu.usage > 50 ? " med" : ""}`}
                style={{ width: `${systemStats.gpu.usage}%` }}
              />
            </div>
          </div>
          <div className="system-stat">
            <span className="system-label">VRAM</span>
            <span className="system-value">{Math.round((systemStats.gpu.memory.used / systemStats.gpu.memory.total) * 100)}%</span>
            <div className="system-bar-track">
              <div
                className={`system-bar${(systemStats.gpu.memory.used / systemStats.gpu.memory.total) > 0.8 ? " high" : (systemStats.gpu.memory.used / systemStats.gpu.memory.total) > 0.5 ? " med" : ""}`}
                style={{ width: `${(systemStats.gpu.memory.used / systemStats.gpu.memory.total) * 100}%` }}
              />
            </div>
          </div>
          <div className="system-stat">
            <span className="system-label">GPU TEMP</span>
            <span className="system-value">{systemStats.temperatures.gpu}°C</span>
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

      {/* Hide HUD controls when a widget is open to keep it clean */}
      {!(mapTarget || newsTarget || pdfTarget) && (
        <div className="hud hud-controls">
          {error && <div className="hud-error">{error}</div>}

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
          <button
            type="button"
            className="hud-btn"
            onClick={async () => {
              try {
                // We'll call a quick API endpoint to toggle it on the backend, or just let Ultron do it
                // Actually, the simplest way is to send a POST to /api/mouse/toggle which we will create
                await fetch("/api/mouse/toggle", { method: "POST" });
              } catch (e) { }
            }}
          >
            TOGGLE MOUSE
          </button>
          <button
            type="button"
            className="hud-btn"
            aria-pressed={agentActive || showAgentInput}
            onClick={toggleAgent}
          >
            {agentActive ? "AGENT ACTIVE" : "AGENT UI"}
          </button>
          <button type="button" className="hud-btn" onClick={() => sceneRef.current?.resetView()}>
            RESET
          </button>
        </div>
      </div>
      )}
    </>
  );
}
