'use client';

import { toNormalizedTag, type FacetCounts, type NormalizedTag } from '@hub/contracts';
import { compareCanonicalStrings } from '@hub/contracts/stable-order';
import type { SearchFilters } from '../search/search-client';

type QuickFilterRowProps = {
  counts: FacetCounts;
  filters: SearchFilters;
  sort: string;
  onFilterChange: (filters: SearchFilters) => void;
  onSortChange: (sort: string) => void;
  onMoreFilters: () => void;
};

const SORT_OPTIONS = [
  ['relevance', 'Relevance'],
  ['quality', 'Quality'],
] as const;

export function visibleQuickFilters(
  counts: Pick<FacetCounts, 'integrations' | 'tags'>,
  limit = 6,
): NormalizedTag[] {
  const candidates = [
    ...Object.entries(counts.integrations).map(([slug, count]) => toNormalizedTag('integration', slug, count)),
    ...Object.entries(counts.tags).map(([slug, count]) => toNormalizedTag('intent', slug, count)),
  ]
    .filter((tag) => tag.count > 0)
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      if (left.group !== right.group) return left.group === 'integration' ? -1 : 1;
      return compareCanonicalStrings(left.label, right.label);
    });

  const seenLabels = new Set<string>();
  const seenSlugs = new Set<string>();
  const deduplicated: NormalizedTag[] = [];
  for (const tag of candidates) {
    const labelKey = tag.label.trim().toLowerCase();
    const slugKey = tag.slug.trim().toLowerCase();
    if (seenLabels.has(labelKey) || seenSlugs.has(slugKey)) continue;
    seenLabels.add(labelKey);
    seenSlugs.add(slugKey);
    deduplicated.push(tag);
    if (deduplicated.length >= limit) break;
  }
  return deduplicated;
}

export function QuickFilterRow({ counts, filters, sort, onFilterChange, onSortChange, onMoreFilters }: QuickFilterRowProps) {
  const toggle = (tag: NormalizedTag) => {
    const key = tag.group === 'integration' ? 'integration' : 'tag';
    const selected = filters[key] ?? [];
    onFilterChange({ ...filters, [key]: selected.includes(tag.slug) ? selected.filter((value) => value !== tag.slug) : [...selected, tag.slug] });
  };
  return (
    <div aria-label="Quick filters" className="flex flex-nowrap gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
      {visibleQuickFilters(counts).map((tag) => {
        const key = tag.group === 'integration' ? 'integration' : 'tag';
        const selected = filters[key]?.includes(tag.slug) ?? false;
        return <button key={`${tag.group}:${tag.slug}`} type="button" aria-label={`Quick filter ${tag.label} ${tag.count}`} aria-pressed={selected} onClick={() => toggle(tag)} className={`min-h-11 shrink-0 rounded-control border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-border active:bg-raised ${selected ? 'border-accent-border bg-accent-dim text-accent-text font-semibold' : 'border-hairline bg-panel text-ink-muted hover:bg-raised hover:text-ink'}`}>{tag.label} <span className="font-mono text-xs">{tag.count}</span></button>;
      })}
      <button type="button" onClick={onMoreFilters} className="min-h-11 shrink-0 rounded-control border border-hairline px-3 text-sm text-accent-text transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-border active:bg-raised">More filters</button>
      <label className="flex min-h-11 shrink-0 items-center gap-2 rounded-control border border-hairline bg-panel px-3 text-sm text-ink-muted">
        <span className="shrink-0 whitespace-nowrap font-mono text-xs">Sort</span>
        <select aria-label="Sort results" value={sort} onChange={(event) => onSortChange(event.target.value)} className="min-h-9 min-w-[7.25rem] shrink-0 bg-panel text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-border">
          {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value} className="bg-panel text-ink">{label}</option>)}
        </select>
      </label>
    </div>
  );
}
