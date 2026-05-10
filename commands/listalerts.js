import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const alertsFile = path.join(__dirname, '..', 'data', 'marketAlerts.json');

export default {
  data: new SlashCommandBuilder()
    .setName('listalerts')
    .setDescription('View and manage your active price alerts'),

  async execute(interaction) {
    const userId = interaction.user.id;

    if (!fs.existsSync(alertsFile)) {
      return await interaction.reply({
        content: '📭 You have no active price alerts.',
        ephemeral: true,
      });
    }

    const allAlerts = JSON.parse(fs.readFileSync(alertsFile, 'utf8'));
    const userAlerts = allAlerts.filter(a => a.userId === userId);

    if (!userAlerts.length) {
      return await interaction.reply({
        content: '📭 You have no active price alerts. Use `/marketalert` to set one!',
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('🔔 Your Active Price Alerts')
      .setDescription(`You have **${userAlerts.length}** active alert(s):`)
      .setTimestamp();

    userAlerts.forEach((alert, index) => {
      const directionEmoji = alert.type === 'above' ? '📈' : '📉';
      const createdDate = new Date(alert.createdAt).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      });
      embed.addFields({
        name: `#${index + 1} — ${alert.coin.toUpperCase()}`,
        value: `${directionEmoji} Notify when **${alert.type}** $${Number(alert.price).toLocaleString()}\n📅 Set on ${createdDate}\n🆔 ID: \`${alert.id}\``,
        inline: true,
      });
    });

    embed.setFooter({ text: 'Use /cancelalert <id> to remove an alert' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
