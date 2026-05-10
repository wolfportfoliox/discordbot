import axios from 'axios';
import { EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Parser from 'rss-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const alertsFile          = path.join(__dirname, '..', 'data', 'marketAlerts.json');
const seenNewsFile        = path.join(__dirname, '..', 'data', 'seenNews.json');
const recentPerformers    = path.join(__dirname, '..', 'data', 'recentPerformers.json');
const bullishVotesFile    = path.join(__dirname, '..', 'data', 'bullishVotes.json');

const rssParser = new Parser();

// ─── Intervals ────────────────────────────────────────────────────────────────
const MARKET_INTERVAL    = Math.floor((60 / 7) * 60 * 1000); // 7x/hour  = ~8m 34s
const PERFORMER_INTERVAL = 6 * 60 * 1000;                    // 10x/hour = 6 min
const NEWS_INTERVAL      = Math.floor((60 / 8) * 60 * 1000); // 8x/hour  = ~7m 30s
const ALERT_CHECK        = 60 * 1000;                         // every 1 min
const PERFORMER_COOLDOWN = 3 * 60 * 60 * 1000;               // same coin can't repeat for 3h
const VOTE_TTL           = 24 * 60 * 60 * 1000;              // votes expire after 24h

// ─── Keywords for news filtering ──────────────────────────────────────────────
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

const STABLECOINS = [
  'tether','usd-coin','dai','binance-usd','true-usd','first-digital-usd',
  'usdd','frax','usdc','busd','tusd','pax-dollar','gemini-dollar',
];

// ─── Coin rotation state (in-memory, resets on restart — that's fine) ─────────
let rotationIndex = 0;

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
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch {}
}

function isRelevant(title = '', desc = '') {
  const text = (title + ' ' + desc).toLowerCase();
  return NEWS_KEYWORDS.some(kw => text.includes(kw));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Retry with exponential backoff — retries up to `attempts` times.
 * Waits 3s, 6s, 12s between retries.
 */
async function withRetry(fn, attempts = 4, label = '') {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = i === attempts - 1;
      const status = err?.response?.status ?? '';
      console.error(
        `[${label}] attempt ${i + 1}/${attempts} failed${status ? ` (HTTP ${status})` : ''}: ${err.message}` +
        (isLast ? ' — giving up this cycle' : ' — retrying...')
      );
      if (!isLast) await sleep(3000 * Math.pow(2, i));
    }
  }
  return null;
}

/**
 * Sequential scheduler — each run must fully complete before the next is scheduled.
 * Eliminates overlapping API calls that cause rate-limit failures.
 */
function scheduleLoop(label, fn, intervalMs) {
  const loop = async () => {
    try { await fn(); } catch (e) { console.error(`[${label}] unhandled error:`, e.message); }
    setTimeout(loop, intervalMs);
  };
  return loop;
}

// ─── Market scheduler: rotating top 7 ────────────────────────────────────────
export function marketScheduler(client) {
  const run = async () => {
    const channel = await fetchChannel(client, process.env.MARKET_CHANNEL_ID, 'MARKET_CHANNEL_ID');
    if (!channel) return;

    const pool = await withRetry(() => getTopCoinPool(50), 4, 'market');
    if (!pool?.length) { console.error('[market] No coin pool returned'); return; }

    // Always include coins[0] (BTC) and coins[1] (ETH) — they're the anchors.
    // Pick 5 more from the rest of the pool in a rotating fashion so each update
    // shows different coins from the top 50.
    const anchors = pool.slice(0, 2);
    const rest    = pool.slice(2);

    // Rotate in windows of 5 across the remaining pool
    const poolSize = rest.length;
    const start    = (rotationIndex * 5) % poolSize;
    const rotating = [];
    for (let i = 0; i < 5; i++) {
      rotating.push(rest[(start + i) % poolSize]);
    }
    rotationIndex++;

    const coins = [...anchors, ...rotating];

    const header  = `${'No.'.padEnd(4)} ${'Coin'.padEnd(18)} ${'Price'.padStart(14)} ${'24h'.padStart(8)} ${'MCap'.padStart(9)}`;
    const divider = '─'.repeat(header.length);
    const rows = coins.map((c, i) => {
      const num    = `${i + 1}.`.padEnd(4);
      const name   = `${c.name} (${c.symbol.toUpperCase()})`.padEnd(18).slice(0, 18);
      const price  = `$${Number(c.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.padStart(14);
      const chg    = parseFloat(c.change24h);
      const sign   = chg >= 0 ? '+' : '';
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
    console.log(`[market] Sent rotating top 7 (window offset ${rotationIndex - 1})`);
  };

  scheduleLoop('market', run, MARKET_INTERVAL)();
}

// ─── Best performer scheduler ─────────────────────────────────────────────────
// Rules:
//  - Only coins with 3–14% 24h gain (building momentum, not already peaked)
//  - Must have positive 1h change (still moving up now)
//  - Min $200M market cap
//  - Same coin cannot repost within 3 hours
//  - User bullish votes boost a coin's priority score
export function topPerformerScheduler(client) {
  const run = async () => {
    const channel = await fetchChannel(client, process.env.MARKET_CHANNEL_ID, 'MARKET_CHANNEL_ID');
    if (!channel) return;

    const coin = await withRetry(getSmartPerformer, 4, 'performer');
    if (!coin) { console.error('[performer] No qualifying coin found this cycle'); return; }

    // Mark as recently posted
    const recent = readJson(recentPerformers, []);
    recent.push({ id: coin.id, postedAt: Date.now() });
    writeJson(recentPerformers, recent);

    const chg24 = parseFloat(coin.change24h);
    const chg1h = parseFloat(coin.change1h);
    const sign24 = chg24 >= 0 ? '+' : '';
    const sign1h = chg1h >= 0 ? '+' : '';

    const trend =
      coin.userVoted     ? 'Community Bullish Pick' :
      chg1h >= 2         ? 'Strong Momentum'        :
      chg1h >= 0.5       ? 'Bullish'                :
      chg24 >= 8         ? 'Recovering Well'        : 'Building Momentum';

    const msg =
      `# Apex Performer Spotlight\n` +
      `**${trend}** — coin showing real upside potential right now.\n\n` +
      `\`\`\`\n` +
      `${'─'.repeat(40)}\n` +
      ` Coin     : ${coin.name} (${coin.symbol.toUpperCase()})\n` +
      ` Price    : $${Number(coin.price).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n` +
      ` 24h      : ${sign24}${coin.change24h}%\n` +
      ` 1h       : ${sign1h}${coin.change1h}%\n` +
      ` MCap     : $${coin.marketCap}\n` +
      ` Volume   : $${coin.volume}\n` +
      ` Rank     : #${coin.rank}\n` +
      `${'─'.repeat(40)}\n` +
      `\`\`\`\n` +
      `${coin.userVoted ? `Community voted this coin bullish today.\n` : ''}` +
      `**DYOR — not financial advice.**`;

    await channel.send(msg);
    console.log(`[performer] Sent: ${coin.name} (${sign24}${coin.change24h}% 24h, ${sign1h}${coin.change1h}% 1h) | voted=${coin.userVoted}`);
  };

  // Start 90s after bot loads to avoid simultaneous API burst
  setTimeout(() => scheduleLoop('performer', run, PERFORMER_INTERVAL)(), 90_000);
}

// ─── News scheduler ───────────────────────────────────────────────────────────
export function newsScheduler(client) {
  const run = async () => {
    const channel = await fetchChannel(client, process.env.NEWS_CHANNEL_ID, 'NEWS_CHANNEL_ID');
    if (!channel) return;

    const articles = await withRetry(getLatestNews, 4, 'news');
    if (!articles?.length) { console.error('[news] No articles returned'); return; }

    const seen       = readJson(seenNewsFile, []);
    const candidates = articles.filter(a => !seen.includes(a.guid) && isRelevant(a.title, a.description));

    if (!candidates.length) { console.log('[news] No new relevant articles this cycle'); return; }

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
    console.log(`[news] Posted: ${article.title.slice(0, 70)}`);
  };

  // Stagger 30s after bot loads
  setTimeout(() => scheduleLoop('news', run, NEWS_INTERVAL)(), 30_000);
}

// ─── Price alert checker ──────────────────────────────────────────────────────
export function checkPriceAlerts(client) {
  const run = async () => {
    ensureDataDir();
    if (!fs.existsSync(alertsFile)) return;

    const alerts = readJson(alertsFile, []);
    if (!alerts.length) return;

    const coins  = [...new Set(alerts.map(a => a.coin))];
    const prices = await withRetry(() => getCurrentPrices(coins), 3, 'alerts') ?? {};

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
      } catch (e) {
        console.error('[alerts] Failed to notify:', e.message);
      }
    }

    if (triggered.length) writeJson(alertsFile, remaining);
  };

  setTimeout(() => {
    run();
    setInterval(run, ALERT_CHECK);
  }, 15_000);
}

// ─── API & data helpers ───────────────────────────────────────────────────────

async function fetchChannel(client, id, label) {
  if (!id) { console.error(`[scheduler] ${label} env var not set`); return null; }
  try { return await client.channels.fetch(id); }
  catch (e) { console.error(`[scheduler] Cannot fetch ${label} (${id}):`, e.message); return null; }
}

/**
 * Fetch top N coins by market cap for the rotation pool.
 */
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

/**
 * Smart performer selection:
 * - 3–14% 24h gain (momentum building, not already peaked/pumped)
 * - Positive 1h change (actively moving up)
 * - Not repeated within 3 hours
 * - User bullish votes get a priority boost
 */
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

  const now   = Date.now();
  const recent = readJson(recentPerformers, [])
    .filter(r => now - r.postedAt < PERFORMER_COOLDOWN);
  writeJson(recentPerformers, recent);
  const recentIds = new Set(recent.map(r => r.id));

  // Active user bullish votes (not expired)
  const votes     = readJson(bullishVotesFile, []).filter(v => now - v.ts < VOTE_TTL);
  const voteSet   = new Set(votes.map(v => v.coinId));

  const candidates = res.data.filter(c => {
    const chg24 = c.price_change_percentage_24h ?? 0;
    const chg1h = c.price_change_percentage_1h_in_currency ?? 0;
    return (
      !STABLECOINS.includes(c.id)          &&  // not a stablecoin
      c.market_cap > 200_000_000            &&  // min $200M market cap
      chg24 >= 3 && chg24 <= 14             &&  // building momentum, NOT already peaked
      chg1h > 0                             &&  // actively moving up right now
      !recentIds.has(c.id)                      // not posted in last 3 hours
    );
  });

  if (!candidates.length) return null;

  // Score: 1h change matters most (current momentum), 24h change secondary, votes boost
  candidates.sort((a, b) => {
    const scoreA = (a.price_change_percentage_1h_in_currency ?? 0) * 2 +
                   (a.price_change_percentage_24h ?? 0) +
                   (voteSet.has(a.id) ? 20 : 0);
    const scoreB = (b.price_change_percentage_1h_in_currency ?? 0) * 2 +
                   (b.price_change_percentage_24h ?? 0) +
                   (voteSet.has(b.id) ? 20 : 0);
    return scoreB - scoreA;
  });

  const c = candidates[0];
  return {
    id: c.id,
    name: c.name,
    symbol: c.symbol,
    price: c.current_price,
    change24h: c.price_change_percentage_24h?.toFixed(2)                 ?? '0.00',
    change1h:  c.price_change_percentage_1h_in_currency?.toFixed(2)      ?? '0.00',
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
        if (item.enclosure?.url)              image = item.enclosure.url;
        else if (item['media:content']?.$?.url) image = item['media:content'].$.url;

        const rawDesc   = item.contentSnippet || item.description || '';
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
      console.error(`[news] Feed error (${feed.source}):`, e.message);
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
