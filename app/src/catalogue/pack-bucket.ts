export const PACK_BUCKET_COUNT = 64;

/** Deterministic FNV-1a 32-bit hash modulo 64 matching `scripts/pack-export-data.mjs`. */
export function bucketForId(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % PACK_BUCKET_COUNT;
}

export function bucketTag(bucket: number): string {
  return String(bucket).padStart(2, '0');
}
