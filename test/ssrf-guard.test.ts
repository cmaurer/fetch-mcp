import { describe, it, expect, vi, beforeEach } from 'vitest';

const lookupMock = vi.fn();

vi.mock('node:dns', () => ({
  promises: {
    lookup: (...args: unknown[]) => lookupMock(...args),
  },
}));

import { assertUrlIsSafe, isRequestUrlSafe } from '../src/ssrf-guard.js';
import { InvalidUrlError, SsrfBlockedError } from '../src/errors.js';

beforeEach(() => {
  lookupMock.mockReset();
});

describe('assertUrlIsSafe', () => {
  it('rejects non-http(s) protocols before doing any DNS lookup', async () => {
    await expect(assertUrlIsSafe('ftp://example.com/file')).rejects.toBeInstanceOf(
      InvalidUrlError
    );
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('allows a hostname that resolves to a public IPv4 address', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(assertUrlIsSafe('https://example.com')).resolves.toBeInstanceOf(URL);
  });

  it('blocks loopback addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(assertUrlIsSafe('http://localhost')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('blocks RFC1918 private addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    await expect(assertUrlIsSafe('http://internal.example')).rejects.toBeInstanceOf(
      SsrfBlockedError
    );
  });

  it('blocks link-local addresses, including the cloud metadata address', async () => {
    lookupMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(assertUrlIsSafe('http://metadata.example')).rejects.toBeInstanceOf(
      SsrfBlockedError
    );
  });

  it('blocks IPv4-mapped IPv6 addresses that map to a private address', async () => {
    lookupMock.mockResolvedValue([{ address: '::ffff:10.0.0.5', family: 6 }]);
    await expect(assertUrlIsSafe('http://mapped.example')).rejects.toBeInstanceOf(
      SsrfBlockedError
    );
  });

  it('blocks a hostname if ANY resolved address is unsafe, even if another is public', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    await expect(assertUrlIsSafe('http://mixed.example')).rejects.toBeInstanceOf(
      SsrfBlockedError
    );
  });
});

describe('isRequestUrlSafe', () => {
  it('returns false instead of throwing for a blocked address', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(isRequestUrlSafe('http://localhost')).resolves.toBe(false);
  });

  it('returns true for a safe address', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(isRequestUrlSafe('https://example.com')).resolves.toBe(true);
  });
});
