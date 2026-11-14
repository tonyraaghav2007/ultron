/**
 * Object Scanner — captures a frame from the camera and sends it
 * to the /api/scan vision endpoint for comprehensive object recognition.
 */

export type ScanState = "idle" | "capturing" | "analyzing" | "done" | "error";

export interface ScannedObjectData {
    title?: string;
    brand?: string | null;
    category?: string;
    size?: string;
    estimatedPrice?: string;
    qualityVerdict?: string;
    betterChoice?: string;
    betterAlternatives?: string[];
    keyDetails?: string[];
    funFact?: string;
    spokenAnalysis?: string;
}

export interface ScanResult {
    analysis: string;
    model: string;
    timestamp: number;
    data?: ScannedObjectData;
    capturedImage?: string;
}

export interface ScanCallbacks {
    onStateChange: (state: ScanState) => void;
    onResult: (result: ScanResult) => void;
    onError: (error: string) => void;
}

export class ObjectScanner {
    private callbacks: ScanCallbacks;
    private _state: ScanState = "idle";
    private lastResult: ScanResult | null = null;

    get state() { return this._state; }
    get result() { return this.lastResult; }

    constructor(callbacks: ScanCallbacks) {
        this.callbacks = callbacks;
    }

    private setState(state: ScanState) {
        this._state = state;
        this.callbacks.onStateChange(state);
    }

    /**
     * Capture a frame from the given video element and analyze it.
     * @param videoEl - The HTMLVideoElement showing the camera feed
     * @param customPrompt - Optional user prompt for what to focus on
     */
    async scan(videoEl: HTMLVideoElement, customPrompt?: string): Promise<ScanResult | null> {
        if (this._state === "analyzing") {
            return null; // Don't stack scans
        }

        try {
            this.setState("capturing");

            // Create an offscreen canvas to capture the video frame
            const canvas = document.createElement("canvas");
            // Use optimal resolution for AI vision clarity
            const captureWidth = Math.min(videoEl.videoWidth || 640, 1280);
            const captureHeight = Math.min(videoEl.videoHeight || 480, 960);
            canvas.width = captureWidth;
            canvas.height = captureHeight;

            const ctx = canvas.getContext("2d");
            if (!ctx) {
                throw new Error("Failed to create canvas context");
            }

            // Draw the current video frame (unmirrored for normal readability)
            ctx.drawImage(videoEl, 0, 0, captureWidth, captureHeight);

            // Convert to base64 JPEG
            const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

            this.setState("analyzing");

            // Send to vision API
            const response = await fetch("/api/scan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    image: dataUrl,
                    prompt: customPrompt || "Scan this object in front of the camera and give me an exhaustive A to Z breakdown of what it is, brand, size, price, verdict, and better alternatives.",
                }),
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: "Unknown error" }));
                throw new Error(errData.error || `Scan failed with status ${response.status}`);
            }

            const data = await response.json();

            const result: ScanResult = {
                analysis: data.analysis || data.data?.spokenAnalysis || "Object scanned.",
                model: data.model,
                timestamp: Date.now(),
                data: data.data,
                capturedImage: dataUrl,
            };

            this.lastResult = result;
            this.setState("done");
            this.callbacks.onResult(result);

            return result;
        } catch (err: any) {
            this.setState("error");
            this.callbacks.onError(err.message || "Scan failed");
            return null;
        }
    }

    /**
     * Capture from any available camera stream (creates its own if needed).
     * Use this when the hand tracker isn't running and we need a standalone capture.
     */
    async scanFromNewStream(customPrompt?: string): Promise<ScanResult | null> {
        let stream: MediaStream | null = null;
        let videoEl: HTMLVideoElement | null = null;

        try {
            this.setState("capturing");

            stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 1280, height: 720, facingMode: "user" },
                audio: false,
            });

            videoEl = document.createElement("video");
            videoEl.srcObject = stream;
            videoEl.muted = true;
            videoEl.playsInline = true;
            await videoEl.play();

            // Wait for the video to actually produce frames
            await new Promise<void>((resolve) => {
                const checkReady = () => {
                    if (videoEl!.readyState >= 2) {
                        resolve();
                    } else {
                        requestAnimationFrame(checkReady);
                    }
                };
                checkReady();
            });

            // Delay to let the camera auto-expose
            await new Promise(r => setTimeout(r, 600));

            return await this.scan(videoEl, customPrompt);
        } catch (err: any) {
            this.setState("error");
            this.callbacks.onError(err.message || "Failed to access camera");
            return null;
        } finally {
            // Clean up the temporary stream
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
            }
            if (videoEl) {
                videoEl.srcObject = null;
            }
        }
    }

    reset() {
        this.lastResult = null;
        this.setState("idle");
    }
}
