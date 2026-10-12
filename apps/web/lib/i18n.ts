import type { Issue, Jurisdiction, Method, OverrideAction } from './api-types';

/** UI text in Japanese (default; first launch market) and English. */
export type Lang = 'ja' | 'en';

const ja = {
  brand: 'svdt',
  tagline: '一つひとつの数字を確かめられる、暗号資産の税金計算。',
  nav: {
    overview: '概要',
    import: '取り込み',
    transactions: '取引',
    fixes: '要確認',
    report: 'レポート',
    settings: '設定',
  },
  demoBanner:
    'デモモード：サンプルデータで動作しています。取り込んだデータはサーバー再起動で消えます。',
  disclaimer:
    '税制ルールは税理士による確認前の下書きです。本サービスの結果は税務上の助言ではありません。',
  jurisdiction: { jp: '日本', us: '米国' } satisfies Record<Jurisdiction, string>,
  method: {
    TOTAL_AVERAGE: '総平均法',
    MOVING_AVERAGE: '移動平均法',
    FIFO: '先入先出法 (FIFO)',
    HIFO: '高値先出法 (HIFO)',
    LIFO: '後入先出法 (LIFO)',
  } satisfies Record<Method, string>,
  yearLabel: (y: number) => `${y}年分`,
  overview: {
    title: (y: number) => `${y}年分の税額の見通し`,
    jpHeadline: '雑所得（暗号資産）',
    usShort: '短期譲渡益',
    usLong: '長期譲渡益',
    usIncome: '所得（ステーキング等）',
    revenue: '収入金額',
    expenses: '必要経費',
    disposals: '譲渡による所得',
    income: '受取による所得',
    feeExpenses: '経費（手数料）',
    lossNote: '損失は他の所得と相殺できないため、課税対象額は0円になります。',
    uncertainty: '未解決の要確認項目による変動幅',
    upTo: (v: string) => `最大 ${v}`,
    unknownCount: (n: number) => `影響額不明 ${n}件`,
    allClear: '要確認の項目はありません。',
    topFixes: '影響の大きい要確認項目',
    seeAll: 'すべて見る',
    data: 'データ',
    accounts: (n: number) => `口座 ${n}`,
    events: (n: number) => `取引 ${n}件`,
    importMore: '取引履歴を取り込む',
    noData: 'まだ取引がありません。取引所の履歴CSVを取り込んでください。',
  },
  importPage: {
    title: '取引履歴の取り込み',
    intro:
      '取引所からダウンロードしたCSVファイルを選んでください。形式は自動で判別します。同じファイルを再度取り込んでも重複しません。',
    file: 'CSVファイル',
    account: '口座名',
    accountHint: '例: bitflyer, coincheck, wallet',
    format: '形式',
    auto: '自動判別',
    unverified: '未検証',
    submit: '取り込む',
    submitting: '取り込み中…',
    result: '取り込み結果',
    rows: (n: number) => `${n}行`,
    imported: (n: number) => `取り込み ${n}件`,
    skipped: (n: number) => `スキップ ${n}件`,
    conflicts: (n: number) => `別の口座と重複したため未登録 ${n}件`,
    warnings: '注意が必要な行',
    line: (n: number | null) => (n === null ? 'ファイル全体' : `${n}行目`),
    history: '取り込み履歴',
    noHistory: 'まだ取り込みはありません。',
    unverifiedNote:
      'この形式は実際のエクスポートでの検証前です。結果を取引所の記録と照らし合わせてください。',
    errors: {
      noFile: 'ファイルを選んでください。',
      badAccount: '口座名は英数字・ドット・ハイフン・下線（64文字以内）で入力してください。',
      tooLarge: 'ファイルが大きすぎます（20MBまで）。',
      unknownFormat:
        '対応していない形式です。svdt標準CSV形式に変換してから取り込んでください（docs/spec/canonical-csv.md）。',
      generic: '取り込みに失敗しました。',
    },
  },
  tx: {
    title: '取引一覧',
    date: '日時',
    account: '口座',
    type: '種類',
    detail: '内容',
    source: '取込元',
    more: 'さらに表示',
    empty: '取引がありません。',
    kinds: {
      buy: '購入',
      sell: '売却',
      swap: '交換',
      transfer: '口座間の移動',
      income: '受取',
      fee: '手数料',
      external_deposit: '外部からの入庫',
      external_withdrawal: '外部への出庫',
    },
    fee: '手数料',
  },
  fixes: {
    title: '要確認の項目',
    intro:
      '税額への影響が大きい順に並んでいます。上から解決すると、数字の確からしさが早く上がります。',
    impact: '影響額',
    unknown: '影響額不明',
    review: '確認のみ',
    suggested: 'おすすめの解決方法',
    confidence: (c: number) => `確からしさ ${Math.round(c * 100)}%`,
    apply: 'この内容で解決',
    orManual: 'または自分で入力',
    unitPrice: '単価（1単位あたり）',
    costBasis: '取得価額（合計）',
    acquiredAt: '取得日（任意）',
    proceeds: '売却・支払額（任意）',
    save: '保存',
    ownWallet: '自分のウォレットへの移動',
    spent: '売却・支払いに使った',
    importHistory: '不足している取引履歴を取り込む',
    event: '対象の取引',
    resolved: '解決済みの修正',
    status: {
      applied: '適用中',
      superseded: '新しい修正で置き換え',
      revoked: '取り消し済み',
      event_not_found: '対象の取引が見つかりません',
      not_applicable: '適用できません',
    } as Record<string, string>,
    noOverrides: 'まだ修正はありません。',
    empty: '要確認の項目はありません。',
    undo: '取り消す',
    action(a: OverrideAction, currency: string): string {
      switch (a.type) {
        case 'set_unit_price':
          return `${a.asset} の単価を ${a.unitPrice} ${currency} に設定`;
        case 'set_cost_basis':
          return `取得価額を ${a.costBasis} ${currency} に設定${a.acquiredAt ? `（取得日 ${a.acquiredAt.slice(0, 10)}）` : ''}`;
        case 'classify_withdrawal':
          return a.as === 'own_wallet'
            ? '自分のウォレットへの移動として確定'
            : `売却・支払いとして確定${a.proceeds ? `（${a.proceeds} ${currency}）` : ''}`;
        case 'revoke':
          return '以前の修正を取り消し';
      }
    },
  },
  report: {
    title: (y: number) => `${y}年分 レポート`,
    returnFigures: '確定申告に記入する金額（円未満切り捨て）',
    disposals: '譲渡（売却・交換・手数料支払い）',
    income: '受取（ステーキング・エアドロップ等）',
    holdings: '年末の保有',
    asset: '資産',
    account: '口座',
    disposedAt: '譲渡日',
    proceeds: '譲渡価額',
    costBasis: '取得費',
    gain: '損益',
    term: '期間',
    short: '短期',
    long: '長期',
    why: '計算の根拠',
    receivedAt: '受取日',
    value: '時価',
    taxable: '課税',
    quantity: '数量',
    averageCost: (m: string) => `${m}による平均取得単価`,
    lotFrom: (origin: string, date: string) => `${date}の${origin}で取得したロット`,
    shortfall: '履歴にない数量のため取得費0円として計算',
    rules: '適用したルール',
    origins: {
      purchase: '購入',
      swap: '交換',
      income: '受取',
      external_deposit: '外部からの入庫',
      opening_position: '期首残高',
      transfer: '移動',
      shortfall: '履歴不足',
    } as Record<string, string>,
    meta: (pack: string, engine: string, tz: string) =>
      `ルール ${pack} ・ 計算エンジン ${engine} ・ ${tz}`,
    none: 'ありません。',
    draft: '下書き',
  },
  settings: {
    title: '設定',
    jurisdiction: '申告する国',
    taxYear: '対象年分',
    method: '取得価額の計算方法',
    methodNote:
      '日本では、届出をしない場合は総平均法になります。変更には税務署への届出が必要です。',
    language: '表示言語',
    save: '保存',
    backend: '接続先',
    backendDemo: 'デモ（内蔵のサンプルデータ）',
    backendApi: 'svdt API',
  },
  issue(i: Issue, fmt: (v: string) => string): string {
    const p = i.params;
    switch (i.kind) {
      case 'missing_price':
        return `${p['quantity']} ${p['asset']} の時価がわかりません。価格が入力されるまで0円として計算しています。`;
      case 'negative_balance':
        return `履歴上の保有量より ${p['shortfall']} ${p['asset']} 多く払い出しています。不足分は取得価額0円として計算しています。不足している取引履歴を取り込んでください。`;
      case 'missing_basis':
        return `外部から入庫した ${p['quantity']} ${p['asset']} の取得価額がわかりません。0円として計算しています。`;
      case 'unmatched_withdrawal':
        return `${p['quantity']} ${p['asset']} が接続されていないウォレットへ出庫されました。自分のウォレットへの移動（課税なし）として扱っています。売却や支払いだった場合は課税対象です。`;
      case 'method_not_allowed':
        return `${p['requested']} はこの国では使えないため、${p['used']} で計算しています。`;
      case 'unsupported_history_year':
        return `${p['year']}年のルールは未対応のため、${p['appliedYear']}年のルールで処理しました。引き継いだ取得価額を確認してください。`;
      case 'orphaned_override':
        return `修正の対象だった取引（${p['eventId']}）が見つからないため、修正は適用されていません。`;
      case 'invalid_override':
        return `修正を取引（${p['eventId']}）に適用できませんでした（${p['reason']}）。`;
      case 'opening_position_mismatch':
        return `申告した期首残高（${p['declared']}）が履歴上の保有量（${p['held']}）と一致しません。`;
      default:
        return i.message + (i.impactKnown ? ` (${fmt(i.impact.max)})` : '');
    }
  },
  suggestion(i: Issue, currency: string): string | null {
    const s = i.suggestedResolution;
    if (!s) return null;
    const a = s.override.action;
    if (a.type === 'set_unit_price') {
      return `最も近い時点の価格 ${a.unitPrice} ${currency}/${a.asset} を使う（${s.params['quotedAt']?.slice(0, 10) ?? ''}時点）`;
    }
    if (a.type === 'classify_withdrawal' && a.as === 'own_wallet') {
      return '自分のウォレットへの移動として確定する';
    }
    return s.message;
  },
};

type Dict = typeof ja;

const en: Dict = {
  brand: 'svdt',
  tagline: 'The crypto tax engine you can actually check.',
  nav: {
    overview: 'Overview',
    import: 'Import',
    transactions: 'Transactions',
    fixes: 'Fix queue',
    report: 'Report',
    settings: 'Settings',
  },
  demoBanner:
    'Demo mode: running on sample data. Anything you import is lost when the server restarts.',
  disclaimer: 'Tax rules are drafts pending professional review. Results are not tax advice.',
  jurisdiction: { jp: 'Japan', us: 'United States' },
  method: {
    TOTAL_AVERAGE: 'Total average (総平均法)',
    MOVING_AVERAGE: 'Moving average (移動平均法)',
    FIFO: 'First in, first out (FIFO)',
    HIFO: 'Highest in, first out (HIFO)',
    LIFO: 'Last in, first out (LIFO)',
  },
  yearLabel: (y: number) => `Tax year ${y}`,
  overview: {
    title: (y: number) => `Your ${y} tax position`,
    jpHeadline: 'Miscellaneous income from crypto (雑所得)',
    usShort: 'Short-term gain',
    usLong: 'Long-term gain',
    usIncome: 'Ordinary income (staking etc.)',
    revenue: 'Revenue (収入金額)',
    expenses: 'Necessary expenses (必要経費)',
    disposals: 'From disposals',
    income: 'From crypto received',
    feeExpenses: 'Fee expenses',
    lossNote: "A loss can't offset other income, so the taxable amount is ¥0.",
    uncertainty: 'Could still change by',
    upTo: (v: string) => `up to ${v}`,
    unknownCount: (n: number) => `${n} with unknown impact`,
    allClear: 'Nothing left to review.',
    topFixes: 'Biggest open items',
    seeAll: 'See all',
    data: 'Data',
    accounts: (n: number) => `${n} accounts`,
    events: (n: number) => `${n} transactions`,
    importMore: 'Import history',
    noData: 'No transactions yet. Import a CSV export from your exchange.',
  },
  importPage: {
    title: 'Import history',
    intro:
      'Choose a CSV file exported from your exchange. The format is detected automatically, and importing the same file again never creates duplicates.',
    file: 'CSV file',
    account: 'Account name',
    accountHint: 'e.g. bitflyer, coincheck, wallet',
    format: 'Format',
    auto: 'Detect automatically',
    unverified: 'unverified',
    submit: 'Import',
    submitting: 'Importing…',
    result: 'Result',
    rows: (n: number) => `${n} rows`,
    imported: (n: number) => `${n} imported`,
    skipped: (n: number) => `${n} skipped`,
    conflicts: (n: number) => `${n} not saved: id already used by another account`,
    warnings: 'Rows that need attention',
    line: (n: number | null) => (n === null ? 'File' : `Line ${n}`),
    history: 'Past imports',
    noHistory: 'No imports yet.',
    unverifiedNote:
      "This format hasn't been checked against real exports yet. Compare the result with your exchange's records.",
    errors: {
      noFile: 'Choose a file.',
      badAccount: 'Use letters, digits, dots, hyphens or underscores (up to 64).',
      tooLarge: 'The file is too large (20 MB maximum).',
      unknownFormat:
        'Unrecognized format. Convert it to the svdt canonical CSV first (docs/spec/canonical-csv.md).',
      generic: 'The import failed.',
    },
  },
  tx: {
    title: 'Transactions',
    date: 'Date',
    account: 'Account',
    type: 'Type',
    detail: 'Details',
    source: 'Source',
    more: 'Show more',
    empty: 'No transactions.',
    kinds: {
      buy: 'Buy',
      sell: 'Sell',
      swap: 'Swap',
      transfer: 'Transfer between accounts',
      income: 'Received',
      fee: 'Fee',
      external_deposit: 'Deposit from outside',
      external_withdrawal: 'Withdrawal to outside',
    },
    fee: 'fee',
  },
  fixes: {
    title: 'Fix queue',
    intro:
      'Ordered by how much each item could change your tax. Fixing from the top makes your number trustworthy fastest.',
    impact: 'Impact',
    unknown: 'Impact unknown',
    review: 'Review',
    suggested: 'Suggested fix',
    confidence: (c: number) => `${Math.round(c * 100)}% confidence`,
    apply: 'Apply',
    orManual: 'Or enter it yourself',
    unitPrice: 'Price per unit',
    costBasis: 'Total cost basis',
    acquiredAt: 'Acquired on (optional)',
    proceeds: 'Proceeds (optional)',
    save: 'Save',
    ownWallet: 'Moved to my own wallet',
    spent: 'Sold or spent it',
    importHistory: 'Import the missing history',
    event: 'Transaction',
    resolved: 'Your corrections',
    status: {
      applied: 'Applied',
      superseded: 'Replaced by a newer one',
      revoked: 'Withdrawn',
      event_not_found: 'Transaction not found',
      not_applicable: "Couldn't be applied",
    },
    noOverrides: 'No corrections yet.',
    empty: 'Nothing to fix.',
    undo: 'Undo',
    action(a: OverrideAction, currency: string): string {
      switch (a.type) {
        case 'set_unit_price':
          return `Set ${a.asset} price to ${a.unitPrice} ${currency}`;
        case 'set_cost_basis':
          return `Set cost basis to ${a.costBasis} ${currency}${a.acquiredAt ? ` (acquired ${a.acquiredAt.slice(0, 10)})` : ''}`;
        case 'classify_withdrawal':
          return a.as === 'own_wallet'
            ? 'Confirmed: moved to my own wallet'
            : `Confirmed: sold or spent${a.proceeds ? ` (${a.proceeds} ${currency})` : ''}`;
        case 'revoke':
          return 'Withdrew an earlier correction';
      }
    },
  },
  report: {
    title: (y: number) => `${y} report`,
    returnFigures: 'Figures for your return',
    disposals: 'Disposals (sales, swaps, fees paid in crypto)',
    income: 'Crypto received (staking, airdrops, …)',
    holdings: 'Holdings at year end',
    asset: 'Asset',
    account: 'Account',
    disposedAt: 'Disposed',
    proceeds: 'Proceeds',
    costBasis: 'Cost basis',
    gain: 'Gain',
    term: 'Term',
    short: 'Short',
    long: 'Long',
    why: 'Why this basis',
    receivedAt: 'Received',
    value: 'Value',
    taxable: 'Taxable',
    quantity: 'Quantity',
    averageCost: (m: string) => `Average cost (${m})`,
    lotFrom: (origin: string, date: string) => `Lot from ${origin} on ${date}`,
    shortfall: 'Not in your history: cost basis 0',
    rules: 'Rules applied',
    origins: {
      purchase: 'purchase',
      swap: 'swap',
      income: 'income',
      external_deposit: 'deposit',
      opening_position: 'opening balance',
      transfer: 'transfer',
      shortfall: 'missing history',
    },
    meta: (pack: string, engine: string, tz: string) => `Rules ${pack} · engine ${engine} · ${tz}`,
    none: 'None.',
    draft: 'draft',
  },
  settings: {
    title: 'Settings',
    jurisdiction: 'Country you file in',
    taxYear: 'Tax year',
    method: 'Cost-basis method',
    methodNote:
      'In Japan the total average method applies unless you file a notice to use moving average.',
    language: 'Language',
    save: 'Save',
    backend: 'Backend',
    backendDemo: 'Demo (built-in sample data)',
    backendApi: 'svdt API',
  },
  issue(i: Issue): string {
    return i.message;
  },
  suggestion(i: Issue): string | null {
    return i.suggestedResolution?.message ?? null;
  },
};

export function t(lang: Lang): Dict {
  return lang === 'en' ? en : ja;
}
