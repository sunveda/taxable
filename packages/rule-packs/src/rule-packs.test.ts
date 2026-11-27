import { describe, expect, it } from 'vitest';
import { rulePacks, UnsupportedTaxYearError } from './index';

describe.each(Object.values(rulePacks))('rule pack $id', (pack) => {
  const years: number[] = [];
  for (let y = pack.supportedYears.from; y <= pack.supportedYears.to; y++) years.push(y);

  it('cites every rule it references, in every supported year', () => {
    const referenced = new Set<string>([pack.reportRounding.rule]);
    for (const year of years) {
      const r = pack.yearRules(year);
      referenced.add(r.costBasis.rule);
      referenced.add(r.basisScopeRule);
      if (r.holdingPeriod) referenced.add(r.holdingPeriod.rule);
      for (const t of Object.values(r.income)) referenced.add(t.rule);
      referenced.add(r.swap.rule);
      referenced.add(r.cryptoFee.rule);
      referenced.add(r.tradeFee.rule);
    }
    const missing = [...referenced].filter((id) => !pack.rules[id]);
    expect(missing).toEqual([]);
  });

  it('allows its own default method', () => {
    for (const year of years) {
      const r = pack.yearRules(year);
      expect(r.costBasis.allowed).toContain(r.costBasis.default);
    }
  });

  it('rejects years outside its range', () => {
    expect(() => pack.yearRules(pack.supportedYears.to + 1)).toThrow(UnsupportedTaxYearError);
    expect(() => pack.yearRules(pack.supportedYears.from - 1)).toThrow(UnsupportedTaxYearError);
  });

  it('is still marked draft until professionally reviewed', () => {
    const unreviewed = Object.values(pack.rules).filter((r) => r.reviewStatus !== 'reviewed');
    if (unreviewed.length > 0) expect(pack.status).toBe('draft');
  });
});

describe('jp', () => {
  it('does not compute separate-taxation years yet', () => {
    expect(() => rulePacks.jp.yearRules(2028)).toThrow(/separate taxation/);
  });
});
