import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const permsFile = path.join(__dirname, '..', 'data', 'botPermissions.json');

function loadPerms() {
  if (!fs.existsSync(permsFile)) return {};
  try { return JSON.parse(fs.readFileSync(permsFile, 'utf8')); } catch { return {}; }
}

function savePerms(data) {
  const dir = path.dirname(permsFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(permsFile, JSON.stringify(data, null, 2));
}

export default {
  data: new SlashCommandBuilder()
    .setName('botset')
    .setDescription('Manage which commands roles can access (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('allow')
        .setDescription('Allow a role to use a command')
        .addRoleOption(o => o.setName('role').setDescription('The role').setRequired(true))
        .addStringOption(o => o.setName('command').setDescription('Command name (e.g. marketalert)').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('deny')
        .setDescription('Remove a role\'s access to a command')
        .addRoleOption(o => o.setName('role').setDescription('The role').setRequired(true))
        .addStringOption(o => o.setName('command').setDescription('Command name').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('restrict')
        .setDescription('Restrict a command to specific roles only (others cannot use it)')
        .addStringOption(o => o.setName('command').setDescription('Command name').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('unrestrict')
        .setDescription('Make a command available to everyone again')
        .addStringOption(o => o.setName('command').setDescription('Command name').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('Show all current command permission settings')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const perms = loadPerms();

    if (sub === 'list') {
      if (!Object.keys(perms).length) {
        return await interaction.reply({ content: 'No command restrictions are set. All commands are open to everyone.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('Bot Command Permissions')
        .setColor('#5865F2')
        .setTimestamp();

      for (const [cmd, data] of Object.entries(perms)) {
        const roleList = data.roles?.map(id => `<@&${id}>`).join(', ') || 'None';
        embed.addFields({
          name: `/${cmd}`,
          value: `Restricted: **${data.restricted ? 'Yes' : 'No'}**\nAllowed roles: ${roleList}`,
          inline: false,
        });
      }

      return await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'allow') {
      const role = interaction.options.getRole('role');
      const cmd = interaction.options.getString('command').toLowerCase();
      if (!perms[cmd]) perms[cmd] = { restricted: false, roles: [] };
      if (!perms[cmd].roles.includes(role.id)) perms[cmd].roles.push(role.id);
      savePerms(perms);
      return await interaction.reply({ content: `<@&${role.id}> can now use \`/${cmd}\`.`, ephemeral: true });
    }

    if (sub === 'deny') {
      const role = interaction.options.getRole('role');
      const cmd = interaction.options.getString('command').toLowerCase();
      if (perms[cmd]) {
        perms[cmd].roles = perms[cmd].roles.filter(id => id !== role.id);
        savePerms(perms);
      }
      return await interaction.reply({ content: `<@&${role.id}> can no longer use \`/${cmd}\`.`, ephemeral: true });
    }

    if (sub === 'restrict') {
      const cmd = interaction.options.getString('command').toLowerCase();
      if (!perms[cmd]) perms[cmd] = { restricted: true, roles: [] };
      else perms[cmd].restricted = true;
      savePerms(perms);
      return await interaction.reply({ content: `\`/${cmd}\` is now restricted. Only roles you allow with \`/botset allow\` can use it.`, ephemeral: true });
    }

    if (sub === 'unrestrict') {
      const cmd = interaction.options.getString('command').toLowerCase();
      if (perms[cmd]) { perms[cmd].restricted = false; savePerms(perms); }
      return await interaction.reply({ content: `\`/${cmd}\` is now open to everyone.`, ephemeral: true });
    }
  },
};
