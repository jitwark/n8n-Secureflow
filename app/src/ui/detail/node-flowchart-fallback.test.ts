import { describe, it, expect } from 'vitest';
import { generateNodeFlowchartSvg } from './node-flowchart-fallback';
import type { SvgPreviewListItem } from '@hub/contracts';

describe('generateNodeFlowchartSvg', () => {
  it('handles empty nodes gracefully', () => {
    const svg = generateNodeFlowchartSvg([]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('No nodes');
  });

  it('renders SVG with connected node elements and bezier paths', () => {
    const mockNodes: SvgPreviewListItem[] = [
      { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', category: 'trigger' },
      { id: '2', name: 'OpenAI GPT-4', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', category: 'ai' },
      { id: '3', name: 'Send Email', type: 'n8n-nodes-base.emailSend', category: 'http' },
    ];
    const svg = generateNodeFlowchartSvg(mockNodes);
    expect(svg).toContain('<svg');
    expect(svg).toContain('Webhook');
    expect(svg).toContain('OpenAI GPT-4');
    expect(svg).toContain('<path');
    expect(svg).toContain('<rect');
    expect(svg).toContain('role="img"');
  });

  it('excludes sticky notes from active node count in the SVG title', () => {
    const mockNodes: SvgPreviewListItem[] = [
      { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', category: 'trigger' },
      { id: '2', name: 'Note', type: 'n8n-nodes-base.stickyNote', category: 'other' },
    ];
    const svg = generateNodeFlowchartSvg(mockNodes);
    expect(svg).toContain('1 active node');
    expect(svg).toContain('1 sticky note');
    expect(svg).not.toContain('n8n-nodes-base.stickyNote');
  });
});
