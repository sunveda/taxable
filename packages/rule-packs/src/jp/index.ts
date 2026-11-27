import { defineRules, UnsupportedTaxYearError, type RulePack, type YearRules } from '../types';

/**
 * Japan — individual residents, crypto assets (暗号資産) under comprehensive taxation
 * (総合課税) as miscellaneous income (雑所得).
 *
 * From 2028 (expected), gains on "specified crypto assets" handled by registered firms
 * move to separate taxation at 20.315% with a 3-year loss carryforward. The start date
 * depends on when the amended Financial Instruments and Exchange Act takes effect, set by
 * cabinet order. That regime needs a new pack version; until then 2028+ is unsupported.
 *
 * Every rule is `draft` until reviewed by a Japanese tax professional (税理士) (ADR-0007).
 */
const rules = defineRules([
  {
    id: 'jp.income_category',
    summary:
      'Gains from crypto assets and crypto received as income are miscellaneous income (雑所得), taxed at progressive rates together with other income.',
    source: '所得税法第35条; 国税庁「暗号資産に関する税務上の取扱いについて（FAQ）」',
    reviewStatus: 'draft',
  },
  {
    id: 'jp.basis.scope',
    summary:
      'Acquisition cost is computed per type of crypto asset across all of the taxpayer’s holdings, not per exchange or wallet.',
    source: '所得税法第48条の2; 国税庁 暗号資産FAQ',
    reviewStatus: 'draft',
  },
  {
    id: 'jp.basis.methods',
    summary:
      'Total average (総平均法) or moving average (移動平均法), elected per type of crypto asset. Without an election, total average applies. A chosen method generally can’t be changed for 3 years.',
    source: '所得税法第48条の2; 所得税法施行令第119条の2〜第119条の5',
    reviewStatus: 'draft',
  },
  {
    id: 'jp.swap',
    summary:
      'Exchanging one crypto asset for another is a disposal (譲渡) at the market value received.',
    source: '国税庁 暗号資産FAQ',
    reviewStatus: 'draft',
  },
  {
    id: 'jp.trade_fee',
    summary:
      'Purchase fees are included in acquisition cost; fees on disposal are necessary expenses (必要経費).',
    source: '所得税法第37条; 国税庁 暗号資産FAQ',
    reviewStatus: 'draft',
  },
  {
    id: 'jp.crypto_fee',
    summary:
      'Paying a fee (e.g. a transfer fee) in crypto disposes of those units at market value, and the fee is a necessary expense. Policy choice pending professional review.',
    source: '所得税法第37条; 国税庁 暗号資産FAQ (policy: needs review)',
    reviewStatus: 'draft',
  },
  {
    id: 'jp.income.staking',
    summary:
      'Staking rewards are miscellaneous income at market value when received; that value is their acquisition cost.',
    source: '国税庁 暗号資産FAQ',
    reviewStatus: 'draft',
  },
  {
    id: 'jp.income.mining',
    summary:
      'Mined crypto is income at market value when received (miscellaneous or business income).',
    source: '国税庁 暗号資産FAQ',
    reviewStatus: 'draft',
  },
  {
    id: 'jp.income.hard_fork',
    summary:
      'Crypto received through a hard fork is not income when received; its acquisition cost is zero.',
    source: '国税庁 暗号資産FAQ',
    reviewStatus: 'draft',
  },
  {
    id: 'jp.income.airdrop',
    summary:
      'Airdropped crypto is treated as income at market value when received. Official guidance is limited; policy choice pending professional review.',
    source: '国税庁 暗号資産FAQ (policy: needs review)',
    reviewStatus: 'draft',
  },
  {
    id: 'jp.income.other',
    summary:
      'Interest from lending and other crypto received as income is miscellaneous income at market value.',
    source: '国税庁 暗号資産FAQ',
    reviewStatus: 'draft',
  },
  {
    id: 'jp.loss',
    summary:
      'A net loss within miscellaneous income can’t offset other categories of income and can’t be carried forward.',
    source: '所得税法第69条',
    reviewStatus: 'draft',
  },
  {
    id: 'jp.tax_year',
    summary: 'The tax year is the calendar year in Japan Standard Time.',
    source: '所得税法第2条',
    reviewStatus: 'draft',
  },
  {
    id: 'jp.rounding',
    summary:
      'Report figures are in whole yen, truncating fractions of a yen. (Rounding of the taxable base to ¥1,000 happens on the return, not here.)',
    source: 'Policy: needs review',
    reviewStatus: 'draft',
  },
]);

const FIRST_YEAR = 2014;
/** Last year before separate taxation is expected to begin (see file comment). */
const LAST_YEAR = 2027;

function yearRules(taxYear: number): YearRules {
  if (taxYear > LAST_YEAR) {
    throw new UnsupportedTaxYearError(
      'jp',
      taxYear,
      'separate taxation (申告分離課税) for specified crypto assets is not implemented yet',
    );
  }
  if (taxYear < FIRST_YEAR) {
    throw new UnsupportedTaxYearError('jp', taxYear, `supported years start at ${FIRST_YEAR}`);
  }
  return {
    taxYear,
    basisScope: 'per_user',
    basisScopeRule: 'jp.basis.scope',
    costBasis: {
      allowed: ['TOTAL_AVERAGE', 'MOVING_AVERAGE'],
      default: 'TOTAL_AVERAGE',
      rule: 'jp.basis.methods',
    },
    holdingPeriod: null,
    income: {
      staking: { taxableAtReceipt: true, basis: 'fair_market_value', rule: 'jp.income.staking' },
      mining: { taxableAtReceipt: true, basis: 'fair_market_value', rule: 'jp.income.mining' },
      airdrop: { taxableAtReceipt: true, basis: 'fair_market_value', rule: 'jp.income.airdrop' },
      hard_fork: { taxableAtReceipt: false, basis: 'zero', rule: 'jp.income.hard_fork' },
      interest: { taxableAtReceipt: true, basis: 'fair_market_value', rule: 'jp.income.other' },
      other: { taxableAtReceipt: true, basis: 'fair_market_value', rule: 'jp.income.other' },
    },
    swap: { rule: 'jp.swap' },
    cryptoFee: { isDisposal: true, isDeductibleExpense: true, rule: 'jp.crypto_fee' },
    tradeFee: { rule: 'jp.trade_fee' },
  };
}

export const jp: RulePack = {
  id: 'jp',
  name: 'Japan (individual resident)',
  version: '0.1.0',
  status: 'draft',
  reportingCurrency: 'JPY',
  defaultTimeZone: 'Asia/Tokyo',
  timeZoneFromUser: false,
  summaryModel: 'jp_miscellaneous_income',
  reportRounding: { decimalPlaces: 0, mode: 'DOWN', rule: 'jp.rounding' },
  supportedYears: { from: FIRST_YEAR, to: LAST_YEAR },
  rules,
  yearRules,
};
