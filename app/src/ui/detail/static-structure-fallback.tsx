import { toNormalizedTag, type Entry } from '@hub/contracts';

/**
 * Clean static node-type and structure summary shown immediately when
 * build-time preview SVGs are omitted, before the user loads the interactive canvas.
 */
export function StaticStructureFallback({ entry }: { entry: Entry }) {
  const { nodeCount, annotationNodeCount, connectionCount, nodeTypes, trigger } = entry.structure;
  const triggerLabel = toNormalizedTag('trigger', trigger || 'unknown', 0).label;
  const shownTypes = nodeTypes.slice(0, 12);
  const extraCount = Math.max(0, nodeTypes.length - shownTypes.length);

  return (
    <div
      role="status"
      className="flex min-h-48 flex-col justify-between gap-4 rounded-panel border border-hairline bg-panel px-5 py-5 font-mono text-xs text-ink-muted"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-3">
        <span className="font-semibold text-ink">Workflow structure summary</span>
        <span>
          {nodeCount} active nodes
          {annotationNodeCount > 0 ? ` · ${annotationNodeCount} sticky notes` : ''}
          {` · ${connectionCount} connections · ${triggerLabel}`}
        </span>
      </div>
      {shownTypes.length > 0 ? (
        <ul aria-label="Workflow node types" className="flex flex-wrap gap-1.5">
          {shownTypes.map((nodeType) => (
            <li key={nodeType} className="rounded-control border border-hairline bg-raised px-2 py-1 text-2xs text-ink">
              {nodeType}
            </li>
          ))}
          {extraCount > 0 && (
            <li className="rounded-control border border-hairline px-2 py-1 text-2xs text-ink-faint">
              +{extraCount} more node types
            </li>
          )}
        </ul>
      ) : (
        <p className="text-ink-muted">Static preview unavailable for this release.</p>
      )}
    </div>
  );
}
