import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  maximumVoiceDurationSeconds,
  validatePcmWav,
} from "./wav-audio.js";

/**
 * Create Wav.
 */
function createWav(options: {
  sampleRate?: number;
  channels?: number;
  bits?: number;
  seconds?: number;
  encoding?: number;
} = {}): Buffer {
  const sampleRate = options.sampleRate ?? 16000;
  const channels = options.channels ?? 1;
  const bits = options.bits ?? 16;
  const seconds = options.seconds ?? 1;
  const dataLength = sampleRate * channels * (bits / 8) * seconds;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(options.encoding ?? 1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bits / 8), 28);
  buffer.writeUInt16LE(channels * (bits / 8), 32);
  buffer.writeUInt16LE(bits, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}

describe("validatePcmWav", () => {
  it("accepts bounded mono and stereo PCM WAV files", () => {
    assert.deepEqual(validatePcmWav(createWav()), { valid: true });
    assert.deepEqual(
      validatePcmWav(createWav({ sampleRate: 44100, channels: 2, seconds: 2 })),
      { valid: true },
    );
  });

  it("rejects malformed, unsupported, or empty wave files", () => {
    assert.equal(validatePcmWav(Buffer.from("not audio")).valid, false);
    assert.equal(validatePcmWav(createWav({ encoding: 3 })).valid, false);
    assert.equal(
      validatePcmWav(createWav({ sampleRate: 96000 })).valid,
      false,
    );
    assert.equal(validatePcmWav(createWav({ seconds: 0 })).valid, false);
  });

  it("rejects recordings longer than the configured duration", () => {
    const result = validatePcmWav(
      createWav({ seconds: maximumVoiceDurationSeconds + 1 }),
    );
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.equal(result.code, "AUDIO_TOO_LONG");
    }
  });
});
