import axios from 'axios';
import { EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Parser from 'rss-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const alertsFile = path.join(__dirname, '..', 'data', 'marketAlerts.json');
const seenNewsFile = path.join(__dirname, '..', 'data', 'seenNews.json');
const seenPerformersFile = path.join(__dirname, '..', 'data', 'seenPerformers.json');

const rssParser = new Parser();

function ensureDataDir() {
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function getSeenNews() {
  ensureDataDir();
  if (!fs.existsSync(seenNewsFile)) return [];
  try { return JSON.parse(fs.readFileSync(seenNewsFile, 'utf8')); } catch { return []; }
}

function saveSeenNews(seen) {
  ensureDataDir();
  fs.writeFileSync(seenNewsFile, JSON.stringify(seen.slice(-300), null, 2));
}

function getSeenPerformers() {
  ensureDataDir();
  if (!fs.existsSync(seenPerformersFile)) return [];
  try { return JSON.parse(fs.readFileSync(seenPerformersFile, 'utf8')); } catch { return []; }
}

function saveSeenPerformers(seen) {
  ensureDataDir();
  fs.writeFileSync(seenPerformersFile, JSON.stringify(seen.slice(-50), null, 2));
}

function pad(str, len, right = false) {
  str = String(str);
  if (str.length >= len) return str.slice(0, len);
  return right ? str.padEnd(len) : str.padStart(len);
}

export function marketScheduler(client) {
  const run = async () => {
    try {
      const channel = await client.channels.fetch(process.env.MARKET_CHANNEL_ID);
      if (!channel) { console.error('Market channel not found'); return; }

      const topCoins = await getTopCoins(7);
      if (!topCoins.length) return;

      const header =
        `# Apex Market Update\n` +
        `Check Live Market price coin and also set alert.\n\n`;

      const divider = `${'─'.repeat(58)}\n`;
      const colHeader = `${'No.'} ${'Coin Name'.padEnd(18)} ${'Price'.padStart(12)} ${'Change'.padStart(9)} ${'MCap'.padStart(9)}\n`;

      const rows = topCoins.map((coin, i) => {
        const num = `${i + 1}.`.padEnd(3);
        const name = `${coin.name} (${coin.symbol.toUpperCase()})`.padEnd(18).slice(0, 18);
        const price = `$${Number(coin.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.padStart(12);
        const sign = parseFloat(coin.change24h) >= 0 ? '+' : '';
        const change = `${sign}${coin.change24h}%`.padStart(9);
        const mcap = `$${coin.marketCap}`.padStart(9);
        return `${num} ${name} ${price} ${change} ${mcap}`;
      }).join('\n');

      const footer = `\n\n**Thanks for Visiting the Market Channel, You can more Market Update here!**`;

      const message = header + '```\n' + colHeader + divider + rows + '\n```' + footer;

      await channel.send(message);
      console.log('Market update sent');
    } catch (error) {
      console.error('Error in market scheduler:', error.message);
    }
  };

  run();
  setInterval(run, 8 * 60 * 1000);
}

export function newsScheduler(client) {
  const run = async () => {
    try {
      const channel = await client.channels.fetch(process.env.NEWS_CHANNEL_ID);
      if (!channel) { console.error('News channel not found'); return; }

      const articles = await getLatestNews();
      if (!articles.length) return;

      const seen = getSeenNews();
      const newArticles = articles.filter(a => !seen.includes(a.guid));
      if (!newArticles.length) { console.log('No new news to post'); return; }

      const article = newArticles[0];

      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(article.title.slice(0, 256))
        .setURL(article.url)
        .setFooter({ text: article.source })
        .setTimestamp(new Date(article.pubDate));

      if (article.description) embed.setDescription(article.description.slice(0, 350));
      if (article.image) embed.setImage(article.image);

      await channel.send({ embeds: [embed] });
      seen.push(article.guid);
      saveSeenNews(seen);
      console.log('News article posted');
    } catch (error) {
      console.error('Error in news scheduler:', error.message);
    }
  };

  run();
  setInterval(run, 8 * 60 * 1000);
}

export function topPerformerScheduler(client) {
  const run = async () => {
    try {
      const channel = await client.channels.fetch(process.env.MARKET_CHANNEL_ID);
      if (!channel) return;

      const coin = await getTopPerformer();
      if (!coin) return;

      const seen = getSeenPerformers();
      if (seen.includes(coin.id)) return;

      const sign = parseFloat(coin.change24h) >= 0 ? '+' : '';

      const message =
        `# Apex Top Performer Alert\n` +
        `One coin is standing out right now — worth watching.\n\n` +
        `\`\`\`\n` +
        `Coin   : ${coin.name} (${coin.symbol.toUpperCase()})\n` +
        `Price  : $${Number(coin.price).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n` +
        `24h    : ${sign}${coin.change24h}%\n` +
        `MCap   : $${coin.marketCap}\n` +
        `Volume : $${coin.volume}\n` +
        `\`\`\`\n` +
        `**This coin is showing strong movement. Do your own research before making any decisions.**`;

      await channel.send(message);
      seen.push(coin.id);
      saveSeenPerformers(seen);
      console.log('Top performer posted:', coin.name);
    } catch (error) {
      console.error('Error in top performer scheduler:', error.message);
    }
  };

  run();
  setInterval(run, 2 * 60 * 60 * 1000); // every 2 hours
}

export function checkPriceAlerts(client) {
  const run = async () => {
    try {
      ensureDataDir();
      if (!fs.existsSync(alertsFile)) return;
      const alerts = JSON.parse(fs.readFileSync(alertsFile, 'utf8'));
      if (!alerts.length) return;

      const coins = [...new Set(alerts.map(a => a.coin))];
      const prices = await getCurrentPrices(coins);

      const triggered = [];
      const remaining = [];

      for (const alert of alerts) {
        const currentPrice = prices[alert.coin];
        if (currentPrice === undefined) { remaining.push(alert); continue; }
        const hit =
          (alert.type === 'above' && currentPrice >= alert.price) ||
          (alert.type === 'below' && currentPrice <= alert.price);
        if (hit) triggered.push({ ...alert, currentPrice });
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
          console.error('Error sending price alert:', e.message);
        }
      }

      if (triggered.length) {
        fs.writeFileSync(alertsFile, JSON.stringify(remaining, null, 2));
      }
    } catch (error) {
      console.error('Error in price alert checker:', error.message);
    }
  };

  setInterval(run, 60000);
}

async function getTopCoins(count = 7) {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: { vs_currency: 'usd', order: 'market_cap_desc', per_page: count, page: 1, sparkline: false },
      headers: { Accept: 'application/json' },
      timeout: 10000,
    });
    return response.data.map(coin => ({
      id: coin.id,
      name: coin.name,
      symbol: coin.symbol,
      price: coin.current_price,
      change24h: coin.price_change_percentage_24h?.toFixed(2) ?? '0.00',
      marketCap: (coin.market_cap / 1e9).toFixed(1) + 'B',
    }));
  } catch (error) {
    console.error('Error fetching top coins:', error.message);
    return [];
  }
}

async function getTopPerformer() {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: {
        vs_currency: 'usd',
        order: 'percent_change_24h_desc',
        per_page: 50,
        page: 1,
        sparkline: false,
      },
      headers: { Accept: 'application/json' },
      timeout: 10000,
    });

    // Filter out stablecoins and very small market caps, pick top gainer
    const candidates = response.data.filter(c =>
      c.market_cap > 500_000_000 &&
      c.price_change_percentage_24h > 5 &&
      !['tether', 'usd-coin', 'dai', 'binance-usd', 'true-usd'].includes(c.id)
    );

    if (!candidates.length) return null;

    candidates.sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h);
    const coin = candidates[0];

    return {
      id: coin.id,
      name: coin.name,
      symbol: coin.symbol,
      price: coin.current_price,
      change24h: coin.price_change_percentage_24h?.toFixed(2) ?? '0.00',
      marketCap: (coin.market_cap / 1e9).toFixed(1) + 'B',
      volume: (coin.total_volume / 1e6).toFixed(0) + 'M',
    };
  } catch (error) {
    console.error('Error fetching top performer:', error.message);
    return null;
  }
}

async function getCurrentPrices(coins) {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: { ids: coins.join(','), vs_currencies: 'usd' },
      timeout: 10000,
    });
    const result = {};
    for (const [coin, data] of Object.entries(response.data)) {
      result[coin] = data.usd;
    }
    return result;
  } catch (error) {
    console.error('Error fetching prices:', error.message);
    return {};
  }
}

async function getLatestNews() {
  const feeds = [
    { url: 'https://feeds.feedburner.com/CoinDesk', source: 'CoinDesk' },
    { url: 'https://cointelegraph.com/rss', source: 'CoinTelegraph' },
  ];
  const articles = [];
  for (const feed of feeds) {
    try {
      const parsed = await rssParser.parseURL(feed.url);
      for (const item of parsed.items.slice(0, 8)) {
        let image = null;
        if (item.enclosure?.url) image = item.enclosure.url;
        else if (item['media:content']?.$.url) image = item['media:content'].$.url;
        const rawDesc = item.contentSnippet || item.content || item.description || '';
        const description = rawDesc.replace(/<[^>]*>/g, '').trim().slice(0, 350);
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
      console.error(`Error fetching ${feed.source} RSS:`, e.message);
    }
  }
  articles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return articles;
}
