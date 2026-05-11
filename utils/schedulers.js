import axios from 'axios';
import { EmbedBuilder } from 'discord.js';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Parser from 'rss-parser';
import { log } from './logger.js';

const __dirname        = path.dirname(fileURLToPath(import.meta.url));
const alertsFile       = path.join(__dirname, '..', 'data', 'marketAlerts.json');
const seenNewsFile     = path.join(__dirname, '..', 'data', 'seenNews.json');
const recentPerfFile   = path.join(__dirname, '..', 'data', 'recentPerformers.json');
const bullishVotesFile = path.join(__dirname, '..', 'data', 'bullishVotes.json');

const rssParser = new Parser();

// ─── Config ───────────────────────────────────────────────────────────────────
const PERFORMER_COOLDOWN = 3 * 60 * 60 * 1000;  // same coin blocked for 3h
const VOTE_TTL           = 24 * 60 * 60 * 1000;  // bullish votes expire after 24h
const MAX_API_RETRIES    = 4;
const BASE_RETRY_DELAY   = 3000;                  // 3s → 6s → 12s → 24s

const STABLECOINS = [
  'tether','usd-coin','dai','binance-usd','true-usd','first-digital-usd',
  'usdd','frax','usdc','busd','tusd','pax-dollar','gemini-dollar',
];

const NEWS_KEYWORDS = [
  'bitcoin','ethereum','crypto','blockchain','defi','altcoin','nft','stablecoin',
  'binance','coinbase','solana','ripple','xrp','btc','eth','token','web3',
  'stock','nasdaq','dow jones','s&p','nyse','shares','equity','ipo','earnings',
  'wall street','federal reserve','fed rate','interest rate','bond','yield',
  'forex','currency','dollar','euro','yen','pound','exchange rate','usd','eur',
  'inflation','recession','gdp','economy','economic','tariff','trade war',
  'central bank','imf','world bank','debt','deficit','monetary',
  'war','conflict','military','sanctions','attack','strike','ceasefire',
  'invasion','missile','nato','ukraine','russia','iran','israel','china',
  'geopolit','nuclear','troops','blockade',
  'earthquake','tsunami','hurricane','flood','wildfire','disaster','pandemic',
  'outbreak','crisis','collapse','bankruptcy','default','crash',
];

// Coin rotation counter — in-memory, resets on restart (fine, just shifts the window)
let rotationIndex = 0;

// ─── Run-lock flags — prevents cron overlap if a job takes longer than its interval ──
const running = { market: false, performer: false, news: false, alerts: false };

// ─── File helpers ─────────────────────────────────────────────────────────────
function ensureDataDir() {
  const dir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  ensureDataDir();
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  ensureDataDir();
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) {
    log.error(`writeJson failed for ${path.basename(file)}: ${e.message}`, 'fs');
  }
}

function isRelevant(title = '', desc = '') {
  const text = (title + ' ' + desc).toLowerCase();
  return NEWS_KEYWORDS.some(kw => text.includes(kw));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Retry with exponential backoff.
 * Respects HTTP 429 Retry-After header from CoinGecko.
 */
async function withRetry(fn, label) {
  for (let i = 0; i < MAX_API_RETRIES; i++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = i === MAX_API_RETRIES - 1;
      const status = err?.response?.status;
      const retryAfter = status === 429
        ? (parseInt(err.response.headers?.['retry-after'] ?? '60', 10) * 1000)
        : BASE_RETRY_DELAY * Math.pow(2, i);

      log.warn(
        `Attempt ${i + 1}/${MAX_API_RETRIES} failed${status ? ` (HTTP ${status})` : ''}: ${err.message}` +
        (isLast ? ' — skipping this cycle' : ` — waiting ${retryAfter / 1000}s`),
        label
      );
      if (!isLast) await sleep(retryAfter);
    }
  }
  return null;
}

/**
 * Wraps a scheduler function with a run-lock.
 * If the previous cron tick is still running, this tick is skipped and logged.
 */
function withLock(key, fn) {
  return async () => {
    if (running[key]) {
      log.warn('Previous run still active — skipping this tick', key);
      return;
    }
    running[key] = true;
    try { await fn(); }
    catch (e) { log.error(`Unhandled error in scheduler: ${e.message}`, key); }
    finally { running[key] = false; }
  };
}

// ─── Public scheduler initializers ───────────────────────────────────────────

/**
 * Market update: 7x per hour (every 8 minutes via cron).
 * Shows rotating top 7 from the top 50 coins — always BTC/ETH + 5 rotating.
 */
export function marketScheduler(client) {
  const run = async () => {
    const channel = await fetchChannel(client, process.env.MARKET_CHANNEL_ID, 'MARKET_CHANNEL_ID');
    if (!channel) return;

    const pool = await withRetry(() => getTopCoinPool(50), 'market');
    if (!pool?.length) { log.error('No coin pool returned', 'market'); return; }

    const anchors  = pool.slice(0, 2);
    const rest     = pool.slice(2);
    const poolSize = rest.length;
    const start    = (rotationIndex * 5) % poolSize;
    const rotating = Array.from({ length: 5 }, (_, i) => rest[(start + i) % poolSize]);
    rotationIndex++;

    const coins = [...anchors, ...rotating];

    const header  = `${'No.'.padEnd(4)} ${'Coin'.padEnd(18)} ${'Price'.padStart(14)} ${'24h'.padStart(8)} ${'MCap'.padStart(9)}`;
    const divider = '─'.repeat(header.length);
    const rows = coins.map((c, i) => {
      const num    = `${i + 1}.`.padEnd(4);
      const name   = `${c.name} (${c.symbol.toUpperCase()})`.padEnd(18).slice(0, 18);
      const price  = `$${Number(c.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.padStart(14);
      const sign   = parseFloat(c.change24h) >= 0 ? '+' : '';
      const change = `${sign}${c.change24h}%`.padStart(8);
      const mcap   = `$${c.marketCap}`.padStart(9);
      return `${num} ${name} ${price} ${change} ${mcap}`;
    }).join('\n');

    const msg =
      `# Apex Market Update\n` +
      `Live market prices — rotating spotlight on top 50 coins.\n\n` +
      `\`\`\`\n${header}\n${divider}\n${rows}\n\`\`\`\n` +
      `**Use /price <coin> for detailed info · /marketalert to set price alerts**`;

    await channel.send(msg);
    log.sched(`Sent rotating top 7 (window ${rotationIndex - 1})`, 'market');
  };

  // Cron: every 8 minutes — 7.5x/hour ≈ 7x/hour target
  cron.schedule('*/8 * * * *', withLock('market', run), { timezone: 'UTC' });

  // Also fire immediately on startup so the channel gets an update right away
  withLock('market', run)();
  log.info('Market scheduler started (cron: every 8 min)', 'market');
}

/**
 * Best performer spotlight: 10x per hour (every 6 minutes via cron).
 * Selects coins with genuine building momentum — not already-peaked coins.
 * Community bullish votes boost coin priority.
 */
export function topPerformerScheduler(client) {
  const run = async () => {
    const channel = await fetchChannel(client, process.env.MARKET_CHANNEL_ID, 'MARKET_CHANNEL_ID');
    if (!channel) return;

    const coin = await withRetry(getSmartPerformer, 'performer');
    if (!coin) { log.warn('No qualifying coin found this cycle', 'performer'); return; }

    // Track recently posted coins
    const recent = readJson(recentPerfFile, []);
    recent.push({ id: coin.id, postedAt: Date.now() });
    writeJson(recentPerfFile, recent);

    const chg24  = parseFloat(coin.change24h);
    const chg1h  = parseFloat(coin.change1h);
    const s24    = chg24 >= 0 ? '+' : '';
    const s1h    = chg1h >= 0 ? '+' : '';

    const trend  =
      coin.userVoted ? 'Community Bullish Pick'  :
      chg1h >= 2     ? 'Strong Momentum'          :
      chg1h >= 0.5   ? 'Bullish'                  :
      chg24 >= 8     ? 'Recovering Well'          : 'Building Momentum';

    const msg =
      `# Apex Performer Spotlight\n` +
      `**${trend}** — coin showing real upside potential right now.\n\n` +
      `\`\`\`\n` +
      `${'─'.repeat(40)}\n` +
      ` Coin     : ${coin.name} (${coin.symbol.toUpperCase()})\n` +
      ` Price    : $${Number(coin.price).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n` +
      ` 24h      : ${s24}${coin.change24h}%\n` +
      ` 1h       : ${s1h}${coin.change1h}%\n` +
      ` MCap     : $${coin.marketCap}\n` +
      ` Volume   : $${coin.volume}\n` +
      ` Rank     : #${coin.rank}\n` +
      `${'─'.repeat(40)}\n` +
      `\`\`\`\n` +
      `${coin.userVoted ? `Community voted this coin bullish today.\n` : ''}` +
      `**DYOR — not financial advice.**`;

    await channel.send(msg);
    log.sched(`Sent: ${coin.name} (${s24}${coin.change24h}% 24h, ${s1h}${coin.change1h}% 1h) voted=${coin.userVoted}`, 'performer');
  };

  // Cron: every 6 minutes — exactly 10x/hour
  cron.schedule('*/6 * * * *', withLock('performer', run), { timezone: 'UTC' });

  // Stagger first run by 90s so it doesn't collide with market on startup
  setTimeout(() => withLock('performer', run)(), 90_000);
  log.info('Performer scheduler started (cron: every 6 min)', 'performer');
}

/**
 * News: ~8x per hour (every 7 minutes via cron).
 * Fetches 6 RSS feeds in parallel, deduplicates by GUID, keyword-filters.
 */
export function newsScheduler(client) {
  const run = async () => {
    const channel = await fetchChannel(client, process.env.NEWS_CHANNEL_ID, 'NEWS_CHANNEL_ID');
    if (!channel) return;

    const articles = await withRetry(getLatestNews, 'news');
    if (!articles?.length) { log.error('No articles returned from any feed', 'news'); return; }

    const seen       = readJson(seenNewsFile, []);
    const candidates = articles.filter(a => !seen.includes(a.guid) && isRelevant(a.title, a.description));

    if (!candidates.length) { log.info('No new relevant articles this cycle', 'news'); return; }

    const article = candidates[0];

    const embed = new EmbedBuilder()
      .setColor('#e8b400')
      .setTitle(article.title.slice(0, 256))
      .setURL(article.url)
      .setAuthor({ name: article.source })
      .setTimestamp(new Date(article.pubDate));

    if (article.description) embed.setDescription(article.description.slice(0, 400));
    if (article.image)       embed.setImage(article.image);

    await channel.send({ embeds: [embed] });

    seen.push(article.guid);
    writeJson(seenNewsFile, seen.slice(-500));
    log.sched(`Posted: ${article.title.slice(0, 80)}`, 'news');
  };

  // Cron: every 7 minutes — 8.5x/hour
  cron.schedule('*/7 * * * *', withLock('news', run), { timezone: 'UTC' });

  // Stagger first run by 30s
  setTimeout(() => withLock('news', run)(), 30_000);
  log.info('News scheduler started (cron: every 7 min)', 'news');
}

/**
 * Price alert checker: runs every minute.
 */
export function checkPriceAlerts(client) {
  const run = async () => {
    ensureDataDir();
    if (!fs.existsSync(alertsFile)) return;

    const alerts = readJson(alertsFile, []);
    if (!alerts.length) return;

    const coins  = [...new Set(alerts.map(a => a.coin))];
    const prices = await withRetry(() => getCurrentPrices(coins), 'alerts') ?? {};

    const triggered = [];
    const remaining = [];

    for (const alert of alerts) {
      const cur = prices[alert.coin];
      if (cur == null) { remaining.push(alert); continue; }
      const hit = (alert.type === 'above' && cur >= alert.price) ||
                  (alert.type === 'below' && cur <= alert.price);
      if (hit) triggered.push({ ...alert, currentPrice: cur });
      else      remaining.push(alert);
    }

    for (const alert of triggered) {
      try {
        const ch = await client.channels.fetch(alert.channelId);
        const embed = new EmbedBuilder()
          .setColor('#f1c40f')
          .setTitle('Price Alert Triggered')
          .setDescription(
            `<@${alert.userId}> **${alert.coin.toUpperCase()}** is now **$${alert.currentPrice.toLocaleString()}**\n` +
            `Your alert: price goes ${alert.type} **$${alert.price.toLocaleString()}**`
          )
          .setTimestamp();
        await ch.send({ embeds: [embed] });
        log.info(`Triggered alert for ${alert.coin} (${alert.userId})`, 'alerts');
      } catch (e) {
        log.error(`Failed to notify alert: ${e.message}`, 'alerts');
      }
    }

    if (triggered.length) writeJson(alertsFile, remaining);
  };

  // Cron: every minute
  cron.schedule('* * * * *', withLock('alerts', run), { timezone: 'UTC' });
  log.info('Price alert checker started (cron: every 1 min)', 'alerts');
}

// ─── Discord channel fetch ────────────────────────────────────────────────────
async function fetchChannel(client, id, label) {
  if (!id) { log.error(`${label} environment variable not set`, 'scheduler'); return null; }
  try { return await client.channels.fetch(id); }
  catch (e) { log.error(`Cannot fetch ${label} (${id}): ${e.message}`, 'scheduler'); return null; }
}

// ─── CoinGecko API calls ──────────────────────────────────────────────────────

async function getTopCoinPool(count = 50) {
  const res = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
    params: {
      vs_currency: 'usd',
      order: 'market_cap_desc',
      per_page: count,
      page: 1,
      sparkline: false,
      price_change_percentage: '24h',
    },
    headers: { Accept: 'application/json' },
    timeout: 14000,
  });
  return res.data
    .filter(c => !STABLECOINS.includes(c.id))
    .map(c => ({
      id: c.id,
      name: c.name,
      symbol: c.symbol,
      price: c.current_price,
      change24h: c.price_change_percentage_24h?.toFixed(2) ?? '0.00',
      marketCap: formatCap(c.market_cap),
    }));
}

async function getSmartPerformer() {
  const res = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
    params: {
      vs_currency: 'usd',
      order: 'market_cap_desc',
      per_page: 200,
      page: 1,
      sparkline: false,
      price_change_percentage: '1h,24h',
    },
    headers: { Accept: 'application/json' },
    timeout: 14000,
  });

  const now      = Date.now();
  const recent   = readJson(recentPerfFile, []).filter(r => now - r.postedAt < PERFORMER_COOLDOWN);
  writeJson(recentPerfFile, recent);
  const recentIds = new Set(recent.map(r => r.id));

  const votes    = readJson(bullishVotesFile, []).filter(v => now - v.ts < VOTE_TTL);
  const voteSet  = new Set(votes.map(v => v.coinId));

  const candidates = res.data.filter(c => {
    const chg24 = c.price_change_percentage_24h ?? 0;
    const chg1h = c.price_change_percentage_1h_in_currency ?? 0;
    return (
      !STABLECOINS.includes(c.id) &&
      c.market_cap > 200_000_000  &&
      chg24 >= 3 && chg24 <= 14  &&
      chg1h > 0                   &&
      !recentIds.has(c.id)
    );
  });

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const score = c =>
      (c.price_change_percentage_1h_in_currency ?? 0) * 2 +
      (c.price_change_percentage_24h ?? 0) +
      (voteSet.has(c.id) ? 20 : 0);
    return score(b) - score(a);
  });

  const c = candidates[0];
  return {
    id: c.id, name: c.name, symbol: c.symbol,
    price:     c.current_price,
    change24h: c.price_change_percentage_24h?.toFixed(2) ?? '0.00',
    change1h:  c.price_change_percentage_1h_in_currency?.toFixed(2) ?? '0.00',
    marketCap: formatCap(c.market_cap),
    volume:    formatVol(c.total_volume),
    rank:      c.market_cap_rank,
    userVoted: voteSet.has(c.id),
  };
}

async function getCurrentPrices(coins) {
  const res = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
    params: { ids: coins.join(','), vs_currencies: 'usd' },
    timeout: 12000,
  });
  const out = {};
  for (const [id, data] of Object.entries(res.data)) out[id] = data.usd;
  return out;
}

async function getLatestNews() {
  const feeds = [
    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',       source: 'BBC World'     },
    { url: 'https://feeds.bbci.co.uk/news/business/rss.xml',    source: 'BBC Business'  },
    { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362', source: 'CNBC' },
    { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664',  source: 'CNBC Markets' },
    { url: 'https://feeds.feedburner.com/CoinDesk',              source: 'CoinDesk'      },
    { url: 'https://cointelegraph.com/rss',                      source: 'CoinTelegraph' },
  ];

  const articles = [];
  await Promise.allSettled(feeds.map(async feed => {
    try {
      const parsed = await rssParser.parseURL(feed.url);
      for (const item of parsed.items.slice(0, 10)) {
        let image = null;
        if (item.enclosure?.url)               image = item.enclosure.url;
        else if (item['media:content']?.$?.url) image = item['media:content'].$.url;
        const rawDesc    = item.contentSnippet || item.description || '';
        const description = rawDesc.replace(/<[^>]*>/g, '').trim().slice(0, 400);
        articles.push({
          guid: item.guid || item.link,
          title: item.title?.trim() || 'Untitled',
          description: description || null,
          url: item.link,
          image,
          source: feed.source,
          pubDate: item.pubDate || new Date().toISOString(),
        });
      }
    } catch (e) {
      log.warn(`Feed error (${feed.source}): ${e.message}`, 'news');
    }
  }));

  articles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return articles;
}

// ─── Formatting ───────────────────────────────────────────────────────────────
function formatCap(n) {
  if (!n) return 'N/A';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return (n / 1e9).toFixed(2)  + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(0)  + 'M';
  return n.toLocaleString();
}

function formatVol(n) {
  if (!n) return 'N/A';
  if (n >= 1e9)  return (n / 1e9).toFixed(2)  + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(0)  + 'M';
  if (n >= 1e3)  return (n / 1e3).toFixed(0)  + 'K';
  return n.toLocaleString();
}
