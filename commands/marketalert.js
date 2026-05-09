import { SlashCommandBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const alertsFile = path.join(__dirname, '..', 'data', 'marketAlerts.json');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const getAlerts = () => {
  if (!fs.existsSync(alertsFile)) return [];
  return JSON.parse(fs.readFileSync(alertsFile, 'utf8'));
};

const saveAlerts = (alerts) => {
  fs.writeFileSync(alertsFile, JSON.stringify(alerts, null, 2));
};

export default {
  data: new SlashCommandBuilder()
    .setName('marketalert')
    .setDescription('Set price alerts for cryptocurrencies')
    .addStringOption(option =>
      option.setName('coin')
        .setDescription('Coin symbol (e.g., bitcoin, ethereum)')
        .setRequired(true)
    )
    .addNumberOption(option =>
      option.setName('price')
        .setDescription('Alert price in USD')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('type')
        .setDescription('Alert type: above or below')
        .setRequired(true)
        .addChoices(
          { name: 'Above', value: 'above' },
          { name: 'Below', value: 'below' }
        )
    ),
  async execute(interaction) {
    const coin = interaction.options.getString('coin').toLowerCase();
    const price = interaction.options.getNumber('price');
    const type = interaction.options.getString('type');
    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    let alerts = getAlerts();
    alerts.push({
      id: Date.now().toString(),
      userId,
      channelId,
      coin,
      price,
      type,
      createdAt: new Date(),
    });

    saveAlerts(alerts);

    await interaction.reply({
      content: `✅ Alert set! You'll be notified when ${coin} goes **${type}** $${price}`,
      ephemeral: true,
    });
  },
};