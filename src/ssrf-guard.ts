import { promises as dns } from 'node:dns';
import ipaddr from 'ipaddr.js';
import { InvalidUrlError, SsrfBlockedError } from './errors.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function parseUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new InvalidUrlError(`"${rawUrl}" is not a valid URL`);
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new InvalidUrlError(
      `Protocol "${url.protocol}" is not allowed; only http/https are supported`
    );
  }
  return url;
}

async function resolveAddresses(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true });
  return records.map((record) => record.address);
}

function isAddressSafe(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.process(address);
  return parsed.range() === 'unicast';
}

export async function assertUrlIsSafe(rawUrl: string): Promise<URL> {
  const url = parseUrl(rawUrl);

  let addresses: string[];
  try {
    addresses = await resolveAddresses(url.hostname);
  } catch {
    throw new InvalidUrlError(`Could not resolve host "${url.hostname}"`);
  }

  if (addresses.length === 0) {
    throw new InvalidUrlError(`Could not resolve host "${url.hostname}"`);
  }

  for (const address of addresses) {
    if (!isAddressSafe(address)) {
      throw new SsrfBlockedError(
        `Blocked request to unsafe address "${address}" (resolved from "${url.hostname}")`
      );
    }
  }

  return url;
}

export async function isRequestUrlSafe(rawUrl: string): Promise<boolean> {
  try {
    await assertUrlIsSafe(rawUrl);
    return true;
  } catch {
    return false;
  }
}
