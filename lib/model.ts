// Token Radar's model: one sealed snapshot in, one ranked board out.
//
// The board ranks protocols that record no token, by what their token would be worth if the
// protocol's record stayed as it is. The watchlist is the floor: every one of its 40 slugs is
// ranked, and the early radar adds pre-token protocols below the $50M floor that the house rule
// does not exclude. Protocols whose token already trades are kept apart and shown with their
// market cap, never mixed into the ranking.
//
// Implied value is one function of the snapshot's own figures, the same for every protocol:
//
//   category multiple  a fee-earning venue earns more per dollar of TVL than a pipe does:
//                      trading venues 0.50, curators and allocators 0.40, capital products 0.35,
//                      infrastructure 0.25, anything else 0.30
//   growth             1 + clamp(change_7d, -50, +150) / 100 x 0.6
//   maturity           0.65 + 0.35 x sqrt(min(age_days, 1460) / 1460); age unknown counts as 365 days
//   breadth            1 + 0.03 x min(chains - 1, 4), at most 1.12
//   implied            max(1, round(tvl_usd x category x growth x maturity x breadth))
//
// No protocol name is ever special-cased: the same function scores every row, and the dashboard
// states the constants so a reader can check any row by hand. The category table the dashboard
// states comes from this file's own constants (see categoryTable), never from a second copy.

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
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

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  trading_multiple: number;
  curator_multiple: number;
  capital_multiple: number;
  infra_multiple: number;
  default_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_cap: number;
}

export const MODEL: ModelConstants = {
  trading_multiple: 0.5,
  curator_multiple: 0.4,
  capital_multiple: 0.35,
  infra_multiple: 0.25,
  default_multiple: 0.3,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_step: 0.03,
  breadth_cap: 4,
};

/** The model's version label, shown on the dashboard. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row's compact form for data.js. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
  watchlist: boolean;
}

/** A live-token protocol: the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One row of the category-multiple table the dashboard states. */
export interface CategoryTableRow {
  label: string;
  multiple: number;
}

/** Everything the dashboard needs to render. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  model_categories: CategoryTableRow[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Categories that earn fees on flow: exchanges, derivatives, prediction and synthetic markets. */
const TRADING = new Set([
  'Dexs',
  'Derivatives',
  'Options',
  'Options Vault',
  'Prediction Market',
  'Synthetics',
  'Interest Rate Derivatives',
  'OTC Marketplace',
  'NFT Marketplace',
]);

/** Categories that manage other people's capital: vaults, curators and allocators. */
const CURATORS = new Set([
  'Risk Curators',
  'Onchain Capital Allocator',
  'Liquidity Manager',
  'Indexes',
  'Launchpad',
  'Governance Incentives',
]);

/** Categories that hold capital and pay yield on it: lending, CDPs, RWA and stable assets. */
const CAPITAL = new Set([
  'Lending',
  'CDP',
  'CDP Manager',
  'Yield',
  'Yield Aggregator',
  'Leveraged Farming',
  'Farm',
  'RWA',
  'Stablecoin Issuer',
  'Algo-Stables',
  'Dual-Token Stablecoin',
  'Stablecoin Wrapper',
  'Basis Trading',
  'Uncollateralized Lending',
  'Collateral Management',
  'Collateral Markets',
  'Reserve Currency',
  'Token Locker',
]);

/** What one dollar of TVL is worth as a future token, by what the protocol does with it. */
export function categoryMultiple(category: string | null, model: ModelConstants): number {
  if (category === null) return model.default_multiple;
  if (TRADING.has(category)) return model.trading_multiple;
  if (CURATORS.has(category)) return model.curator_multiple;
  if (CAPITAL.has(category)) return model.capital_multiple;
  return model.infra_multiple;
}

/**
 * The category-multiple table the dashboard states, built from the model's own constants, so
 * the number on the page and the number in the score can never drift apart. The labels name
 * the category groups; the multiples are the constants above, in the same order.
 */
export function categoryTable(model: ModelConstants): CategoryTableRow[] {
  return [
    { label: 'Trading venues — Dexs, Derivatives, Options, Prediction Market, Synthetics', multiple: model.trading_multiple },
    { label: 'Curators and allocators — Risk Curators, Onchain Capital Allocator, Liquidity Manager', multiple: model.curator_multiple },
    { label: 'Capital products — Lending, CDP, Yield, RWA, Stablecoin Issuer', multiple: model.capital_multiple },
    { label: 'Infrastructure and everything else', multiple: model.infra_multiple },
    { label: 'Uncategorised', multiple: model.default_multiple },
  ];
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; catMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    model.maturity_range * Math.sqrt(Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days);
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_cap);
  const breadthMult = 1 + model.breadth_step * extraChains;
  const catMult = categoryMultiple(protocol.category, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * catMult * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, catMult, age };
}

/** A row's score as readable lines, for the dossier's worked example and for a reader who
 *  wants to check a row by hand. Each line names one factor and the number it contributes. */
export function scoreBreakdown(row: BoardRow): string[] {
  const m = row.model;
  const growth =
    row.change_7d === null
      ? 'no 7-day change on record, counted as 0%'
      : `${row.change_7d.toFixed(2)}% over 7 days`;
  const age =
    m.age_days === null ? 'unknown, counted as 365 days' : `${m.age_days} day${m.age_days === 1 ? '' : 's'}`;
  const chains = `${row.chains.length} chain${row.chains.length === 1 ? '' : 's'}`;
  return [
    `TVL $${row.tvl_usd.toLocaleString('en-US')} times the category multiple ${m.category_multiple} for ${row.category ?? 'an uncategorised protocol'}.`,
    `Growth ${growth}, clamped to ${m.growth_pct.toFixed(2)}%, gives a growth multiplier of ${m.growth_multiplier}.`,
    `Age ${age} gives a maturity multiplier of ${m.maturity_multiplier}.`,
    `${chains} give a breadth multiplier of ${m.breadth_multiplier}.`,
    `Implied value $${row.implied_value_usd.toLocaleString('en-US')}: the product, rounded to the dollar, at least $1.`,
  ];
}

/** Summary counts of a board, for the console log and the dossier's headline. */
export function boardStats(board: BoardRow[], snapshot: Snapshot): {
  rows: number;
  watchlistCovered: number;
  watchlistSize: number;
  earlyRows: number;
  topValue: number;
  bottomValue: number;
  topSlug: string;
  distinctValues: number;
} {
  const watchlist = new Set(snapshot.watchlist);
  const values = board.map((r) => r.implied_value_usd);
  return {
    rows: board.length,
    watchlistCovered: board.filter((r) => watchlist.has(r.slug)).length,
    watchlistSize: snapshot.watchlist.length,
    earlyRows: board.filter((r) => !watchlist.has(r.slug)).length,
    topValue: values.length > 0 ? Math.max(...values) : 0,
    bottomValue: values.length > 0 ? Math.min(...values) : 0,
    topSlug: board.length > 0 ? board[0]!.slug : '',
    distinctValues: new Set(values).size,
  };
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The house rule's exclusions, applied to the early radar as well as the watchlist: a wrapped,
 *  staked or bridged product of a token that already trades, a centralised exchange, and a
 *  versioned pool are not protocols that might launch a token. */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol is one the board may rank: pre-token and not an excluded product. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIXES) if (p.name.startsWith(prefix)) return false;
  return true;
}

/** The snapshot's protocols by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The board: every watchlist slug, then every rankable pre-token protocol below the floor. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.catMult,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** One step as a single string: the action, then its cost and its time. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page for its points program.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in whole dollars of gas. */
function gasOn(chain: string): number {
  if (chain === 'Ethereum') return 8;
  if (chain === 'Bitcoin') return 3;
  if (chain === 'Solana') return 1;
  if (chain === 'Tron' || chain === 'Binance' || chain === 'Avalanche' || chain === 'Hyperliquid L1') return 1;
  return 1;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: a young protocol needs a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The first move: what to do with the capital, by what the protocol does. */
function firstMove(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} as a lender and leave the deposit earning.`;
  }
  if (c.includes('dex') || c.includes('liquidity manager')) {
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position in range.`;
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options') || c.includes('synthetic')) {
    return `Deposit $${capital} of USDC as collateral on ${name} on ${chain} and open a single small hedged trade.`;
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) {
    return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and let the yield compound.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('indexes')) {
    return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and hold the vault shares.`;
  }
  if (c.includes('rwa') || c.includes('reserve')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in your wallet.`;
  }
  if (c.includes('stable')) {
    return `Mint $${capital} of the stable asset through ${name} on ${chain} and keep it parked in the protocol.`;
  }
  if (c.includes('stak') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the funds inside its app.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${name} and take one small position in a market that closes within a week.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  if (c.includes('launchpad')) {
    return `Register $${capital} for the next allocation on ${name} and complete its checks before the sale opens.`;
  }
  if (c.includes('governance')) {
    return `Lock $${capital} of the voting asset through ${name} on ${chain} and vote on the next live proposal.`;
  }
  if (c.includes('payment') || c.includes('card')) {
    return `Load $${capital} onto ${name} on ${chain} and spend it on two ordinary purchases.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The second move: a different feature of the same protocol, so the farm is not one action. */
function secondMove(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Borrow $20 of USDC against the deposit on ${name} and repay it within the week.`;
  }
  if (c.includes('dex') || c.includes('liquidity manager')) {
    return `Swap $25 of USDC for the pool's other asset on ${name} and add it to the same pool.`;
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged') || c.includes('curator') || c.includes('allocator')) {
    return `Claim the vault's accrued yield on ${name} once, then redeposit it into the same vault.`;
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options') || c.includes('synthetic')) {
    return `Close the hedge on ${name} and open a second one in the opposite direction.`;
  }
  if (c.includes('rwa') || c.includes('reserve') || c.includes('stable')) {
    return `Redeem $25 of the asset back to USDC on ${name} to prove the exit works, then mint it again.`;
  }
  if (c.includes('prediction')) {
    return `Settle the first market on ${name} and place a second position in a different market.`;
  }
  return `Use ${name}'s second feature once, such as a swap, a vote or a claim, on ${chain}.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasOn(chain);
  return [
    {
      text: 'Open a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper.',
      cost: `about $${gas} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: firstMove(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondMove(p, capital, chain),
      cost: `about $${gas * 2} of gas`,
      time: '10 minutes',
    },
    {
      text: 'Do one qualifying action every week, such as a deposit, a swap, a borrow or a vote.',
      cost: `about $${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days so the activity spans more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: "Before you withdraw, open the protocol's own rewards page from its official site and claim only from the link it publishes; then write the wallet, the dates and every transaction in a farm log.",
      cost: 'no fee to check, and never pay to claim',
      time: '15 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, farm plan included. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    model_categories: categoryTable(model),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, new Set(snapshot.watchlist))),
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board has ${board.length} rows, fewer than 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
