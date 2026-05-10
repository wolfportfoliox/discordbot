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
          flags: 64,
        });
      }
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Error in /${interaction.commandName}:`, error.message);
      // Safely attempt to inform the user — ignore if interaction already handled (e.g. modal shown)
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: 'An error occurred while running this command.', flags: 64 });
        } else {
          await interaction.reply({ content: 'An error occurred while running this command.', flags: 64 });
        }
      } catch {
        // Interaction already acknowledged (e.g. modal was shown) — nothing to do
      }
    }
  },
};
