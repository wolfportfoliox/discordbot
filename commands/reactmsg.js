import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('reactmsg')
    .setDescription('React with an emoji to a message')
    .addStringOption(option =>
      option.setName('messagelink')
        .setDescription('Link to the message')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('emoji')
        .setDescription('Emoji to react with')
        .setRequired(true)
    ),
  async execute(interaction) {
    const messageLink = interaction.options.getString('messagelink');
    const emoji = interaction.options.getString('emoji');

    try {
      const regex = /https:\/\/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;
      const match = messageLink.match(regex);

      if (!match) {
        return await interaction.reply({
          content: '❌ Invalid message link format!',
          ephemeral: true,
        });
      }

      const [, guildId, channelId, messageId] = match;
      const channel = await interaction.client.channels.fetch(channelId);
      const message = await channel.messages.fetch(messageId);

      await message.react(emoji);

      await interaction.reply({
        content: `✅ Reacted with ${emoji} to the message!`,
        ephemeral: true,
      });
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: '❌ Error reacting to message!',
        ephemeral: true,
      });
    }
  },
};