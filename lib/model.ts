// Token Radar — the valuation model (radar-comps-1).
//
// One snapshot in, one ranked board out. The board ranks protocols that record no token yet by what a
// token would plausibly be worth if it launched against the record the snapshot shows. The value is
// never a flat guess: it is priced off the snapshot's own market.
//
//   1. Comps. Every protocol whose token already trades gives a market observation: the ratio of its
//      market cap to its TVL. Protocols in the same category are the comparables. Each ratio is
//      winsorized to the sane band first, so one token whose cap is plainly not priced off its
//      protocol's TVL cannot drag a whole category with it. A category's multiple is the median of
//      its comps' ratios, shrunk toward the global median by the comp count (a category with two
//      comps leans on the market; one with twenty stands on its own), then clamped to the band.
//   2. Momentum. The seven-day TVL change, clamped, scales the multiple: a protocol gathering TVL
//      into a launch is worth more per dollar than one leaking it.
//   3. Track record. Days since DefiLlama first tracked the protocol, capped at four years, scale
//      the value from 0.70 to 1.00: a launch is worth more from a protocol that has run for years
//      with no token than from one that appeared last month.
//
//   implied = round( tvl_usd x category_multiple x momentum x track_record )
//
// No protocol name is ever special-cased: the same function scores every row, and the category
// multiples are derived from the snapshot at run time, never hardcoded.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, shipped to the dashboard so the page runs the same arithmetic. */
export interface ModelConstants {
  shrinkage: number;
  multiple_min: number;
  multiple_max: number;
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  age_floor_mult: number;
  age_cap_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  shrinkage: 4,
  multiple_min: 0.02,
  multiple_max: 3,
  growth_floor: -40,
  growth_cap: 80,
  growth_weight: 0.75,
  age_floor_mult: 0.7,
  age_cap_days: 1460,
  unknown_age_days: 540,
};

/** The model's version label, named in the dashboard and the board's summary. */
export const MODEL_VERSION = 'radar-comps-1';

/** How many live-token protocols the dashboard's "already trading" strip carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  category_multiple: number;
  comps_n: number;
  implied_value_usd: number;
  farm_steps: string[];
}

/** The dashboard's view of one board row: the board row's figures plus its farm plan. */
export interface RadarRow extends BoardRow {
  momentum_multiplier: number;
  track_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const bySlugAsc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** One category's comp set: the live-token protocols in it, and the multiple they imply. */
export interface CategoryComp {
  multiple: number;
  comps_n: number;
}

/**
 * The comp table: for every category, the median market-cap/TVL ratio of its live-token protocols,
 * shrunk toward the global median and clamped. Also returns the global median itself.
 */
export function compTable(snapshot: Snapshot, model: ModelConstants = MODEL): { table: Map<string, CategoryComp>; globalMultiple: number } {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = Math.min(model.multiple_max, Math.max(model.multiple_min, p.mcap_usd / p.tvl_usd));
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const globalMultiple = all.length > 0 ? median(all) : 0.2;
  const table = new Map<string, CategoryComp>();
  for (const [category, ratios] of ratiosByCategory) {
    const n = ratios.length;
    const shrunk = (n * median(ratios) + model.shrinkage * globalMultiple) / (n + model.shrinkage);
    const clamped = Math.min(model.multiple_max, Math.max(model.multiple_min, shrunk));
    table.set(category, { multiple: round4(clamped), comps_n: n });
  }
  return { table, globalMultiple: round4(globalMultiple) };
}

/** The multiple one protocol is priced with: its category's comp multiple, or the global median. */
function multipleFor(p: SnapshotProtocol, table: Map<string, CategoryComp>, globalMultiple: number): CategoryComp {
  return table.get(p.category ?? 'Other') ?? { multiple: globalMultiple, comps_n: 0 };
}

/** The three factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  comp: CategoryComp,
  model: ModelConstants = MODEL,
): { implied: number; momentumMult: number; trackMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, p.change_7d ?? 0));
  const momentumMult = 1 + (growth / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const trackMult = model.age_floor_mult + (1 - model.age_floor_mult) * (Math.min(Math.max(ageForModel, 0), model.age_cap_days) / model.age_cap_days);
  const implied = Math.max(1, Math.round(p.tvl_usd * comp.multiple * momentumMult * trackMult));
  return { implied, momentumMult, trackMult, age };
}

// ---------------------------------------------------------------- which protocols the board may rank

/** DefiLlama's version-marker rule: a name ending in a release is another protocol's pool. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that are a wrapped, staked or bridged product of a token that already trades, or an exchange. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Exchange names a product's name may begin with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a wrapped, staked or bridged product of another protocol, by the house's rule. */
export function isProductOfAnother(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x));
}

/** Whether the board may rank a protocol: it records no token and is no other protocol's product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && !isProductOfAnother(p);
}

// ---------------------------------------------------------------- farm plans

/** Rough per-action gas on a chain, in words a plan can carry. */
function gasLabel(chain: string): string {
  if (chain === 'Ethereum') return 'about $9';
  if (chain === 'Solana') return 'about $0.10';
  if (chain === 'Binance') return 'about $0.30';
  if (['Base', 'Arbitrum', 'Optimism', 'Polygon', 'zkSync Era', 'Linea', 'Scroll', 'Blast', 'Mode'].includes(chain)) return 'about $0.40';
  return 'about $1.50';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: a younger protocol needs a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 365) return 90;
  if (age < 730) return 60;
  return 45;
}

/** The category's core action and its follow-up action, in words a farmer can follow. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): { core: string; second: string } {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      core: `Supply $${capital} of USDC to ${n} on ${chain} so the wallet appears as a lender in its markets.`,
      second: `Borrow about 30% against the position once and repay it a week later, so the wallet shows both sides of the market.`,
    };
  }
  if (c.includes('dex')) {
    return {
      core: `Add $${capital} of liquidity to ${n}'s largest stablecoin pool on ${chain} and leave the LP position open.`,
      second: `Make two small swaps a week through ${n}'s own interface so the wallet builds a trading history, not only a deposit.`,
    };
  }
  if (c.includes('deriv') || c.includes('perpetual')) {
    return {
      core: `Deposit $${capital} of USDC as margin on ${n} and open one small hedged position (long and short of equal size).`,
      second: `Roll the hedge once a week and keep total fees under 1% of the margin, so the activity reads as trading, not churn.`,
    };
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return {
      core: `Deposit $${capital} into the largest ${n} vault on ${chain} and keep the vault shares in the same wallet.`,
      second: `Split a second $${Math.round(capital / 2)} into a different ${n} vault, so the wallet follows more than one strategy.`,
    };
  }
  if (c.includes('rwa')) {
    return {
      core: `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} after its onboarding check and hold the asset.`,
      second: `Use the minted asset once in the venue ${n} itself points to, such as its own market or a listed lending pool.`,
    };
  }
  if (c.includes('basis')) {
    return {
      core: `Deposit $${capital} of USDC into ${n}'s basis vault on ${chain} and keep the position through a full funding cycle.`,
      second: `Add a small top-up after the first cycle settles, so the wallet shows a deposit in two different months.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      core: `Fund $${capital} on ${n} and take one position in its most liquid market, sized under 10% of the market.`,
      second: `Settle the position at expiry and take one position in a second market, so the record spans two events.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      core: `Buy $${capital} of cover from ${n} on ${chain} for a position you actually hold, and keep the policy to expiry.`,
      second: `Renew the cover once when it expires, so the wallet shows a second policy period.`,
    };
  }
  if (c.includes('chain')) {
    return {
      core: `Bridge $${capital} of stablecoins to ${chain} and hold a small balance of its gas token in the farming wallet.`,
      second: `Make one transfer and one contract interaction on ${chain} each week, so the wallet is an active user of the chain.`,
    };
  }
  if (c.includes('staking') || c.includes('restaking')) {
    return {
      core: `Stake $${capital} of the underlying asset through ${n} on ${chain} and keep the receipt token in the wallet.`,
      second: `Claim and restake the rewards once, so the wallet shows a full staking cycle rather than a single deposit.`,
    };
  }
  if (c.includes('stablecoin') || c.includes('stable')) {
    return {
      core: `Deposit $${capital} of collateral into ${n} on ${chain} and mint or hold its stable asset in the wallet.`,
      second: `Use the stable asset once inside ${n}'s own app, such as a swap or a repayment, and then hold the remainder.`,
    };
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('liquidity')) {
    return {
      core: `Deposit $${capital} into ${n}'s main vault on ${chain} and keep the shares for the whole qualifying window.`,
      second: `Compound the rewards back into the same vault once, so the wallet shows an active, not parked, position.`,
    };
  }
  if (c.includes('payment') || c.includes('card')) {
    return {
      core: `Complete ${n}'s sign-up, fund $${capital} and make it the wallet you spend from for everyday purchases.`,
      second: `Keep a balance on ${n} for a full month and make at least four real payments, so the record is usage, not a deposit.`,
    };
  }
  return {
    core: `Deposit $${capital} of USDC into ${n} on ${chain} through its own app and keep the position open.`,
    second: `Repeat a smaller deposit of $${Math.round(capital / 2)} two weeks later, so the wallet shows activity in more than one week.`,
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) — never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const gas = gasLabel(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const { core, second } = actionsFor(p, capital, chain);
  const steps = [
    `Set up a fresh wallet only for ${p.name}, fund it from your main wallet and keep its seed phrase offline. Cost: one funding transfer, ${gas} of gas on ${chain}. Time: 10 minutes.`,
    `${core} Cost: $${capital} of capital plus ${gas} of gas. Time: 15 minutes to set up.`,
    `${second} Cost: ${gas} of gas. Time: 10 minutes.`,
    `Repeat one qualifying action every week for at least ${weeks} weeks, on roughly the same weekday, so the wallet reads as a regular user. Cost: ${gas} of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days without withdrawing, so it is counted in more than one weekly snapshot. Cost: the $${capital} stays locked in the position. Time: ${hold} days.`,
    `Check ${p.name}'s own points or rewards page weekly and claim only through the link the protocol itself publishes; never pay a fee to claim. Cost: nothing to check. Time: 5 minutes a week.`,
    `Keep a farm log of the wallet, dates and transaction hashes, and exit if ${p.name}'s TVL falls more than 30% in a week or a token launches, then re-judge the position. Cost: nothing but the log. Time: 5 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

// ---------------------------------------------------------------- the board

/** The protocols the board ranks, strongest first, with ranks 1..n and the dashboard's rows. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { table, globalMultiple } = compTable(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => {
      const comp = multipleFor(p, table, globalMultiple);
      const { implied, momentumMult, trackMult, age } = impliedValue(p, snapshot.as_of, comp, model);
      return { p, comp, implied, momentumMult, trackMult, age };
    });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || bySlugAsc(a.p.slug, b.p.slug));
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    on_watchlist: watchlist.has(s.p.slug),
    category_multiple: s.comp.multiple,
    comps_n: s.comp.comps_n,
    implied_value_usd: s.implied,
    farm_steps: farmSteps(s.p, s.age),
  }));
  const rows: RadarRow[] = board.map((r, i) => ({
    ...r,
    momentum_multiplier: round4(scored[i]!.momentumMult),
    track_multiplier: round4(scored[i]!.trackMult),
  }));
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !recordsNoToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || bySlugAsc(a.slug, b.slug))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: globalMultiple,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    rows,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const seen = new Set<string>();
  for (const r of board) {
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const ordered = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]!.implied_value_usd > ordered[i - 1]!.implied_value_usd) return `rank ${ordered[i]!.rank} outranks rank ${ordered[i - 1]!.rank} on implied value`;
  }
  if (board.length >= 2 && ordered[0]!.implied_value_usd === ordered[ordered.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (r.name.trim().length === 0) return `${r.slug} has an empty name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
