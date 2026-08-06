import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { html } from 'htm/preact';
import { App } from './App.js';

function createFakeService() {
  return {
    getOpenSession: vi.fn().mockResolvedValue(null),
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

describe('App', () => {
  test('defaults to the capture view', async () => {
    render(
      html`<${App} service=${createFakeService()} sensors=${fakeSensors()} downscale=${vi.fn()} />`,
    );
    expect(await screen.findByRole('button', { name: /save observation/i })).toBeInTheDocument();
  });

  test('the device probe link switches to the probe view, and Back returns to capture', async () => {
    render(
      html`<${App} service=${createFakeService()} sensors=${fakeSensors()} downscale=${vi.fn()} />`,
    );
    await screen.findByRole('button', { name: /save observation/i });

    fireEvent.click(screen.getByRole('button', { name: /device probe/i }));
    expect(await screen.findByText('Device capability probe')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));
    expect(await screen.findByRole('button', { name: /save observation/i })).toBeInTheDocument();
  });

  test('never touches window.location.hash — no client-side router', async () => {
    const initialHash = window.location.hash;
    render(
      html`<${App} service=${createFakeService()} sensors=${fakeSensors()} downscale=${vi.fn()} />`,
    );
    await screen.findByRole('button', { name: /save observation/i });

    fireEvent.click(screen.getByRole('button', { name: /device probe/i }));
    await screen.findByText('Device capability probe');
    expect(window.location.hash).toBe(initialHash);

    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));
    await screen.findByRole('button', { name: /save observation/i });
    expect(window.location.hash).toBe(initialHash);
  });
});
