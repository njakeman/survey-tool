import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { html } from 'htm/preact';
import { FeatureLayerPanel } from './FeatureLayerPanel.js';

const PARCELS = {
  id: 'parcels',
  name: 'Field parcels',
  sizeBytes: 34_000,
  featureCount: 12,
  geometryTypes: ['Polygon'],
  style: { colour: '#1c5f9e' },
  stored: true,
  enabled: true,
};
const DESIGNATIONS = {
  id: 'designations',
  name: 'Designations',
  sizeBytes: 8_000,
  featureCount: 3,
  geometryTypes: ['Polygon', 'Point'],
  style: { colour: '#7d2208' },
  stored: false,
  enabled: false,
};

function renderPanel(overrides = {}) {
  const props = {
    layers: [PARCELS, DESIGNATIONS],
    manifestAvailable: true,
    online: true,
    onEnable: vi.fn(),
    onDisable: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
  render(html`<${FeatureLayerPanel} ...${props} />`);
  return props;
}

describe('FeatureLayerPanel', () => {
  test('lists each published layer with what it contains', () => {
    renderPanel();

    expect(screen.getByText('Field parcels')).toBeInTheDocument();
    expect(screen.getByText('12 features · Polygon · 34 kB')).toBeInTheDocument();
    expect(screen.getByText('3 features · Polygon+Point · 8 kB')).toBeInTheDocument();
  });

  test('a toggle reports whether the layer is on, not just how it looks', () => {
    // aria-pressed rather than a colour or a glyph: this is a two-state
    // control and a screen reader has to be told which state it is in.
    renderPanel();

    expect(screen.getByRole('button', { name: /Field parcels/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /Designations/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('tapping an enabled layer switches it off', () => {
    const { onDisable, onEnable } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Field parcels/ }));

    expect(onDisable).toHaveBeenCalledWith('parcels');
    expect(onEnable).not.toHaveBeenCalled();
  });

  test('tapping a layer that is off switches it on', async () => {
    const { onEnable } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Designations/ }));

    await waitFor(() => expect(onEnable).toHaveBeenCalledWith('designations'));
  });

  test('spells out each state rather than relying on the swatch alone', () => {
    renderPanel({
      layers: [
        PARCELS,
        { ...DESIGNATIONS, stored: true, enabled: false },
        { ...DESIGNATIONS, id: 'hedges', name: 'Hedges' },
      ],
    });

    expect(screen.getByText('Shown')).toBeInTheDocument();
    expect(screen.getByText('Hidden')).toBeInTheDocument();
    expect(screen.getByText('Not added')).toBeInTheDocument();
  });

  test('carries the layer colour, so a row can be matched to what is on the map', () => {
    renderPanel();

    const swatch = document.querySelector('.feature-layer-swatch');
    expect(swatch.getAttribute('style')).toContain('#1c5f9e');
  });

  test('offers Remove only for a layer that is on the device and switched off', () => {
    // Removing the layer you are looking at is a way to lose your bearings
    // mid-observation; switch it off first, deliberately.
    renderPanel({ layers: [PARCELS, { ...DESIGNATIONS, stored: true, enabled: false }] });

    expect(screen.queryByRole('button', { name: /Remove Field parcels/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove Designations/ })).toBeInTheDocument();
  });

  test('a failed fetch is announced and does not leave the row stuck busy', async () => {
    const onEnable = vi.fn().mockRejectedValue(new Error('Could not add Designations (HTTP 404)'));
    renderPanel({ onEnable });

    fireEvent.click(screen.getByRole('button', { name: /Designations/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/404/);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Designations/ })).not.toBeDisabled(),
    );
  });

  test('a layer already on the device can be switched back on with no connection', () => {
    // The whole point of keeping the data after a disable: enabling is a
    // local operation, and offline is when the surveyor needs it.
    const { onEnable } = renderPanel({
      online: false,
      layers: [{ ...DESIGNATIONS, stored: true, enabled: false }],
    });

    // Anchored: a stored-and-disabled layer also has a "Remove Designations"
    // button, and only the row itself starts with the name.
    const row = screen.getByRole('button', { name: /^Designations/ });
    expect(row).not.toBeDisabled();
    fireEvent.click(row);
    expect(onEnable).toHaveBeenCalled();
  });

  test('a layer not yet on the device cannot be added with no connection', () => {
    renderPanel({ online: false, layers: [DESIGNATIONS] });

    expect(screen.getByRole('button', { name: /Designations/ })).toBeDisabled();
  });

  test('says so when nothing is published, rather than showing an empty space', () => {
    renderPanel({ layers: [] });

    expect(screen.getByText(/no feature layers are published/i)).toBeInTheDocument();
  });

  test('explains a list that could not be checked', () => {
    renderPanel({ manifestAvailable: false, layers: [{ ...PARCELS }] });

    expect(screen.getByText(/could not be checked/i)).toBeInTheDocument();
  });
});
