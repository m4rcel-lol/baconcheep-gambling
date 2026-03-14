const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const Database = require('better-sqlite3');
require('dotenv').config();

// ==================== CONFIGURATION ====================
const config = {
    token: process.env.TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
    adminRoleId: process.env.ADMIN_ROLE_ID,
    withdrawRoleId: process.env.WITHDRAW_ROLE_ID,
    depositCategoryId: process.env.DEPOSIT_CATEGORY_ID,
    coinflipChannelId: process.env.COINFLIP_CHANNEL_ID,
    taxRate: 0.10 // 10% tax
};

// ==================== SQLITE DATABASE SETUP ====================
const db = new Database('botdata.db');

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create tables with all required columns
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        userId TEXT PRIMARY KEY,
        username TEXT,
        balance REAL DEFAULT 0.0,
        totalWagered REAL DEFAULT 0,
        totalWon REAL DEFAULT 0,
        totalLost REAL DEFAULT 0,
        coinflipsPlayed INTEGER DEFAULT 0,
        coinflipsWon INTEGER DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        itemName TEXT,
        itemValue REAL,
        acquiredAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS taxSystem (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT,
        name TEXT,
        value REAL,
        source TEXT,
        sourceGame TEXT,
        taxedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS coinflips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channelId TEXT,
        messageId TEXT,
        creatorId TEXT,
        creatorName TEXT,
        betType TEXT,
        creatorItems TEXT,
        creatorMoney REAL,
        creatorTotalValue REAL,
        participants TEXT DEFAULT '[]',
        winnerId TEXT,
        status TEXT DEFAULT 'waiting',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

console.log('✅ Database initialized');

// ==================== HELPER FUNCTIONS ====================
function getUser(userId, username) {
    try {
        let user = db.prepare('SELECT * FROM users WHERE userId = ?').get(userId);
        
        if (!user) {
            db.prepare('INSERT INTO users (userId, username) VALUES (?, ?)').run(userId, username);
            user = db.prepare('SELECT * FROM users WHERE userId = ?').get(userId);
        }
        
        return user;
    } catch (error) {
        console.error('Error in getUser:', error);
        return { userId, username, balance: 0, totalWagered: 0, totalWon: 0, totalLost: 0, coinflipsPlayed: 0, coinflipsWon: 0 };
    }
}

function getInventory(userId) {
    try {
        return db.prepare('SELECT * FROM inventory WHERE userId = ? ORDER BY itemValue ASC').all(userId);
    } catch (error) {
        console.error('Error in getInventory:', error);
        return [];
    }
}

function addItemToInventory(userId, itemName, itemValue) {
    try {
        db.prepare('INSERT INTO inventory (userId, itemName, itemValue) VALUES (?, ?, ?)').run(userId, itemName, itemValue);
    } catch (error) {
        console.error('Error in addItemToInventory:', error);
    }
}

function removeItemsFromInventory(userId, itemIds) {
    try {
        const placeholders = itemIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM inventory WHERE userId = ? AND id IN (${placeholders})`).run(userId, ...itemIds);
    } catch (error) {
        console.error('Error in removeItemsFromInventory:', error);
    }
}

function addBalance(userId, amount) {
    try {
        db.prepare('UPDATE users SET balance = balance + ? WHERE userId = ?').run(amount, userId);
    } catch (error) {
        console.error('Error in addBalance:', error);
    }
}

function removeBalance(userId, amount) {
    try {
        db.prepare('UPDATE users SET balance = balance - ? WHERE userId = ?').run(amount, userId);
    } catch (error) {
        console.error('Error in removeBalance:', error);
    }
}

function getBalance(userId) {
    try {
        const user = db.prepare('SELECT balance FROM users WHERE userId = ?').get(userId);
        return user ? user.balance : 0;
    } catch (error) {
        console.error('Error in getBalance:', error);
        return 0;
    }
}

function addTax(type, name, value, source, sourceGame) {
    try {
        db.prepare('INSERT INTO taxSystem (type, name, value, source, sourceGame) VALUES (?, ?, ?, ?, ?)')
            .run(type, name, value, source, sourceGame);
    } catch (error) {
        console.error('Error in addTax:', error);
    }
}

function updateStats(userId, type, amount) {
    try {
        if (type === 'win') {
            db.prepare('UPDATE users SET totalWon = totalWon + ?, coinflipsWon = coinflipsWon + 1, coinflipsPlayed = coinflipsPlayed + 1 WHERE userId = ?').run(amount, userId);
        } else if (type === 'loss') {
            db.prepare('UPDATE users SET totalLost = totalLost + ?, coinflipsPlayed = coinflipsPlayed + 1 WHERE userId = ?').run(amount, userId);
        }
        db.prepare('UPDATE users SET totalWagered = totalWagered + ? WHERE userId = ?').run(amount, userId);
    } catch (error) {
        console.error('Error in updateStats:', error);
    }
}

// ==================== CLIENT SETUP ====================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// ==================== COMMAND DEFINITIONS ====================
const commands = [
    new SlashCommandBuilder()
        .setName('additem')
        .setDescription('Give an item to a user (Admin only)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to give the item to')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Item name')
                .setRequired(true))
        .addNumberOption(option =>
            option.setName('value')
                .setDescription('Item value')
                .setRequired(true)
                .setMinValue(0.01)),

    new SlashCommandBuilder()
        .setName('addmoney')
        .setDescription('Add money to a user (Admin only)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to add money to')
                .setRequired(true))
        .addNumberOption(option =>
            option.setName('amount')
                .setDescription('Amount to add (can use decimals)')
                .setRequired(true)
                .setMinValue(0.01)),

    new SlashCommandBuilder()
        .setName('deposit')
        .setDescription('Create a private deposit channel'),

    new SlashCommandBuilder()
        .setName('inventory')
        .setDescription('Check your inventory and balance')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Check your gambling stats')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check stats of')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Start a coinflip game'),

    new SlashCommandBuilder()
        .setName('cancel')
        .setDescription('Cancel your active coinflip game')
        .addStringOption(option =>
            option.setName('gameid')
                .setDescription('ID of the game to cancel (optional)')
                .setRequired(false))
];

// ==================== COMMAND HANDLERS ====================
async function handleAddItem(interaction) {
    if (!interaction.member.roles.cache.has(config.adminRoleId)) {
        return interaction.reply({ content: '❌ You need the admin role!', ephemeral: true });
    }
    
    const targetUser = interaction.options.getUser('user');
    const itemName = interaction.options.getString('name');
    const itemValue = interaction.options.getNumber('value');
    
    try {
        getUser(targetUser.id, targetUser.username);
        addItemToInventory(targetUser.id, itemName, itemValue);
        
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('✅ Item Added')
            .setDescription(`Gave **${itemName}** ($${itemValue.toFixed(2)}) to ${targetUser}`)
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
        
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: '❌ Error!', ephemeral: true });
    }
}

async function handleAddMoney(interaction) {
    if (!interaction.member.roles.cache.has(config.adminRoleId)) {
        return interaction.reply({ content: '❌ You need the admin role!', ephemeral: true });
    }
    
    const targetUser = interaction.options.getUser('user');
    const amount = interaction.options.getNumber('amount');
    
    try {
        getUser(targetUser.id, targetUser.username);
        addBalance(targetUser.id, amount);
        
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('💰 Money Added')
            .setDescription(`Added **$${amount.toFixed(2)}** to ${targetUser}`)
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
        
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: '❌ Error!', ephemeral: true });
    }
}

async function handleDeposit(interaction) {
    const category = interaction.guild.channels.cache.get(config.depositCategoryId);
    if (!category) {
        return interaction.reply({ content: '❌ Deposit category not found!', ephemeral: true });
    }
    
    const channelName = `deposit-${interaction.user.username.toLowerCase()}`;
    const existing = interaction.guild.channels.cache.find(c => c.name === channelName);
    
    if (existing) {
        return interaction.reply({ content: `❌ You already have ${existing}`, ephemeral: true });
    }
    
    try {
        const channel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: config.depositCategoryId,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });
        
        await interaction.reply({ content: `✅ Created ${channel}`, ephemeral: true });
        
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: '❌ Error!', ephemeral: true });
    }
}

async function handleInventory(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    
    const user = getUser(target.id, target.username);
    const inventory = getInventory(target.id);
    const balance = user?.balance ?? 0;
    
    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`📊 ${target.username}'s Profile`)
        .setThumbnail(target.displayAvatarURL({ dynamic: true }))
        .addFields(
            { name: '💰 Balance', value: `**$${balance.toFixed(2)}**` }
        )
        .setTimestamp();
    
    if (inventory.length > 0) {
        let itemList = '';
        let totalValue = 0;
        
        inventory.forEach((item, i) => {
            itemList += `**${i+1}.** ${item.itemName} — **$${item.itemValue.toFixed(2)}**\n`;
            totalValue += item.itemValue;
        });
        
        embed.addFields(
            { name: '📦 Items', value: itemList.slice(0, 1024) },
            { name: '💎 Total Value', value: `**$${totalValue.toFixed(2)}**` }
        );
    } else {
        embed.addFields({ name: '📦 Items', value: 'No items' });
    }
    
    await interaction.reply({ embeds: [embed] });
}

async function handleStats(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const user = getUser(target.id, target.username);
    
    const winRate = user.coinflipsPlayed > 0 ? ((user.coinflipsWon / user.coinflipsPlayed) * 100).toFixed(2) : 0;
    const profit = (user.totalWon || 0) - (user.totalLost || 0);
    
    const embed = new EmbedBuilder()
        .setColor('#ff9900')
        .setTitle(`📊 ${target.username}'s Stats`)
        .setThumbnail(target.displayAvatarURL({ dynamic: true }))
        .addFields(
            { name: '💰 Wagered', value: `**$${(user.totalWagered || 0).toFixed(2)}**`, inline: true },
            { name: '🏆 Won', value: `**$${(user.totalWon || 0).toFixed(2)}**`, inline: true },
            { name: '💔 Lost', value: `**$${(user.totalLost || 0).toFixed(2)}**`, inline: true },
            { name: '📈 Profit', value: `**$${profit.toFixed(2)}**`, inline: true },
            { name: '🎲 Games', value: `**${user.coinflipsPlayed || 0}**`, inline: true },
            { name: '✅ Wins', value: `**${user.coinflipsWon || 0}**`, inline: true },
            { name: '📊 Win Rate', value: `**${winRate}%**`, inline: true }
        )
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
}

async function handleCancel(interaction) {
    const activeGames = db.prepare(`
        SELECT * FROM coinflips 
        WHERE creatorId = ? AND status = 'waiting'
    `).all(interaction.user.id);
    
    if (activeGames.length === 0) {
        return interaction.reply({ content: '❌ No active games!', ephemeral: true });
    }
    
    const game = activeGames[0];
    
    if (game.betType === 'money') {
        addBalance(game.creatorId, game.creatorMoney);
    } else {
        const items = JSON.parse(game.creatorItems);
        items.forEach(item => addItemToInventory(game.creatorId, item.name, item.value));
    }
    
    db.prepare('UPDATE coinflips SET status = ? WHERE id = ?').run('cancelled', game.id);
    
    if (game.channelId && game.messageId) {
        try {
            const channel = client.channels.cache.get(game.channelId);
            if (channel) {
                const msg = await channel.messages.fetch(game.messageId);
                await msg.edit({ 
                    embeds: [new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('❌ Cancelled')
                        .setDescription(`Cancelled by ${interaction.user.username}`)
                        .setTimestamp()
                    ], 
                    components: [] 
                });
            }
        } catch (e) {}
    }
    
    await interaction.reply({ content: '✅ Game cancelled!', ephemeral: true });
}

async function handleCoinflip(interaction) {
    const coinflipChannel = client.channels.cache.get(config.coinflipChannelId);
    
    if (!coinflipChannel) {
        return interaction.reply({ content: '❌ Coinflip channel not found!', ephemeral: true });
    }
    
    getUser(interaction.user.id, interaction.user.username);
    const inventory = getInventory(interaction.user.id);
    const balance = getBalance(interaction.user.id);
    
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('bet_type')
        .setPlaceholder('Choose what to bet')
        .addOptions(
            { label: '💰 Bet Money', description: `Balance: $${balance.toFixed(2)}`, value: 'money', emoji: '💰' },
            { label: '📦 Bet Items', description: `${inventory.length} items`, value: 'items', emoji: '📦' }
        );
    
    await interaction.reply({ 
        embeds: [new EmbedBuilder()
            .setColor('#ffd700')
            .setTitle('🎲 Start a Coinflip')
            .addFields(
                { name: '💰 Balance', value: `$${balance.toFixed(2)}`, inline: true },
                { name: '📦 Items', value: `${inventory.length}`, inline: true }
            )
        ], 
        components: [new ActionRowBuilder().addComponents(selectMenu)], 
        ephemeral: true 
    });
}

// ==================== BUTTON HANDLERS ====================
async function handleJoin(interaction, gameId, message) {
    try {
        await interaction.deferReply({ ephemeral: true });
        
        const game = db.prepare('SELECT * FROM coinflips WHERE id = ?').get(gameId);
        
        if (!game || game.status !== 'waiting') {
            return interaction.editReply({ content: '❌ Game no longer available!' });
        }
        
        if (interaction.user.id === game.creatorId) {
            return interaction.editReply({ content: '❌ Cannot join your own game!' });
        }
        
        const participants = JSON.parse(game.participants || '[]');
        if (participants.some(p => p.userId === interaction.user.id)) {
            return interaction.editReply({ content: '❌ Already joined this game!' });
        }
        
        getUser(interaction.user.id, interaction.user.username);
        
        if (game.betType === 'money') {
            await handleJoinMoney(interaction, game, message);
        } else {
            await handleJoinItems(interaction, game, message);
        }
        
    } catch (error) {
        console.error('Join error:', error);
        await interaction.editReply({ content: '❌ An error occurred!' }).catch(() => {});
    }
}

async function handleJoinMoney(interaction, game, message) {
    const balance = getBalance(interaction.user.id);
    const amount = game.creatorMoney;

    if (balance < amount) {
        return interaction.editReply({ content: `❌ Need $${amount.toFixed(2)}! You have $${balance.toFixed(2)}.` });
    }

    // Use a transaction to prevent race conditions
    const transaction = db.transaction(() => {
        // Re-check game status within transaction
        const currentGame = db.prepare('SELECT * FROM coinflips WHERE id = ? AND status = ?').get(game.id, 'waiting');
        if (!currentGame) {
            throw new Error('Game no longer available');
        }

        const participants = JSON.parse(currentGame.participants || '[]');

        // Check if already joined
        if (participants.some(p => p.userId === interaction.user.id)) {
            throw new Error('Already joined');
        }

        // Check if game already has participants
        if (participants.length > 0) {
            throw new Error('Game is full');
        }

        // Remove balance
        removeBalance(interaction.user.id, amount);

        // Add participant
        participants.push({ userId: interaction.user.id, username: interaction.user.username, amount: amount });
        db.prepare('UPDATE coinflips SET participants = ? WHERE id = ?').run(JSON.stringify(participants), currentGame.id);
    });

    try {
        transaction();
        await startMoneyCoinflip(game.id, message);
        await interaction.editReply({ content: `✅ Joined with $${amount.toFixed(2)}!` });
    } catch (error) {
        console.error('Join money error:', error);
        if (error.message === 'Game no longer available' || error.message === 'Game is full') {
            return interaction.editReply({ content: `❌ ${error.message}!` });
        } else if (error.message === 'Already joined') {
            return interaction.editReply({ content: '❌ Already joined this game!' });
        }
        return interaction.editReply({ content: '❌ An error occurred while joining!' });
    }
}

async function handleJoinItems(interaction, game, message) {
    const inventory = getInventory(interaction.user.id);
    const creatorItems = JSON.parse(game.creatorItems);

    if (inventory.length < creatorItems.length) {
        return interaction.editReply({ content: `❌ Need ${creatorItems.length} items!` });
    }

    // Auto-select lowest matching items
    const selectedItems = [];
    const usedIds = new Set();

    for (const creatorItem of creatorItems) {
        const minValue = Math.floor(creatorItem.value * 0.9);
        const maxValue = Math.ceil(creatorItem.value * 1.1);

        const matches = inventory
            .filter(item => !usedIds.has(item.id) && item.itemValue >= minValue && item.itemValue <= maxValue)
            .sort((a, b) => a.itemValue - b.itemValue);

        if (matches.length === 0) {
            return interaction.editReply({ content: `❌ Can't match ${creatorItem.name} ($${minValue}-$${maxValue})` });
        }

        selectedItems.push(matches[0]);
        usedIds.add(matches[0].id);
    }

    // Use a transaction to prevent race conditions
    const transaction = db.transaction(() => {
        // Re-check game status within transaction
        const currentGame = db.prepare('SELECT * FROM coinflips WHERE id = ? AND status = ?').get(game.id, 'waiting');
        if (!currentGame) {
            throw new Error('Game no longer available');
        }

        const participants = JSON.parse(currentGame.participants || '[]');

        // Check if already joined
        if (participants.some(p => p.userId === interaction.user.id)) {
            throw new Error('Already joined');
        }

        // Check if game already has participants
        if (participants.length > 0) {
            throw new Error('Game is full');
        }

        // Remove items
        removeItemsFromInventory(interaction.user.id, selectedItems.map(i => i.id));

        // Add participant
        participants.push({
            userId: interaction.user.id,
            username: interaction.user.username,
            items: selectedItems.map(i => ({ name: i.itemName, value: i.itemValue })),
            totalValue: selectedItems.reduce((sum, i) => sum + i.itemValue, 0)
        });
        db.prepare('UPDATE coinflips SET participants = ? WHERE id = ?').run(JSON.stringify(participants), currentGame.id);
    });

    try {
        transaction();
        await startItemCoinflip(game.id, message);
        await interaction.editReply({ content: `✅ Joined with ${selectedItems.length} items!` });
    } catch (error) {
        console.error('Join items error:', error);
        if (error.message === 'Game no longer available' || error.message === 'Game is full') {
            return interaction.editReply({ content: `❌ ${error.message}!` });
        } else if (error.message === 'Already joined') {
            return interaction.editReply({ content: '❌ Already joined this game!' });
        }
        return interaction.editReply({ content: '❌ An error occurred while joining!' });
    }
}

async function startMoneyCoinflip(gameId, message) {
    try {
        if (!message) {
            console.error('startMoneyCoinflip: message is null or undefined');
            return;
        }

        const game = db.prepare('SELECT * FROM coinflips WHERE id = ?').get(gameId);
        if (!game || game.status !== 'waiting') return;

        const participants = JSON.parse(game.participants || '[]');
        if (participants.length === 0) return;

        const joiner = participants[0];
        const amount = game.creatorMoney;
        const totalPool = amount * 2;
        const taxAmount = totalPool * config.taxRate;
        const winnings = totalPool - taxAmount;

        const winner = Math.random() < 0.5 ? 'creator' : 'joiner';

        // Use transaction to ensure atomic updates
        const transaction = db.transaction(() => {
            if (winner === 'creator') {
                addBalance(game.creatorId, winnings);
                addTax('money', 'tax', taxAmount, game.creatorName, game.id);
                updateStats(game.creatorId, 'win', winnings);
                updateStats(joiner.userId, 'loss', amount);
            } else {
                addBalance(joiner.userId, winnings);
                addTax('money', 'tax', taxAmount, joiner.username, game.id);
                updateStats(joiner.userId, 'win', winnings);
                updateStats(game.creatorId, 'loss', amount);
            }

            db.prepare('UPDATE coinflips SET status = ?, winnerId = ? WHERE id = ?')
                .run('completed', winner === 'creator' ? game.creatorId : joiner.userId, game.id);
        });

        transaction();

        const winnerName = winner === 'creator' ? game.creatorName : joiner.username;

        await message.edit({
            embeds: [new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('💰 Coinflip Completed!')
                .setDescription(`**${winnerName}** wins!`)
                .addFields(
                    { name: '💰 Total', value: `$${totalPool.toFixed(2)}` },
                    { name: '📊 Tax', value: `$${taxAmount.toFixed(2)}` },
                    { name: '💵 Winnings', value: `$${winnings.toFixed(2)}` }
                )
                .setTimestamp()
            ],
            components: []
        });

        setTimeout(() => message.delete().catch(() => {}), 15000);
    } catch (error) {
        console.error('Error in startMoneyCoinflip:', error);
    }
}

async function startItemCoinflip(gameId, message) {
    try {
        if (!message) {
            console.error('startItemCoinflip: message is null or undefined');
            return;
        }

        const game = db.prepare('SELECT * FROM coinflips WHERE id = ?').get(gameId);
        if (!game || game.status !== 'waiting') return;

        const creatorItems = JSON.parse(game.creatorItems);
        const participants = JSON.parse(game.participants || '[]');
        if (participants.length === 0) return;

        const joiner = participants[0];
        const totalPool = game.creatorTotalValue + joiner.totalValue;
        const taxAmount = totalPool * config.taxRate;

        const winner = Math.random() < 0.5 ? 'creator' : 'joiner';
        const allItems = [...creatorItems, ...joiner.items];

        // Use transaction to ensure atomic updates
        const transaction = db.transaction(() => {
            if (winner === 'creator') {
                allItems.forEach(item => addItemToInventory(game.creatorId, item.name, item.value));
                allItems.forEach(item => {
                    const itemTax = (item.value / totalPool) * taxAmount;
                    addTax('item', item.name, itemTax, game.creatorName, game.id);
                });
                updateStats(game.creatorId, 'win', totalPool - taxAmount);
                updateStats(joiner.userId, 'loss', joiner.totalValue);
            } else {
                allItems.forEach(item => addItemToInventory(joiner.userId, item.name, item.value));
                allItems.forEach(item => {
                    const itemTax = (item.value / totalPool) * taxAmount;
                    addTax('item', item.name, itemTax, joiner.username, game.id);
                });
                updateStats(joiner.userId, 'win', totalPool - taxAmount);
                updateStats(game.creatorId, 'loss', game.creatorTotalValue);
            }

            db.prepare('UPDATE coinflips SET status = ?, winnerId = ? WHERE id = ?')
                .run('completed', winner === 'creator' ? game.creatorId : joiner.userId, game.id);
        });

        transaction();

        const winnerName = winner === 'creator' ? game.creatorName : joiner.username;
        const itemsList = allItems.map(i => `**${i.name}** ($${i.value.toFixed(2)})`).join('\n');

        await message.edit({
            embeds: [new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('📦 Coinflip Completed!')
                .setDescription(`**${winnerName}** wins!`)
                .addFields(
                    { name: '💰 Total', value: `$${totalPool.toFixed(2)}` },
                    { name: '📊 Tax', value: `$${taxAmount.toFixed(2)}` },
                    { name: '📦 Items', value: itemsList.slice(0, 1024) }
                )
                .setTimestamp()
            ],
            components: []
        });

        setTimeout(() => message.delete().catch(() => {}), 15000);
    } catch (error) {
        console.error('Error in startItemCoinflip:', error);
    }
}

// ==================== CLIENT EVENTS ====================
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`📁 SQLite database: botdata.db`);
    
    try {
        await client.application.commands.set(commands);
        console.log('✅ Slash commands registered');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
    
    client.user.setActivity('/coinflip | 10% tax', { type: 3 });
});

client.on('interactionCreate', async interaction => {
    try {
        // Handle buttons
        if (interaction.isButton()) {
            if (interaction.customId.startsWith('join_')) {
                const gameId = interaction.customId.split('_')[1];
                const message = interaction.message;
                await handleJoin(interaction, gameId, message);
            }
            return;
        }
        
        // Handle select menus
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'bet_type') {
                await interaction.deferUpdate();
                
                const betType = interaction.values[0];
                const coinflipChannel = client.channels.cache.get(config.coinflipChannelId);
                
                if (betType === 'money') {
                    const balance = getBalance(interaction.user.id);
                    
                    const amountSelect = new StringSelectMenuBuilder()
                        .setCustomId('money_amount')
                        .setPlaceholder('Choose amount')
                        .addOptions([
                            { label: '$10', value: '10', emoji: '💰' },
                            { label: '$25', value: '25', emoji: '💰' },
                            { label: '$50', value: '50', emoji: '💰' },
                            { label: '$100', value: '100', emoji: '💰' },
                            { label: 'Custom', value: 'custom', emoji: '✏️' }
                        ].filter(opt => betType === 'money' ? balance >= parseInt(opt.value) || opt.value === 'custom' : true));
                    
                    await interaction.editReply({ 
                        embeds: [new EmbedBuilder()
                            .setColor('#ffd700')
                            .setTitle('💰 Choose Amount')
                            .addFields({ name: 'Your Balance', value: `$${balance.toFixed(2)}` })
                        ], 
                        components: [new ActionRowBuilder().addComponents(amountSelect)] 
                    });
                    
                } else {
                    const inventory = getInventory(interaction.user.id);
                    
                    if (inventory.length === 0) {
                        return interaction.editReply({ content: '❌ No items!', components: [] });
                    }
                    
                    const itemSelect = new StringSelectMenuBuilder()
                        .setCustomId('select_items')
                        .setPlaceholder('Choose items (1-15)')
                        .setMinValues(1)
                        .setMaxValues(Math.min(15, inventory.length));
                    
                    inventory.forEach(item => {
                        itemSelect.addOptions({
                            label: `${item.itemName} ($${item.itemValue.toFixed(2)})`,
                            value: item.id.toString(),
                            emoji: '📦'
                        });
                    });
                    
                    await interaction.editReply({ 
                        embeds: [new EmbedBuilder()
                            .setColor('#ffd700')
                            .setTitle('📦 Choose Items')
                            .addFields({ name: 'Your Items', value: `${inventory.length} available` })
                        ], 
                        components: [new ActionRowBuilder().addComponents(itemSelect)] 
                    });
                }
            }
            
            else if (interaction.customId === 'money_amount') {
                await interaction.deferUpdate();

                const selectedValue = interaction.values[0];
                const coinflipChannel = client.channels.cache.get(config.coinflipChannelId);

                if (selectedValue === 'custom') {
                    await interaction.editReply({ 
                        content: 'Type the amount you want to bet:', 
                        components: [] 
                    });
                    
                    const filter = m => m.author.id === interaction.user.id && !isNaN(m.content) && parseFloat(m.content) > 0;
                    const collector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });

                    collector.on('collect', async m => {
                        try {
                            const customAmount = parseFloat(m.content);

                            if (isNaN(customAmount) || customAmount <= 0) {
                                return m.reply({ content: '❌ Invalid amount! Please enter a positive number.', ephemeral: true });
                            }

                            const balance = getBalance(interaction.user.id);

                            if (customAmount > balance) {
                                return m.reply({ content: `❌ Insufficient funds! You have $${balance.toFixed(2)}.`, ephemeral: true });
                            }

                            removeBalance(interaction.user.id, customAmount);

                            const result = db.prepare(`
                                INSERT INTO coinflips (channelId, creatorId, creatorName, betType, creatorMoney, creatorTotalValue, status)
                                VALUES (?, ?, ?, ?, ?, ?, 'waiting')
                            `).run(coinflipChannel.id, interaction.user.id, interaction.user.username, 'money', customAmount, customAmount);

                            const gameEmbed = new EmbedBuilder()
                                .setColor('#ffd700')
                                .setTitle('💰 New Money Coinflip')
                                .setDescription(`${interaction.user.username} is looking for an opponent!`)
                                .addFields(
                                    { name: 'Amount', value: `$${customAmount.toFixed(2)}` },
                                    { name: 'Tax', value: '10% on winnings' }
                                )
                                .setTimestamp();

                            const row = new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`join_${result.lastInsertRowid}`)
                                    .setLabel('💰 JOIN')
                                    .setStyle(ButtonStyle.Success)
                            );

                            const msg = await coinflipChannel.send({ embeds: [gameEmbed], components: [row] });
                            db.prepare('UPDATE coinflips SET messageId = ? WHERE id = ?').run(msg.id, result.lastInsertRowid);

                            await m.reply({ content: '✅ Game created!', ephemeral: true });
                            await interaction.editReply({ content: `✅ Coinflip created for $${customAmount.toFixed(2)}!`, components: [] }).catch(() => {});
                        } catch (error) {
                            console.error('Custom amount collection error:', error);
                            await m.reply({ content: '❌ An error occurred while creating the game!', ephemeral: true }).catch(() => {});
                        }
                    });

                    collector.on('end', (collected, reason) => {
                        if (reason === 'time' && collected.size === 0) {
                            interaction.editReply({ content: '❌ Timed out! Please try again.', components: [] }).catch(() => {});
                        }
                    });

                } else {
                    const amount = parseFloat(selectedValue);

                    if (isNaN(amount) || amount <= 0) {
                        return interaction.editReply({ content: '❌ Invalid amount!', components: [] });
                    }

                    const balance = getBalance(interaction.user.id);
                    if (balance < amount) {
                        return interaction.editReply({ content: `❌ Insufficient funds! You have $${balance.toFixed(2)}.`, components: [] });
                    }

                    removeBalance(interaction.user.id, amount);
                    
                    const result = db.prepare(`
                        INSERT INTO coinflips (channelId, creatorId, creatorName, betType, creatorMoney, creatorTotalValue, status)
                        VALUES (?, ?, ?, ?, ?, ?, 'waiting')
                    `).run(coinflipChannel.id, interaction.user.id, interaction.user.username, 'money', amount, amount);
                    
                    const gameEmbed = new EmbedBuilder()
                        .setColor('#ffd700')
                        .setTitle('💰 New Money Coinflip')
                        .setDescription(`${interaction.user.username} is looking for an opponent!`)
                        .addFields(
                            { name: 'Amount', value: `$${amount.toFixed(2)}` },
                            { name: 'Tax', value: '10% on winnings' }
                        )
                        .setTimestamp();
                    
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`join_${result.lastInsertRowid}`)
                            .setLabel('💰 JOIN')
                            .setStyle(ButtonStyle.Success)
                    );
                    
                    const msg = await coinflipChannel.send({ embeds: [gameEmbed], components: [row] });
                    db.prepare('UPDATE coinflips SET messageId = ? WHERE id = ?').run(msg.id, result.lastInsertRowid);
                    
                    await interaction.editReply({ content: '✅ Game created!', components: [] });
                }
            }
            
            else if (interaction.customId === 'select_items') {
                await interaction.deferUpdate();
                
                const selectedIds = interaction.values;
                const inventory = getInventory(interaction.user.id);
                const selectedItems = inventory.filter(item => selectedIds.includes(item.id.toString()));
                const totalValue = selectedItems.reduce((sum, item) => sum + item.itemValue, 0);
                
                removeItemsFromInventory(interaction.user.id, selectedItems.map(i => i.id));
                
                const coinflipChannel = client.channels.cache.get(config.coinflipChannelId);
                const creatorItems = selectedItems.map(i => ({ name: i.itemName, value: i.itemValue }));
                
                const result = db.prepare(`
                    INSERT INTO coinflips (channelId, creatorId, creatorName, betType, creatorItems, creatorTotalValue, status)
                    VALUES (?, ?, ?, ?, ?, ?, 'waiting')
                `).run(coinflipChannel.id, interaction.user.id, interaction.user.username, 'items', JSON.stringify(creatorItems), totalValue);
                
                const itemsList = selectedItems.map(i => `**${i.itemName}** ($${i.itemValue.toFixed(2)})`).join('\n');
                
                const gameEmbed = new EmbedBuilder()
                    .setColor('#ffd700')
                    .setTitle('📦 New Item Coinflip')
                    .setDescription(`${interaction.user.username} is looking for an opponent!`)
                    .addFields(
                        { name: 'Items', value: itemsList.slice(0, 1024) },
                        { name: 'Total', value: `$${totalValue.toFixed(2)}` },
                        { name: 'Tax', value: '10% on winnings' }
                    )
                    .setTimestamp();
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`join_${result.lastInsertRowid}`)
                        .setLabel('🎲 JOIN')
                        .setStyle(ButtonStyle.Success)
                );
                
                const msg = await coinflipChannel.send({ embeds: [gameEmbed], components: [row] });
                db.prepare('UPDATE coinflips SET messageId = ? WHERE id = ?').run(msg.id, result.lastInsertRowid);
                
                await interaction.editReply({ content: '✅ Game created!', components: [] });
            }
            
            return;
        }
        
        // Handle commands
        if (!interaction.isCommand()) return;
        
        switch(interaction.commandName) {
            case 'additem': await handleAddItem(interaction); break;
            case 'addmoney': await handleAddMoney(interaction); break;
            case 'deposit': await handleDeposit(interaction); break;
            case 'inventory': await handleInventory(interaction); break;
            case 'stats': await handleStats(interaction); break;
            case 'coinflip': await handleCoinflip(interaction); break;
            case 'cancel': await handleCancel(interaction); break;
        }
        
    } catch (error) {
        console.error('Interaction error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ An error occurred!', ephemeral: true }).catch(() => {});
        } else {
            await interaction.editReply({ content: '❌ An error occurred!' }).catch(() => {});
        }
    }
});

// ==================== START BOT ====================
client.login(config.token);