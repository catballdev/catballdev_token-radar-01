// A custom token radar model: improved pre-token protocol scoring.
//
// The model reads the snapshot and scores every pre-token protocol using:
// 1. TVL-based base value with category-aware multipliers
// 2. Growth momentum (7d change with acceleration term)
// 3. Maturity/age factor
// 4. Chain diversity bonus
// 5. Confidence grade based on data quality
//
// No protocol name is special-cased; the same function scores every row.

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

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_bonus_weight: number;
  max_chains: number;
  chain_diminishing_rate: number;
  confidence_threshold: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.30,
  growth_weight: 0.7,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.5,
  maturity_range: 0.5,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_bonus_weight: 0.15,
  max_chains: 10,
  chain_diminishing_rate: 0.4,
  confidence_threshold: 0.7,
};

/** Category multipliers: some categories naturally have higher token potential */
const CATEGORY_MULTIPLIERS: Record<string, number> = {
  // Risk Curators - high token potential, early-stage projects
  'Risk Curators': 1.35,
  // RWA - real world assets, growing sector with premium
  'RWA': 1.30,
  // Onchain Capital Allocator - capital deployment, high upside
  'Onchain Capital Allocator': 1.40,
  // Basis Trading - stablecoin mechanisms, often precede tokens
  'Basis Trading': 1.25,
  // Lending - established category, solid token models
  'Lending': 1.20,
  // Chain - new chains need native tokens for governance
  'Chain': 1.35,
  // Yield Aggregator - aggregates yield, often has governance token
  'Yield': 1.15,
  // Restaking - new paradigm, high upside potential
  'Restaking': 1.45,
  // Dexs - trading fees, liquidity, established token models
  'Dexs': 1.10,
  // CeDeFi - tokenized securities, regulated assets
  'CeDeFi': 1.20,
  // Insurance - protocol insurance, risk sharing tokens
  'Insurance': 1.15,
  // Payments - adoption layer, token for payments
  'Payments': 1.10,
  // Governance Incentives - governance-focused
  'Governance Incentives': 1.20,
  // Staking Pool - staking yields, tokens for participation
  'Staking Pool': 1.05,
  // Stablecoin Wrapper - stablecoin bridges, regulated versions
  'Stablecoin Wrapper': 0.95,
  // Collateral Markets - DeFi collateral, established
  'Collateral Markets': 1.05,
  // CDP - collateralized debt positions, MakerDAO-style
  'CDP': 1.10,
  // Default for unknown categories
  'Default': 1.00,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2-category-bonus';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 300;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_bonus: number;
    category_multiplier: number;
    confidence: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The confidence grade for a protocol */
export type ConfidenceGrade = 'A' | 'B' | 'C' | 'D';

/** The dashboard's compact view of one row, with farm plans generated in the page. */
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
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_bonus: number;
  category_multiplier: number;
  confidence: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  category_multipliers: Record<string, number>;
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

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Get category multiplier with default */
function categoryMultiplier(cat: string | null): number {
  if (cat === null) return CATEGORY_MULTIPLIERS['Default'];
  return CATEGORY_MULTIPLIERS[cat] ?? CATEGORY_MULTIPLIERS['Default'];
}

/** Calculate confidence grade based on data quality */
function calculateConfidence(row: { tvl_usd: number; change_7d: number | null; age_days: number | null; chains: string[] }): number {
  let score = 0.6; // Base confidence
  
  // TVL quality - higher TVL means more reliable data
  if (row.tvl_usd >= 100_000_000) score += 0.3;
  else if (row.tvl_usd >= 10_000_000) score += 0.2;
  else if (row.tvl_usd >= 1_000_000) score += 0.1;
  
  // Growth report quality - missing momentum data is penalized
  if (row.change_7d !== null) score += 0.1;
  else score -= 0.1; // Unverified momentum = more cautious
  
  // Age quality
  if (row.age_days !== null && row.age_days >= 30) score += 0.1;
  
  // Chain diversity (more chains usually means more established)
  if (row.chains.length >= 5) score += 0.05;
  
  return Math.min(1.0, Math.max(0, score));
}

/** Get confidence letter grade */
function confidenceGrade(confidence: number): ConfidenceGrade {
  if (confidence >= 0.85) return 'A';
  if (confidence >= 0.75) return 'B';
  if (confidence >= 0.60) return 'C';
  return 'D';
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol, 
  asOf: string, 
  model: ModelConstants
): { 
  implied: number; 
  growthPct: number; 
  growthMult: number; 
  maturityMult: number; 
  age: number | null;
  chainBonus: number;
  catMult: number;
  confidence: number;
} {
  const age = ageDays(asOf, protocol.listed_at);
  
  // Raw growth with acceleration for strong performers
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  
  // Momentum boost: positive growth gets extra weight, negative growth penalized
  let momentumFactor = 1;
  if (rawGrowth > 10) {
    momentumFactor = 1 + (rawGrowth - 10) / 500; // Extra boost for strong growth
  } else if (rawGrowth < -10) {
    momentumFactor = 1 + (rawGrowth + 10) / 200; // Penalty for steep decline
  }
  
  const growthMult = (1 + (growthPct / 100) * model.growth_weight) * momentumFactor;
  
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  
  // Chain breadth bonus - diminishing returns: first chain adds 0, each additional adds progressively less
  const chainCount = Math.min(protocol.chains.length, model.max_chains);
  const chainBonus = model.chain_bonus_weight * (1 - Math.pow(1 - model.chain_diminishing_rate, Math.max(0, chainCount - 1)));
  
  // Category multiplier
  const catMult = categoryMultiplier(protocol.category);
  
  // Confidence grade
  const confidence = calculateConfidence({
    tvl_usd: protocol.tvl_usd,
    change_7d: protocol.change_7d,
    age_days: age,
    chains: protocol.chains,
  });
  
  // Base value with all factors
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * (1 + chainBonus) * catMult * confidence));
  
  return { implied, growthPct, growthMult, maturityMult, age, chainBonus, catMult, confidence };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all (gecko_id and symbol both null). */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, age, chainBonus, catMult, confidence } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, growthPct, growthMult, maturityMult, age, chainBonus, catMult, confidence };
  });
  
  // Sort by implied value descending
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
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_bonus: round4(s.chainBonus),
      category_multiplier: round4(s.catMult),
      confidence: round4(s.confidence),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A farm step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * Get action based on category and chains.
 * This generates concrete farm steps from the protocol's category and chains.
 */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const chainsList = p.chains.join(', ');
  
  // Risk Curators - yield aggregation, liquidations
  if (c.includes('curator') || c.includes('risk')) {
    return `Deposit $${capital} of USDC into ${name}'s yield strategy on ${chain} and monitor the liquidation triggers weekly.`;
  }
  
  // RWA - real world asset tokenization
  if (c.includes('rwa')) {
    return `Mint $${capital} of the protocol's tokenized asset on ${chain} and hold as the underlying appreciate.`;
  }
  
  // Onchain Capital Allocator - capital deployment
  if (c.includes('capital allocator') || c.includes('allocator') || c.includes('onchain')) {
    return `Deploy $${capital} of USDC into ${name}'s capital pools on ${chain} and claim allocation tokens weekly.`;
  }
  
  // Basis Trading - stablecoin mechanisms
  if (c.includes('basis') || c.includes('stablecoin wrapper')) {
    return `Mint or deposit $${capital} of the protocol's stable asset through ${name} on ${chain} and earn protocol fees.`;
  }
  
  // Lending - supply/borrow
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} and borrow against to earn yield.`;
  }
  
  // Chain - new chain deployments
  if (c.includes('chain')) {
    return `Bridge $${capital} to ${chain} via ${name} and participate in the chain's native yield program.`;
  }
  
  // Restaking - new restaking paradigm
  if (c.includes('restak') || c.includes('restaking')) {
    return `Stake $${capital} of the native token through ${name} on ${chain} and restake the rewards.`;
  }
  
  // Dexs - liquidity provision
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and farm the reward tokens.`;
  }
  
  // CeDeFi - tokenized securities
  if (c.includes('cendefi') || c.includes('security')) {
    return `Acquire $${capital} of the protocol's tokenized securities and hold for dividends.`;
  }
  
  // Insurance - protocol insurance
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and hold the policy for premium yield.`;
  }
  
  // Payments - adoption layer
  if (c.includes('payment')) {
    return `Bridge $${capital} to ${chain} and use ${name}'s payment rails for merchant transactions.`;
  }
  
  // Governance Incentives
  if (c.includes('governance') || c.includes('incentive')) {
    return `Deposit $${capital} of USDC into ${name} on ${chain} and vote on governance proposals weekly.`;
  }
  
  // Staking Pool
  if (c.includes('staking pool') || c.includes('staking')) {
    return `Stake $${capital} of the chain's native token through ${name} and compound rewards.`;
  }
  
  // Collateral Markets
  if (c.includes('collateral') || c.includes('market')) {
    return `Deposit $${capital} worth of collateral into ${name} on ${chain} and monitor the health ratio.`;
  }
  
  // CDP - collateralized debt positions
  if (c.includes('cdp')) {
    return `Create a $${capital} CDP with $USDC collateral on ${chain} and hold the debt position.`;
  }
  
  // Default fallback for unknown categories
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open for protocol incentives.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. 
 * The plan is derived from the protocol's own record (category, chains, TVL, age),
 * never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  
  const category = (p.category ?? '').toLowerCase();
  const isDexOrYield = category.includes('dex') || category.includes('yield');
  const isLending = category.includes('lend') || category.includes('cdp') || category.includes('collateral');
  const isRestaking = category.includes('restak') || category.includes('restaking');
  const isStaking = category.includes('staking') && !category.includes('restak');
  
  return [
    {
      text: `Create a fresh wallet address specifically for farming this protocol and keep its seed phrase in a secure offline location.`,
      cost: 'under $3 of gas for wallet creation',
      time: '10 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $$${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: isDexOrYield 
        ? `Swap half the liquidity to the protocol's reward token and stake it to compound earnings.`
        : `Claim and stake any rewards from the position weekly to maximize yield.`,
      cost: isDexOrYield ? 'gas fees for swap: $5-$15' : 'gas for reward claims: $2-$5',
      time: '15 minutes weekly',
    },
    {
      text: `Make one qualifying action each week (swap, provide liquidity, borrow, or stake) to maintain eligibility for rewards.`,
      cost: `about $3-$5 of gas weekly`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is recorded across multiple snapshots.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before any exit, check the protocol's governance forum for upcoming token snapshots and airdrop eligibility requirements.`,
      cost: 'no cost to check, never pay to claim',
      time: '10 minutes before exit',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
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

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
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
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_bonus: row.model.chain_bonus,
    category_multiplier: row.model.category_multiplier,
    confidence: row.model.confidence,
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
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    category_multipliers: CATEGORY_MULTIPLIERS,
    rows: board.map(radarRow),
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// Export category multipliers for reference
export { CATEGORY_MULTIPLIERS };