import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { makeEntry } from '../../test-support/make-entry';
import { MetricStrip } from './metric-strip';

afterEach(() => cleanup());

describe('MetricStrip', () => {
  it('normalizes trigger labels via toNormalizedTag and distinguishes active nodes from sticky notes', () => {
    const entry = makeEntry({
      structure: {
        nodeCount: 12,
        rawNodeCount: 18,
        annotationNodeCount: 6,
        connectionCount: 11,
        trigger: 'execute_workflow',
        complexity: 'medium',
      },
    });
    render(<MetricStrip entry={entry} />);

    expect(screen.getByText('Active nodes')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('Sticky notes')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText('Execute Workflow')).toBeTruthy();
  });

  it('omits sticky notes row when annotationNodeCount is zero and normalizes empty trigger to Uncategorized', () => {
    const entry = makeEntry({
      structure: {
        nodeCount: 4,
        rawNodeCount: 4,
        annotationNodeCount: 0,
        connectionCount: 3,
        trigger: '',
        complexity: 'simple',
      },
    });
    render(<MetricStrip entry={entry} />);

    expect(screen.queryByText('Sticky notes')).toBeNull();
    expect(screen.getByText('Uncategorized')).toBeTruthy();
  });
});
