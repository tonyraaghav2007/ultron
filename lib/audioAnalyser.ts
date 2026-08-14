/**
 * AudioAnalyser — captures microphone input via the Web Audio API and
 * provides real-time frequency-band energy levels (bass / mid / treble).
 *
 * Runs entirely in the browser — no backend required.
 */

export interface AudioLevels {
  /** Low frequencies 0–300 Hz (kick drums, bass) */
  bass: number;
  /** Mid frequencies 300–2 kHz (vocals, snare) */
  mid: number;
  /** High frequencies 2 kHz+ (hi-hats, cymbals, sibilance) */
  treble: number;
  /** Weighted overall energy (0–1) */
  overall: number;
}

export class AudioAnalyser {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private freqData: Uint8Array = new Uint8Array(0);
  private _running = false;

  // Smoothed values to avoid jittery visual jumps
  private smoothBass = 0;
  private smoothMid = 0;
  private smoothTreble = 0;
  private smoothOverall = 0;

  /** Smoothing factor — higher = snappier response, lower = smoother */
  private readonly SMOOTH = 0.35;

  get running() {
    return this._running;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });

    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256; // 128 frequency bins
    this.analyser.smoothingTimeConstant = 0.6;

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);

    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this._running = true;
  }

  stop(): void {
    this._running = false;
    this.source?.disconnect();
    this.source = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;

    this.smoothBass = 0;
    this.smoothMid = 0;
    this.smoothTreble = 0;
    this.smoothOverall = 0;
  }

  /**
   * Sample the current audio levels. Call this once per animation frame.
   * Returns normalized 0–1 values for each frequency band.
   */
  getLevels(): AudioLevels {
    if (!this.analyser || !this._running) {
      return { bass: 0, mid: 0, treble: 0, overall: 0 };
    }

    this.analyser.getByteFrequencyData(this.freqData);
    const bins = this.freqData.length; // 128
    const sampleRate = this.ctx!.sampleRate;
    const binHz = sampleRate / (this.analyser.fftSize); // Hz per bin

    // Calculate bin boundaries
    const bassCutoff = Math.min(Math.floor(300 / binHz), bins);
    const midCutoff = Math.min(Math.floor(2000 / binHz), bins);

    // Average energy per band (0–255 → 0–1)
    const bassRaw = avgRange(this.freqData, 1, bassCutoff); // skip bin 0 (DC offset)
    const midRaw = avgRange(this.freqData, bassCutoff, midCutoff);
    const trebleRaw = avgRange(this.freqData, midCutoff, bins);

    // Weight: bass is usually loudest, treble weakest — boost treble for visual balance
    const bass = bassRaw;
    const mid = Math.min(1, midRaw * 1.2);
    const treble = Math.min(1, trebleRaw * 1.8);
    const overall = bass * 0.5 + mid * 0.3 + treble * 0.2;

    // Apply exponential smoothing
    this.smoothBass += (bass - this.smoothBass) * this.SMOOTH;
    this.smoothMid += (mid - this.smoothMid) * this.SMOOTH;
    this.smoothTreble += (treble - this.smoothTreble) * this.SMOOTH;
    this.smoothOverall += (overall - this.smoothOverall) * this.SMOOTH;

    return {
      bass: this.smoothBass,
      mid: this.smoothMid,
      treble: this.smoothTreble,
      overall: this.smoothOverall,
    };
  }
}

/** Average a sub-range of a Uint8Array, normalized to 0–1 */
function avgRange(data: Uint8Array, from: number, to: number): number {
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i];
  return sum / ((to - from) * 255);
}
