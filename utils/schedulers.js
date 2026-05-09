import axios from 'axios';
import { EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function marketScheduler(client) {
  // Run every hour (3600000 ms)
  setInterval(async () => {
    try {
      const channel = await client.channels.fetch(process.env.MARKET_CHANNEL_ID);
      if (!channel) return;

      const topCoins = await getTopCoins();

      const embed = new EmbedBuilder()
        .setColor('#1f8b4c')
        .setTitle('📊 Top Cryptocurrencies')
        .setTimestamp();

      topCoins.forEach(coin => {
        embed.addFields({
          name: `${coin.symbol.toUpperCase()} - ${coin.name}`,
          value: `Price: $${coin.price}\nChange (24h): ${coin.change24h}%\nMarket Cap: $${coin.marketCap}`,
          inline: false,
        });
      });

      await channel.send({ embeds: [embed] });
      console.log('✅ Market update sent');
    } catch (error) {
      console.error('Error in market scheduler:', error);
    }
  }, 3600000); // 1 hour
}

export function newsScheduler(client) {
  // Run every 30 minutes (1800000 ms)
  setInterval(async () => {
    try {
      const channel = await client.channels.fetch(process.env.NEWS_CHANNEL_ID);
      if (!channel) return;

      const news = await getLatestNews();

      for (const article of news.slice(0, 3)) {
        const embed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle(article.title)
          .setDescription(article.description || 'No description')
          .setURL(article.url)
          .setImage(article.image)
          .setFooter({ text: article.source })
          .setTimestamp();

        await channel.send({ embeds: [embed] });
      }

      console.log('✅ News update sent');
    } catch (error) {
      console.error('Error in news scheduler:', error);
    }
  }, 1800000); // 30 minutes
}

async function getTopCoins() {
  try {
    const response = await axios.get(
      `${process.env.COINGECKO_API}/coins/markets`,
      {
        params: {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: 10,
          page: 1,
          sparkline: false,
        },
      }
    );

    return response.data.map(coin => ({
      name: coin.name,
      symbol: coin.symbol,
      price: coin.current_price,
      change24h: coin.price_change_percentage_24h.toFixed(2),
      marketCap: (coin.market_cap / 1e9).toFixed(2) + 'B',
    }));
  } catch (error) {
    console.error('Error fetching top coins:', error);
    return [];
  }
}

async function getLatestNews() {
  try {
    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: 'crypto OR bitcoin OR ethereum OR stock OR economy OR war OR disaster',
        sortBy: 'publishedAt',
        language: 'en',
        apiKey: process.env.NEWSAPI_KEY,
      },
    });

    return response.data.articles.map(article => ({
      title: article.title,
      description: article.description,
      url: article.url,
      image: article.urlToImage,
      source: article.source.name,
    }));
  } catch (error) {
    console.error('Error fetching news:', error);
    return [];
  }
}
