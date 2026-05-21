// Pure helper tests — no DOM required. Covers the awareness-level →
// recommendation mappings + the word counter that drives copy length
// estimates throughout the app.

import { describe, it, expect } from 'vitest';
import {
  getRecomendedEstilo,
  getRecomendacaoTempo,
  countWords,
  recomendacoesTempo,
} from '../src/lib/helpers';
import { cn, formatVideoDuration, getVideoAspectRatioClass } from '../src/lib/utils';

describe('getRecomendedEstilo', () => {
  it('returns styles for awareness levels 1-5', () => {
    expect(getRecomendedEstilo('1')).toContain('Storytelling');
    expect(getRecomendedEstilo('2')).toContain('Problema → Solução');
    expect(getRecomendedEstilo('3')).toContain('Antes e Depois');
    expect(getRecomendedEstilo('4')).toContain('Direto ao Ponto');
    expect(getRecomendedEstilo('5')).toContain('Urgência / Escassez');
  });

  it('accepts compound strings (uses first char only)', () => {
    expect(getRecomendedEstilo('3-aware')).toEqual(getRecomendedEstilo('3'));
  });

  it('returns empty array for unknown levels', () => {
    expect(getRecomendedEstilo('99')).toEqual([]);
    expect(getRecomendedEstilo('')).toEqual([]);
  });
});

describe('getRecomendacaoTempo', () => {
  it('returns the full recommendation object for each level', () => {
    const r = getRecomendacaoTempo('3');
    expect(r).toEqual(recomendacoesTempo['3']);
    expect(r?.palavrasMin).toBeGreaterThan(0);
    expect(r?.palavrasMax).toBeGreaterThan(r!.palavrasMin);
  });

  it('returns null for unknown levels', () => {
    expect(getRecomendacaoTempo('99')).toBeUndefined();
    expect(getRecomendacaoTempo('')).toBeNull();
  });

  it('word ranges decrease as awareness goes up (more aware = shorter copy)', () => {
    const l1 = recomendacoesTempo['1']!;
    const l5 = recomendacoesTempo['5']!;
    expect(l1.palavrasMin).toBeGreaterThan(l5.palavrasMin);
    expect(l1.palavrasMax).toBeGreaterThan(l5.palavrasMax);
  });
});

describe('countWords', () => {
  it('counts simple words', () => {
    expect(countWords('hello world')).toBe(2);
    expect(countWords('one two three four')).toBe(4);
  });

  it('strips [section markers] before counting', () => {
    expect(countWords('[HOOK] real hook text here')).toBe(4);
    // Punctuation that lingers after the marker is its own "token" by
    // whitespace split — that's fine, the count is rough anyway.
    expect(countWords('[AVATAR] my line')).toBe(2);
  });

  it('strips (parenthetical asides) too', () => {
    expect(countWords('the (quick) brown fox')).toBe(3);
  });

  it('handles empty / whitespace-only', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });

  it('collapses runs of whitespace', () => {
    expect(countWords('one   two\nthree\t\tfour')).toBe(4);
  });
});

describe('cn (className combiner)', () => {
  it('merges plain class strings', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1');
  });

  it('resolves tailwind conflicts (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('handles conditional classnames', () => {
    expect(cn('base', false && 'hidden', true && 'visible')).toBe('base visible');
  });
});

describe('formatVideoDuration', () => {
  it('formats seconds into m:ss', () => {
    expect(formatVideoDuration(0)).toBe('0:00');
    expect(formatVideoDuration(5)).toBe('0:05');
    expect(formatVideoDuration(59)).toBe('0:59');
    expect(formatVideoDuration(60)).toBe('1:00');
    expect(formatVideoDuration(73)).toBe('1:13');
    expect(formatVideoDuration(3600)).toBe('60:00');
  });

  it('returns placeholder for invalid input', () => {
    expect(formatVideoDuration(NaN)).toBe('--:--');
    expect(formatVideoDuration(-1)).toBe('--:--');
    expect(formatVideoDuration(Infinity)).toBe('--:--');
  });

  it('floors fractional seconds', () => {
    expect(formatVideoDuration(45.9)).toBe('0:45');
  });
});

describe('getVideoAspectRatioClass', () => {
  it('maps known ratios to Tailwind classes', () => {
    expect(getVideoAspectRatioClass({ aspectRatio: '9:16' })).toBe('aspect-[9/16]');
    expect(getVideoAspectRatioClass({ aspectRatio: '1:1' })).toBe('aspect-square');
    expect(getVideoAspectRatioClass({ aspectRatio: '16:9' })).toBe('aspect-video');
    expect(getVideoAspectRatioClass({ aspectRatio: '4:5' })).toBe('aspect-[4/5]');
  });

  it('defaults to 9:16 when video is missing or ratio undefined', () => {
    expect(getVideoAspectRatioClass(null)).toBe('aspect-[9/16]');
    expect(getVideoAspectRatioClass({})).toBe('aspect-[9/16]');
    expect(getVideoAspectRatioClass(undefined)).toBe('aspect-[9/16]');
  });
});
