/**
 * VoiceEngine — handles wake-word detection ("Ultron"), Speech-to-Text,
 * AI chat via Groq, and Text-to-Speech for the Ultron voice interface.
 *
 * Flow: WAKE_LISTENING → hears "Ultron" → LISTENING (for command) → THINKING → SPEAKING → back to WAKE_LISTENING
 */

export type VoiceState = "idle" | "wake_listening" | "listening" | "thinking" | "speaking";

export interface VoiceCallbacks {
  onStateChange: (state: VoiceState) => void;
  onTranscript: (text: string, isFinal: boolean) => void;
  onResponse: (text: string) => void;
  onError: (error: string) => void;
  /** Called every frame while speaking, with a fake audio level 0–1 */
  onSpeakingLevel: (level: number) => void;
  /** Called when wake word is detected */
  onWakeWordDetected: () => void;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

const WAKE_WORD = "ultron";

export class VoiceEngine {
  private callbacks: VoiceCallbacks;
  private recognition: SpeechRecognition | null = null;
  private synthesis: SpeechSynthesis;
  private _state: VoiceState = "idle";
  private speakingRaf = 0;
  private speakingTime = 0;
  private _available = false;
  private restartTimeout: ReturnType<typeof setTimeout> | null = null;
  private isWakeMode = false;

  get state() {
    return this._state;
  }

  get available() {
    return this._available;
  }

  constructor(callbacks: VoiceCallbacks) {
    this.callbacks = callbacks;
    this.synthesis = window.speechSynthesis;

    const SpeechRecognitionCtor =
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition;

    if (SpeechRecognitionCtor) {
      this._available = true;
      this.recognition = new (SpeechRecognitionCtor as new () => SpeechRecognition)();
      this.setupRecognition();
    }
  }

  private setupRecognition() {
    if (!this.recognition) return;

    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = "en-US";
    this.recognition.maxAlternatives = 1;

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (this._state === "thinking" || this._state === "speaking") return;

      // Collect all results from this recognition session
      let fullTranscript = "";
      let latestInterim = "";

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          fullTranscript += result[0].transcript;
        } else {
          latestInterim += result[0].transcript;
        }
      }

      const combined = (fullTranscript + " " + latestInterim).toLowerCase();

      if (this.isWakeMode) {
        // In wake mode: look for the wake word
        if (combined.includes(WAKE_WORD)) {
          this.callbacks.onWakeWordDetected();
          // Stop current recognition
          this.isWakeMode = false;
          this.recognition?.stop();

          // Say "Yes sir" and THEN start listening for the command
          this.sayAcknowledgment();
        }
      } else {
        // In command mode: capture the user's request
        const currentText = latestInterim || fullTranscript;
        if (currentText) {
          this.callbacks.onTranscript(currentText, false);
        }

        // Check for final results to process
        const latestIdx = event.results.length - 1;
        if (event.results[latestIdx]?.isFinal) {
          const finalText = event.results[latestIdx][0].transcript.trim();
          if (finalText) {
            this.callbacks.onTranscript(finalText, true);
            this.recognition?.stop();
            this.sendToAI(finalText);
          }
        }
      }
    };

    this.recognition.onerror = (event: Event & { error?: string }) => {
      const errorMsg = event.error || "unknown";
      if (errorMsg === "no-speech" || errorMsg === "aborted") {
        // Silently restart wake listening if we were in wake mode
        if (this.isWakeMode || this._state === "wake_listening") {
          this.scheduleRestart();
        } else if (this._state === "listening") {
          // No speech in command mode — go back to wake listening
          this.startWakeListening();
        }
        return;
      }
      if (errorMsg === "not-allowed") {
        this.callbacks.onError("MIC ACCESS DENIED");
        this.setState("idle");
        return;
      }
      this.callbacks.onError(`SPEECH ERROR: ${errorMsg.toUpperCase()}`);
      this.scheduleRestart();
    };

    this.recognition.onend = () => {
      // Auto-restart if we should still be listening
      if (this._state === "wake_listening" || (this.isWakeMode && this._state !== "idle")) {
        this.scheduleRestart();
      } else if (this._state === "listening" && !this.isWakeMode) {
        // Command listening timed out — go back to wake mode
        setTimeout(() => this.startWakeListening(), 500);
      }
    };
  }

  private scheduleRestart() {
    if (this.restartTimeout) clearTimeout(this.restartTimeout);
    this.restartTimeout = setTimeout(() => {
      if (this._state === "idle" || this._state === "thinking" || this._state === "speaking") return;
      this.startWakeRecognition();
    }, 500);
  }

  private startWakeRecognition() {
    if (!this.recognition) return;
    this.isWakeMode = true;
    try {
      this.recognition.start();
    } catch {
      // May already be running — that's fine
    }
  }

  private setState(state: VoiceState) {
    this._state = state;
    this.callbacks.onStateChange(state);
  }

  /** Activate always-on wake word listening */
  startWakeListening(): void {
    if (!this.recognition) {
      this.callbacks.onError("SPEECH RECOGNITION NOT AVAILABLE");
      return;
    }

    // Stop anything currently running
    try {
      this.recognition.stop();
    } catch {
      // Ignore
    }

    this.isWakeMode = true;
    this.setState("wake_listening");

    setTimeout(() => this.startWakeRecognition(), 300);
  }

  /** Start command-mode listening (after wake word detected) */
  private startCommandListening(): void {
    if (!this.recognition) return;

    this.isWakeMode = false;
    this.setState("listening");

    try {
      this.recognition.start();
    } catch {
      // If already running, stop and restart
      this.recognition.stop();
      setTimeout(() => {
        this.isWakeMode = false;
        try {
          this.recognition?.start();
        } catch {
          this.callbacks.onError("MIC INIT FAILED");
          this.startWakeListening();
        }
      }, 300);
    }

    // Auto-timeout: if no command in 8 seconds, go back to wake mode
    setTimeout(() => {
      if (this._state === "listening") {
        this.recognition?.stop();
        this.startWakeListening();
      }
    }, 8000);
  }

  /** Manual push-to-talk (spacebar) — bypasses wake word */
  manualListen(): void {
    if (!this.recognition) {
      this.callbacks.onError("SPEECH RECOGNITION NOT AVAILABLE");
      return;
    }

    if (this._state === "speaking") {
      this.synthesis.cancel();
      cancelAnimationFrame(this.speakingRaf);
    }

    // Stop wake listening if active
    try {
      this.recognition.stop();
    } catch {
      // Ignore
    }

    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    setTimeout(() => this.startCommandListening(), 300);
  }

  /** Stop all listening */
  stopAll(): void {
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    try {
      this.recognition?.stop();
    } catch {
      // Ignore
    }
    this.synthesis.cancel();
    cancelAnimationFrame(this.speakingRaf);
    this.isWakeMode = false;
    this.setState("idle");
  }

  /** Send text to the AI chat endpoint */
  private async sendToAI(text: string): Promise<void> {
    this.setState("thinking");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const data = await res.json();
      const reply = data.reply || "I have nothing to say.";

      this.callbacks.onResponse(reply);
      this.speak(reply);
    } catch {
      this.callbacks.onError("AI LINK FAILED");
      this.startWakeListening();
    }
  }
  /** Speak acknowledgment and start command listening */
  private sayAcknowledgment(): void {
    this.synthesis.cancel();
    this.setState("speaking");

    const utterance = new SpeechSynthesisUtterance("Yes human.");
    utterance.rate = 0.95;
    utterance.pitch = 0.85;
    utterance.volume = 1;

    const voices = this.synthesis.getVoices();
    const preferred = voices.find(
      (v) =>
        v.name.includes("Google UK English Male") ||
        v.name.includes("Microsoft David") ||
        v.name.includes("Daniel") ||
        v.name.includes("Male")
    );
    if (preferred) {
      utterance.voice = preferred;
    }

    this.speakingTime = 0;
    const pumpSpeaking = () => {
      if (this._state !== "speaking") return;
      this.speakingTime += 0.016;
      const base = 0.3 + Math.sin(this.speakingTime * 8) * 0.15;
      const burst = Math.pow(Math.max(0, Math.sin(this.speakingTime * 15)), 3) * 0.4;
      const noise = Math.random() * 0.15;
      const level = Math.min(1, base + burst + noise);
      this.callbacks.onSpeakingLevel(level);
      this.speakingRaf = requestAnimationFrame(pumpSpeaking);
    };

    utterance.onstart = () => {
      pumpSpeaking();
    };

    utterance.onend = () => {
      cancelAnimationFrame(this.speakingRaf);
      this.callbacks.onSpeakingLevel(0);
      // Start listening for command after acknowledgment
      setTimeout(() => this.startCommandListening(), 100);
    };

    utterance.onerror = () => {
      cancelAnimationFrame(this.speakingRaf);
      this.callbacks.onSpeakingLevel(0);
      this.startCommandListening();
    };

    this.synthesis.speak(utterance);
  }

  /** Speak text using the browser's TTS */
  private speak(text: string): void {
    this.synthesis.cancel();
    this.setState("speaking");

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 0.85;
    utterance.volume = 1;

    // Try to find a deep, robotic-sounding voice
    const voices = this.synthesis.getVoices();
    const preferred = voices.find(
      (v) =>
        v.name.includes("Google UK English Male") ||
        v.name.includes("Microsoft David") ||
        v.name.includes("Daniel") ||
        v.name.includes("Male")
    );
    if (preferred) {
      utterance.voice = preferred;
    }

    // Simulate audio levels while speaking
    this.speakingTime = 0;
    const pumpSpeaking = () => {
      if (this._state !== "speaking") return;
      this.speakingTime += 0.016;
      const base = 0.3 + Math.sin(this.speakingTime * 8) * 0.15;
      const burst = Math.pow(Math.max(0, Math.sin(this.speakingTime * 15)), 3) * 0.4;
      const noise = Math.random() * 0.15;
      const level = Math.min(1, base + burst + noise);
      this.callbacks.onSpeakingLevel(level);
      this.speakingRaf = requestAnimationFrame(pumpSpeaking);
    };

    utterance.onstart = () => {
      pumpSpeaking();
    };

    utterance.onend = () => {
      cancelAnimationFrame(this.speakingRaf);
      this.callbacks.onSpeakingLevel(0);
      // Go back to wake listening after speaking
      this.startWakeListening();
    };

    utterance.onerror = () => {
      cancelAnimationFrame(this.speakingRaf);
      this.callbacks.onSpeakingLevel(0);
      this.startWakeListening();
    };

    this.synthesis.speak(utterance);
  }

  /** Reset the AI conversation history */
  async resetConversation(): Promise<void> {
    try {
      await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
    } catch {
      // Silently fail
    }
  }

  /** Full cleanup */
  dispose(): void {
    if (this.restartTimeout) clearTimeout(this.restartTimeout);
    try {
      this.recognition?.stop();
    } catch {
      // Ignore
    }
    this.synthesis.cancel();
    cancelAnimationFrame(this.speakingRaf);
    this._state = "idle";
  }
}
