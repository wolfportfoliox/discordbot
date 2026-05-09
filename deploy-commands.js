import { REST, Routes } from 'discord.js';
import { config } from 'dotenv';

config();

const commands = []; // agar tumhare commands commands folder me hain to ye auto load nahi ho raha, abhi simple rakho

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering commands...');

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log('Commands registered successfully');
  } catch (error) {
    console.error(error);
  }
})();