import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Get the profile picture of a user')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user whose avatar you want to see')
        .setRequired(true)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const member = interaction.guild?.members.cache.get(user.id);

    const serverAvatar = member?.displayAvatarURL({ size: 1024, extension: 'png' });
    const globalAvatar = user.displayAvatarURL({ size: 1024, extension: 'png' });

    const embed = new EmbedBuilder()
      .setTitle(`${user.username}'s Avatar`)
      .setImage(serverAvatar || globalAvatar)
      .setColor('#5865F2')
      .setTimestamp();

    if (serverAvatar && serverAvatar !== globalAvatar) {
      embed.setDescription(`[Server Avatar](${serverAvatar}) | [Global Avatar](${globalAvatar})`);
    } else {
      embed.setDescription(`[Download Avatar](${globalAvatar})`);
    }

    await interaction.reply({ embeds: [embed] });
  },
};
