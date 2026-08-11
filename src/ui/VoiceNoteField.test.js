import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { html } from 'htm/preact';
import { VoiceNoteField } from './VoiceNoteField.js';

function renderField({
  audio = null,
  error = null,
  onRecorded = vi.fn(),
  onRemove = vi.fn(),
  onError = vi.fn(),
  recordAudio,
} = {}) {
  render(
    html`<${VoiceNoteField}
      audio=${audio}
      error=${error}
      onRecorded=${onRecorded}
      onRemove=${onRemove}
      onError=${onError}
      recordAudio=${recordAudio}
    />`,
  );
  return { onRecorded, onRemove, onError };
}

const NOTE = { blob: new Blob([new Uint8Array(32)], { type: 'audio/mp4' }), durationMs: 3000 };

describe('VoiceNoteField', () => {
  test('records, stops, and hands the note up', async () => {
    const handle = { stop: vi.fn().mockResolvedValue(NOTE), cancel: vi.fn() };
    const recordAudio = vi.fn().mockResolvedValue(handle);
    const { onRecorded } = renderField({ recordAudio });

    fireEvent.click(screen.getByRole('button', { name: 'Record voice note' }));
    await screen.findByText(/Recording ·/);

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(onRecorded).toHaveBeenCalledWith(NOTE));
  });

  test('a recorded note shows a player and can be removed', () => {
    const { onRemove } = renderField({ audio: NOTE });

    expect(document.querySelector('audio.voice-note-player')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove voice note' }));
    expect(onRemove).toHaveBeenCalled();
  });

  test('a denial lands on the field as a message, not a crash — Save is untouched', async () => {
    const recordAudio = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }),
      );
    const { onError, onRecorded } = renderField({ recordAudio });

    fireEvent.click(screen.getByRole('button', { name: 'Record voice note' }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith('Permission denied'));
    expect(onRecorded).not.toHaveBeenCalled();
  });

  test('an empty recording is reported, never handed up as a silent file', async () => {
    const empty = { blob: new Blob([], { type: 'audio/mp4' }), durationMs: 3000 };
    const handle = { stop: vi.fn().mockResolvedValue(empty), cancel: vi.fn() };
    const { onError, onRecorded } = renderField({ recordAudio: vi.fn().mockResolvedValue(handle) });

    fireEvent.click(screen.getByRole('button', { name: 'Record voice note' }));
    await screen.findByText(/Recording ·/);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith('No audio was captured — try again'));
    expect(onRecorded).not.toHaveBeenCalled();
  });

  test('unmounting mid-recording releases the microphone', async () => {
    const handle = { stop: vi.fn().mockResolvedValue(NOTE), cancel: vi.fn() };
    const { unmount } = render(
      html`<${VoiceNoteField}
        audio=${null}
        onRecorded=${vi.fn()}
        onRemove=${vi.fn()}
        onError=${vi.fn()}
        recordAudio=${vi.fn().mockResolvedValue(handle)}
      />`,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Record voice note' }));
    await screen.findByText(/Recording ·/);
    unmount();

    expect(handle.cancel).toHaveBeenCalled();
  });
});
