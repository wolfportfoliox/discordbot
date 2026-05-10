import { SlashCommandBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const votesFile   = path.join(__dirname, '..', 'data', 'bullishVotes.json');
const VOTE_TTL    = 24 * 60 * 60 * 1000; // votes expire after 24h

function ensureDataDir() {
  const dir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readVotes() {
  ensureDataDir();
  if (!fs.existsSync(votesFile)) return [];
  try { return JSON.parse(fs.readFileSync(votesFile, 'utf8')); } catch { return []; }
}

function saveVotes(votes) {
  ensureDataDir();
  fs.writeFileSync(votesFile, JSON.stringify(votes, null, 2));
}

async function resolveCoinId(query) {
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/search', {
      params: { query },
      timeout: 8000,
    });
    const coins = res.data?.coins;
    if (!coins?.length) return null;
    return { id: coins[0].id, name: coins[0].name, symbol: coins[0].symbol };
  } catch {
    return null;
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('bullish')
    .setDescription('Vote a coin as bullish — it gets priority in the performer spotlight')
    .addStringOption(opt =>
      opt.setName('coin')
        .setDescription('Coin name or symbol (e.g. solana, BTC, pepe)')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const query = interaction.options.getString('coin').trim();
    const coin  = await resolveCoinId(query);

    if (!coin) {
      return interaction.editReply(`Could not find a coin matching **${query}**. Try the full name, e.g. \`solana\`, \`bitcoin\`, \`pepe\`.`);
    }

    const now   = Date.now();
    let votes   = readVotes().filter(v => now - v.ts < VOTE_TTL); // prune expired

    // Check if this user already voted for this coin in the last 24h
    const existing = votes.find(v => v.userId === interaction.user.id && v.coinId === coin.id);
    if (existing) {
      const expiresIn = Math.ceil((VOTE_TTL - (now - existing.ts)) / (60 * 60 * 1000));
      return interaction.editReply(
        `You already voted **${coin.name}** as bullish. Your vote expires in ~${expiresIn}h.`
      );
    }

    votes.push({
      userId:   interaction.user.id,
      username: interaction.user.username,
      coinId:   coin.id,
      coinName: coin.name,
      symbol:   coin.symbol.toUpperCase(),
      ts:       now,
    });

    saveVotes(votes);

    // Count total active votes for this coin
    const totalForCoin = votes.filter(v => v.coinId === coin.id).length;

    await interaction.editReply(
      `Your bullish vote for **${coin.name} (${coin.symbol.toUpperCase()})** has been recorded.\n` +
      `Total community votes for this coin today: **${totalForCoin}**\n\n` +
      `Coins with community votes get priority in the Performer Spotlight.`
    );
  },
};
