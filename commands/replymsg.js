import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('replymsg')
    .setDescription('Reply to a specific message using its link')
    .addStringOption(option =>
      option.setName('messagelink')
        .setDescription('The full link to the message you want to reply to')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reply')
        .setDescription('The text to send as a reply')
        .setRequired(true)
    ),

  async execute(interaction) {
    const messageLink = interaction.options.getString('messagelink');
    const replyText = interaction.options.getString('reply');

    const regex = /https:\/\/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;
    const match = messageLink.match(regex);

    if (!match) {
      return await interaction.reply({
        content: 'Invalid message link. Please right-click a message and copy the message link.',
        flags: 64,
      });
    }

    const [, guildId, channelId, messageId] = match;

    try {
      const channel = await interaction.client.channels.fetch(channelId);
      if (!channel) {
        return await interaction.reply({ content: 'Could not find that channel.', flags: 64 });
      }

      const message = await channel.messages.fetch(messageId);
      if (!message) {
        return await interaction.reply({ content: 'Could not find that message.', flags: 64 });
      }

      await message.reply(replyText);

      await interaction.reply({ content: 'Reply sent successfully.', flags: 64 });
    } catch (error) {
      console.error('Error in /replymsg:', error.message);
      await interaction.reply({
        content: 'Failed to send the reply. Make sure the link is valid and the bot has access to that channel.',
        flags: 64,
      });
    }
  },
};
