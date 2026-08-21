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

  test('Start calls onStart with the (possibly edited) name and no reference', () => {
    const onStart = vi.fn();
    render(html`<${SessionBar} session=${null} defaultName="2026-08-06" onStart=${onStart} />`);

    fireEvent.input(screen.getByLabelText(/session name/i), { target: { value: 'Ashton Keynes' } });
    fireEvent.click(screen.getByRole('button', { name: /start session/i }));

    expect(onStart).toHaveBeenCalledWith('Ashton Keynes', null);
  });

  test('a blank name does not call onStart', () => {
    const onStart = vi.fn();
    render(html`<${SessionBar} session=${null} defaultName="2026-08-06" onStart=${onStart} />`);

    fireEvent.input(screen.getByLabelText(/session name/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /start session/i }));

    expect(onStart).not.toHaveBeenCalled();
  });

  test('shows the brand lockup — wordmark, decorative mark, and the SURVEY suffix', () => {
    render(html`<${SessionBar} session=${null} defaultName="2026-08-06" />`);

    expect(screen.getByText('field')).toBeInTheDocument();
    expect(screen.getByText('Works')).toBeInTheDocument();
    // Natural case in the DOM — CSS uppercases it (docs/styling.md: assert on
    // DOM text, not rendered case).
    expect(screen.getByText('Survey')).toBeInTheDocument();

    const mark = document.querySelector('.brand-mark');
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveAttribute('alt', '');
  });
});

describe('SessionBar — session types', () => {
  const loadedReference = {
    buffer: new ArrayBuffer(4),
    stations: [{ id: 'ref-1', note: 'Culvert head.', lat: 51.5002, lon: -0.14 }],
    reference: {
      filename: 'long-barrow-2025-04-12.zip',
      hash: 'a'.repeat(64),
      sessionId: 'ref-sess-1',
      sessionName: 'Long Barrow south',
      startedAt: '2025-04-12T09:00:00.000Z',
      stationCount: 1,
      photoCount: 1,
    },
  };

  function renderStart(overrides = {}) {
    const props = {
      session: null,
      defaultName: '2026-08-21',
      onStart: vi.fn(),
      loadReference: vi.fn().mockResolvedValue(loadedReference),
      ...overrides,
    };
    render(html`<${SessionBar} ...${props} />`);
    return props;
  }

  async function pickReferenceFile() {
    fireEvent.click(screen.getByRole('button', { name: /revisit a survey/i }));
    const file = new File(['PK'], 'long-barrow-2025-04-12.zip', { type: 'application/zip' });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    await screen.findByText('long-barrow-2025-04-12.zip');
  }

  test('offers the two session types, New survey pressed by default', () => {
    renderStart();

    const newSurvey = screen.getByRole('button', { name: /new survey/i });
    const revisit = screen.getByRole('button', { name: /revisit a survey/i });
    expect(newSurvey).toHaveAttribute('aria-pressed', 'true');
    expect(revisit).toHaveAttribute('aria-pressed', 'false');
  });

  test('choosing Revisit relabels Start and disables it until a reference is loaded', () => {
    renderStart();

    fireEvent.click(screen.getByRole('button', { name: /revisit a survey/i }));

    const start = screen.getByRole('button', { name: /start revisit session/i });
    expect(start).toBeDisabled();
    expect(screen.getByText(/load a previous export/i)).toBeInTheDocument();
  });

  test('a loaded reference enables Start, and Start hands the whole load over', async () => {
    const { onStart, loadReference } = renderStart();

    await pickReferenceFile();

    expect(loadReference).toHaveBeenCalledTimes(1);
    const start = screen.getByRole('button', { name: /start revisit session/i });
    expect(start).not.toBeDisabled();
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledWith('2026-08-21', loadedReference);
  });

  test('a failed load names its reason and Start stays disabled', async () => {
    const loadReference = vi
      .fn()
      .mockRejectedValue(new Error('Could not load reference: no session.geojson inside'));
    renderStart({ loadReference });

    fireEvent.click(screen.getByRole('button', { name: /revisit a survey/i }));
    const file = new File(['nope'], 'not-a-zip.txt', { type: 'text/plain' });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/no session\.geojson/);
    expect(screen.getByRole('button', { name: /start revisit session/i })).toBeDisabled();
  });

  test('switching back to New survey collapses the reference and starts a plain session', async () => {
    const { onStart } = renderStart();
    await pickReferenceFile();

    fireEvent.click(screen.getByRole('button', { name: /new survey/i }));

    expect(screen.queryByText('long-barrow-2025-04-12.zip')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^start session$/i }));
    expect(onStart).toHaveBeenCalledWith('2026-08-21', null);
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

  test('does not show the brand lockup — it belongs to first launch only', () => {
    render(html`<${SessionBar} session=${session} observationCount=${3} />`);

    expect(document.querySelector('.brand-lockup')).not.toBeInTheDocument();
  });

  test('confirming End on a revisit shows the four outcomes together — the only place they are', () => {
    const summary = { total: 12, done: 9, skipped: 2, noAccess: 1, remaining: 0, newCount: 3 };
    render(
      html`<${SessionBar}
        session=${session}
        observationCount=${12}
        revisitProgress=${{ done: 9, total: 12 }}
        revisitSummary=${summary}
        onEnd=${vi.fn()}
      />`,
    );

    expect(document.querySelector('.session-revisit-summary')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /end session/i }));

    const block = document.querySelector('.session-revisit-summary');
    expect(block).not.toBeNull();
    expect(block.textContent).toMatch(/9\s*of 12 revisited/);
    expect(block.textContent).toMatch(/1 no access · 2 skipped · 3 new observations/);
    // Shape as well as words: filled / hatched / dashed segments.
    expect(block.querySelector('.session-summary-done')).not.toBeNull();
    expect(block.querySelector('.session-summary-noaccess')).not.toBeNull();
    expect(block.querySelector('.session-summary-remaining')).not.toBeNull();
  });

  test('an ordinary survey confirms End without any revisit summary', () => {
    render(html`<${SessionBar} session=${session} observationCount=${3} onEnd=${vi.fn()} />`);

    fireEvent.click(screen.getByRole('button', { name: /end session/i }));

    expect(document.querySelector('.session-revisit-summary')).toBeNull();
  });
});
