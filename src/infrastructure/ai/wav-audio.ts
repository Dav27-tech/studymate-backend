export const maximumVoiceAudioBytes = 10 * 1024 * 1024;
export const maximumVoiceDurationSeconds = 180;

export type WavValidation =
  | { valid: true }
  | {
      valid: false;
      code: "INVALID_AUDIO" | "AUDIO_TOO_LONG";
      message: string;
    };

/**
 * Validate Pcm Wav.
 */
export function validatePcmWav(data: Buffer): WavValidation {
  if (
    data.length < 44 ||
    data.toString("ascii", 0, 4) !== "RIFF" ||
    data.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return invalidAudio();
  }

  const declaredLength = data.readUInt32LE(4) + 8;
  if (declaredLength > data.length || declaredLength < 44) {
    return invalidAudio();
  }

  let format:
    | { encoding: number; channels: number; sampleRate: number; bits: number }
    | undefined;
  let sampleCount = 0;
  let offset = 12;

  while (offset + 8 <= declaredLength) {
    const chunkId = data.toString("ascii", offset, offset + 4);
    const chunkSize = data.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > declaredLength) {
      return invalidAudio();
    }

    if (chunkId === "fmt ") {
      if (chunkSize < 16) {
        return invalidAudio();
      }
      format = {
        encoding: data.readUInt16LE(chunkStart),
        channels: data.readUInt16LE(chunkStart + 2),
        sampleRate: data.readUInt32LE(chunkStart + 4),
        bits: data.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === "data") {
      sampleCount = chunkSize;
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  if (
    !format ||
    format.encoding !== 1 ||
    (format.channels !== 1 && format.channels !== 2) ||
    format.sampleRate < 8000 ||
    format.sampleRate > 48000 ||
    ![8, 16, 24, 32].includes(format.bits) ||
    sampleCount === 0
  ) {
    return invalidAudio();
  }

  const bytesPerSecond =
    format.sampleRate * format.channels * (format.bits / 8);
  if (sampleCount / bytesPerSecond > maximumVoiceDurationSeconds) {
    return {
      valid: false,
      code: "AUDIO_TOO_LONG",
      message: `Voice messages are limited to ${maximumVoiceDurationSeconds} seconds.`,
    };
  }

  return { valid: true };
}

/**
 * Explain the purpose of invalid Audio.
 */
function invalidAudio(): WavValidation {
  return {
    valid: false,
    code: "INVALID_AUDIO",
    message: "Upload a valid PCM WAV audio file (8–48 kHz, mono or stereo).",
  };
}
