import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { html } from 'htm/preact';
import { TraceStrip } from './TraceStrip.js';

function renderStrip({
  trace = {},
  onPause = vi.fn(),
  onResume = vi.fn(),
  onFinish = vi.fn(),
  onDiscard = vi.fn(),
} = {}) {
  const value = {
    status: 'recording',
    mode: 'path',
    startedAt: '2026-08-12T09:00:00.000Z',
    stats: { vertexCount: 34, lengthM: 480, worstAccuracyM: 9 },
    warnings: [],
    error: null,
    ...trace,
  };
  render(
    html`<${TraceStrip}
      trace=${value}
      onPause=${onPause}
      onResume=${onResume}
      onFinish=${onFinish}
      onDiscard=${onDiscard}
    />`,
  );
  return { onPause, onResume, onFinish, onDiscard };
}

describe('TraceStrip', () => {
  test('while recording it reports the walk and offers pause, finish and discard', () => {
    const { onPause, onFinish } = renderStrip();

    expect(screen.getByText(/Tracing path/)).toBeTruthy();
    expect(screen.getByText(/480 m · 34 points/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onPause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onFinish).toHaveBeenCalled();
  });

  test('Finish is the accent action, recording and paused alike', () => {
    // The one-accent rule: Finish is what moves the walk toward being saved,
    // so it wears the accent in both states — same treatment, same slot.
    renderStrip();
    expect(screen.getByRole('button', { name: 'Finish' }).className).toContain('button-primary');

    cleanup();

    renderStrip({ trace: { status: 'paused' } });
    expect(screen.getByRole('button', { name: 'Finish' }).className).toContain('button-primary');
  });

  test('a boundary names itself as one', () => {
    renderStrip({ trace: { mode: 'boundary' } });

    expect(screen.getByText(/Tracing boundary/)).toBeTruthy();
  });

  test('before the first vertex, waiting-for-a-fix takes the metrics slot', () => {
    // The same slot, not an extra line — the strip must not change height
    // under the thumb when the first vertex lands.
    renderStrip({ trace: { stats: { vertexCount: 0, lengthM: 0, worstAccuracyM: null } } });

    expect(screen.getByText(/waiting for a good fix/i)).toBeTruthy();
    expect(screen.queryByText(/0 points/)).toBeNull();
  });

  test('paused shows Resume in place of Pause and quietens the label', () => {
    const { onResume } = renderStrip({ trace: { status: 'paused' } });

    expect(screen.getByText(/Paused · path/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalled();
  });

  test('discard asks before it acts — a walked line is not lost to one mistap', () => {
    const { onDiscard } = renderStrip();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDiscard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Discard trace' }));
    expect(onDiscard).toHaveBeenCalled();
  });

  test('the confirm replaces the action row rather than extending it', () => {
    // Finish and Pause leave while the confirm is up: the row cannot reflow
    // mid-interaction on a 320px screen, and a glove aiming at Keep tracing
    // must not land on Finish.
    renderStrip();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(screen.queryByRole('button', { name: 'Finish' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Discard trace' })).toBeTruthy();
  });

  test('the confirm step can be backed out of', () => {
    const { onDiscard } = renderStrip();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep tracing' }));

    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Discard trace' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeTruthy();
  });

  test('a pending trace states what it is, asks for Save, and can only be discarded', () => {
    renderStrip({ trace: { status: 'pending', mode: 'boundary' } });

    // The word "pending" goes: the strip's existence is the pending-ness,
    // and Save sits directly beneath saying the same thing.
    expect(screen.getByText(/Traced boundary · 480 m · 34 points/)).toBeTruthy();
    expect(screen.getByText(/Save to keep it/)).toBeTruthy();
    expect(screen.queryByText(/pending/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Finish' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy();
  });

  test('a self-intersecting boundary warns but does not block', () => {
    renderStrip({
      trace: { status: 'pending', mode: 'boundary', warnings: ['self-intersection'] },
    });

    expect(screen.getByText(/crosses itself/i)).toBeTruthy();
    expect(screen.getByText(/still save/i)).toBeTruthy();
  });

  test('errors surface on the strip', () => {
    renderStrip({ trace: { error: 'Keep walking or discard — a boundary needs three points' } });

    expect(screen.getByRole('alert').textContent).toMatch(/Keep walking/);
  });
});
