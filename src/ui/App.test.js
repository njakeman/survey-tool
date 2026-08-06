import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { html } from 'htm/preact';
import { App } from './App.js';

function createFakeService() {
  return {
    getOpenSession: vi.fn().mockResolvedValue(null),
    listSessions: vi.fn().mockResolvedValue([]),
    listObservations: vi.fn().mockResolvedValue([]),
    startSession: vi.fn(),
    endSession: vi.fn(),
    saveObservation: vi.fn(),
    countObservations: vi.fn().mockResolvedValue(0),
    deleteObservation: vi.fn(),
  };
}

function fakeSensors() {
  return {
    watchPosition: () => () => {},
    watchHeading: () => () => {},
    requestHeadingPermission: vi.fn().mockResolvedValue('granted'),
  };
}

function renderApp(overrides = {}) {
  return render(
    html`<${App}
      service=${overrides.service ?? createFakeService()}
      sensors=${overrides.sensors ?? fakeSensors()}
      downscale=${overrides.downscale ?? vi.fn()}
      exportSession=${overrides.exportSession ?? vi.fn()}
    />`,
  );
}

describe('App', () => {
  test('defaults to the capture view', async () => {
    renderApp();
    expect(await screen.findByRole('button', { name: /save observation/i })).toBeInTheDocument();
  });

  test('the device probe link switches to the probe view, and Back returns to capture', async () => {
    renderApp();
    await screen.findByRole('button', { name: /save observation/i });

    fireEvent.click(screen.getByRole('button', { name: /device probe/i }));
    expect(await screen.findByText('Device capability probe')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));
    expect(await screen.findByRole('button', { name: /save observation/i })).toBeInTheDocument();
  });

  test('the session history link switches to the history view, and Back returns to capture', async () => {
    renderApp();
    await screen.findByRole('button', { name: /save observation/i });

    fireEvent.click(screen.getByRole('button', { name: /session history/i }));
    expect(await screen.findByText('Past sessions')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));
    expect(await screen.findByRole('button', { name: /save observation/i })).toBeInTheDocument();
  });

  test('never touches window.location.hash — no client-side router', async () => {
    const initialHash = window.location.hash;
    renderApp();
    await screen.findByRole('button', { name: /save observation/i });

    fireEvent.click(screen.getByRole('button', { name: /device probe/i }));
    await screen.findByText('Device capability probe');
    expect(window.location.hash).toBe(initialHash);

    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));
    await screen.findByRole('button', { name: /save observation/i });
    expect(window.location.hash).toBe(initialHash);
  });
});
