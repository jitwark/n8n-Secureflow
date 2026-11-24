export type DetailLinkInput = {
  id: string;
  slug: string;
  /** Retained for caller compatibility; all workflows now route via `/w/view/`. */
  isPrerendered?: boolean;
};

/**
 * Canonical workflow detail route. Every entry resolves via `/w/view/?id=<id>`
 * (falling back to slug when id is absent) from packed `.gzbin` buckets.
 */
export function detailHref(item: DetailLinkInput): string {
  const key = item.id || item.slug;
  return `/w/view/?id=${encodeURIComponent(key)}`;
}

/**
 * Client shell href carrying optional precomputed related workflow ids.
 */
export function interactiveHref(id: string, relatedIds: readonly string[] = []): string {
  const related = Array.from(new Set(relatedIds)).filter((candidate) => candidate && candidate !== id);
  const base = `/w/view/?id=${encodeURIComponent(id)}`;
  return related.length > 0 ? `${base}&related=${related.map((candidate) => encodeURIComponent(candidate)).join(',')}` : base;
}

/** `/w/view/` is statically emitted with its RSC payload for every workflow. */
export function isClientRoutable(_item: Pick<DetailLinkInput, 'isPrerendered'>): boolean {
  return true;
}
