import { SlashCommandBuilder } from 'discord.js';
import axios from 'axios';

export default {
  data: new SlashCommandBuilder()
    .setName('price')
    .setDescription('Get full live information about any cryptocurrency')
    .addStringOption(option =>
      option.setName('coin')
        .setDescription('Coin name or symbol (e.g. bitcoin, eth, solana)')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const input = interaction.options.getString('coin').toLowerCase().trim();

    try {
      // Step 1: Search for the coin to get the correct ID
      const searchRes = await axios.get('https://api.coingecko.com/api/v3/search', {
        params: { query: input },
        timeout: 10000,
      });

      const coins = searchRes.data.coins;
      if (!coins || !coins.length) {
        return await interaction.editReply(`Could not find a coin matching **${input}**. Try the full name (e.g. \`bitcoin\`, \`ethereum\`).`);
      }

      const coinId = coins[0].id;

      // Step 2: Get full coin details
      const detailRes = await axios.get(`https://api.coingecko.com/api/v3/coins/${coinId}`, {
        params: {
          localization: false,
          tickers: false,
          market_data: true,
          community_data: false,
          developer_data: false,
        },
        timeout: 10000,
      });

      const d = detailRes.data;
      const m = d.market_data;

      const price = m.current_price?.usd;
      const change1h = m.price_change_percentage_1h_in_currency?.usd?.toFixed(2);
      const change24h = m.price_change_percentage_24h?.toFixed(2);
      const change7d = m.price_change_percentage_7d?.toFixed(2);
      const change30d = m.price_change_percentage_30d?.toFixed(2);
      const high24h = m.high_24h?.usd;
      const low24h = m.low_24h?.usd;
      const ath = m.ath?.usd;
      const athDate = m.ath_date?.usd ? new Date(m.ath_date.usd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
      const athChange = m.ath_change_percentage?.usd?.toFixed(2);
      const atl = m.atl?.usd;
      const atlDate = m.atl_date?.usd ? new Date(m.atl_date.usd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
      const marketCap = m.market_cap?.usd;
      const volume24h = m.total_volume?.usd;
      const supply = m.circulating_supply;
      const maxSupply = m.max_supply;
      const rank = d.market_cap_rank;

      function fmt(n, decimals = 2) {
        if (n == null) return 'N/A';
        if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
        if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
        if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
        if (n >= 1e3) return `$${n.toLocaleString('en-US', { minimumFractionDigits: decimals })}`;
        return `$${n.toFixed(decimals > 4 ? 6 : decimals)}`;
      }

      function fmtSupply(n) {
        if (n == null) return 'N/A';
        if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
        if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
        if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
        return n.toLocaleString();
      }

      function changeStr(val) {
        if (val == null) return 'N/A';
        return parseFloat(val) >= 0 ? `+${val}%` : `${val}%`;
      }

      const divider = '─'.repeat(44);

      const message =
        `# ${d.name} (${d.symbol.toUpperCase()}) — Live Price\n` +
        `Rank: #${rank ?? 'N/A'}\n\n` +
        `\`\`\`\n` +
        `${divider}\n` +
        ` Current Price   : ${fmt(price, 6)}\n` +
        `${divider}\n` +
        ` 1h Change       : ${changeStr(change1h)}\n` +
        ` 24h Change      : ${changeStr(change24h)}\n` +
        ` 7d Change       : ${changeStr(change7d)}\n` +
        ` 30d Change      : ${changeStr(change30d)}\n` +
        `${divider}\n` +
        ` 24h High        : ${fmt(high24h, 6)}\n` +
        ` 24h Low         : ${fmt(low24h, 6)}\n` +
        `${divider}\n` +
        ` All Time High   : ${fmt(ath, 6)}\n` +
        ` ATH Date        : ${athDate}\n` +
        ` From ATH        : ${changeStr(athChange)}\n` +
        `${divider}\n` +
        ` All Time Low    : ${fmt(atl, 6)}\n` +
        ` ATL Date        : ${atlDate}\n` +
        `${divider}\n` +
        ` Market Cap      : ${fmt(marketCap)}\n` +
        ` 24h Volume      : ${fmt(volume24h)}\n` +
        ` Circulating     : ${fmtSupply(supply)} ${d.symbol.toUpperCase()}\n` +
        ` Max Supply      : ${maxSupply ? fmtSupply(maxSupply) + ' ' + d.symbol.toUpperCase() : 'Unlimited'}\n` +
        `${divider}\n` +
        `\`\`\`\n` +
        `*Use \`/marketalert\` to set a price alert for ${d.name}.*`;

      await interaction.editReply(message);
    } catch (error) {
      console.error('Error in /price:', error.message);
      await interaction.editReply('Failed to fetch coin data. Please try again in a moment.');
    }
  },
};
