import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const permsFile = path.join(__dirname, '..', 'data', 'botPermissions.json');

function loadPerms() {
  if (!fs.existsSync(permsFile)) return {};
  try { return JSON.parse(fs.readFileSync(permsFile, 'utf8')); } catch { return {}; }
}

export default {
  name: 'interactionCreate',
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    // Check botset permissions
    const perms = loadPerms();
    const cmdPerms = perms[interaction.commandName];
    if (cmdPerms?.restricted) {
      const memberRoles = interaction.member?.roles?.cache;
      const hasRole = cmdPerms.roles?.some(roleId => memberRoles?.has(roleId));
      if (!hasRole) {
        return await interaction.reply({
          content: `You do not have permission to use \`/${interaction.commandName}\`.`,
          ephemeral: true,
        });
      }
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'Error executing command!', ephemeral: true });
      } else {
        await interaction.reply({ content: 'Error executing command!', ephemeral: true });
      }
    }
  },
};
