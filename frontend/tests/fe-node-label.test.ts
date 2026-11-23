import { describe, it, expect } from 'vitest';
import { nodeLabel } from '@/lib/nodeLabel';

describe('nodeLabel', () => {
  it('turns stored node ids into "Node N"', () => {
    expect(nodeLabel('node_1')).toBe('Node 1');
    expect(nodeLabel('node-12')).toBe('Node 12');
    expect(nodeLabel('NODE_3')).toBe('Node 3');
    expect(nodeLabel('n7')).toBe('Node 7');
  });
  it('leaves other values alone', () => {
    expect(nodeLabel('welcome_email')).toBe('welcome_email');
    expect(nodeLabel('')).toBe('');
    expect(nodeLabel(null)).toBe('');
    expect(nodeLabel(undefined)).toBe('');
  });
});
