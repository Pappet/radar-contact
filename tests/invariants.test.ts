/**
 * Guards for the architecture invariants in CLAUDE.md. These read the source
 * files rather than the behaviour, so a violation fails fast.
 */

import { describe, expect, it } from 'vitest';

const SIM_SOURCES = import.meta.glob('../src/sim/*.ts', {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Record<string, string>;

const sources = Object.entries(SIM_SOURCES);

describe('src/sim stays pure', () => {
  it('has files to check', () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  it('never touches browser APIs', () => {
    const forbidden = [
      /\bdocument\b/,
      /\bwindow\b/,
      /\bnavigator\b/,
      /\blocalStorage\b/,
      /\bHTMLCanvas/,
      /\bCanvasRenderingContext/,
      /\brequestAnimationFrame\b/,
      /\bperformance\.now\b/,
    ];
    for (const [file, source] of sources) {
      for (const pattern of forbidden) {
        expect(pattern.test(source), `${file} must not use ${pattern}`).toBe(false);
      }
    }
  });

  it('never imports from radar, ui or audio', () => {
    for (const [file, source] of sources) {
      expect(/from '\.\.\/(radar|ui|audio)\//.test(source), `${file} imports a host layer`).toBe(
        false,
      );
    }
  });

  it('uses only the seeded RNG', () => {
    for (const [file, source] of sources) {
      expect(/Math\.random/.test(source), `${file} must use the seeded RNG`).toBe(false);
    }
  });
});
