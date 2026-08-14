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

    fireEvent.click(screen.getByRole('button', { name: 'Voice note' }));
    await screen.findByRole('timer');

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(onRecorded).toHaveBeenCalledWith(NOTE));
  });

  test('while recording, the row shows the activity bars and a timer', async () => {
    // The bars are a repeating pattern, deliberately not live levels (design
    // pass 4 decision) — motion that says "recording" without claiming to be
    // a meter.
    const handle = { stop: vi.fn().mockResolvedValue(NOTE), cancel: vi.fn() };
    renderField({ recordAudio: vi.fn().mockResolvedValue(handle) });

    fireEvent.click(screen.getByRole('button', { name: 'Voice note' }));
    await screen.findByRole('timer');

    expect(document.querySelector('.voice-note-bars')).toBeTruthy();
    expect(document.querySelectorAll('.voice-note-bars span')).toHaveLength(16);
  });

  test('a recorded note shows the transport row and can be deleted', () => {
    const { onRemove } = renderField({ audio: NOTE });

    // The purpose-drawn transport replaces the native player (design pass 4,
    // 5c in full); delete is an unlabelled ✕ that still names itself.
    expect(document.querySelector('.voice-transport')).toBeTruthy();
    expect(document.querySelector('audio')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play voice note' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete voice note' }));
    expect(onRemove).toHaveBeenCalled();
  });

  test('a denial lands on the field as a message, not a crash — Save is untouched', async () => {
    const recordAudio = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }),
      );
    const { onError, onRecorded } = renderField({ recordAudio });

    fireEvent.click(screen.getByRole('button', { name: 'Voice note' }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith('Permission denied'));
    expect(onRecorded).not.toHaveBeenCalled();
  });

  test('an empty recording is reported, never handed up as a silent file', async () => {
    const empty = { blob: new Blob([], { type: 'audio/mp4' }), durationMs: 3000 };
    const handle = { stop: vi.fn().mockResolvedValue(empty), cancel: vi.fn() };
    const { onError, onRecorded } = renderField({ recordAudio: vi.fn().mockResolvedValue(handle) });

    fireEvent.click(screen.getByRole('button', { name: 'Voice note' }));
    await screen.findByRole('timer');
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

    fireEvent.click(screen.getByRole('button', { name: 'Voice note' }));
    await screen.findByRole('timer');
    unmount();

    expect(handle.cancel).toHaveBeenCalled();
  });
});
