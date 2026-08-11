import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { startRecording, MAX_RECORDING_MS } from './record.js';

// Fakes shaped like the real things: a stream whose tracks record being
// stopped, and a MediaRecorder that hands chunks to ondataavailable and
// fires onstop when stopped — enough to pin the lifecycle rules (tracks
// always released, cap behaves like a stop) without a microphone.

function fakeStream() {
  const tracks = [{ stopped: false }, { stopped: false }].map((track) => ({
    ...track,
    stop() {
      track.stopped = true;
      this.stopped = true;
    },
  }));
  return { tracks, getTracks: () => tracks };
}

function fakeMediaRecorderClass({ chunks = [new Blob([new Uint8Array(64)])], failOnStart } = {}) {
  const instances = [];
  class FakeMediaRecorder {
    constructor(stream, options) {
      this.stream = stream;
      this.options = options;
      this.state = 'inactive';
      instances.push(this);
    }
    start() {
      if (failOnStart) throw new Error('start failed');
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      for (const chunk of chunks) this.ondataavailable?.({ data: chunk });
      this.onstop?.();
    }
    static isTypeSupported(type) {
      return type === 'audio/mp4';
    }
  }
  FakeMediaRecorder.instances = instances;
  return FakeMediaRecorder;
}

function deps(overrides = {}) {
  const stream = fakeStream();
  return {
    stream,
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    MediaRecorderCtor: fakeMediaRecorderClass(),
    ...overrides,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('startRecording', () => {
  test('records with the first supported mime type and low-bitrate audio', async () => {
    const { mediaDevices, MediaRecorderCtor } = deps();

    const handle = await startRecording({ mediaDevices, MediaRecorderCtor });
    const { blob } = await handle.stop();

    const [recorder] = MediaRecorderCtor.instances;
    expect(recorder.options.mimeType).toBe('audio/mp4');
    expect(recorder.options.audioBitsPerSecond).toBe(24_000);
    expect(blob.type).toBe('audio/mp4');
    expect(blob.size).toBeGreaterThan(0);
    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  test('stop releases every track — the works-once failure is a track left live', async () => {
    const { stream, mediaDevices, MediaRecorderCtor } = deps();

    const handle = await startRecording({ mediaDevices, MediaRecorderCtor });
    await handle.stop();

    expect(stream.tracks.every((track) => track.stopped)).toBe(true);
  });

  test('cancel releases every track too', async () => {
    const { stream, mediaDevices, MediaRecorderCtor } = deps();

    const handle = await startRecording({ mediaDevices, MediaRecorderCtor });
    handle.cancel();

    expect(stream.tracks.every((track) => track.stopped)).toBe(true);
  });

  test('the time cap stops the recording by itself', async () => {
    const { stream, mediaDevices, MediaRecorderCtor } = deps();

    await startRecording({ mediaDevices, MediaRecorderCtor });
    vi.advanceTimersByTime(MAX_RECORDING_MS + 1);

    const [recorder] = MediaRecorderCtor.instances;
    expect(recorder.state).toBe('inactive');
    expect(stream.tracks.every((track) => track.stopped)).toBe(true);
  });

  test('a device with no recorder, or none of the formats, fails with a named reason', async () => {
    await expect(
      startRecording({ mediaDevices: {}, MediaRecorderCtor: undefined }),
    ).rejects.toThrow(/no audio recorder/);

    class NothingSupported {
      static isTypeSupported() {
        return false;
      }
    }
    await expect(
      startRecording({ mediaDevices: {}, MediaRecorderCtor: NothingSupported }),
    ).rejects.toThrow(/none of the recording formats/);
  });

  test('a denial propagates as-is, and a constructor failure still releases the stream', async () => {
    const denial = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    await expect(
      startRecording({
        mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(denial) },
        MediaRecorderCtor: fakeMediaRecorderClass(),
      }),
    ).rejects.toBe(denial);

    const stream = fakeStream();
    class ThrowsOnConstruct {
      constructor() {
        throw new Error('bad options');
      }
      static isTypeSupported() {
        return true;
      }
    }
    await expect(
      startRecording({
        mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
        MediaRecorderCtor: ThrowsOnConstruct,
      }),
    ).rejects.toThrow('bad options');
    expect(stream.tracks.every((track) => track.stopped)).toBe(true);
  });
});
