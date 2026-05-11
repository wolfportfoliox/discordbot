import { SlashCommandBuilder } from 'discord.js';
import axios from 'axios';

// ─── Shared coin lookup + formatting ─────────────────────────────────────────

/**
 * Finds a coin on CoinGecko using a multi-step strategy:
 *  1. Try /search (best for names and partial matches)
 *  2. If multiple hits, prefer the one whose symbol matches the input exactly
 *  3. Fall back to /coins/markets with symbol search
 * Returns the full /coins/{id} detail object or null.
 */
export async function fetchCoinData(input) {
  const query = input.toLowerCase().trim();

  // Step 1 — search by name/symbol
  let coinId = null;
  try {
    const searchRes = await axios.get('https://api.coingecko.com/api/v3/search', {
      params: { query },
      timeout: 10000,
    });
    const hits = searchRes.data.coins ?? [];
    if (hits.length) {
      // Prefer exact symbol match (e.g. "btc" → bitcoin, not some random token)
      const exactSymbol = hits.find(c => c.symbol.toLowerCase() === query);
      const exactName   = hits.find(c => c.name.toLowerCase() === query);
      coinId = (exactSymbol ?? exactName ?? hits[0]).id;
    }
  } catch { /* fall through to markets fallback */ }

  // Step 2 — fallback: scan markets list by symbol (covers coins not in search index)
  if (!coinId) {
    try {
      const mRes = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
        params: {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: 250,
          page: 1,
          sparkline: false,
        },
        timeout: 12000,
      });
      const match = mRes.data.find(
        c => c.symbol.toLowerCase() === query || c.id.toLowerCase() === query || c.name.toLowerCase() === query
      );
      if (match) coinId = match.id;
    } catch { /* give up */ }
  }

  if (!coinId) return null;

  // Step 3 — fetch full detail
  const detailRes = await axios.get(`https://api.coingecko.com/api/v3/coins/${coinId}`, {
    params: {
      localization: false,
      tickers: false,
      market_data: true,
      community_data: false,
      developer_data: false,
    },
    timeout: 12000,
  });
  return detailRes.data;
}

// ─── Formatters ───────────────────────────────────────────────────────────────
export function fmtPrice(n) {
  if (n == null) return 'N/A';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1000) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  if (n >= 1)    return `$${n.toFixed(4)}`;
  return `$${n.toFixed(8)}`;
}

export function fmtSupply(n) {
  if (n == null) return 'N/A';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toLocaleString();
}

export function fmtChange(val) {
  if (val == null) return 'N/A';
  const n = parseFloat(val);
  return n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`;
}

// ─── Slash command ────────────────────────────────────────────────────────────
export default {
  data: new SlashCommandBuilder()
    .setName('price')
    .setDescription('Get full live price data for any coin — top 1 to top 1000+')
    .addStringOption(option =>
      option
        .setName('coin')
        .setDescription('Coin name or symbol (e.g. bitcoin, BTC, solana, SOL, pepe, IP)')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const input = interaction.options.getString('coin');

    let d;
    try {
      d = await fetchCoinData(input);
    } catch (err) {
      console.error('[price] API error:', err.message);
      return interaction.editReply('CoinGecko API is busy — please try again in a moment.');
    }

    if (!d) {
      return interaction.editReply(
        `Could not find a coin matching **${input}**.\n` +
        `Try the full name (e.g. \`bitcoin\`, \`ethereum\`, \`pepe\`) or the exact symbol (e.g. \`BTC\`, \`ETH\`, \`PEPE\`).`
      );
    }

    const m = d.market_data;
    const DIV = '─'.repeat(44);

    const msg =
      `## Apex Price Update!\n` +
      `checkout any coin price here\n\n` +
      `\`\`\`\n` +
      `${DIV}\n` +
      ` Coin        : ${d.name} (${d.symbol.toUpperCase()})\n` +
      ` Rank        : #${d.market_cap_rank ?? 'N/A'}\n` +
      `${DIV}\n` +
      ` Price       : ${fmtPrice(m.current_price?.usd)}\n` +
      ` 1H Change   : ${fmtChange(m.price_change_percentage_1h_in_currency?.usd)}\n` +
      ` 24H Change  : ${fmtChange(m.price_change_percentage_24h)}\n` +
      ` 7D Change   : ${fmtChange(m.price_change_percentage_7d)}\n` +
      ` 30D Change  : ${fmtChange(m.price_change_percentage_30d)}\n` +
      `${DIV}\n` +
      ` 24H High    : ${fmtPrice(m.high_24h?.usd)}\n` +
      ` 24H Low     : ${fmtPrice(m.low_24h?.usd)}\n` +
      `${DIV}\n` +
      ` Market Cap  : ${fmtPrice(m.market_cap?.usd)}\n` +
      ` Volume 24H  : ${fmtPrice(m.total_volume?.usd)}\n` +
      ` Circulating : ${fmtSupply(m.circulating_supply)} ${d.symbol.toUpperCase()}\n` +
      ` Max Supply  : ${m.max_supply ? fmtSupply(m.max_supply) + ' ' + d.symbol.toUpperCase() : 'Unlimited'}\n` +
      `${DIV}\n` +
      ` All Time High : ${fmtPrice(m.ath?.usd)}\n` +
      ` From ATH      : ${fmtChange(m.ath_change_percentage?.usd)}\n` +
      ` All Time Low  : ${fmtPrice(m.atl?.usd)}\n` +
      `${DIV}\n` +
      `\`\`\`\n` +
      `**Thanks for Using Apex Syndicate**`;

    await interaction.editReply(msg);
  },
};
