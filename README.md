# Baconcheep Gambling Bot

A Discord bot for gambling games, featuring a coinflip system with money and item betting.

## Features

- **Coinflip Games**: Bet money or items against other players
- **Inventory System**: Manage items with different values
- **User Statistics**: Track wins, losses, and profit
- **Tax System**: 10% tax on all winnings
- **Admin Commands**: Add money and items to users
- **Private Deposit Channels**: Create private channels for users

## Commands

### User Commands
- `/coinflip` - Start a new coinflip game (bet money or items)
- `/inventory [user]` - Check your or another user's inventory and balance
- `/stats [user]` - View gambling statistics
- `/cancel [gameid]` - Cancel your active coinflip game
- `/deposit` - Create a private deposit channel

### Admin Commands
- `/additem <user> <name> <value>` - Give an item to a user
- `/addmoney <user> <amount>` - Add money to a user's balance

## Setup

### Prerequisites
- Node.js v16 or higher
- A Discord Bot Token
- A Discord Server with necessary permissions

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd baconcheep-gambling
```

2. Install dependencies:
```bash
npm install
```

3. Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
```

4. Edit `.env` with your Discord bot credentials:
   - Get your bot token from [Discord Developer Portal](https://discord.com/developers/applications)
   - Enable Developer Mode in Discord (User Settings > Advanced)
   - Right-click channels/roles to copy their IDs

### Required Environment Variables

```
TOKEN              - Your Discord bot token
CLIENT_ID          - Your Discord application ID
GUILD_ID           - Your Discord server ID
ADMIN_ROLE_ID      - Role ID that can use admin commands
WITHDRAW_ROLE_ID   - (Currently unused)
DEPOSIT_CATEGORY_ID - Category ID where deposit channels are created
COINFLIP_CHANNEL_ID - Channel ID where coinflip games are posted
```

### Running the Bot

Development mode (with auto-restart):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## How Coinflip Works

### Creating a Game
1. Use `/coinflip` command
2. Choose to bet **Money** or **Items**
3. Select the amount or items to bet
4. A game is created in the coinflip channel

### Joining a Game
1. Click the **JOIN** button on an active game
2. For money games: You need the exact amount
3. For item games: Bot auto-matches items within ±10% value
4. Winner is randomly selected (50/50 chance)

### Rewards
- Winner receives the total pool minus 10% tax
- Taxes are tracked in the system
- Statistics are automatically updated

## Database

The bot uses SQLite (`botdata.db`) with the following tables:
- `users` - User profiles with balance and statistics
- `inventory` - User items with values
- `coinflips` - Active and completed games
- `taxSystem` - Tax tracking for all games

## Technical Features

### Reliability & Stability
- **Database Transactions**: All money/item operations use atomic transactions to prevent data loss
- **Race Condition Prevention**: Concurrent join attempts are handled safely
- **Error Handling**: Comprehensive try-catch blocks prevent crashes
- **Null Safety**: All message operations check for null/undefined
- **Input Validation**: All user inputs are validated before processing

### Performance
- **Efficient Queries**: Prepared statements for all database operations
- **Foreign Keys**: Enabled for data integrity
- **Indexed Lookups**: Fast user and inventory retrieval

## Troubleshooting

### Bot crashes with "Interaction failed"
This was a common issue that has been fixed. The problem was:
- Incorrect parsing of custom amount selection
- Missing error handling in message collectors
- Race conditions in concurrent joins

All these issues have been resolved in the current version.

### Money disappears after failed game
The bot now uses database transactions to ensure:
- Money is only removed after successful game creation
- Failed operations are rolled back automatically
- No partial updates can occur

### Bot doesn't respond
Check:
1. Bot token is correct in `.env`
2. Bot has proper permissions in the server
3. All channel IDs in `.env` are correct
4. Bot is online and logged in

## License

MIT
