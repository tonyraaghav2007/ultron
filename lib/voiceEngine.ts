import { acquireMic, releaseMic } from "@/lib/micManager";

export type VoiceState = "idle" | "wake_listening" | "listening" | "thinking" | "speaking";

export interface VoiceCallbacks {
  onStateChange: (state: VoiceState) => void;
  onTranscript: (text: string, isFinal: boolean) => void;
  onResponse: (text: string, data?: any) => void;
  onError: (error: string) => void;
  onSpeakingLevel: (level: number) => void;
  onListeningLevel?: (level: number) => void;
  onWakeWordDetected: () => void;
}

export class VoiceEngine {
  private callbacks: VoiceCallbacks;
  private audioEl: HTMLAudioElement | null = null;
  private _state: VoiceState = "idle";
  private speakingRaf = 0;
  private speakingTime = 0;
  private _available = true;
  
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private disposed = false;
  private hasSpokenInCurrentRecording = false; // Tracks if actual speech occurred
  private wasInterrupted = false;
  private silenceRaf = 0;
  private recordingStartTime = 0;
  private audioCtx: AudioContext | null = null;
  private silenceAnalyser: AnalyserNode | null = null;

  private recognition: any = null;
  private shouldBeWakeListening = false;
  private isLiveTranscribing = false;
  private lastSpeechTime = 0;

  get state() { return this._state; }
  get available() { return this._available; }

  constructor(callbacks: VoiceCallbacks) {
    this.callbacks = callbacks;

    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
        
        this.recognition.onresult = (event: any) => {
          let fullTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            fullTranscript += event.results[i][0].transcript.toLowerCase() + " ";
          }
          
          if (this.shouldBeWakeListening) {
            if (fullTranscript.includes("jarvis") || fullTranscript.includes("travis") || fullTranscript.includes("charvis")) {
              this.handleWakeWordDetected();
            }
          } else if (this.isLiveTranscribing) {
            const trimmed = fullTranscript.trim().toLowerCase();
            // Instantly cancel recording if user says "mute"
            if (trimmed === "mute" || trimmed === "mute." || trimmed.endsWith(" mute") || trimmed.endsWith(" mute.")) {
               this.hasSpokenInCurrentRecording = false; // Prevents API send
               this.callbacks.onTranscript("Muting... returning to stand-by.", true);
               this.stopRecording();
               setTimeout(() => {
                 this.startWakeListening();
               }, 100);
               return;
            }

            this.callbacks.onTranscript(fullTranscript.trim(), false);
            this.lastSpeechTime = Date.now();
            this.hasSpokenInCurrentRecording = true;
          }
        };

        this.recognition.onend = () => {
          if (this.shouldBeWakeListening && !this.disposed && this._state === "wake_listening") {
            try {
              this.recognition?.start();
            } catch (e: any) {
              if (e.name === 'NotAllowedError') {
                 this.shouldBeWakeListening = false;
                 this.setState("idle");
                 this.callbacks.onError("BROWSER BLOCKED MIC: Click anywhere to allow Jarvis to listen.");
              }
            }
          } else if (this._state === "listening") {
            // Do nothing, we reverted to AudioAnalyser for VAD!
          }
        };
        
        this.recognition.onerror = (event: any) => {
            console.warn("Speech recognition error:", event.error);
            if (event.error === 'not-allowed' || event.error === 'audio-capture') {
                this.shouldBeWakeListening = false;
                this.setState("idle");
                this.callbacks.onError("BROWSER BLOCKED MIC: Click anywhere on the screen to allow Jarvis to listen.");
            }
        };
      }
    }
  }
  
  private setState(state: VoiceState) {
    if (this.disposed) return;
    this._state = state;
    this.callbacks.onStateChange(state);
  }

  private handleWakeWordDetected() {
    if (this._state !== "wake_listening") return;
    this.stopWakeListening();
    this.callbacks.onWakeWordDetected();
    this.startRecording(true);
  }

  private wakeMicStream: MediaStream | null = null;

  async startWakeListening(): Promise<void> {
    if (this._state === "listening" || this._state === "thinking" || this._state === "speaking") return;
    
    this.setState("wake_listening");
    this.shouldBeWakeListening = true;

    try {
      // Warm up the microphone explicitly to trigger the browser's "Microphone in use" indicator
      // and prevent SpeechRecognition from being silently throttled or put to sleep.
      if (!this.wakeMicStream) {
         this.wakeMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch (e: any) {
      this.shouldBeWakeListening = false;
      this.setState("idle");
      this.callbacks.onError("BROWSER BLOCKED MIC: Click anywhere to allow Ultron to listen.");
      return;
    }

    if (this.recognition) {
      try {
        this.recognition.abort(); // Clear any hung state
        this.recognition.start();
      } catch (e: any) {
        if (e.name === 'NotAllowedError') {
           this.shouldBeWakeListening = false;
           this.setState("idle");
           this.callbacks.onError("BROWSER BLOCKED MIC: Click anywhere to allow Jarvis to listen.");
        }
      }
    } else {
       this.setState("idle");
    }
  }

  private stopWakeListening() {
    this.shouldBeWakeListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }
    if (this.wakeMicStream) {
      this.wakeMicStream.getTracks().forEach(t => t.stop());
      this.wakeMicStream = null;
    }
  }

  async startRecording(autoStop = false, noSpeechTimeoutMs = 5000): Promise<void> {
    this.stopWakeListening();
    
    if (this._state === "speaking") {
      this.wasInterrupted = true;
      if (this.audioEl) {
        this.audioEl.pause();
      }
      if (typeof window !== "undefined") {
        window.speechSynthesis.cancel();
      }
      cancelAnimationFrame(this.speakingRaf);
    }

    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
        return;
    }

    try {
      const stream = await acquireMic();
      
      // Try webm first (standard in chrome), fallback to mp4/mp3
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/mp4';
      }

      this.mediaRecorder = new MediaRecorder(stream, { mimeType });
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.audioChunks.push(e.data);
      };

      this.mediaRecorder.onstop = async () => {
        if (this.silenceRaf) cancelAnimationFrame(this.silenceRaf);
        if (this.audioChunks.length === 0) {
            this.setState("idle");
            return;
        }
        
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        this.audioChunks = [];
        await this.transcribeAndSend(audioBlob);
      };

      this.mediaRecorder.start();
      this.setState("listening");
      this.recordingStartTime = Date.now();
      this.hasSpokenInCurrentRecording = false;
      this.isLiveTranscribing = true;
      this.lastSpeechTime = 0;

      // Start live transcription API alongside MediaRecorder
      if (this.recognition) {
         try {
             this.recognition.abort();
             this.recognition.start();
         } catch (e) {}
      }

      if (autoStop) {
        this.startSilenceDetection(stream, noSpeechTimeoutMs);
      }
    } catch (err) {
      this.callbacks.onError("MIC ACCESS DENIED — allow microphone in browser settings");
      this.setState("idle");
    }
  }

  private startSilenceDetection(stream: MediaStream, noSpeechTimeoutMs: number) {
    if (!this.audioCtx) {
       this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const source = this.audioCtx.createMediaStreamSource(stream);
    this.silenceAnalyser = this.audioCtx.createAnalyser();
    this.silenceAnalyser.fftSize = 256;
    source.connect(this.silenceAnalyser);
    
    const dataArray = new Uint8Array(this.silenceAnalyser.frequencyBinCount);
    const startTime = Date.now();
    let lastSpokeTime = Date.now();
    let hasSpoken = false;
    let noiseFloor = 40; // base floor
    let frames = 0;
    let sumMax = 0;

    const checkSilence = () => {
       if (this._state !== "listening") return;
       
       this.silenceAnalyser!.getByteFrequencyData(dataArray);
       const maxLevel = Math.max(...Array.from(dataArray));
       const elapsed = Date.now() - startTime;
       
       if (this.callbacks.onListeningLevel) {
           this.callbacks.onListeningLevel(maxLevel / 255.0);
       }

       if (frames < 20) {
           sumMax += maxLevel;
           frames++;
           if (frames === 20) {
               // dynamically calculate noise floor from first ~300ms + much higher margin
               noiseFloor = Math.max(50, (sumMax / 20) + 40); 
           }
       } else if (elapsed > 500) { // wait 500ms before allowing speech detection to avoid TTS echo
           if (maxLevel > noiseFloor) { 
               // If live transcription is active, we rely on it to keep lastSpeechTime updated.
               // We only use volume to set the initial hasSpoken flag or if recognition isn't supported.
               if (!this.recognition) {
                   this.lastSpeechTime = Date.now();
               } else if (!hasSpoken) {
                   this.lastSpeechTime = Date.now();
               }
               hasSpoken = true;
               this.hasSpokenInCurrentRecording = true;
           }
       }

       // Calculate silence since the last actual spoken word (or initial volume trigger)
       const silentTime = Date.now() - (this.lastSpeechTime || startTime);
       
       // Stop if:
       // 1. Spoke, and now silent for 1.5s
       // 2. Didn't speak, and timeout reached
       // 3. Hard limit of 15 seconds reached (prevent infinite listening)
       if ((hasSpoken && silentTime > 1500) || (!hasSpoken && elapsed > noSpeechTimeoutMs) || elapsed > 15000) {
           this.stopRecording();
           return;
       }
       this.silenceRaf = requestAnimationFrame(checkSilence);
    };
    checkSilence();
  }

  stopRecording(): void {
      if (this.silenceRaf) {
          cancelAnimationFrame(this.silenceRaf);
          this.silenceRaf = 0;
      }
      if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
          this.mediaRecorder.stop();
      }
      if (this.isLiveTranscribing) {
          this.isLiveTranscribing = false;
          if (this.callbacks.onListeningLevel) {
              this.callbacks.onListeningLevel(0);
          }
          if (this.recognition) {
              try { this.recognition.stop(); } catch(e) {}
          }
      }
  }
  
  // Kept for backward compatibility
  async manualListen(): Promise<void> {
      await this.startRecording();
  }

  stopAll(): void {
    this.stopWakeListening();
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
        this.mediaRecorder.stop();
    }
    if (this.audioEl) {
        this.audioEl.pause();
    }
    if (typeof window !== "undefined") {
        window.speechSynthesis.cancel();
    }
    cancelAnimationFrame(this.speakingRaf);
    this.setState("idle");
    releaseMic();
  }
  
  private async transcribeAndSend(audioBlob: Blob): Promise<void> {
      // Prevent hallucination spam: if no speech was detected, abort transcription
      if (!this.hasSpokenInCurrentRecording) {
          console.log("No speech detected in recording. Aborting transcription.");
          this.setState("idle");
          return;
      }

      this.setState("thinking");
      try {
          const formData = new FormData();
          formData.append('file', audioBlob, 'audio.webm');
          
          const res = await fetch("/api/transcribe", {
              method: "POST",
              body: formData
          });
          
          if (!res.ok) {
              throw new Error("Failed to transcribe");
          }
          
          const data = await res.json();
          const transcript = data.text?.trim();
          
          if (!transcript) {
              this.setState("idle");
              return;
          }
          
          if (this._state !== "thinking") return;
          this.callbacks.onTranscript(transcript, true);
          await this.sendToAI(transcript);
          
      } catch (err) {
          this.callbacks.onError("TRANSCRIPTION FAILED");
          this.setState("idle");
      }
  }

  async sendSystemMessage(text: string): Promise<void> {
    await this.sendToAI(text, true);
  }

  private async sendToAI(text: string, isSystem: boolean = false): Promise<void> {
    this.setState("thinking");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          timestamp: new Date().toISOString(),
          localTime: new Date().toLocaleString("en-US", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).replace("GMT+5:30", "IST") + " (IST)",
          interrupted: this.wasInterrupted,
          isSystem: isSystem
        }),
      });
      this.wasInterrupted = false;

      if (!res.ok) throw new Error(`API error`);

      const data = await res.json();
      let reply = data.reply || "I have nothing to say.";
      
      // Intercept UI commands from the AI's response before speaking
      const mapMatch = reply.match(/\[UI_CMD:MAP:(.*?)\]/);
      if (mapMatch) {
          data.mapTarget = mapMatch[1];
          reply = reply.replace(mapMatch[0], "").trim();
      }

      const newsMatch = reply.match(/\[UI_CMD:NEWS:(.*?)\]/);
      if (newsMatch) {
          data.newsTarget = newsMatch[1];
          reply = reply.replace(newsMatch[0], "").trim();
      }

      const browserMatch = reply.match(/\[UI_CMD:BROWSER:(.*?)\]/);
      if (browserMatch) {
          data.browserTarget = browserMatch[1];
          reply = reply.replace(browserMatch[0], "").trim();
      }

      const pdfMatch = reply.match(/\[UI_CMD:OPEN_PDF:(.*?)\]/);
      if (pdfMatch) {
          data.pdfTarget = pdfMatch[1];
          reply = reply.replace(pdfMatch[0], "").trim();
      }

      const expandNewsMatch = reply.match(/\[UI_CMD:EXPAND_NEWS:(.*?)\]/);
      if (expandNewsMatch) {
          // AI outputs 1-based index (e.g. 1 for first article), but array is 0-based
          data.newsExpandedIndex = parseInt(expandNewsMatch[1], 10) - 1;
          reply = reply.replace(expandNewsMatch[0], "").trim();
      }

      this.callbacks.onResponse(reply, data);
      
      // If we are pulling up the news grid, remain silent until the news actually loads.
      // The NewsWidget will trigger a system message to speak the headlines once ready.
      if (newsMatch) {
          this.setState("idle");
          return;
      }

      if (this._state !== "thinking") return;
      this.speak(reply);
    } catch {
      this.callbacks.onError("AI LINK FAILED");
      this.setState("idle");
    }
  }

  private speak(text: string): void {
    if (this.audioEl) {
      this.audioEl.pause();
    }
    if (typeof window !== "undefined") {
      window.speechSynthesis.cancel();
    }
    this.setState("speaking");

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => v.name.includes("UK English Male") || v.name.includes("Google UK English Male") || v.lang === "en-GB");
    if (voice) utterance.voice = voice;
    
    utterance.rate = 1.0;
    utterance.pitch = 0.5;

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

    utterance.onstart = () => pumpSpeaking();

    utterance.onend = () => {
      cancelAnimationFrame(this.speakingRaf);
      this.callbacks.onSpeakingLevel(0);
      // Automatically start listening for 3 seconds after speaking
      this.startRecording(true, 3000);
    };

    utterance.onerror = (e) => {
      console.warn("TTS Warning: Speech synthesis was interrupted or failed.", e);
      cancelAnimationFrame(this.speakingRaf);
      this.callbacks.onSpeakingLevel(0);
      this.setState("idle");
    };

    setTimeout(() => {
      window.speechSynthesis.speak(utterance);
    }, 50);
  }

  async resetConversation(): Promise<void> {
    try {
      await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
    } catch { }
  }

  dispose(): void {
    this.disposed = true;
    this.shouldBeWakeListening = false;
    if (this.recognition) {
      try {
        this.recognition.onend = null;
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.stop();
      } catch (e) {}
    }
    this.stopAll();
  }
}
