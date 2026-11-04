import { defineRules, UnsupportedTaxYearError, type RulePack, type YearRules } from '../types';

/**
 * United States — individual taxpayers, digital assets held as capital assets.
 *
 * Every rule is `draft` until reviewed by a US tax professional (ADR-0007).
 */
const rules = defineRules([
  {
    id: 'us.property',
    summary: 'Digital assets are property; gains and losses on disposal are capital.',
    source: 'IRS Notice 2014-21; IRC §1221',
    reviewStatus: 'draft',
  },
  {
    id: 'us.basis.per_wallet',
    summary:
      'Basis is tracked separately for each wallet or account. Required from 2025-01-01; the engine also applies it to earlier years, which is permissible under specific identification per wallet.',
    source: 'Treas. Reg. §1.1012-1(j); Rev. Proc. 2024-28',
    reviewStatus: 'draft',
  },
  {
    id: 'us.basis.methods',
    summary:
      'FIFO within each wallet unless units are specifically identified; LIFO and HIFO are applied as standing-order specific identification.',
    source: 'Treas. Reg. §1.1012-1(j)(3)',
    reviewStatus: 'draft',
  },
  {
    id: 'us.safe_harbor',
    summary:
      'One-time allocation of unused basis held on 2025-01-01 across wallets; irrevocable once made.',
    source: 'Rev. Proc. 2024-28',
    reviewStatus: 'draft',
  },
  {
    id: 'us.holding_period',
    summary:
      'Long-term if held more than one year; the holding period starts the day after acquisition.',
    source: 'IRC §1222; IRC §1223',
    reviewStatus: 'draft',
  },
  {
    id: 'us.swap',
    summary:
      'Exchanging one digital asset for another is a taxable disposition at fair-market value.',
    source: 'IRC §1001; IRS Notice 2014-21',
    reviewStatus: 'draft',
  },
  {
    id: 'us.trade_fee',
    summary:
      'Transaction costs are added to basis on acquisition and reduce the amount realized on disposition (including crypto-for-crypto exchanges).',
    source: 'Treas. Reg. §1.1012-1(h)',
    reviewStatus: 'draft',
  },
  {
    id: 'us.crypto_fee',
    summary:
      'Paying a network fee in crypto disposes of those units at fair-market value. Policy choice pending professional review; the fee itself is not deducted.',
    source: 'IRC §1001 (policy: needs review)',
    reviewStatus: 'draft',
  },
  {
    id: 'us.income.staking',
    summary:
      'Staking rewards are ordinary income at fair-market value when the taxpayer gains dominion and control.',
    source: 'Rev. Rul. 2023-14',
    reviewStatus: 'draft',
  },
  {
    id: 'us.income.airdrop',
    summary: 'Airdropped units are ordinary income at fair-market value when received.',
    source: 'Rev. Rul. 2019-24',
    reviewStatus: 'draft',
  },
  {
    id: 'us.income.hard_fork',
    summary:
      'New units received after a hard fork are ordinary income at fair-market value when received.',
    source: 'Rev. Rul. 2019-24',
    reviewStatus: 'draft',
  },
  {
    id: 'us.income.mining',
    summary: 'Mined units are ordinary income at fair-market value when received.',
    source: 'IRS Notice 2014-21',
    reviewStatus: 'draft',
  },
  {
    id: 'us.income.other',
    summary:
      'Interest and other crypto received as income is ordinary income at fair-market value.',
    source: 'IRC §61; IRS Notice 2014-21',
    reviewStatus: 'draft',
  },
  {
    id: 'us.rounding',
    summary: 'Report figures are rounded to cents; Form 8949 also allows whole dollars.',
    source: 'Instructions for Form 8949',
    reviewStatus: 'draft',
  },
]);

const FIRST_YEAR = 2009;
const LAST_YEAR = 2026;

function yearRules(taxYear: number): YearRules {
  if (taxYear < FIRST_YEAR || taxYear > LAST_YEAR) {
    throw new UnsupportedTaxYearError(
      'us',
      taxYear,
      `supported years are ${FIRST_YEAR}–${LAST_YEAR}`,
    );
  }
  return {
    taxYear,
    basisScope: 'per_account',
    basisScopeRule: 'us.basis.per_wallet',
    costBasis: { allowed: ['FIFO', 'LIFO', 'HIFO'], default: 'FIFO', rule: 'us.basis.methods' },
    holdingPeriod: { longTermAfterYears: 1, rule: 'us.holding_period' },
    income: {
      staking: { taxableAtReceipt: true, basis: 'fair_market_value', rule: 'us.income.staking' },
      mining: { taxableAtReceipt: true, basis: 'fair_market_value', rule: 'us.income.mining' },
      airdrop: { taxableAtReceipt: true, basis: 'fair_market_value', rule: 'us.income.airdrop' },
      hard_fork: {
        taxableAtReceipt: true,
        basis: 'fair_market_value',
        rule: 'us.income.hard_fork',
      },
      interest: { taxableAtReceipt: true, basis: 'fair_market_value', rule: 'us.income.other' },
      other: { taxableAtReceipt: true, basis: 'fair_market_value', rule: 'us.income.other' },
    },
    swap: { rule: 'us.swap' },
    cryptoFee: { isDisposal: true, isDeductibleExpense: false, rule: 'us.crypto_fee' },
    tradeFee: { rule: 'us.trade_fee' },
  };
}

export const us: RulePack = {
  id: 'us',
  name: 'United States (individual)',
  version: '0.1.0',
  status: 'draft',
  reportingCurrency: 'USD',
  defaultTimeZone: 'America/New_York',
  timeZoneFromUser: true,
  summaryModel: 'us_capital_gains',
  reportRounding: { decimalPlaces: 2, mode: 'HALF_UP', rule: 'us.rounding' },
  supportedYears: { from: FIRST_YEAR, to: LAST_YEAR },
  rules,
  yearRules,
};
