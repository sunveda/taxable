import { formatLocalDate, localDate, roundTo, sum, ZERO, type Decimal } from '@svdt/domain';
import type { RulePack } from '@svdt/rule-packs';
import type {
  Bucket,
  Disposal,
  ExpenseRecord,
  Form8949Line,
  Form8949Totals,
  IncomeRecord,
  JpSummary,
  UsSummary,
} from './types';

interface Records {
  disposals: readonly Disposal[];
  income: readonly IncomeRecord[];
  expenses: readonly ExpenseRecord[];
}

function bucket(disposals: readonly Disposal[]): Bucket {
  return {
    proceeds: sum(disposals.map((d) => d.proceeds)),
    sellingCosts: sum(disposals.map((d) => d.sellingCosts)),
    costBasis: sum(disposals.map((d) => d.costBasis)),
    gain: sum(disposals.map((d) => d.gain)),
  };
}

export function summarize(
  pack: RulePack,
  records: Records,
  timeZone: string,
): UsSummary | JpSummary {
  switch (pack.summaryModel) {
    case 'us_capital_gains':
      return summarizeUs(pack, records, timeZone);
    case 'jp_miscellaneous_income':
      return summarizeJp(pack, records);
  }
}

function summarizeUs(pack: RulePack, { disposals, income }: Records, timeZone: string): UsSummary {
  const { decimalPlaces, mode } = pack.reportRounding;
  const round = (v: Decimal): Decimal => roundTo(v, decimalPlaces, mode);
  const date = (ts: string): string => formatLocalDate(localDate(ts, timeZone));
  const form8949: Form8949Line[] = disposals.map((d) => {
    // Proceeds are reported net of selling costs; gain is derived from rounded figures so
    // each line adds up on the form.
    const proceeds = round(d.proceeds.minus(d.sellingCosts));
    const costBasis = round(d.costBasis);
    return {
      part: d.term === 'long' ? 'II' : 'I',
      description: `${d.quantity.toString()} ${d.asset}`,
      dateAcquired: d.acquiredAt ? date(d.acquiredAt) : 'VARIOUS',
      dateSold: date(d.disposedAt),
      proceeds,
      costBasis,
      gain: proceeds.minus(costBasis),
      disposalId: d.id,
    };
  });
  const totals = (part: 'I' | 'II'): Form8949Totals => {
    const lines = form8949.filter((l) => l.part === part);
    return {
      proceeds: sum(lines.map((l) => l.proceeds)),
      costBasis: sum(lines.map((l) => l.costBasis)),
      gain: sum(lines.map((l) => l.gain)),
    };
  };
  const ordinaryIncome = sum(income.filter((i) => i.taxable).map((i) => i.value));
  return {
    model: 'us_capital_gains',
    shortTerm: bucket(disposals.filter((d) => d.term !== 'long')),
    longTerm: bucket(disposals.filter((d) => d.term === 'long')),
    ordinaryIncome,
    form8949,
    form8949Totals: { partI: totals('I'), partII: totals('II') },
    reportedOrdinaryIncome: round(ordinaryIncome),
  };
}

function summarizeJp(pack: RulePack, { disposals, income, expenses }: Records): JpSummary {
  const { decimalPlaces, mode } = pack.reportRounding;
  const round = (v: Decimal): Decimal => roundTo(v, decimalPlaces, mode);
  const byType: JpSummary['income'] = {};
  for (const i of income) {
    if (!i.taxable) continue;
    byType[i.incomeType] = (byType[i.incomeType] ?? ZERO).plus(i.value);
  }
  const d = bucket(disposals);
  const incomeTotal = sum(Object.values(byType));
  const expenseTotal = sum(expenses.map((e) => e.value));
  const misc = d.gain.plus(incomeTotal).minus(expenseTotal);
  const revenue = round(d.proceeds.plus(incomeTotal));
  const necessaryExpenses = round(d.costBasis.plus(d.sellingCosts).plus(expenseTotal));
  const reportedMisc = revenue.minus(necessaryExpenses);
  return {
    model: 'jp_miscellaneous_income',
    disposals: d,
    income: byType,
    incomeTotal,
    expenses: expenseTotal,
    miscellaneousIncome: misc,
    taxableMiscellaneousIncome: misc.isNegative() ? ZERO : misc,
    reported: {
      revenue,
      necessaryExpenses,
      miscellaneousIncome: reportedMisc,
      taxableMiscellaneousIncome: reportedMisc.isNegative() ? ZERO : reportedMisc,
    },
  };
}
