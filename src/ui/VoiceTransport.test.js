import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/preact';
import { html } from 'htm/preact';
import { VoiceTransport } from './VoiceTransport.js';

// A fake HTMLAudioElement: the component drives play/pause and listens for
// timeupdate/ended/loadedmetadata — tests fire those by hand.
function fakeAudioFactory() {
  const audio = {
    currentTime: 0,
    duration: NaN,
    paused: true,
    listeners: {},
    play: vi.fn(() => {
      audio.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(() => {
      audio.paused = true;
    }),
    addEventListener: (type, fn) => (audio.listeners[type] ??= []).push(fn),
    removeEventListener: (type, fn) => {
      audio.listeners[type] = (audio.listeners[type] ?? []).filter((f) => f !== fn);
    },
    emit: (type) => (audio.listeners[type] ?? []).forEach((fn) => fn()),
  };
  const createAudio = vi.fn(() => audio);
  return { audio, createAudio };
}

function renderTransport({ audio, createAudio } = fakeAudioFactory(), props = {}) {
  const onDelete = props.onDelete;
  render(
    html`<${VoiceTransport}
      src="blob:fake"
      durationMs=${'durationMs' in props ? props.durationMs : 12_000}
      onDelete=${onDelete}
      createAudio=${createAudio}
    />`,
  );
  return { audio, createAudio };
}

describe('VoiceTransport', () => {
  test('at rest: a play button, sixteen bars, and the total duration', () => {
    renderTransport();

    expect(screen.getByRole('button', { name: 'Play voice note' })).toBeInTheDocument();
    expect(document.querySelectorAll('.voice-transport-bar')).toHaveLength(16);
    expect(screen.getByText('0:12')).toBeInTheDocument();
  });

  test('play starts the audio and swaps the button to Pause', async () => {
    const { audio } = renderTransport();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play voice note' }));
    });

    expect(audio.play).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Pause voice note' })).toBeInTheDocument();
  });

  test('playback position is the bars darkening, driven by timeupdate', async () => {
    const { audio } = renderTransport();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play voice note' }));
    });

    audio.currentTime = 6; // half of 12s
    await act(async () => {
      audio.emit('timeupdate');
    });

    expect(document.querySelectorAll('.voice-transport-bar-played')).toHaveLength(8);
    // Elapsed and total both read out, elapsed first.
    expect(screen.getByText('0:06')).toBeInTheDocument();
    expect(screen.getByText(/0:12/)).toBeInTheDocument();
  });

  test('ended resets to the start: play button back, no bars darkened', async () => {
    const { audio } = renderTransport();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play voice note' }));
    });
    audio.currentTime = 12;
    await act(async () => {
      audio.emit('timeupdate');
      audio.emit('ended');
    });

    expect(screen.getByRole('button', { name: 'Play voice note' })).toBeInTheDocument();
    expect(document.querySelectorAll('.voice-transport-bar-played')).toHaveLength(0);
  });

  test('the delete control is withheld while playing, and its slot keeps the row width', async () => {
    const onDelete = vi.fn();
    const { audio } = fakeAudioFactory();
    render(
      html`<${VoiceTransport}
        src="blob:fake"
        durationMs=${12_000}
        onDelete=${onDelete}
        createAudio=${() => audio}
      />`,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete voice note' }));
    expect(onDelete).toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play voice note' }));
    });

    expect(screen.queryByRole('button', { name: 'Delete voice note' })).toBeNull();
    expect(document.querySelector('.voice-transport-spacer')).toBeTruthy();
  });

  test('with no onDelete there is never a delete control, nor a spacer', () => {
    renderTransport(fakeAudioFactory(), { onDelete: undefined });

    expect(screen.queryByRole('button', { name: 'Delete voice note' })).toBeNull();
    expect(document.querySelector('.voice-transport-spacer')).toBeNull();
  });

  test('a legacy note without a stored duration learns it from the audio metadata', async () => {
    const { audio, createAudio } = fakeAudioFactory();
    render(
      html`<${VoiceTransport} src="blob:fake" durationMs=${null} createAudio=${createAudio} />`,
    );

    audio.duration = 7;
    await act(async () => {
      audio.emit('loadedmetadata');
    });

    expect(screen.getByText('0:07')).toBeInTheDocument();
  });

  test('unmounting stops playback', async () => {
    const { audio, createAudio } = fakeAudioFactory();
    const { unmount } = render(
      html`<${VoiceTransport} src="blob:fake" durationMs=${12_000} createAudio=${createAudio} />`,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play voice note' }));
    });

    unmount();

    expect(audio.pause).toHaveBeenCalled();
  });
});
