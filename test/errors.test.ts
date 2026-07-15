import { describe, it, expect } from 'vitest';
import {
  InvalidUrlError,
  SsrfBlockedError,
  NavigationFailedError,
  toToolError,
} from '../src/errors.js';

describe('toToolError', () => {
  it('formats a known error class with its name and message', () => {
    const result = toToolError(new SsrfBlockedError('blocked 10.0.0.1'));
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'SsrfBlockedError: blocked 10.0.0.1' },
    ]);
  });

  it('formats a non-Error thrown value by stringifying it', () => {
    const result = toToolError('plain string failure');
    expect(result.content).toEqual([{ type: 'text', text: 'plain string failure' }]);
    expect(result.isError).toBe(true);
  });

  it('gives InvalidUrlError and NavigationFailedError distinct .name identities', () => {
    expect(new InvalidUrlError('bad url').name).toBe('InvalidUrlError');
    expect(new NavigationFailedError('nav failed').name).toBe('NavigationFailedError');
  });
});
