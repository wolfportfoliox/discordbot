import axios from 'axios';
import { EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Parser from 'rss-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const alertsFile       = path.join(__dirname, '..', 'data', 'marketAlerts.json');
const seenNewsFile     = path.join(__dirname, '..', 'data', 'seenNews.json');

const rssParser = new Parser();

// ─── Intervals ────────────────────────────────────────────────────────────────
const MARKET_INTERVAL     = Math.floor((60 / 7)  * 60 * 1000); // 7x/hour  = ~8m 34s
const PERFORMER_INTERVAL  = 6 * 60 * 1000;                      // 10x/hour = 6 min
const NEWS_INTERVAL       = Math.floor((60 / 8)  * 60 * 1000); // 8x/hour  = ~7m 30s
const ALERT_CHECK         = 60 * 1000;                          // every 1 min

// ─── Topic keywords for news filtering ────────────────────────────────────────
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

const STABLECOINS = ['tether','usd-coin','dai','binance-usd','true-usd','first-digital-usd','usdd','frax'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function isRelevant(title = '', desc = '') {
  const text = (title + ' ' + desc).toLowerCase();
  return NEWS_KEYWORDS.some(kw => text.includes(kw));
}

/**
 * Retry wrapper — retries up to `attempts` times on failure.
 * Waits 2s, 4s, 8s between retries (exponential backoff).
 */
async function withRetry(fn, attempts = 3, label = '') {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = i === attempts - 1;
      console.error(`[${label}] attempt ${i + 1} failed: ${err.message}${isLast ? ' — giving up' : ' — retrying...'}`);
      if (!isLast) await sleep(2000 * Math.pow(2, i));
    }
  }
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Sequential scheduler — waits for each run to complete before scheduling next.
 * Prevents overlapping API calls and rate-limit issues.
 */
function scheduleLoop(label, fn, intervalMs) {
  const loop = async () => {
    try { await fn(); } catch (e) { console.error(`[${label}] unhandled:`, e.message); }
    setTimeout(loop, intervalMs);
  };
  // Stagger initial runs to avoid hitting API all at once
  return loop;
}

// ─── Public schedulers ────────────────────────────────────────────────────────

export function marketScheduler(client) {
  const run = async () => {
    const channel = await fetchChannel(client, process.env.MARKET_CHANNEL_ID, 'MARKET_CHANNEL_ID');
    if (!channel) return;

    const coins = await withRetry(() => getTopCoins(7), 3, 'market');
    if (!coins?.length) { console.error('[market] No coins returned'); return; }

    const header   = `${'No.'.padEnd(4)} ${'Coin Name'.padEnd(20)} ${'Price'.padStart(14)} ${'Change'.padStart(9)} ${'MCap'.padStart(9)}`;
    const divider  = '─'.repeat(header.length);
    const rows = coins.map((c, i) => {
      const num    = `${i + 1}.`.padEnd(4);
      const name   = `${c.name} (${c.symbol.toUpperCase()})`.padEnd(20).slice(0, 20);
      const price  = `$${Number(c.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.padStart(14);
      const sign   = parseFloat(c.change24h) >= 0 ? '+' : '';
      const change = `${sign}${c.change24h}%`.padStart(9);
      const mcap   = `$${c.marketCap}`.padStart(9);
      return `${num} ${name} ${price} ${change} ${mcap}`;
    }).join('\n');

    const msg =
      `# Apex Market Update\n` +
      `Check Live Market price coin and also set alert.\n\n` +
      `\`\`\`\n${header}\n${divider}\n${rows}\n\`\`\`\n` +
      `**Thanks for Visiting the Market channel, you can get more Market Updates here!**`;

    await channel.send(msg);
    console.log('[market] Sent top 7 update');
  };

  scheduleLoop('market', run, MARKET_INTERVAL)();
}

export function topPerformerScheduler(client) {
  const run = async () => {
    const channel = await fetchChannel(client, process.env.MARKET_CHANNEL_ID, 'MARKET_CHANNEL_ID');
    if (!channel) return;

    const coin = await withRetry(getBestPerformer, 3, 'performer');
    if (!coin) { console.error('[performer] No qualifying coin found'); return; }

    const sign    = parseFloat(coin.change24h) >= 0 ? '+' : '';
    const trend   = parseFloat(coin.change24h) >= 15 ? 'Strong Bullish' :
                    parseFloat(coin.change24h) >= 8  ? 'Bullish'        :
                    parseFloat(coin.change24h) >= 3  ? 'Recovering'     : 'Building Momentum';

    const msg =
      `# Apex Best Performer\n` +
      `Top moving coin right now — ${trend} signal.\n\n` +
      `\`\`\`\n` +
      `${'─'.repeat(38)}\n` +
      ` Coin    : ${coin.name} (${coin.symbol.toUpperCase()})\n` +
      ` Price   : $${Number(coin.price).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n` +
      ` 24h     : ${sign}${coin.change24h}%\n` +
      ` 1h      : ${coin.change1h >= 0 ? '+' : ''}${coin.change1h}%\n` +
      ` MCap    : $${coin.marketCap}\n` +
      ` Volume  : $${coin.volume}\n` +
      ` Rank    : #${coin.rank}\n` +
      `${'─'.repeat(38)}\n` +
      `\`\`\`\n` +
      `**Do your own research before making any financial decisions.**`;

    await channel.send(msg);
    console.log(`[performer] Sent: ${coin.name} (${sign}${coin.change24h}%)`);
  };

  // Stagger 90 seconds after market scheduler starts
  setTimeout(() => scheduleLoop('performer', run, PERFORMER_INTERVAL)(), 90_000);
}

export function newsScheduler(client) {
  const run = async () => {
    const channel = await fetchChannel(client, process.env.NEWS_CHANNEL_ID, 'NEWS_CHANNEL_ID');
    if (!channel) return;

    const articles = await withRetry(getLatestNews, 3, 'news');
    if (!articles?.length) { console.error('[news] No articles returned'); return; }

    const seen       = readJson(seenNewsFile, []);
    const candidates = articles.filter(a => !seen.includes(a.guid) && isRelevant(a.title, a.description));

    if (!candidates.length) { console.log('[news] No new relevant articles'); return; }

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

  // Stagger 30 seconds after bot starts
  setTimeout(() => scheduleLoop('news', run, NEWS_INTERVAL)(), 30_000);
}

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
      else remaining.push(alert);
    }

    for (const alert of triggered) {
      try {
        const channel = await client.channels.fetch(alert.channelId);
        const embed = new EmbedBuilder()
          .setColor('#f1c40f')
          .setTitle('Price Alert Triggered')
          .setDescription(
            `<@${alert.userId}> **${alert.coin.toUpperCase()}** is now **$${alert.currentPrice.toLocaleString()}**\n` +
            `Your alert: price goes ${alert.type} **$${alert.price.toLocaleString()}**`
          )
          .setTimestamp();
        await channel.send({ embeds: [embed] });
      } catch (e) {
        console.error('[alerts] Failed to send alert:', e.message);
      }
    }

    if (triggered.length) writeJson(alertsFile, remaining);
  };

  // Check alerts every minute but also stagger slightly
  setTimeout(() => {
    run();
    setInterval(run, ALERT_CHECK);
  }, 15_000);
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchChannel(client, id, label) {
  if (!id) { console.error(`[scheduler] ${label} env var not set`); return null; }
  try {
    return await client.channels.fetch(id);
  } catch (e) {
    console.error(`[scheduler] Could not fetch ${label} (${id}):`, e.message);
    return null;
  }
}

async function getTopCoins(count = 7) {
  const res = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
    params: { vs_currency: 'usd', order: 'market_cap_desc', per_page: count, page: 1, sparkline: false },
    headers: { Accept: 'application/json' },
    timeout: 12000,
  });
  return res.data.map(c => ({
    id: c.id,
    name: c.name,
    symbol: c.symbol,
    price: c.current_price,
    change24h: c.price_change_percentage_24h?.toFixed(2) ?? '0.00',
    marketCap: (c.market_cap / 1e9).toFixed(1) + 'B',
  }));
}

async function getBestPerformer() {
  const res = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
    params: {
      vs_currency: 'usd',
      order: 'percent_change_24h_desc',
      per_page: 100,
      page: 1,
      sparkline: false,
      price_change_percentage: '1h,24h',
    },
    headers: { Accept: 'application/json' },
    timeout: 12000,
  });

  // Filter: min $200M market cap, not a stablecoin, positive 24h change
  const candidates = res.data.filter(c =>
    c.market_cap > 200_000_000 &&
    c.price_change_percentage_24h > 0 &&
    !STABLECOINS.includes(c.id)
  );

  if (!candidates.length) return null;

  // Sort by 24h gain descending
  candidates.sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h);
  const c = candidates[0];

  return {
    id: c.id,
    name: c.name,
    symbol: c.symbol,
    price: c.current_price,
    change24h: c.price_change_percentage_24h?.toFixed(2) ?? '0.00',
    change1h: c.price_change_percentage_1h_in_currency?.toFixed(2) ?? 'N/A',
    marketCap: (c.market_cap / 1e9).toFixed(2) + 'B',
    volume: (c.total_volume / 1e6).toFixed(0) + 'M',
    rank: c.market_cap_rank,
  };
}

async function getCurrentPrices(coins) {
  const res = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
    params: { ids: coins.join(','), vs_currencies: 'usd' },
    timeout: 12000,
  });
  const result = {};
  for (const [coin, data] of Object.entries(res.data)) result[coin] = data.usd;
  return result;
}

async function getLatestNews() {
  const feeds = [
    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',       source: 'BBC World'    },
    { url: 'https://feeds.bbci.co.uk/news/business/rss.xml',    source: 'BBC Business' },
    { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362', source: 'CNBC' },
    { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664',  source: 'CNBC Markets' },
    { url: 'https://feeds.feedburner.com/CoinDesk',              source: 'CoinDesk'     },
    { url: 'https://cointelegraph.com/rss',                      source: 'CoinTelegraph'},
  ];

  const articles = [];

  await Promise.allSettled(feeds.map(async feed => {
    try {
      const parsed = await rssParser.parseURL(feed.url);
      for (const item of parsed.items.slice(0, 10)) {
        let image = null;
        if (item.enclosure?.url)             image = item.enclosure.url;
        else if (item['media:content']?.$.url) image = item['media:content'].$.url;

        const rawDesc   = item.contentSnippet || item.description || '';
        const description = rawDesc.replace(/<[^>]*>/g, '').trim().slice(0, 400);

        articles.push({
          guid: item.guid || item.link,
          title: item.title?.trim() || 'No title',
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
