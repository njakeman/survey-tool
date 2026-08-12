// Night mode's one attribute: <html data-mode="night"> drives the token
// block, the map filter and the status-bar colour together (src/style.css,
// design pass 3). Auto follows the OS between light and dark via
// prefers-color-scheme; night is always a deliberate act and is never
// inferred — a dark room at midday is not a dark field at midnight.
//
// The document is injected, sensor-adapter style, so this is node-testable;
// main.js binds the real one and persists the choice in settings.

const NIGHT_PAPER = '#0b0604';

// Mirrors the two theme-color metas in index.html — the browser picks by
// scheme in auto, and both drop to night paper in night so the iOS status
// bar cannot light up in either scheme.
const AUTO_THEME = { light: '#c2611f', dark: '#16171c' };

export function applyDisplayMode(mode, doc) {
  const night = mode === 'night';
  if (night) doc.documentElement.setAttribute('data-mode', 'night');
  else doc.documentElement.removeAttribute('data-mode');

  for (const meta of doc.querySelectorAll('meta[name="theme-color"]')) {
    const scheme = (meta.getAttribute('media') ?? '').includes('dark') ? 'dark' : 'light';
    meta.setAttribute('content', night ? NIGHT_PAPER : AUTO_THEME[scheme]);
  }
}
