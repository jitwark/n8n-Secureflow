import Link from 'next/link';
import type { Route } from 'next';
import { isIndexable, toNormalizedTag, toSearchDisplayItem, type Entry } from '@hub/contracts';
import { detailHref } from '../catalogue/detail-href';
import { GradeBadge, toGrade } from './grade-badge';
import type { ResultCardItem } from './result-card';

export type HubGridProps = {
  entries: Entry[];
};

export function entryToCardItem(entry: Entry): ResultCardItem {
  return toSearchDisplayItem(entry, {
    isIndexable: isIndexable(entry),
    isPrerendered: entry.isPrerendered ?? false,
  });
}

export function HubGrid({ entries }: HubGridProps) {
  if (entries.length === 0) {
    return (
      <div className="p-8 rounded-panel bg-panel border border-hairline text-center text-ink-muted">
        No workflows found in this hub.
      </div>
    );
  }

  return (
    <div className="divide-y divide-hairline overflow-hidden rounded-panel border border-hairline bg-panel">
      {entries.map((entry) => {
        const item = entryToCardItem(entry);
        const trigger = toNormalizedTag('trigger', item.triggers[0] ?? 'unknown', 0).label;
        const integrations = item.integrations.slice(0, 3);
        return (
          <article key={item.id} className="flex flex-col justify-between gap-2 px-4 py-3 md:flex-row md:items-center md:gap-6">
            <div className="min-w-0 flex-1">
              <Link
                href={detailHref(item) as Route}
                prefetch={false}
                className="inline-flex min-h-11 items-center text-sm font-semibold text-ink hover:text-accent-text md:text-base"
              >
                <span className="break-words">{item.title}</span>
              </Link>
              <p className="line-clamp-2 max-w-3xl text-xs leading-5 text-ink-muted">
                {item.summary || 'No overview description available for this workflow.'}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 font-mono text-[11px] text-ink-muted md:flex-col md:items-end">
              <GradeBadge grade={toGrade(item.grade)} compact />
              <span>{item.nodeCount} nodes · {trigger}</span>
              {integrations.length > 0 && (
                <span className="text-ink-faint">
                  {integrations.map((slug) => toNormalizedTag('integration', slug, 0).label).join(' · ')}
                </span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
