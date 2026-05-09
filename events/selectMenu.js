export default {
  name: 'interactionCreate',
  async execute(interaction) {
    if (!interaction.isChannelSelectMenu()) return;

    if (interaction.customId === 'channel_select') {
      const selectedChannel = interaction.channels.first();
      const message = interaction.client.tempMessages?.[interaction.user.id];

      if (!message) {
        return await interaction.reply({
          content: '❌ Message not found!',
          ephemeral: true,
        });
      }

      try {
        await selectedChannel.send(message);
        await interaction.reply({
          content: `✅ Message sent to ${selectedChannel}!`,
          ephemeral: true,
        });

        delete interaction.client.tempMessages[interaction.user.id];
      } catch (error) {
        console.error(error);
        await interaction.reply({
          content: '❌ Error sending message!',
          ephemeral: true,
        });
      }
    }
  },
};