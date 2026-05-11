import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from './utils/logger.js';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Validate required environment variables ──────────────────────────────────
const REQUIRED_ENV = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'GUILD_ID', 'MARKET_CHANNEL_ID', 'NEWS_CHANNEL_ID'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  log.error(`Missing required environment variables: ${missing.join(', ')}`, 'startup');
  process.exit(1);
}

// ─── Discord client ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.commands  = new Collection();
client.cooldowns = new Collection();

// ─── Load commands ────────────────────────────────────────────────────────────
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  for (const file of commandFiles) {
    const command = await import(`file://${path.join(commandsPath, file)}`);
    client.commands.set(command.default.data.name, command.default);
    log.info(`Loaded command: ${command.default.data.name}`, 'startup');
  }
}

// ─── Load events ─────────────────────────────────────────────────────────────
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
  const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));
  for (const file of eventFiles) {
    const event = await import(`file://${path.join(eventsPath, file)}`);
    if (event.default.once) {
      client.once(event.default.name, (...args) => event.default.execute(...args));
    } else {
      client.on(event.default.name, (...args) => event.default.execute(...args));
    }
    log.info(`Loaded event: ${event.default.name}`, 'startup');
  }
}

// ─── Discord client-level error & reconnect handling ─────────────────────────
client.on('error', err => {
  log.error(`Client error: ${err.message}`, 'discord');
});

client.on('warn', msg => {
  log.warn(msg, 'discord');
});

client.on('shardDisconnect', (event, shardId) => {
  log.warn(`Shard ${shardId} disconnected (code ${event.code}) — discord.js will auto-reconnect`, 'discord');
});

client.on('shardReconnecting', shardId => {
  log.info(`Shard ${shardId} reconnecting...`, 'discord');
});

client.on('shardResume', (shardId, replayedEvents) => {
  log.info(`Shard ${shardId} resumed (replayed ${replayedEvents} events)`, 'discord');
});

client.on('shardError', (err, shardId) => {
  log.error(`Shard ${shardId} error: ${err.message}`, 'discord');
});

// ─── Process-level crash protection ──────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  log.error(`Unhandled promise rejection: ${reason?.message ?? reason}`, 'process');
});

process.on('uncaughtException', (err) => {
  log.error(`Uncaught exception: ${err.message}\n${err.stack}`, 'process');
  // Don't exit — let Railway's restart policy handle truly fatal crashes
});

// ─── Graceful shutdown (Railway sends SIGTERM before stopping) ────────────────
async function shutdown(signal) {
  log.info(`Received ${signal} — shutting down gracefully`, 'process');
  try {
    client.destroy();
    log.info('Discord client destroyed cleanly', 'process');
  } catch (e) {
    log.error(`Error during shutdown: ${e.message}`, 'process');
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ─── Login ────────────────────────────────────────────────────────────────────
log.info('Connecting to Discord...', 'startup');
client.login(process.env.DISCORD_TOKEN).catch(err => {
  log.error(`Failed to login: ${err.message}`, 'startup');
  process.exit(1);
});
