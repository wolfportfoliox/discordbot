import { fetchCoinData, fmtPrice, fmtChange } from '../commands/price.js';

const PREFIX = '!as ';  // case-insensitive match

export default {
  name: 'messageCreate',
  once: false,

  async execute(message) {
    // Ignore bots and messages that don't start with the prefix
    if (message.author.bot) return;
    if (!message.content.toLowerCase().startsWith(PREFIX)) return;

    const query = message.content.slice(PREFIX.length).trim();
    if (!query) {
      return message.reply('Please provide a coin name or symbol. Example: `!AS BTC` or `!AS solana`');
    }

    // Show a typing indicator while fetching
    await message.channel.sendTyping().catch(() => {});

    let d;
    try {
      d = await fetchCoinData(query);
    } catch (err) {
      console.error('[!AS] API error:', err.message);
      return message.reply('CoinGecko API is busy right now — please try again in a moment.');
    }

    if (!d) {
      return message.reply(
        `Could not find a coin matching **${query}**.\n` +
        `Try the full name (e.g. \`!AS bitcoin\`) or symbol (e.g. \`!AS BTC\`, \`!AS SOL\`, \`!AS PEPE\`).`
      );
    }

    const m = d.market_data;

    const msg =
      `## Apex Price Update!\n` +
      `checkout any coin price here\n\n` +
      `Coin: **${d.name} (${d.symbol.toUpperCase()})**\n` +
      `Price: **${fmtPrice(m.current_price?.usd)}**\n` +
      `24H: **${fmtChange(m.price_change_percentage_24h)}**\n` +
      `1H: **${fmtChange(m.price_change_percentage_1h_in_currency?.usd)}**\n` +
      `MCap: **${fmtPrice(m.market_cap?.usd)}**\n` +
      `Volume: **${fmtPrice(m.total_volume?.usd)}**\n` +
      `Rank: **#${d.market_cap_rank ?? 'N/A'}**\n\n` +
      `**Thanks for Using Apex Syndicate**`;

    await message.reply(msg);
  },
};
