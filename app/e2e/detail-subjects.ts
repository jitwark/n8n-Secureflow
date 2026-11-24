import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

/**
 * Choose workflow detail subjects from the packed v0.3 static export at test time.
 *
 * Wave 4B-1 replaced ~11,464 static `/w/<slug>/index.html` pages with the
 * client-resolved `/w/view/?id=<id|slug>` route backed by FNV-1a `.gzbin`
 * buckets under `app/out/data/details/` and `app/out/data/charts/`.
 *
 * Subjects are derived directly from those packed buckets (falling back to
 * `app/public/data/catalogue-*.json` only if packed artifacts are absent) by the
 * structural properties each spec actually needs (small, largest Tier C, most
 * annotated, longest title, mid-sized).
 */
export type DetailSubject = {
  id: string;
  slug: string;
  title: string;
  nodeCount: number;
  annotationNodeCount: number;
  isPrerendered: boolean;
  download: { pack: number; offset: number; length: number } | null;
};

// `__dirname`, not `import.meta.dirname`: Playwright loads specs as CommonJS.
const outDetailsDir = path.resolve(__dirname, '..', 'out', 'data', 'details');
const publicDataDir = path.resolve(__dirname, '..', 'public', 'data');

let cache: DetailSubject[] | null = null;

function toSubject(entry: {
  id: string;
  slug: string;
  title?: string;
  structure?: { nodeCount?: number; annotationNodeCount?: number };
  isPrerendered?: boolean;
  download?: { pack: number; offset: number; length: number } | null;
}): DetailSubject {
  return {
    id: entry.id,
    slug: entry.slug,
    title: entry.title ?? '',
    nodeCount: entry.structure?.nodeCount ?? 0,
    annotationNodeCount: entry.structure?.annotationNodeCount ?? 0,
    isPrerendered: entry.isPrerendered === true,
    download: entry.download
      ? { pack: entry.download.pack, offset: entry.download.offset, length: entry.download.length }
      : null,
  };
}

function loadPackedDetails(): DetailSubject[] {
  if (!fs.existsSync(outDetailsDir)) return [];
  const packs = fs.readdirSync(outDetailsDir).filter((name) => /^pack-\d+\.jsonl\.gzbin$/.test(name)).sort();
  if (packs.length === 0) return [];
  const entries: DetailSubject[] = [];
  for (const file of packs) {
    const text = gunzipSync(fs.readFileSync(path.join(outDetailsDir, file))).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      entries.push(toSubject(JSON.parse(line)));
    }
  }
  return entries;
}

function loadPublicCatalogue(): DetailSubject[] {
  const entries: DetailSubject[] = [];
  for (let shard = 0; ; shard += 1) {
    const shardPath = path.join(publicDataDir, `catalogue-${shard}.json`);
    if (!fs.existsSync(shardPath)) break;
    for (const entry of JSON.parse(fs.readFileSync(shardPath, 'utf8'))) entries.push(toSubject(entry));
  }
  return entries;
}

function loadCatalogue(): DetailSubject[] {
  if (cache) return cache;
  const packed = loadPackedDetails();
  const entries = packed.length > 0 ? packed : loadPublicCatalogue();
  if (entries.length === 0) {
    throw new Error(
      `No packed details in ${outDetailsDir} or catalogue shards in ${publicDataDir}. Run \`npm run build\` first.`,
    );
  }
  cache = entries;
  return entries;
}

export function viewHref(subject: Pick<DetailSubject, 'id' | 'slug'>): string {
  return `/w/view/?id=${encodeURIComponent(subject.id || subject.slug)}`;
}

export function leanSubjects(): DetailSubject[] {
  return loadCatalogue().filter((entry) => !entry.isPrerendered);
}

/**
 * A stable, corpus-derived spread of workflow shapes: small (>= 5 nodes),
 * largest, most annotation-heavy, longest title, and mid-sized.
 */
export function leanRepresentatives(): DetailSubject[] {
  const lean = leanSubjects();
  const byId = (left: DetailSubject, right: DetailSubject) => (left.id < right.id ? -1 : 1);
  const chosen = new Map<string, DetailSubject>();

  const take = (candidates: DetailSubject[]) => {
    const pick = candidates.find((entry) => !chosen.has(entry.id));
    if (pick) chosen.set(pick.id, pick);
  };

  const bySize = [...lean].sort((a, b) => a.nodeCount - b.nodeCount || byId(a, b));
  take(bySize.filter((entry) => entry.nodeCount >= 5));
  take([...bySize].reverse());
  take([...lean].sort((a, b) => b.annotationNodeCount - a.annotationNodeCount || byId(a, b)));
  take([...lean].sort((a, b) => b.title.length - a.title.length || byId(a, b)));
  take([bySize[Math.floor(bySize.length / 2)]!]);

  return [...chosen.values()];
}

/** The largest non-prerendered graph — the binding case for Tier C canvas cost. */
export function largestLeanSubject(): DetailSubject {
  return leanSubjects().reduce((worst, entry) => (entry.nodeCount > worst.nodeCount ? entry : worst));
}

/** The most annotation-heavy graph — sticky notes are not functional nodes. */
export function mostAnnotatedLeanSubject(): DetailSubject {
  return leanSubjects().reduce(
    (worst, entry) => (entry.annotationNodeCount > worst.annotationNodeCount ? entry : worst),
  );
}

/** The first non-prerendered entry, by id. */
export function firstLeanSubject(): DetailSubject {
  return [...leanSubjects()].sort((left, right) => (left.id < right.id ? -1 : 1))[0]!;
}

/** The first flagged top-ranked entry, by id (falling back to first entry). */
export function firstPrerenderedSubject(): DetailSubject {
  const entries = loadCatalogue();
  const top = entries.filter((entry) => entry.isPrerendered).sort((left, right) => (left.id < right.id ? -1 : 1));
  return top[0] ?? [...entries].sort((left, right) => (left.id < right.id ? -1 : 1))[0]!;
}
