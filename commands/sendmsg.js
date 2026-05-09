import { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('sendmsg')
    .setDescription('Send a message to a specific channel'),
  async execute(interaction) {
    const modal = new ModalBuilder()
      .setCustomId('sendmsg_modal')
      .setTitle('Send Message');

    const messageInput = new TextInputBuilder()
      .setCustomId('message_input')
      .setLabel('What message do you want to send?')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(messageInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  },
};