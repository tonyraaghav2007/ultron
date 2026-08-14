import {
  FilesetResolver,
  HandLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Landmark indices (MediaPipe hand model)
const WRIST = 0;
const THUMB_IP = 3;
const THUMB_TIP = 4;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

// Pinch hysteresis: thumb–index distance relative to hand size
const PINCH_ON = 0.32;
const PINCH_OFF = 0.45;

// How strongly hand movement rotates the orb (radians per normalized unit)
const ROTATE_SPEED = 5.0;
// Smoothing factor for grab-point tracking (0..1, higher = snappier)
const SMOOTHING = 0.4;

export type GestureMode = "idle" | "spin" | "zoom";

export interface TrackerStatus {
  hands: number;
  mode: GestureMode;
}

export interface HandTrackerCallbacks {
  /** Called when a single pinched hand drags: deltas in mirrored normalized coords. */
  onRotate(deltaTheta: number, deltaPhi: number): void;
  /** Called when both hands pinch and spread/close: multiply camera distance by factor. */
  onZoom(factor: number): void;
  /** Called when a pulse gesture is completed (open -> closed -> open). */
  onPulse(count: number): void;
  onStatus(status: TrackerStatus): void;
}

interface Point {
  x: number;
  y: number;
}

interface HandState {
  pinching: boolean;
  grab: Point; // smoothed pinch midpoint, mirrored
}

export class HandTracker {
  private video: HTMLVideoElement;
  private overlay: HTMLCanvasElement;
  private callbacks: HandTrackerCallbacks;
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private rafId = 0;
  private running = false;
  private lastVideoTime = -1;

  // keyed by handedness label so state survives re-ordering between frames
  private handStates = new Map<string, HandState>();
  private prevMode: GestureMode = "idle";
  private prevSpinGrab: Point | null = null;
  private prevZoomDist: number | null = null;
  private lastStatus: TrackerStatus = { hands: 0, mode: "idle" };

  // Pulse state tracking
  private pulseCount = 0;
  private isFist = false;
  private lastFistTime = 0;
  private lastPulseTime = 0;

  // Mouse Mode state
  private isMouseMode = false;
  private lastMousePinchEnd = 0;
  private isMouseDragging = false;
  private mousePollInterval: any = null;
  private mouseFetchPending = false;

  constructor(
    video: HTMLVideoElement,
    overlay: HTMLCanvasElement,
    callbacks: HandTrackerCallbacks,
  ) {
    this.video = video;
    this.overlay = overlay;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    this.mousePollInterval = setInterval(async () => {
      try {
        const res = await fetch("/api/mouse/status");
        const data = await res.json();
        this.isMouseMode = data.enabled;
      } catch {}
    }, 2000);

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
    const options = {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" as const },
      runningMode: "VIDEO" as const,
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    };
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options);
    } catch {
      // Some browsers/GPUs reject the GPU delegate — fall back to CPU
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: "CPU" as const },
      });
    }

    this.running = true;
    this.loop();
  }

  stop(): void {
    if (this.mousePollInterval) clearInterval(this.mousePollInterval);
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.landmarker?.close();
    this.landmarker = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.handStates.clear();
    this.prevMode = "idle";
    this.prevSpinGrab = null;
    this.prevZoomDist = null;
    const ctx = this.overlay.getContext("2d");
    ctx?.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.emitStatus({ hands: 0, mode: "idle" });
  }

  private loop = () => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    if (!this.landmarker || this.video.readyState < 2) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, performance.now());
    this.processHands(result.landmarks, result.handedness.map((h) => h[0]?.categoryName ?? "?"));
    this.drawOverlay(result.landmarks);
  };

  private processHands(
    landmarks: NormalizedLandmark[][],
    labels: string[],
  ): void {
    if (this.isMouseMode && landmarks.length > 0) {
      const lm = landmarks[0];
      const thumb = lm[THUMB_TIP];
      const index = lm[INDEX_TIP];
      
      const handScale = dist2d(lm[WRIST], lm[MIDDLE_MCP]);
      const isPinched = handScale > 1e-6 && dist2d(thumb, index) / handScale < PINCH_ON;
      
      const nx = 1 - index.x; // Mirrored X
      const ny = index.y;

      let action = "move";
      const now = performance.now();

      if (isPinched && !this.isMouseDragging) {
        if (now - this.lastMousePinchEnd < 300) {
          action = "right_click";
        } else {
          action = "drag_start";
        }
        this.isMouseDragging = true;
      } else if (!isPinched && this.isMouseDragging) {
        action = "drag_end";
        this.isMouseDragging = false;
        this.lastMousePinchEnd = now;
      }

      if (!this.mouseFetchPending || action !== "move") {
        this.mouseFetchPending = true;
        fetch("/api/mouse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x: nx, y: ny, action }),
        }).finally(() => {
          this.mouseFetchPending = false;
        });
      }
      
      // Stop orb interaction in mouse mode
      return;
    }

    const pinchedGrabs: Point[] = [];
    const seen = new Set<string>();

    landmarks.forEach((lm, i) => {
      const label = labels[i];
      seen.add(label);

      const handScale = dist2d(lm[WRIST], lm[MIDDLE_MCP]);
      if (handScale < 1e-6) return;
      const pinchRatio = dist2d(lm[THUMB_TIP], lm[INDEX_TIP]) / handScale;

      // Mirrored so hand-right = screen-right from the user's perspective
      const raw: Point = {
        x: 1 - (lm[THUMB_TIP].x + lm[INDEX_TIP].x) / 2,
        y: (lm[THUMB_TIP].y + lm[INDEX_TIP].y) / 2,
      };

      let state = this.handStates.get(label);
      if (!state) {
        state = { pinching: false, grab: raw };
        this.handStates.set(label, state);
      }

      // Hysteresis so the pinch doesn't flicker on/off at the threshold
      if (state.pinching && pinchRatio > PINCH_OFF) state.pinching = false;
      else if (!state.pinching && pinchRatio < PINCH_ON) state.pinching = true;

      state.grab = {
        x: state.grab.x + (raw.x - state.grab.x) * SMOOTHING,
        y: state.grab.y + (raw.y - state.grab.y) * SMOOTHING,
      };

      if (state.pinching) pinchedGrabs.push(state.grab);
    });

    // Drop state for hands that left the frame
    for (const key of this.handStates.keys()) {
      if (!seen.has(key)) this.handStates.delete(key);
    }

    const now = performance.now();
    let anyOpen = false;
    let anyClosed = false;

    landmarks.forEach((lm) => {
      if (isHandOpen(lm)) anyOpen = true;
      if (isHandClosed(lm)) anyClosed = true;
    });

    if (anyClosed) {
      this.isFist = true;
      this.lastFistTime = now;
    } else if (anyOpen) {
      if (this.isFist && now - this.lastFistTime < 800) {
        // Fist to Open within a short time = 1 pulse
        this.pulseCount++;
        this.lastPulseTime = now;
      }
      this.isFist = false;
    }

    if (this.pulseCount > 0 && now - this.lastPulseTime > 600) {
      this.callbacks.onPulse(this.pulseCount);
      this.pulseCount = 0;
    }

    const mode: GestureMode =
      pinchedGrabs.length >= 2 ? "zoom" : pinchedGrabs.length === 1 ? "spin" : "idle";

    // Reset reference points on any mode change to avoid jumps
    if (mode !== this.prevMode) {
      this.prevSpinGrab = null;
      this.prevZoomDist = null;
      this.prevMode = mode;
    }

    if (mode === "spin") {
      const grab = pinchedGrabs[0];
      if (this.prevSpinGrab) {
        const dx = grab.x - this.prevSpinGrab.x;
        const dy = grab.y - this.prevSpinGrab.y;
        if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) {
          this.callbacks.onRotate(dx * ROTATE_SPEED, dy * ROTATE_SPEED);
        }
      }
      this.prevSpinGrab = grab;
    } else if (mode === "zoom") {
      const d = Math.hypot(
        pinchedGrabs[0].x - pinchedGrabs[1].x,
        pinchedGrabs[0].y - pinchedGrabs[1].y,
      );
      if (this.prevZoomDist && d > 1e-4) {
        // Spread hands apart -> factor < 1 -> camera moves closer
        const factor = Math.min(1.18, Math.max(0.85, this.prevZoomDist / d));
        this.callbacks.onZoom(factor);
      }
      this.prevZoomDist = d;
    }

    this.emitStatus({ hands: landmarks.length, mode });
  }

  private emitStatus(status: TrackerStatus): void {
    if (
      status.hands !== this.lastStatus.hands ||
      status.mode !== this.lastStatus.mode
    ) {
      this.lastStatus = status;
      this.callbacks.onStatus(status);
    }
  }

  private drawOverlay(landmarks: NormalizedLandmark[][]): void {
    const ctx = this.overlay.getContext("2d");
    if (!ctx) return;
    const { width, height } = this.overlay;
    ctx.clearRect(0, 0, width, height);

    for (const lm of landmarks) {
      const thumb = lm[THUMB_TIP];
      const index = lm[INDEX_TIP];
      const middle = lm[MIDDLE_TIP];
      const ring = lm[RING_TIP];
      const pinky = lm[PINKY_TIP];

      // Overlay canvas sits on the mirrored video preview, so mirror x here too
      const tx = (1 - thumb.x) * width;
      const ty = thumb.y * height;
      const ix = (1 - index.x) * width;
      const iy = index.y * height;

      const handScale = dist2d(lm[WRIST], lm[MIDDLE_MCP]);
      const pinched =
        handScale > 1e-6 && dist2d(thumb, index) / handScale < PINCH_ON;

      // Draw line only between thumb and index
      ctx.strokeStyle = pinched ? "#ffcc66" : "rgba(255,170,48,0.5)";
      ctx.lineWidth = pinched ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(ix, iy);
      ctx.stroke();

      // Draw dots on all five fingertips
      ctx.fillStyle = pinched ? "#ffcc66" : "rgba(255,170,48,0.7)";
      const fingerTips = [
        [tx, ty],
        [ix, iy],
        [(1 - middle.x) * width, middle.y * height],
        [(1 - ring.x) * width, ring.y * height],
        [(1 - pinky.x) * width, pinky.y * height],
      ];
      
      for (const [x, y] of fingerTips) {
        ctx.beginPath();
        // Slightly larger dots for thumb/index when pinched
        const isThumbOrIndex = (x === tx && y === ty) || (x === ix && y === iy);
        ctx.arc(x, y, (pinched && isThumbOrIndex) ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function dist2d(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isHandOpen(lm: NormalizedLandmark[]): boolean {
  const isIndexExt = dist2d(lm[WRIST], lm[INDEX_TIP]) > dist2d(lm[WRIST], lm[INDEX_PIP]);
  const isMiddleExt = dist2d(lm[WRIST], lm[MIDDLE_TIP]) > dist2d(lm[WRIST], lm[MIDDLE_PIP]);
  const isRingExt = dist2d(lm[WRIST], lm[RING_TIP]) > dist2d(lm[WRIST], lm[RING_PIP]);
  const isPinkyExt = dist2d(lm[WRIST], lm[PINKY_TIP]) > dist2d(lm[WRIST], lm[PINKY_PIP]);
  const isThumbExt = dist2d(lm[WRIST], lm[THUMB_TIP]) > dist2d(lm[WRIST], lm[THUMB_IP]);
  
  return isIndexExt && isMiddleExt && isRingExt && isPinkyExt && isThumbExt;
}

function isHandClosed(lm: NormalizedLandmark[]): boolean {
  const isIndexExt = dist2d(lm[WRIST], lm[INDEX_TIP]) > dist2d(lm[WRIST], lm[INDEX_PIP]);
  const isMiddleExt = dist2d(lm[WRIST], lm[MIDDLE_TIP]) > dist2d(lm[WRIST], lm[MIDDLE_PIP]);
  const isRingExt = dist2d(lm[WRIST], lm[RING_TIP]) > dist2d(lm[WRIST], lm[RING_PIP]);
  const isPinkyExt = dist2d(lm[WRIST], lm[PINKY_TIP]) > dist2d(lm[WRIST], lm[PINKY_PIP]);
  
  return !isIndexExt && !isMiddleExt && !isRingExt && !isPinkyExt;
}
