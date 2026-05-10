import { SlashCommandBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const alertsFile = path.join(__dirname, '..', 'data', 'marketAlerts.json');

export default {
  data: new SlashCommandBuilder()
    .setName('cancelalert')
    .setDescription('Cancel an active price alert by its ID')
    .addStringOption(option =>
      option.setName('id')
        .setDescription('The alert ID (from /listalerts)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const alertId = interaction.options.getString('id');
    const userId = interaction.user.id;

    if (!fs.existsSync(alertsFile)) {
      return await interaction.reply({
        content: '📭 No alerts found.',
        ephemeral: true,
      });
    }

    const allAlerts = JSON.parse(fs.readFileSync(alertsFile, 'utf8'));
    const target = allAlerts.find(a => a.id === alertId && a.userId === userId);

    if (!target) {
      return await interaction.reply({
        content: '❌ Alert not found. Make sure the ID is correct and the alert belongs to you.',
        ephemeral: true,
      });
    }

    const updated = allAlerts.filter(a => !(a.id === alertId && a.userId === userId));
    fs.writeFileSync(alertsFile, JSON.stringify(updated, null, 2));

    await interaction.reply({
      content: `✅ Cancelled your **${target.type}** alert for **${target.coin.toUpperCase()}** at $${Number(target.price).toLocaleString()}`,
      ephemeral: true,
    });
  },
};
