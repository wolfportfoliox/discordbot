import axios from 'axios';
import { EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Parser from 'rss-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const alertsFile = path.join(__dirname, '..', 'data', 'marketAlerts.json');
const seenNewsFile = path.join(__dirname, '..', 'data', 'seenNews.json');

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
  // Keep only the last 200 seen IDs to avoid the file growing forever
  fs.writeFileSync(seenNewsFile, JSON.stringify(seen.slice(-200), null, 2));
}

export function marketScheduler(client) {
  const run = async () => {
    try {
      const channel = await client.channels.fetch(process.env.MARKET_CHANNEL_ID);
      if (!channel) { console.error('Market channel not found — check MARKET_CHANNEL_ID'); return; }

      const topCoins = await getTopCoins();
      if (!topCoins.length) return;

      const changeEmoji = (pct) => parseFloat(pct) >= 0 ? '🟢' : '🔴';

      const lines = topCoins.map((coin, i) => {
        return (
          `**${i + 1}.** ${coin.name} (${coin.symbol.toUpperCase()})\n` +
          `> 💰 Price: **$${Number(coin.price).toLocaleString()}**\n` +
          `> ${changeEmoji(coin.change24h)} Change: **${coin.change24h}%**\n` +
          `> 🏦 MCap: **$${coin.marketCap}**`
        );
      }).join('\n\n');

      const message =
        `# 📈 APEX MARKET UPDATE\n` +
        `**Live Market Update, check it out!**\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        lines +
        `\n\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `*Powered by CoinGecko • <t:${Math.floor(Date.now() / 1000)}:R>*`;

      await channel.send(message);
      console.log('✅ Market update sent');
    } catch (error) {
      console.error('Error in market scheduler:', error.message);
    }
  };

  run();
  setInterval(run, 8 * 60 * 1000); // every 8 minutes (~7-8x per hour)
}

export function newsScheduler(client) {
  const run = async () => {
    try {
      const channel = await client.channels.fetch(process.env.NEWS_CHANNEL_ID);
      if (!channel) { console.error('News channel not found — check NEWS_CHANNEL_ID'); return; }

      const articles = await getLatestNews();
      if (!articles.length) return;

      const seen = getSeenNews();
      const newArticles = articles.filter(a => !seen.includes(a.guid));

      if (!newArticles.length) { console.log('No new news articles to post'); return; }

      let posted = 0;
      for (const article of newArticles.slice(0, 1)) {
        const embed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle(article.title.slice(0, 256))
          .setURL(article.url)
          .setFooter({ text: `📰 ${article.source}` })
          .setTimestamp(new Date(article.pubDate));

        if (article.description) embed.setDescription(article.description.slice(0, 350));
        if (article.image) embed.setImage(article.image);

        await channel.send({ embeds: [embed] });
        seen.push(article.guid);
        posted++;
      }

      saveSeenNews(seen);
      console.log(`✅ Posted ${posted} news article(s)`);
    } catch (error) {
      console.error('Error in news scheduler:', error.message);
    }
  };

  run();
  setInterval(run, 10 * 60 * 1000); // every 10 minutes (~6/hour)
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
            .setTitle('🔔 Price Alert Triggered!')
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
        console.log(`✅ Triggered ${triggered.length} price alert(s)`);
      }
    } catch (error) {
      console.error('Error in price alert checker:', error.message);
    }
  };

  setInterval(run, 60000);
}

async function getTopCoins() {
  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/coins/markets',
      {
        params: {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: 15,
          page: 1,
          sparkline: false,
        },
        headers: { Accept: 'application/json' },
        timeout: 10000,
      }
    );
    return response.data.map(coin => ({
      name: coin.name,
      symbol: coin.symbol,
      price: coin.current_price,
      change24h: coin.price_change_percentage_24h?.toFixed(2) ?? '0.00',
      marketCap: (coin.market_cap / 1e9).toFixed(2) + 'B',
    }));
  } catch (error) {
    console.error('Error fetching top coins:', error.message);
    return [];
  }
}

async function getCurrentPrices(coins) {
  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price',
      {
        params: { ids: coins.join(','), vs_currencies: 'usd' },
        timeout: 10000,
      }
    );
    const result = {};
    for (const [coin, data] of Object.entries(response.data)) {
      result[coin] = data.usd;
    }
    return result;
  } catch (error) {
    console.error('Error fetching current prices:', error.message);
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
      for (const item of parsed.items.slice(0, 5)) {
        // Extract image from enclosure or media content
        let image = null;
        if (item.enclosure?.url) image = item.enclosure.url;
        else if (item['media:content']?.$.url) image = item['media:content'].$.url;

        // Strip HTML tags from description
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

  // Sort by date, newest first
  articles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return articles;
}
