import { describe, expect, test } from 'vitest';
import { formatError, isMutedErrorEvent } from './error-display.js';

describe('formatError', () => {
  test('includes the error message and name', () => {
    const text = formatError(new TypeError('storage is not defined'));
    expect(text).toContain('TypeError');
    expect(text).toContain('storage is not defined');
  });

  test('includes the stack trace when present', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at main.js:1:1';
    expect(formatError(error)).toContain('at main.js:1:1');
  });

  test('handles a non-Error value thrown (e.g. a string or plain object)', () => {
    expect(formatError('a plain string rejection')).toContain('a plain string rejection');
  });

  test('handles an ErrorEvent-like object with message/filename/lineno', () => {
    const event = { message: 'Script error', filename: 'main.js', lineno: 12, colno: 4 };
    const text = formatError(event);
    expect(text).toContain('Script error');
    expect(text).toContain('main.js:12:4');
  });

  test('an absent location renders as just the message, never "(:0:0)"', () => {
    // WebKit's muted cross-origin payload: empty filename, zero line and
    // column. '' and 0 survived the old undefined-only filter and joined
    // into a truthy ':0:0' — the "(:0:0)" seen on the phone.
    const event = { message: 'Script error.', filename: '', lineno: 0, colno: 0 };

    expect(formatError(event)).toBe('Script error.');
  });
});

describe('isMutedErrorEvent', () => {
  test('recognises the sanitized cross-origin payload — null error, no filename', () => {
    // The signature WebKit dispatches for errors the page may not inspect
    // (the HTML spec's muted-errors rule). Everything identifying is
    // withheld, so nothing in it can ever be acted on.
    const muted = { message: 'Script error.', filename: '', lineno: 0, colno: 0, error: null };

    expect(isMutedErrorEvent(muted)).toBe(true);
  });

  test('an event carrying a real error object is not muted', () => {
    const real = {
      message: 'boom',
      filename: '',
      lineno: 0,
      colno: 0,
      error: new Error('boom'),
    };

    expect(isMutedErrorEvent(real)).toBe(false);
  });

  test('an event with a source file is not muted, even with no error object', () => {
    // A same-origin throw of a primitive can surface with error null-ish in
    // odd engines, but it still names its file — that is actionable.
    const located = { message: 'boom', filename: 'main.js', lineno: 12, colno: 4, error: null };

    expect(isMutedErrorEvent(located)).toBe(false);
  });

  test('tolerates null and undefined', () => {
    expect(isMutedErrorEvent(null)).toBe(false);
    expect(isMutedErrorEvent(undefined)).toBe(false);
  });
});
