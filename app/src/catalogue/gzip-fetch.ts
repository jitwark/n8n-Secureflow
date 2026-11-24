export type GzipFetchOptions = { expectedSha256?: string; signal?: AbortSignal };

function isGzipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle?.digest) {
    const view = bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : new Uint8Array(bytes);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', view);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const [{ sha256 }, { bytesToHex }] = await Promise.all([
    import('@noble/hashes/sha2.js'),
    import('@noble/hashes/utils.js'),
  ]);
  return bytesToHex(sha256(bytes));
}

export async function decodeMaybeGzipBytes(bytes: Uint8Array): Promise<string> {
  if (!isGzipMagic(bytes)) return new TextDecoder().decode(bytes);
  if (typeof DecompressionStream !== 'function') throw new Error('Gzip decompression unavailable.');
  const copy = new Uint8Array(bytes);
  const stream = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(copy); c.close(); },
  }).pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) { chunks.push(value); total += value.byteLength; }
  }
  const merged = new Uint8Array(total);
  for (let offset = 0, i = 0; i < chunks.length; i += 1) {
    merged.set(chunks[i]!, offset);
    offset += chunks[i]!.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function normalizeOpts(optionsOrSha?: string | GzipFetchOptions, signalArg?: AbortSignal): GzipFetchOptions {
  if (typeof optionsOrSha === 'string') return { expectedSha256: optionsOrSha, signal: signalArg };
  return { expectedSha256: optionsOrSha?.expectedSha256, signal: optionsOrSha?.signal ?? signalArg };
}

/** Fetches UTF-8 text or gzipped `.gzbin` payload, checking gzip magic bytes and optional SHA-256. */
export async function fetchTextMaybeGzip(
  url: string,
  optionsOrSha?: string | GzipFetchOptions,
  signalArg?: AbortSignal,
): Promise<string> {
  const { expectedSha256, signal } = normalizeOpts(optionsOrSha, signalArg);
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) throw Object.assign(new Error(`Failed to fetch ${url}: ${res.status}`), { status: res.status });
  if (typeof res.arrayBuffer === 'function') {
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (expectedSha256 && (await sha256HexBytes(bytes)) !== expectedSha256) {
      throw Object.assign(new Error(`Integrity check failed for ${url}`), { code: 'hash-mismatch' });
    }
    return decodeMaybeGzipBytes(bytes);
  }
  if (typeof res.text === 'function') return res.text();
  if (typeof res.json === 'function') return JSON.stringify(await res.json());
  throw new Error(`Unsupported response body for ${url}`);
}

export async function fetchJsonMaybeGzip<T = unknown>(
  url: string,
  optionsOrSha?: string | GzipFetchOptions,
  signalArg?: AbortSignal,
): Promise<T> {
  return JSON.parse(await fetchTextMaybeGzip(url, optionsOrSha, signalArg)) as T;
}
