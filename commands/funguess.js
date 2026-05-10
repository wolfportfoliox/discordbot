import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('funguess')
    .setDescription('Randomly picks one of two users and gives them a fun title')
    .addUserOption(option =>
      option.setName('user1')
        .setDescription('First user')
        .setRequired(true)
    )
    .addUserOption(option =>
      option.setName('user2')
        .setDescription('Second user')
        .setRequired(true)
    ),

  async execute(interaction) {
    const user1 = interaction.options.getUser('user1');
    const user2 = interaction.options.getUser('user2');

    const winner = Math.random() < 0.5 ? user1 : user2;

    const message =
      `# Apex cute guy\n\n` +
      `> <@${winner.id}>\n` +
      `> You are cute \u{1F60B}`;

    await interaction.reply({ content: message });
  },
};
