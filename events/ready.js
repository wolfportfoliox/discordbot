import { marketScheduler, newsScheduler, checkPriceAlerts } from '../utils/schedulers.js';

export default {
  name: 'ready',
  once: true,
  execute(client) {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    console.log(`📡 MARKET_CHANNEL_ID: ${process.env.MARKET_CHANNEL_ID}`);
    console.log(`📡 NEWS_CHANNEL_ID: ${process.env.NEWS_CHANNEL_ID}`);

    marketScheduler(client);
    newsScheduler(client);
    checkPriceAlerts(client);
  },
};
