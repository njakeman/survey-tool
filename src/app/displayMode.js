// The display switch's one attribute: <html data-mode="…"> drives the token
// blocks, the map filter and the status-bar colour together (src/style.css,
// design pass 3 §6). Four positions — auto follows the OS between light and
// dark via prefers-color-scheme; light and dark force a scheme (a phone that
// decided it was daytime is not an argument you want on a hillside); night is
// always a deliberate act and is never inferred — a dark room at midday is
// not a dark field at midnight.
//
// The document is injected, sensor-adapter style, so this is node-testable;
// main.js binds the real one and persists the choice in settings.

const LIGHT_PAPER = '#c2611f'; // theme-color is the accent in light, not paper
const DARK_PAPER = '#16171c';
const NIGHT_PAPER = '#0b0604';

// In auto the browser picks between the two metas by OS scheme. A forced
// position must pin both to the same colour — the browser still chooses by
// *OS* scheme, so forced Light on an OS-dark phone would otherwise get a
// dark status bar over a paper screen. Night set this precedent.
const AUTO_THEME = { light: LIGHT_PAPER, dark: DARK_PAPER };
const FORCED_THEME = { light: LIGHT_PAPER, dark: DARK_PAPER, night: NIGHT_PAPER };

export function applyDisplayMode(mode, doc) {
  const forced = Object.hasOwn(FORCED_THEME, mode) ? mode : null;
  if (forced) doc.documentElement.setAttribute('data-mode', forced);
  // Unknown values fall through to auto — a corrupt setting must never drop
  // anyone into a forced scheme, least of all night.
  else doc.documentElement.removeAttribute('data-mode');

  for (const meta of doc.querySelectorAll('meta[name="theme-color"]')) {
    const scheme = (meta.getAttribute('media') ?? '').includes('dark') ? 'dark' : 'light';
    meta.setAttribute('content', forced ? FORCED_THEME[forced] : AUTO_THEME[scheme]);
  }
}
