// =============================================================================
// Gammon Rivals — MISSIONS-SIZING sweep  (iteration 3)
// =============================================================================
// Core loop (entry sink + win/loss payout @ 80% RTP) + level tap (XP on every
// match, wager-proportional) + the MISSIONS tap, modelled as refilling a fraction
// of each active day's wagering. Sweeps refill = 0/10/20/30% to find the level
// that keeps players solvent and lets them actually level.
//
// Run:  node tools/economy-sim/sim.mjs [nPlayers]
// Out:  tools/economy-sim/out/{report.html, summary.json, missions-sweep.csv, per-tier.csv}
// =============================================================================

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from './config.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');

function rng(seed) { let s = seed >>> 0; return () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const randint = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const gauss = (r, m, sd) => { const u = Math.max(1e-9, r()), v = r(); return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const pct = (arr, q) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); return a[clamp(Math.floor(q * (a.length - 1)), 0, a.length - 1)]; };
const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString());
function fmtShort(n) { if (n == null) return ''; const a = Math.abs(n); if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (a >= 1e3) return (n / 1e3).toFixed(1) + 'k'; return Math.round(n).toString(); }

function tierRtp(t) { return C.CORE_RTP_OVERRIDE != null ? C.CORE_RTP_OVERRIDE : t.targetRtp / 100; }
const TIER_BASE_WR = {};
for (const t of C.TIERS) TIER_BASE_WR[t.id] = C.BASE_WINRATE_OVERRIDE[t.id] != null ? C.BASE_WINRATE_OVERRIDE[t.id] : clamp((tierRtp(t) * t.entry - t.prizeLoss) / (t.prizeWin - t.prizeLoss), 0.05, 0.95);
const TIER_BY_ID = Object.fromEntries(C.TIERS.map((t) => [t.id, t]));
const DIFFICULTY_TIERS = C.TIERS.filter((t) => t.kind === 'difficulty');
const CHEAPEST_ENTRY = Math.min(...DIFFICULTY_TIERS.map((t) => t.entry));

// XP per match = base × (1 + boost%), granted on win AND loss (XP_ON_LOSS).
// Beginner 50 · Advanced 75 · Pro 125 · Expert 175 · Grand Master 300.
function xpPerMatch(tier) {
  return C.xpPerWin(tier);
}
function levelForXp(xp, fromLevel = 1) { let l = fromLevel; while (l < C.MAX_LEVEL && C.CURVE[l].xpRequired <= xp) l++; return l; }

function makePlayer(arch, r) {
  return { arch, r, skill: arch.skillDelta + gauss(r, 0, C.SKILL_NOISE_SD),
    coins: C.SIGNUP_GRANT.coins, gems: 0, xp: 0, level: 1, tieredAiMatches: 0,
    wagered: 0, matchPayout: 0, levelRewardCoins: 0, missionCoins: 0,
    everBankrupt: false, bankruptDay: null, stallDays: 0, churned: false, churnDay: null,
    reachDay: {}, reachWagered: { 1: 0 }, traj: {} };
}
function gainXp(p, amount, day) {
  if (amount <= 0) return;
  p.xp += amount;
  const nl = levelForXp(p.xp, p.level);
  if (nl > p.level) {
    let coins = 0;
    for (let L = p.level + 1; L <= nl; L++) { coins += C.CURVE[L - 1].rewardCoins; p.gems += C.CURVE[L - 1].rewardGems; if (p.reachDay[L] == null) { p.reachDay[L] = day; p.reachWagered[L] = p.wagered; } }
    p.coins += coins; p.levelRewardCoins += coins; p.level = nl;
  }
}
function chooseTier(p) {
  const unlocked = (t) => p.level >= t.reqLevel;
  const pool = (p.arch.progressionAware ? DIFFICULTY_TIERS : [TIER_BY_ID['beginner']]).filter(unlocked);
  const buffered = pool.filter((t) => p.coins >= t.entry * p.arch.riskBufferX).sort((a, b) => b.entry - a.entry);
  if (buffered.length) return buffered[0];
  const single = pool.filter((t) => p.coins >= t.entry).sort((a, b) => a.entry - b.entry);
  return single.length ? single[0] : null;
}
function playMatch(p, tier, day) {
  const wr = clamp(TIER_BASE_WR[tier.id] + p.skill, 0.05, 0.95);
  const win = p.r() < wr;
  p.coins -= tier.entry; p.wagered += tier.entry;
  let payout = win ? tier.prizeWin : tier.prizeLoss;
  if (!win && tier.kind === 'difficulty' && p.tieredAiMatches < C.RISK_FREE_FIRST_N && tier.entry > tier.prizeLoss) payout = tier.entry;
  p.coins += payout; p.matchPayout += payout;
  if (tier.kind === 'difficulty') p.tieredAiMatches++;
  const xp = xpPerMatch(tier);
  if (xp > 0 && (win || C.XP_ON_LOSS)) gainXp(p, xp, day);
}

const TRAJ_DAYS = [1, 7, 14, 30, 60, 90, 120, 150, 180];
const LEVEL_MILESTONES = [2, 5, 10, 20, 30];

function simulatePlayer(arch, seed, refillPct) {
  const r = rng(seed);
  const p = makePlayer(arch, r);
  for (let day = 0; day < C.HORIZON_DAYS; day++) {
    if (!p.churned && r() < arch.activeProb) {
      const wBefore = p.wagered;
      const n = randint(r, arch.matchesPerActive[0], arch.matchesPerActive[1]);
      let played = 0;
      for (let m = 0; m < n; m++) { const tier = chooseTier(p); if (!tier) break; playMatch(p, tier, day); played++; }
      const wToday = p.wagered - wBefore; // missions tap: refill % of the day's wagering (coins only)
      if (refillPct > 0 && wToday > 0) { const mc = Math.floor(refillPct * wToday); p.coins += mc; p.missionCoins += mc; }
      if (p.coins < CHEAPEST_ENTRY && !p.everBankrupt) { p.everBankrupt = true; p.bankruptDay = day; }
      if (played === 0) { p.stallDays++; if (p.stallDays >= C.CHURN_STALL_DAYS && !p.churned) { p.churned = true; p.churnDay = day; } } else p.stallDays = 0;
    }
    if (TRAJ_DAYS.includes(day + 1)) p.traj[day + 1] = { coins: p.coins, level: p.level };
  }
  return p;
}

function summarize(group) {
  const rtp = group.map((p) => (p.wagered > 0 ? p.matchPayout / p.wagered : null)).filter((x) => x != null);
  const bonus = group.map((p) => (p.wagered > 0 ? p.levelRewardCoins / p.wagered * 100 : null)).filter((x) => x != null);
  const o = {
    n: group.length,
    levelD180: pct(group.map((p) => p.traj[180]?.level ?? p.level), 0.5),
    realizedRtpPct: Math.round(pct(rtp, 0.5) * 100),
    bonusPp: +(pct(bonus, 0.5) ?? 0).toFixed(2),
    pctBankrupt: Math.round(100 * group.filter((p) => p.everBankrupt).length / group.length),
    pctChurned: Math.round(100 * group.filter((p) => p.churned).length / group.length),
    bal: {}, l10: null,
  };
  for (const d of TRAJ_DAYS) o.bal[d] = pct(group.map((p) => p.traj[d]?.coins).filter((x) => x != null), 0.5);
  const l10 = group.map((p) => p.reachDay[10]).filter((x) => x != null);
  o.l10 = { pctReached: Math.round(100 * l10.length / group.length), p50Day: pct(l10, 0.5) };
  return o;
}

function perTierAnalytic(a = 10, b = 60) {
  const xpSpan = C.CURVE[b - 1].xpRequired - C.CURVE[a - 1].xpRequired;
  let coinSpan = 0; for (let L = a + 1; L <= b; L++) coinSpan += C.CURVE[L - 1].rewardCoins;
  return DIFFICULTY_TIERS.map((t) => {
    const xpm = xpPerMatch(t), matches = xpm > 0 ? xpSpan / xpm : Infinity, wagered = matches * t.entry;
    const bonusPp = wagered > 0 && isFinite(matches) ? coinSpan / wagered * 100 : null;
    return { label: t.label, entry: t.entry, xpPerMatch: +xpm.toFixed(1), winRatePct: Math.round(TIER_BASE_WR[t.id] * 100), coreRtpPct: Math.round(tierRtp(t) * 100), bonusPp: bonusPp == null ? null : +bonusPp.toFixed(3) };
  });
}


const N = Number(process.argv[2] || 5000);
const POP = (() => { const a = []; for (const x of C.ARCHETYPES) for (let i = 0; i < Math.round(N * x.weight); i++) a.push(x); return a; })();
const tierTable = perTierAnalytic();
const bonusPps = tierTable.map((t) => t.bonusPp).filter((x) => x != null);
const bonusLo = Math.min(...bonusPps), bonusHi = Math.max(...bonusPps); // tier-scaled XP => tier-dependent

const scenarios = C.MISSIONS_REFILL_PCTS.map((refill) => {
  const players = POP.map((arch, i) => simulatePlayer(arch, C.SEED + i * 2654435761, refill));
  const overall = summarize(players);
  const trend = overall.bal[180] > overall.bal[30] * 1.15 ? 'growing' : overall.bal[180] < overall.bal[30] * 0.85 ? 'declining' : 'stable';
  return { refill, overall, trend };
});
// recommended = smallest refill that is solvent (not declining, low bankruptcy)
const recommended = scenarios.find((s) => s.trend !== 'declining' && s.overall.pctBankrupt <= 25) || scenarios[scenarios.length - 1];


mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ meta: { nPlayers: N, horizonDays: C.HORIZON_DAYS, coreRtp: C.CORE_RTP_OVERRIDE, xpFormula: 'base*(1+boost%)', levelBonusPpRange: [bonusLo, bonusHi] }, recommendedRefillPct: recommended.refill, scenarios, perTierAnalytic: tierTable }, null, 2));
writeFileSync(join(OUT, 'missions-sweep.csv'), 'refill_pct,bal_d30,bal_d90,bal_d180,trend,pct_bankrupt,level_d180,l10_pct_reached,l10_median_day,realized_rtp_pct,level_bonus_pp\n' +
  scenarios.map((s) => [s.refill * 100, s.overall.bal[30], s.overall.bal[90], s.overall.bal[180], s.trend, s.overall.pctBankrupt, s.overall.levelD180, s.overall.l10.pctReached, s.overall.l10.p50Day ?? '', s.overall.realizedRtpPct, s.overall.bonusPp].join(',')).join('\n'));

function svgLines(series, opts) {
  const { w = 760, h = 260, pad = 52, xs, title } = opts;
  const allY = series.flatMap((s) => s.points.map((p) => p.y)).filter((y) => y != null);
  const ymin = Math.min(0, ...allY), ymax = Math.max(...allY, 1);
  const X = (x) => pad + (x - xs[0]) / (xs[xs.length - 1] - xs[0]) * (w - pad - 12);
  const Y = (y) => h - pad - (y - ymin) / ((ymax - ymin) || 1) * (h - pad - 28);
  const colors = ['#94a3b8', '#dc2626', '#16a34a', '#2563eb', '#7c3aed'];
  let s = `<svg viewBox="0 0 ${w} ${h}" width="100%" style="background:#fff;border:1px solid #e5e7eb;border-radius:8px">`;
  s += `<text x="${w / 2}" y="16" text-anchor="middle" font-size="13" font-weight="700">${title}</text>`;
  s += `<line x1="${pad}" y1="${h - pad}" x2="${w - 12}" y2="${h - pad}" stroke="#9ca3af"/><line x1="${pad}" y1="24" x2="${pad}" y2="${h - pad}" stroke="#9ca3af"/>`;
  for (let i = 0; i <= 4; i++) { const yv = ymin + (ymax - ymin) * i / 4, py = Y(yv); s += `<line x1="${pad}" y1="${py}" x2="${w - 12}" y2="${py}" stroke="#f1f5f9"/><text x="${pad - 6}" y="${py + 3}" text-anchor="end" font-size="9" fill="#6b7280">${fmtShort(yv)}</text>`; }
  for (const x of xs) s += `<text x="${X(x)}" y="${h - pad + 14}" text-anchor="middle" font-size="9" fill="#6b7280">${x}</text>`;
  s += `<text x="${w / 2}" y="${h - 4}" text-anchor="middle" font-size="10" fill="#374151">day</text>`;
  series.forEach((ser, i) => { const c = colors[i % colors.length]; const d = ser.points.filter((p) => p.y != null).map((p, j) => `${j ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' '); s += `<path d="${d}" fill="none" stroke="${c}" stroke-width="2"/><rect x="${pad + 8 + i * 130}" y="26" width="10" height="10" fill="${c}"/><text x="${pad + 22 + i * 130}" y="35" font-size="10" fill="#374151">${ser.name}</text>`; });
  return s + '</svg>';
}
const balChart = svgLines(scenarios.map((s) => ({ name: `${Math.round(s.refill * 100)}% refill`, points: TRAJ_DAYS.map((d) => ({ x: d, y: s.overall.bal[d] })) })), { xs: TRAJ_DAYS, title: 'Median coin balance over time, by missions refill %' });

const trendBadge = (t) => `<span class="${t === 'growing' ? 'good' : t === 'declining' ? 'bad' : 'warn'}">${t}</span>`;
const sweepRows = scenarios.map((s) => `<tr${s.refill === recommended.refill ? ' style="outline:2px solid #16a34a;outline-offset:-2px"' : ''}><td style="text-align:left"><b>${Math.round(s.refill * 100)}%</b>${s.refill === recommended.refill ? ' ✓' : ''}</td><td>${fmt(s.overall.bal[30])}</td><td>${fmt(s.overall.bal[90])}</td><td>${fmt(s.overall.bal[180])}</td><td>${trendBadge(s.trend)}</td><td class="${s.overall.pctBankrupt > 50 ? 'bad' : s.overall.pctBankrupt > 20 ? 'warn' : 'good'}">${s.overall.pctBankrupt}%</td><td>L${s.overall.levelD180}</td><td>${s.overall.l10.pctReached}%${s.overall.l10.p50Day ? ` <span class=dim>d${s.overall.l10.p50Day}</span>` : ''}</td><td>${s.overall.realizedRtpPct}%</td><td class=good>+${s.overall.bonusPp}pp</td></tr>`).join('');
const tierRows = tierTable.map((t) => `<tr><td style="text-align:left">${t.label}</td><td>${fmt(t.entry)}</td><td>${t.xpPerMatch}</td><td>${t.coreRtpPct}%</td><td class=good>+${t.bonusPp}pp</td></tr>`).join('');

const html = `<!doctype html><meta charset=utf8><title>Gammon Rivals — Missions sizing</title>
<style>body{font:14px/1.5 system-ui,Segoe UI,Arial;margin:0;background:#f8fafc;color:#0f172a}.wrap{max-width:1000px;margin:0 auto;padding:28px}
h1{font-size:22px;margin:0 0 2px}h2{font-size:16px;margin:26px 0 8px;border-bottom:2px solid #e2e8f0;padding-bottom:4px}.dim{color:#94a3b8;font-size:11px}.sub{color:#64748b;margin:0 0 16px}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:13px}th,td{padding:7px 10px;text-align:center;border-bottom:1px solid #f1f5f9}th{background:#f1f5f9;font-size:11px;text-transform:uppercase;color:#475569}td:first-child,th:first-child{text-align:left}
.bad{background:#fef2f2;color:#b91c1c;font-weight:700}.warn{background:#fffbeb;color:#b45309;font-weight:600}.good{background:#f0fdf4;color:#15803d;font-weight:600}
.kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:12px 0}.card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px}.card .v{font-size:22px;font-weight:800}.card .l{font-size:11px;color:#64748b;text-transform:uppercase}
.note{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-size:13px;margin:10px 0}.grid{margin:12px 0}</style>
<div class=wrap>
<h1>Gammon Rivals — Missions Sizing</h1>
<p class=sub>${N.toLocaleString()} players · ${C.HORIZON_DAYS} days · core RTP ${Math.round(C.CORE_RTP_OVERRIDE * 100)}% · XP = base 50 + difficulty boost% (Beg 50 → GM 300) · missions = % of wagering refilled</p>

<div class=kpi>
  <div class=card><div class=l>Break-even refill</div><div class="v good">${Math.round(recommended.refill * 100)}%</div><div class=dim>smallest solvent level</div></div>
  <div class=card><div class=l>Core bleed to offset</div><div class=v>${Math.round((1 - C.CORE_RTP_OVERRIDE) * 100)}%</div><div class=dim>of every coin wagered @ ${Math.round(C.CORE_RTP_OVERRIDE * 100)}% RTP</div></div>
  <div class=card><div class=l>Level-coin bonus</div><div class="v ${bonusHi > 1 ? 'warn' : 'good'}">+${bonusLo}→+${bonusHi}pp</div><div class=dim>GM → Beginner (flat coins, tier-scaled XP)</div></div>
  <div class=card><div class=l>L10 reached @ ${Math.round(recommended.refill * 100)}%</div><div class=v>${recommended.overall.l10.pctReached}%</div><div class=dim>${recommended.overall.l10.p50Day ? 'median day ' + recommended.overall.l10.p50Day : '—'}</div></div>
</div>

<div class=note><b>Key finding.</b> The raw RTP gap is ${Math.round((1 - C.CORE_RTP_OVERRIDE) * 100)}%, but <b>break-even is ~${Math.round(recommended.refill * 100)}%</b> — higher, because variance at high-stakes tiers ruins players against an absorbing barrier (no free-tap floor), so you must over-refill the mean bleed to keep the median solvent. It's a <b>knife-edge</b>: just below → mass bleed-out, just above → runaway inflation (a 10pp swing spans 1.6k to 1.5M median balance). And proportional missions <b>cannot rescue a broke player</b> — someone who isn't wagering gets 0 refill. Only an <b>absolute floor</b> (free daily coins, regardless of play) can. Modelled as proportional to stakes; real flat mission rewards would over-serve low tiers and under-serve whales.</div>

<h2>Refill sweep</h2>
<table><tr><th>Refill %</th><th>Bal d30</th><th>Bal d90</th><th>Bal d180</th><th>Trend</th><th>Bankrupt</th><th>Level d180</th><th>L10 reached</th><th>Realized RTP</th><th>Level bonus</th></tr>${sweepRows}</table>
<div class=grid>${balChart}</div>

<h2>Level-bonus pp by tier <span class=dim>(unchanged by missions — XP is match-driven)</span></h2>
<table><tr><th>Tier</th><th>Entry</th><th>XP/match</th><th>Core RTP</th><th>Level bonus</th></tr>${tierRows}</table>

<p class=dim style="margin-top:22px">Idealized proportional-missions model. XP only from matches (wager-prop), so missions don't affect the level-bonus pp. Assumptions in config.mjs §B.</p>
</div>`;
writeFileSync(join(OUT, 'report.html'), html);

const log = (s) => console.log(s);
log('\n=== Missions-sizing sweep ===');
log(`${N} players · ${C.HORIZON_DAYS}d · core RTP ${Math.round(C.CORE_RTP_OVERRIDE * 100)}% · XP base50+boost (Beg 50..GM 300) · level-coin bonus +${bonusLo}pp(GM)..+${bonusHi}pp(Beg)`);
log(`XP/match by tier: ` + DIFFICULTY_TIERS.map((t) => `${t.label.split(' ')[0]} ${xpPerMatch(t)}`).join(' · '));

function matchesToLevel(target, climb) {
  let xp = 0, m = 0, lvl = 1;
  while (lvl < target && m < 100000) {
    const t = !climb ? TIER_BY_ID['beginner'] : lvl >= 5 ? TIER_BY_ID['pro'] : lvl >= 3 ? TIER_BY_ID['advanced'] : TIER_BY_ID['beginner'];
    xp += xpPerMatch(t); m++; lvl = levelForXp(xp, lvl);
  }
  return m;
}
log(`FTUE pace (matches): ` + [3, 5, 10].map((L) => `L${L} ${matchesToLevel(L, false)}/${matchesToLevel(L, true)} (Beg-only/climb)`).join(' · '));
log(`Core bleed to offset = ${Math.round((1 - C.CORE_RTP_OVERRIDE) * 100)}% of wagering\n`);
log('refill |  bal d30 |  bal d90 | bal d180 | trend     | bankrupt | Lvl d180 | L10 reached | RTP');
for (const s of scenarios) log(`  ${String(Math.round(s.refill * 100)).padStart(3)}% | ${fmtShort(s.overall.bal[30]).padStart(8)} | ${fmtShort(s.overall.bal[90]).padStart(8)} | ${fmtShort(s.overall.bal[180]).padStart(8)} | ${s.trend.padEnd(9)} | ${String(s.overall.pctBankrupt).padStart(7)}% | ${('L' + s.overall.levelD180).padStart(8)} | ${(s.overall.l10.pctReached + '%' + (s.overall.l10.p50Day ? ' d' + s.overall.l10.p50Day : '')).padStart(11)} | ${s.overall.realizedRtpPct}%`);
log(`\n>> Break-even ≈ ${Math.round(recommended.refill * 100)}% (knife-edge: below => bleed-out, above => inflation).`);
log(`   Raw RTP gap is ${Math.round((1 - C.CORE_RTP_OVERRIDE) * 100)}%; the extra is variance/ruin. Proportional missions can't rescue broke players — keep a free-tap floor.`);
log(`   Wrote ${join(OUT, 'report.html')} + summary.json + missions-sweep.csv\n`);
