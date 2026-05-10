import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

const FLAGS = {
  Staff: 'Discord Staff',
  Partner: 'Discord Partner',
  Hypesquad: 'HypeSquad Events',
  BugHunterLevel1: 'Bug Hunter Level 1',
  BugHunterLevel2: 'Bug Hunter Level 2',
  HypeSquadOnlineHouse1: 'House Bravery',
  HypeSquadOnlineHouse2: 'House Brilliance',
  HypeSquadOnlineHouse3: 'House Balance',
  PremiumEarlySupporter: 'Early Supporter',
  VerifiedDeveloper: 'Verified Bot Developer',
  CertifiedModerator: 'Discord Certified Moderator',
  ActiveDeveloper: 'Active Developer',
};

export default {
  data: new SlashCommandBuilder()
    .setName('user_info')
    .setDescription('Get detailed information about a user')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to look up')
        .setRequired(true)
    ),

  async execute(interaction) {
    const user = await interaction.options.getUser('user').fetch().catch(() => interaction.options.getUser('user'));
    const member = interaction.guild?.members.cache.get(user.id);

    const accountCreated = `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`;
    const accountAge = `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`;
    const joinedServer = member?.joinedTimestamp
      ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`
      : 'Not in this server';

    const roles = member?.roles.cache
      .filter(r => r.id !== interaction.guild?.id)
      .sort((a, b) => b.position - a.position)
      .map(r => `<@&${r.id}>`)
      .slice(0, 10)
      .join(', ') || 'None';

    const badges = user.flags?.toArray()
      .map(f => FLAGS[f] || f)
      .join(', ') || 'None';

    const embed = new EmbedBuilder()
      .setTitle(`User Info — ${user.username}`)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .setColor(member?.displayHexColor || '#5865F2')
      .addFields(
        { name: 'Username', value: `${user.username}`, inline: true },
        { name: 'Display Name', value: member?.displayName || user.globalName || user.username, inline: true },
        { name: 'User ID', value: `\`${user.id}\``, inline: true },
        { name: 'Account Created', value: `${accountCreated}\n${accountAge}`, inline: false },
        { name: 'Joined Server', value: joinedServer, inline: false },
        { name: 'Roles', value: roles.length > 900 ? roles.slice(0, 900) + '...' : roles, inline: false },
        { name: 'Badges', value: badges, inline: true },
        { name: 'Bot?', value: user.bot ? 'Yes' : 'No', inline: true },
      )
      .setTimestamp()
      .setFooter({ text: `Requested by ${interaction.user.username}` });

    await interaction.reply({ embeds: [embed] });
  },
};
