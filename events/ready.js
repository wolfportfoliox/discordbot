import { marketScheduler, newsScheduler } from '../utils/schedulers.js';

export default {
  name: 'ready',
  once: true,
  execute(client) {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    
    // Start market and news schedulers
    marketScheduler(client);
    newsScheduler(client);
  },
};