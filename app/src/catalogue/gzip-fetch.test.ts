// @vitest-environment jsdom
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bucketForId, bucketTag, PACK_BUCKET_COUNT } from './pack-bucket';
import {
  decodeMaybeGzipBytes,
  fetchJsonMaybeGzip,
  fetchTextMaybeGzip,
} from './gzip-fetch';

async function sha256HexNode(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pack-bucket', () => {
  it('distributes IDs deterministically across 64 buckets', () => {
    expect(PACK_BUCKET_COUNT).toBe(64);
    const b1 = bucketForId('26006871febf2139');
    const b2 = bucketForId('26006871febf2139');
    expect(b1).toBe(b2);
    expect(b1).toBeGreaterThanOrEqual(0);
    expect(b1).toBeLessThan(64);
    expect(bucketTag(0)).toBe('00');
    expect(bucketTag(9)).toBe('09');
    expect(bucketTag(63)).toBe('63');
  });
});

describe('gzip-fetch', () => {
  it('detects gzip magic bytes (0x1f 0x8b) and decompresses without Content-Encoding header', async () => {
    const payload = JSON.stringify({ hello: 'world', count: 42 });
    const compressed = new Uint8Array(gzipSync(Buffer.from(payload, 'utf8')));
    expect(compressed[0]).toBe(0x1f);
    expect(compressed[1]).toBe(0x8b);

    const expectedSha256 = await sha256HexNode(compressed);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => compressed.slice().buffer,
    } as unknown as Response);

    const parsed = await fetchJsonMaybeGzip<{ hello: string; count: number }>('/data/test.json.gzbin', {
      expectedSha256,
    });
    expect(parsed).toEqual({ hello: 'world', count: 42 });
  });

  it('decodes plain UTF-8 bytes when magic bytes are not gzip', async () => {
    const payload = JSON.stringify({ plain: true });
    const raw = new TextEncoder().encode(payload);
    const expectedSha256 = await sha256HexNode(raw);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => raw.slice().buffer,
    } as unknown as Response);

    await expect(fetchJsonMaybeGzip('/data/plain.json', expectedSha256)).resolves.toEqual({ plain: true });
  });

  it('rejects on SHA-256 digest mismatch before decompressing', async () => {
    const compressed = new Uint8Array(gzipSync(Buffer.from('{"a":1}', 'utf8')));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => compressed.slice().buffer,
    } as unknown as Response);

    await expect(
      fetchTextMaybeGzip('/data/test.json.gzbin', { expectedSha256: '0'.repeat(64) }),
    ).rejects.toThrow(/integrity/i);
  });

  it('throws an HTTP error when response.ok is false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as unknown as Response);

    await expect(fetchTextMaybeGzip('/data/missing.gzbin')).rejects.toThrow(/404/);
  });

  it('works with minimal Vitest Response mocks exposing text() or json()', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'hello text' } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ mocked: 1 }) } as unknown as Response);

    await expect(fetchTextMaybeGzip('/mock/text')).resolves.toBe('hello text');
    await expect(fetchJsonMaybeGzip('/mock/json')).resolves.toEqual({ mocked: 1 });
  });

  it('decodes both gzipped and raw Uint8Array payloads via decodeMaybeGzipBytes', async () => {
    const text = 'line1\nline2\n';
    const raw = new TextEncoder().encode(text);
    const gz = new Uint8Array(gzipSync(Buffer.from(text, 'utf8')));
    await expect(decodeMaybeGzipBytes(raw)).resolves.toBe(text);
    await expect(decodeMaybeGzipBytes(gz)).resolves.toBe(text);
  });
});
