import { toNormalizedTag, type Entry } from '@hub/contracts';

type MetricStripProps = { entry: Entry };
type Metric = { label: string; value: string | number };

export function MetricStrip({ entry }: MetricStripProps) {
  const stickyNotes = entry.structure.annotationNodeCount > 0
    ? entry.structure.annotationNodeCount
    : Math.max(0, entry.structure.rawNodeCount - entry.structure.nodeCount);
  const triggerLabel = toNormalizedTag('trigger', entry.structure.trigger || 'unknown', 0).label;
  const metrics: Metric[] = [
    { label: 'Active nodes', value: entry.structure.nodeCount },
    ...(stickyNotes > 0 ? [{ label: 'Sticky notes', value: stickyNotes }] : []),
    { label: 'Connections', value: entry.structure.connectionCount },
    { label: 'Trigger', value: triggerLabel },
    { label: 'Complexity', value: entry.structure.complexity },
  ];
  const columns = metrics.length === 5 ? 'sm:grid-cols-3 lg:grid-cols-5' : 'sm:grid-cols-4';
  return (
    <dl aria-label="Workflow metrics" className={`grid min-w-0 grid-cols-2 overflow-hidden rounded-panel border border-hairline bg-panel ${columns}`}>
      {metrics.map((metric) => (
        <div key={metric.label} className="flex min-h-20 min-w-0 flex-col justify-center gap-1 border-b border-r border-hairline bg-panel px-4 py-3 last:border-r-0">
          <dt className="text-2xs font-mono uppercase tracking-wider font-bold text-ink-muted">{metric.label}</dt>
          <dd className="truncate font-sans text-xl font-bold tabular-nums text-accent-text">{metric.value}</dd>
        </div>
      ))}
    </dl>
  );
}
