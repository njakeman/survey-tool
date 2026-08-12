import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
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
    expect(screen.getByText(/480 m/)).toBeTruthy();
    expect(screen.getByText(/34 points/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onPause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onFinish).toHaveBeenCalled();
  });

  test('a boundary names itself as one', () => {
    renderStrip({ trace: { mode: 'boundary' } });

    expect(screen.getByText(/Tracing boundary/)).toBeTruthy();
  });

  test('before the first vertex it says it is waiting for a good fix', () => {
    renderStrip({ trace: { stats: { vertexCount: 0, lengthM: 0, worstAccuracyM: null } } });

    expect(screen.getByText(/waiting for a good fix/i)).toBeTruthy();
  });

  test('paused shows Resume in place of Pause', () => {
    const { onResume } = renderStrip({ trace: { status: 'paused' } });

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

  test('the confirm step can be backed out of', () => {
    const { onDiscard } = renderStrip();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep tracing' }));

    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Discard trace' })).toBeNull();
  });

  test('a pending trace waits on Save and can only be discarded', () => {
    renderStrip({ trace: { status: 'pending' } });

    expect(screen.getByText(/save to keep it/i)).toBeTruthy();
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
