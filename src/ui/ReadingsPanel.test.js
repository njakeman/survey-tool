import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { html } from 'htm/preact';
import { ReadingsPanel } from './ReadingsPanel.js';

const NOW = 1_760_000_000_000;

function renderPanel(overrides = {}) {
  const props = {
    position: null,
    positionError: null,
    heading: null,
    headingStatus: 'idle',
    onEnableCompass: vi.fn(),
    onRetryCompass: vi.fn(),
    now: () => NOW,
    ...overrides,
  };
  render(html`<${ReadingsPanel} ...${props} />`);
  return props;
}

function fix(overrides = {}) {
  return { lat: 51.5, lon: -0.14, accuracyM: 8, fixAtMs: NOW, ...overrides };
}

describe('position errors', () => {
  // Only permission-denied was handled; every other code fell through to
  // "Waiting for GPS fix…", so a device that will never produce a fix looked
  // identical to one about to.
  test.each([
    ['unsupported', /not support|unsupported/i],
    ['position-unavailable', /unavailable/i],
    ['timeout', /timed out|timeout/i],
    ['unknown', /could not|unknown|failed/i],
  ])('reports %s distinctly rather than as "waiting"', (code, pattern) => {
    renderPanel({ positionError: { code, message: 'raw message' } });

    expect(screen.getByText(pattern)).toBeInTheDocument();
    expect(screen.queryByText(/waiting for gps/i)).not.toBeInTheDocument();
  });

  test('still reports a denied permission', () => {
    renderPanel({ positionError: { code: 'permission-denied' } });
    expect(screen.getByText(/denied/i)).toBeInTheDocument();
  });

  test('waiting is only shown when genuinely waiting', () => {
    renderPanel();
    expect(screen.getByText(/waiting for gps/i)).toBeInTheDocument();
  });
});

describe('stale fixes', () => {
  test('a fresh fix is shown without an age', () => {
    renderPanel({ position: fix({ fixAtMs: NOW - 2_000 }) });

    expect(screen.getByText(/51\.500000/)).toBeInTheDocument();
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
  });

  test('an old fix is marked stale with its age, not shown as if live', () => {
    // usePosition never clears the last reading on error, so a revoked
    // permission or a lost signal leaves stale coordinates on screen looking
    // exactly like a live fix. This is the cue that they are not.
    renderPanel({ position: fix({ fixAtMs: NOW - 90_000 }) });

    expect(screen.getByText(/ago/)).toBeInTheDocument();
  });

  test('the age reads once, not twice — formatAge already ends in "ago"', () => {
    // The panel appended its own " ago" to a string that already had one, so
    // a stale fix read "1 min ago ago". The assertion above only checked for
    // /ago/, which the doubled version satisfies.
    renderPanel({ position: fix({ fixAtMs: NOW - 90_000 }) });

    expect(screen.getByText(/1 min ago/)).toBeInTheDocument();
    expect(screen.queryByText(/ago ago/)).not.toBeInTheDocument();
  });

  test('an error arriving after a fix is surfaced, not hidden behind the old reading', () => {
    renderPanel({
      position: fix({ fixAtMs: NOW - 90_000 }),
      positionError: { code: 'position-unavailable' },
    });

    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/51\.500000/)).toBeInTheDocument();
  });
});

describe('accuracy quality', () => {
  // accuracyQuality() has existed in sensors/format.js since Phase 3 and has
  // never been shown to anyone. A metre figure alone asks the surveyor to
  // remember what counts as good.
  // Natural case in the DOM, uppercased by CSS: a screen reader gets the
  // word, the surveyor gets the chip.
  test.each([
    [6, 'Good'],
    [22, 'Fair'],
    [80, 'Poor'],
  ])('a %s m fix is chipped %s', (accuracyM, word) => {
    renderPanel({ position: fix({ accuracyM }) });

    expect(screen.getByText(word)).toBeInTheDocument();
  });

  test('no chip when the device reports no accuracy — there is nothing to judge', () => {
    renderPanel({ position: fix({ accuracyM: null }) });

    for (const word of ['Good', 'Fair', 'Poor']) {
      expect(screen.queryByText(word)).not.toBeInTheDocument();
    }
  });
});

describe('compass', () => {
  test('offers to enable before it has been asked for', () => {
    const { onEnableCompass } = renderPanel({ headingStatus: 'idle' });
    fireEvent.click(screen.getByRole('button', { name: /enable compass/i }));
    expect(onEnableCompass).toHaveBeenCalled();
  });

  test('says it is waiting instead of rendering nothing', () => {
    // The Enable button disappears the moment it is tapped, and the watch
    // allows four seconds for a first reading — silence in between looks
    // like a broken app.
    renderPanel({ headingStatus: 'waiting' });

    expect(screen.getByText(/waiting for compass/i)).toBeInTheDocument();
  });

  test('shows the bearing once active', () => {
    renderPanel({ headingStatus: 'active', heading: { headingDeg: 247 } });
    expect(screen.getByText(/247/)).toBeInTheDocument();
  });

  test('a compass that stalled can be retried, since the watch stops for good', () => {
    // watchHeading tears its listener down after the no-heading timeout and
    // nothing re-arms it — without this the compass is gone for the session.
    const { onRetryCompass } = renderPanel({ headingStatus: 'unavailable' });

    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));

    expect(onRetryCompass).toHaveBeenCalled();
  });

  test('a denied compass degrades to position-only without offering a pointless retry', () => {
    renderPanel({ headingStatus: 'denied' });

    expect(screen.getByText(/position only/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry|try again/i })).not.toBeInTheDocument();
  });

  // iOS stores a compass-permission denial permanently per origin — a Retry
  // tap would just resolve 'denied' again with no dialog (see enable() in
  // useHeading.js), so the message has to tell the surveyor how to actually
  // fix it rather than imply the device has no magnetometer. Distinct from
  // the generic 'unavailable' text below, which genuinely may mean that.
  test('a denied compass names the fix — a Settings reset, not a broken device', () => {
    renderPanel({ headingStatus: 'denied' });

    expect(screen.getByText(/settings/i)).toBeInTheDocument();
    expect(screen.getByText(/website data/i)).toBeInTheDocument();
  });

  test('an unavailable compass (genuinely no reading) keeps the generic message, not the denied one', () => {
    renderPanel({ headingStatus: 'unavailable' });

    expect(screen.queryByText(/settings/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/website data/i)).not.toBeInTheDocument();
  });
});

describe('ReadingsPanel — grid reference', () => {
  const POSITION_UK = {
    lat: 51.5,
    lon: -0.14,
    accuracyM: 8,
    altitudeM: null,
    altitudeAccuracyM: null,
    fixAt: '2026-08-06T10:00:00.000Z',
    fixAtMs: Date.now(),
  };

  test('shows the grid reference under the coordinates', () => {
    render(
      html`<${ReadingsPanel}
        position=${POSITION_UK}
        headingStatus="idle"
        gridRef=${() => 'SU 14082 39216'}
      />`,
    );

    expect(screen.getByText('SU 14082 39216')).toBeInTheDocument();
  });

  test('is derived from the live fix, so it follows the surveyor', () => {
    const gridRef = vi.fn(() => 'SU 14082 39216');
    render(
      html`<${ReadingsPanel} position=${POSITION_UK} headingStatus="idle" gridRef=${gridRef} />`,
    );

    expect(gridRef).toHaveBeenCalledWith(POSITION_UK.lat, POSITION_UK.lon);
  });

  test('shows nothing rather than an empty row outside Great Britain', () => {
    const { container } = render(
      html`<${ReadingsPanel} position=${POSITION_UK} headingStatus="idle" gridRef=${() => null} />`,
    );

    expect(container.querySelector('.readings-gridref')).toBeNull();
    // The coordinates themselves are unaffected — the grid reference is an
    // extra, never a replacement.
    expect(screen.getByText('51.500000, -0.140000')).toBeInTheDocument();
  });

  test('works before the shift grid has loaded', () => {
    const { container } = render(
      html`<${ReadingsPanel} position=${POSITION_UK} headingStatus="idle" />`,
    );

    expect(container.querySelector('.readings-gridref')).toBeNull();
  });
});
