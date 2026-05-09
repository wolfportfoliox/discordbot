import { ChannelSelectMenuBuilder, ActionRowBuilder } from 'discord.js';

export default {
  name: 'interactionCreate',
  async execute(interaction) {
    if (!interaction.isModalSubmit()) return;

    if (interaction.customId === 'sendmsg_modal') {
      const message = interaction.fields.getTextInputValue('message_input');

      const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('channel_select')
        .setPlaceholder('Select a channel');

      const row = new ActionRowBuilder().addComponents(channelSelect);

      await interaction.reply({
        content: `Your message: **${message}**\n\nSelect a channel to send it to:`,
        components: [row],
        ephemeral: true,
      });

      // Store message temporarily
      interaction.client.tempMessages = interaction.client.tempMessages || {};
      interaction.client.tempMessages[interaction.user.id] = message;
    }
  },
};