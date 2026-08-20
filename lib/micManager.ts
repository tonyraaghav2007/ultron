/**
 * Shared microphone access — one stream for the whole app so voice recognition,
 * audio visualizer, and permission checks don't fight over the device.
 */

let sharedStream: MediaStream | null = null;
let consumerCount = 0;

export async function acquireMic(): Promise<MediaStream> {
  if (sharedStream?.active) {
    consumerCount++;
    return sharedStream;
  }

  sharedStream = null;
  consumerCount = 0;

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DOMException("Microphone API not available", "NotSupportedError");
  }

  sharedStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
  consumerCount = 1;
  return sharedStream;
}

export function releaseMic(): void {
  consumerCount = Math.max(0, consumerCount - 1);
  if (consumerCount === 0 && sharedStream) {
    sharedStream.getTracks().forEach((t) => t.stop());
    sharedStream = null;
  }
}

export function getMicStream(): MediaStream | null {
  return sharedStream?.active ? sharedStream : null;
}

export async function ensureMicPermission(): Promise<boolean> {
  try {
    await acquireMic();
    return true;
  } catch {
    return false;
  }
}
