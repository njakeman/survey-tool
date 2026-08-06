import { describe, expect, test } from 'vitest';
import { formatError } from './error-display.js';

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
});
