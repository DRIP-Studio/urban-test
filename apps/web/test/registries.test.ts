// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The engine module starts its Web Worker on import; the registries only need it to exist.
class WorkerStub { onmessage = null; postMessage(): void {} addEventListener(): void {} removeEventListener(): void {} terminate(): void {} }
(globalThis as unknown as { Worker: unknown }).Worker = WorkerStub;
const { TOOLS } = await import('../src/tools/registry');
const { COMMANDS } = await import('../src/shell/commands');

describe('RB-08 · no dead controls', () => {
  it('every tool has a pointer handler, a unique id and a unique shortcut', () => {
    for (const t of TOOLS) {
      const h = t.handler;
      expect(Boolean(h.click || h.down || h.dblclick), t.id).toBe(true);
      expect(t.modes.length, t.id).toBeGreaterThan(0);
      expect(t.hint.trim(), t.id).not.toBe('');
    }
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    const keys = TOOLS.map((t) => t.shortcut).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('every command runs something', () => {
    for (const c of COMMANDS) expect(typeof c.run, c.id).toBe('function');
    expect(new Set(COMMANDS.map((c) => c.id)).size).toBe(COMMANDS.length);
  });
});

describe('RB-11 · materials catalogue', () => {
  const cat = JSON.parse(readFileSync(resolve(process.cwd(), '../../packages/assets/materials/catalog.json'), 'utf-8')) as { items: { id: string; label: string; color: string; category: string; permeable?: boolean }[] };
  it('ships the required materials with a colour and a known category', () => {
    expect(cat.items.length).toBeGreaterThanOrEqual(17);
    for (const m of cat.items) {
      expect(m.color, m.id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(m.label.trim(), m.id).not.toBe('');
    }
    for (const id of ['asphalt', 'grass']) expect(cat.items.map((m) => m.id)).toContain(id);
    expect(cat.items.some((m) => m.permeable)).toBe(true);
  });
});
