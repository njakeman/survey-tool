import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { html } from 'htm/preact';
import { SessionBar } from './SessionBar.js';

describe('SessionBar — no open session', () => {
  test('shows a name input pre-filled with defaultName and a Start button', () => {
    render(html`<${SessionBar} session=${null} defaultName="2026-08-06" />`);

    expect(screen.getByLabelText(/session name/i)).toHaveValue('2026-08-06');
    expect(screen.getByRole('button', { name: /start session/i })).toBeInTheDocument();
  });

  test('Start calls onStart with the (possibly edited) name', () => {
    const onStart = vi.fn();
    render(html`<${SessionBar} session=${null} defaultName="2026-08-06" onStart=${onStart} />`);

    fireEvent.input(screen.getByLabelText(/session name/i), { target: { value: 'Ashton Keynes' } });
    fireEvent.click(screen.getByRole('button', { name: /start session/i }));

    expect(onStart).toHaveBeenCalledWith('Ashton Keynes');
  });

  test('a blank name does not call onStart', () => {
    const onStart = vi.fn();
    render(html`<${SessionBar} session=${null} defaultName="2026-08-06" onStart=${onStart} />`);

    fireEvent.input(screen.getByLabelText(/session name/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /start session/i }));

    expect(onStart).not.toHaveBeenCalled();
  });
});

describe('SessionBar — open session', () => {
  const session = {
    id: 'sess-1',
    name: 'Ashton Keynes',
    startedAt: '2026-08-06T09:00:00.000Z',
    status: 'open',
  };

  test('shows the session name, start time and observation count', () => {
    render(html`<${SessionBar} session=${session} observationCount=${3} />`);

    expect(screen.getByText('Ashton Keynes')).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  test('End session requires a second confirming tap before onEnd fires', () => {
    const onEnd = vi.fn();
    render(html`<${SessionBar} session=${session} observationCount=${3} onEnd=${onEnd} />`);

    fireEvent.click(screen.getByRole('button', { name: /end session/i }));
    expect(onEnd).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm end session' }));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  test('ending with nothing recorded says the session will be discarded, still two-tap', () => {
    // endSession deletes an empty session rather than closing it; the
    // confirm step is where the surveyor learns that, before it happens.
    const onEnd = vi.fn();
    render(html`<${SessionBar} session=${session} observationCount=${0} onEnd=${onEnd} />`);

    fireEvent.click(screen.getByRole('button', { name: /end session/i }));
    expect(onEnd).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /nothing recorded — discard session/i }));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
