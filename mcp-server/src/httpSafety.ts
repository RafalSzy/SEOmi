import { lookup } from 'node:dns/promises';
import { request as requestHttp, type RequestOptions as HttpRequestOptions } from 'node:http';
import { request as requestHttps } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';

export const MAX_AUDIT_URL_LENGTH = 2048;

const parseIpv4 = (address: string): [number, number, number, number] | null => {
  if (isIP(address) !== 4) return null;
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts as [number, number, number, number]
    : null;
};

const parseIpv6Words = (address: string): number[] | null => {
  let value = address.toLowerCase();
  if (value.includes('.')) {
    const separator = value.lastIndexOf(':');
    const ipv4 = parseIpv4(value.slice(separator + 1));
    if (!ipv4) return null;
    const high = ((ipv4[0] << 8) | ipv4[1]).toString(16);
    const low = ((ipv4[2] << 8) | ipv4[3]).toString(16);
    value = `${value.slice(0, separator)}:${high}:${low}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const parseHalf = (half: string) => half ? half.split(':').map((part) => /^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : Number.NaN) : [];
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] || '');
  if ([...left, ...right].some((word) => !Number.isInteger(word)) || left.length + right.length > 8) return null;
  const fillCount = 8 - left.length - right.length;
  if (halves.length === 1 && fillCount !== 0) return null;
  if (halves.length === 2 && fillCount < 1) return null;
  return [...left, ...Array.from({ length: fillCount }, () => 0), ...right];
};

export const isPublicAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = parseIpv4(address)!;
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0 && c === 0)
      || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 88 && c === 99)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113));
  }
  if (family !== 6) return false;
  const words = parseIpv6Words(address);
  if (!words) return false;
  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (mapped) {
    const ipv4 = [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff].join('.');
    return isPublicAddress(ipv4);
  }
  const first = words[0];
  const second = words[1];
  return first >= 0x2000 && first <= 0x3fff
    && !(first === 0x2001 && second <= 0x01ff)
    && !(first === 0x2001 && second === 0x0db8)
    && first !== 0x2002;
};

export type AddressResolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const resolveAll: AddressResolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

export interface ValidatedPublicTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

export const validatePublicTarget = async (value: string, resolve: AddressResolver = resolveAll): Promise<ValidatedPublicTarget> => {
  if (value.length > MAX_AUDIT_URL_LENGTH) throw new Error(`URL cannot exceed ${MAX_AUDIT_URL_LENGTH} characters.`);
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
  if (url.username || url.password) throw new Error('URLs with embedded credentials are not allowed.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || ['.localhost', '.local', '.internal', '.lan'].some((suffix) => hostname.endsWith(suffix))) {
    throw new Error('Local and private network targets are blocked.');
  }
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new Error('Private, loopback, and special-purpose IP targets are blocked.');
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolve(hostname);
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('Private, loopback, and special-purpose network targets are blocked.');
  }
  const address = addresses[0].address;
  const family = isIP(address);
  if (family !== 4 && family !== 6) throw new Error('Hostname resolution did not return a valid IP address.');
  return { url, address, family };
};

export const validatePublicUrl = async (value: string, resolve: AddressResolver = resolveAll): Promise<URL> => (
  await validatePublicTarget(value, resolve)
).url;

export const requestPinnedPublicTarget = async (target: ValidatedPublicTarget, timeoutMs: number): Promise<Response> => {
  const transport = target.url.protocol === 'https:' ? requestHttps : requestHttp;
  const lookupPinned = ((
    _hostname: string,
    options: { all?: boolean } | undefined,
    callback: (...args: unknown[]) => void,
  ) => {
    const result = { address: target.address, family: target.family };
    if (options?.all) callback(null, [result]);
    else callback(null, result.address, result.family);
  }) as NonNullable<HttpRequestOptions['lookup']>;

  return new Promise((resolve, reject) => {
    const request = transport(target.url, {
      method: 'GET',
      headers: { 'user-agent': 'SEOmi-MCP/1.0 (+local desktop workflow)' },
      signal: AbortSignal.timeout(timeoutMs),
      lookup: lookupPinned as LookupFunction,
    }, (incoming) => {
      const headers = new Headers();
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
      }
      const status = incoming.statusCode ?? 502;
      const body = [204, 205, 304].includes(status)
        ? null
        : Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
      resolve(new Response(body, { status, statusText: incoming.statusMessage, headers }));
    });
    request.once('error', reject);
    request.end();
  });
};

export interface LimitedBodyText { text: string; truncated: boolean; bytesRead: number; }

export const readResponseTextLimited = async (response: Response, maxBytes: number): Promise<LimitedBodyText> => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Response byte limit must be a non-negative integer.');
  if (!response.body) return { text: '', truncated: false, bytesRead: 0 };
  if (maxBytes === 0) {
    await response.body.cancel();
    return { text: '', truncated: true, bytesRead: 0 };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytesRead;
      if (value.byteLength > remaining) {
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        bytesRead += Math.max(remaining, 0);
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      bytesRead += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), truncated, bytesRead };
};
