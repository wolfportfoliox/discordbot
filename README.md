# Apex Discord Bot 🤖

An advanced Discord bot with market alerts, live news, and utility commands.

## Features

- 📊 **Live Market Updates** - Top 10 cryptocurrencies every hour
- 📰 **Live News** - Latest crypto, economy, and world news every 30 minutes
- 🚨 **Market Alerts** - Set price alerts for cryptocurrencies
- 💬 **Send Messages** - Send messages to specific channels without embed style
- 👍 **React to Messages** - React with emojis to specific messages

## Setup

### Prerequisites
- Node.js v16+
- Discord Bot Token
- NewsAPI Key
- CoinGecko API (Free - no key needed)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/wolfportfoliox/discordbot.git
cd discordbot
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file and add your configuration:
```
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
GUILD_ID=your_guild_id_here
COINGECKO_API=https://api.coingecko.com/api/v3
NEWSAPI_KEY=your_newsapi_key_here
MARKET_CHANNEL_ID=your_channel_id
NEWS_CHANNEL_ID=your_channel_id
```

4. Run the bot:
```bash
npm start
```

## Commands

### `/marketalert`
Set cryptocurrency price alerts
- `coin` - Coin symbol (e.g., bitcoin, ethereum)
- `price` - Alert price in USD
- `type` - Alert type (above/below)

**Example:**
```
/marketalert coin:bitcoin price:45000 type:below
```

### `/sendmsg`
Send a message to a specific channel without embed style
1. Type `/sendmsg`
2. Enter your message
3. Select the target channel
4. Message sent!

### `/reactmsg`
React with an emoji to a specific message
- `messagelink` - Link to the message
- `emoji` - Emoji to react with

**Example:**
```
/reactmsg messagelink:https://discord.com/channels/... emoji:👍
```

## Scheduling

- **Market Updates**: Every 1 hour
- **News Updates**: Every 30 minutes

## File Structure

```
discordbot/
├── index.js
├── package.json
├── .env
├── .gitignore
├── README.md
├── commands/
│   ├── marketalert.js
│   ├── sendmsg.js
│   └── reactmsg.js
├── events/
│   ├── ready.js
│   ├── interactionCreate.js
│   ├── modalSubmit.js
│   └── selectMenu.js
├── utils/
│   └── schedulers.js
└── data/
    └── marketAlerts.json
```

## Deployment

### Replit (Recommended)
1. Go to https://replit.com
2. Import from GitHub
3. Add `.env` secrets
4. Click Run

### Railway
1. Go to https://railway.app
2. Connect GitHub repo
3. Add environment variables
4. Deploy

### Render
1. Go to https://render.com
2. Create Web Service
3. Connect GitHub
4. Add environment variables
5. Deploy

## Author

wolfportfoliox

## License

MIT
