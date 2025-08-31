const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
require('dotenv').config();

// Bot configuration
const CONFIG = {
    TOKEN: process.env.TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID,
    INPUT_CHANNEL_ID: process.env.INPUT_CHANNEL_ID,
    OUTPUT_CHANNEL_ID: process.env.OUTPUT_CHANNEL_ID,
    STORAGE_CHANNEL_ID: process.env.STORAGE_CHANNEL_ID // Private channel for data storage
};

// Slash commands definition
const commands = [
    new SlashCommandBuilder()
        .setName('list_boss')
        .setDescription('List all active boss respawns'),
    
    new SlashCommandBuilder()
        .setName('allbosses')
        .setDescription('List all tracked bosses (active and respawned)'),
    
    new SlashCommandBuilder()
        .setName('boss_status')
        .setDescription('Check specific boss status')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Boss name to check')
                .setRequired(true)
        ),
    
    new SlashCommandBuilder()
        .setName('remove_boss')
        .setDescription('Remove a boss from tracking')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Boss name to remove')
                .setRequired(true)
        ),
    
    new SlashCommandBuilder()
        .setName('cleanup_storage')
        .setDescription('Clean up respawned bosses from storage (Admin only)')
].map(command => command.toJSON());

// Register slash commands
const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);

async function registerCommands() {
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

class BossTracker {
    constructor() {
        this.storageChannel = null;
        this.bosses = new Map(); // Cache for faster access
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        
        this.storageChannel = client.channels.cache.get(CONFIG.STORAGE_CHANNEL_ID);
        if (!this.storageChannel) {
            throw new Error('Storage channel not found! Make sure STORAGE_CHANNEL_ID is correct.');
        }
        
        await this.loadBossesFromChannel();
        this.initialized = true;
        console.log('✅ Boss tracker initialized with Discord channel storage');
    }

    async loadBossesFromChannel() {
        try {
            console.log('📖 Loading bosses from storage channel...');
            const messages = await this.storageChannel.messages.fetch({ limit: 100 });
            
            this.bosses.clear();
            let loadedCount = 0;
            
            for (const [messageId, message] of messages) {
                if (message.author.id === client.user.id && message.embeds.length > 0) {
                    const embed = message.embeds[0];
                    if (embed.title === '🗡️ Boss Data') {
                        try {
                            const bossData = this.parseBossEmbed(embed, messageId);
                            if (bossData) {
                                // Convert formatted dates back to ISO strings for consistency
                                const lastDeathField = embed.fields.find(f => f.name === '🕒 Last Death')?.value;
                                const nextRespawnField = embed.fields.find(f => f.name === '🔄 Next Respawn')?.value;
                                const addedAtField = embed.fields.find(f => f.name === '📅 Added At')?.value;
                                
                                // Parse the formatted dates back to ISO strings
                                if (lastDeathField) {
                                    const lastDeathDate = this.parseFormattedDate(lastDeathField);
                                    if (lastDeathDate) bossData.lastDeath = lastDeathDate.toISOString();
                                }
                                
                                if (nextRespawnField) {
                                    const nextRespawnDate = this.parseFormattedDate(nextRespawnField);
                                    if (nextRespawnDate) bossData.nextRespawn = nextRespawnDate.toISOString();
                                }
                                
                                if (addedAtField) {
                                    const addedAtDate = this.parseFormattedDate(addedAtField);
                                    if (addedAtDate) bossData.addedAt = addedAtDate.toISOString();
                                }
                                
                                this.bosses.set(bossData.name.toLowerCase(), bossData);
                                loadedCount++;
                                console.log(`Loaded boss: ${bossData.name}`);
                            }
                        } catch (error) {
                            console.error('Error parsing boss embed:', error);
                        }
                    }
                }
            }
            
            console.log(`📊 Loaded ${loadedCount} bosses from storage channel`);
        } catch (error) {
            console.error('Error loading bosses from channel:', error);
        }
    }

    parseFormattedDate(formattedDateStr) {
        try {
            // Parse format: "31/08/2025, 23:30" back to Date object
            // Assuming Manila timezone
            const [datePart, timePart] = formattedDateStr.split(', ');
            const [day, month, year] = datePart.split('/').map(Number);
            const [hour, minute] = timePart.split(':').map(Number);
            
            // Create date assuming Manila timezone (UTC+8)
            const utcDate = new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
            return utcDate;
        } catch (error) {
            console.error('Error parsing formatted date:', formattedDateStr, error);
            return null;
        }
    }

    parseBossEmbed(embed, messageId) {
        try {
            const fields = embed.fields;
            if (!fields || fields.length < 6) return null;
            
            const bossData = {
                name: fields.find(f => f.name === '👹 Boss')?.value,
                deathTime: fields.find(f => f.name === '💀 Death Time')?.value,
                respawnDuration: fields.find(f => f.name === '⏱️ Respawn Duration')?.value,
                lastDeath: fields.find(f => f.name === '🕒 Last Death')?.value,
                nextRespawn: fields.find(f => f.name === '🔄 Next Respawn')?.value,
                addedAt: fields.find(f => f.name === '📅 Added At')?.value,
                messageId: messageId
            };
            
            // Validate required fields
            if (!bossData.name || !bossData.deathTime || !bossData.respawnDuration || 
                !bossData.lastDeath || !bossData.nextRespawn) {
                console.log('Missing required fields in boss embed');
                return null;
            }
            
            console.log('Successfully parsed boss from embed:', bossData.name);
            return bossData;
        } catch (error) {
            console.error('Error parsing boss embed:', error);
            return null;
        }
    }

    async cleanupRespawnedBosses() {
        if (!this.initialized) await this.initialize();
        
        const now = new Date();
        let removed = 0;
        let removedBosses = [];

        for (const [key, boss] of this.bosses.entries()) {
            if (new Date(boss.nextRespawn) <= now) {
                // Delete the message from storage channel
                try {
                    const message = await this.storageChannel.messages.fetch(boss.messageId);
                    await message.delete();
                } catch (error) {
                    console.log(`Could not delete message for ${boss.name}:`, error.message);
                }
                
                removedBosses.push(boss);
                this.bosses.delete(key);
                removed++;
            }
        }

        if (removed > 0) {
            console.log(`🗑️ Removed ${removed} respawned bosses:`, removedBosses.map(b => b.name));
        }
    }

    parseMessage(content) {
        console.log(`Parsing message: "${content}"`);
        const regex = /^(\d{1,2}:\d{2})\s*-\s*(.+?)\s*-\s*(\d+\s*(?:hrs?|hours?))\s*$/i;
        const match = content.trim().match(regex);
        
        if (!match) {
            console.log('Regex did not match. Expected format: "HH:MM - Boss Name - X hrs/hours"');
            return null;
        }
        
        const [, deathTime, bossName, respawnDuration] = match;
        const result = {
            deathTime: deathTime.trim(),
            bossName: bossName.trim(),
            respawnDuration: respawnDuration.trim()
        };
        console.log('Successfully parsed:', result);
        return result;
    }

    parseRespawnDuration(duration) {
        const timeRegex = /(\d+)\s*(?:hrs?|hours?)\s*$/i;
        const match = duration.trim().match(timeRegex);
        
        if (!match) return null;
        
        const hours = parseInt(match[1]);
        if (isNaN(hours) || hours < 0) return null;
        
        return hours * 60; // Return total minutes
    }

    calculateRespawnTime(deathTime, respawnMinutes) {
        const [h, m] = deathTime.split(':').map(Number);
        if (Number.isNaN(h) || Number.isNaN(m)) {
            throw new Error('Invalid death time (HH:MM expected)');
        }

        const now = new Date();

        // Get today's date in Manila (YYYY, MM, DD)
        const dParts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Manila',
            year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(now);
        const year  = parseInt(dParts.find(p => p.type === 'year').value, 10);
        const month = parseInt(dParts.find(p => p.type === 'month').value, 10);
        let   day   = parseInt(dParts.find(p => p.type === 'day').value, 10);

        // Current time-of-day in Manila for "yesterday if future" rule
        const tParts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Manila',
            hour: '2-digit', minute: '2-digit', hour12: false
        }).formatToParts(now);
        const curH = parseInt(tParts.find(p => p.type === 'hour').value, 10);
        const curM = parseInt(tParts.find(p => p.type === 'minute').value, 10);

        // If entered death time is in the future vs "now in Manila", treat it as yesterday
        if (h > curH || (h === curH && m > curM)) {
            day -= 1;
        }

        // Build a UTC instant for Manila wall-clock (Manila is UTC+8 -> subtract 8 hours)
        const deathUTCms   = Date.UTC(year, month - 1, day, h - 8, m, 0, 0);
        const respawnUTCms = deathUTCms + respawnMinutes * 60 * 1000;

        const deathDateTime   = new Date(deathUTCms);
        const respawnDateTime = new Date(respawnUTCms);

        return {
            deathDateTime,
            respawnDateTime,
            isActive: respawnUTCms > Date.now()
        };
    }

    formatDateTime(date) {
        return new Intl.DateTimeFormat('en-PH', {
            timeZone: 'Asia/Manila',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).format(date);
    }

    getTimeUntilRespawn(boss) {
        const now = new Date();
        const respawnTime = new Date(boss.nextRespawn);
        const timeDiff = respawnTime - now;

        if (timeDiff <= 0) {
            return { hours: 0, minutes: 0, isExpired: true };
        }

        const hours = Math.floor(timeDiff / (1000 * 60 * 60));
        const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));

        return { hours, minutes, isExpired: false };
    }

    async saveBossToChannel(bossData) {
        const embed = new EmbedBuilder()
            .setTitle('🗡️ Boss Data')
            .setColor(0x2F3136) // Dark gray for storage
            .addFields([
                { name: '👹 Boss', value: bossData.name, inline: true },
                { name: '💀 Death Time', value: bossData.deathTime, inline: true },
                { name: '⏱️ Respawn Duration', value: bossData.respawnDuration, inline: true },
                { name: '🕒 Last Death', value: bossTracker.formatDateTime(new Date(bossData.lastDeath)), inline: true },
                { name: '🔄 Next Respawn', value: bossTracker.formatDateTime(new Date(bossData.nextRespawn)), inline: true },
                { name: '📅 Added At', value: bossTracker.formatDateTime(new Date(bossData.addedAt)), inline: true }
            ])
            .setTimestamp()
            .setFooter({ text: 'Boss Storage Data' });

        const message = await this.storageChannel.send({ embeds: [embed] });
        return message.id;
    }

    async updateBossInChannel(bossData) {
        try {
            const message = await this.storageChannel.messages.fetch(bossData.messageId);
            
            const embed = new EmbedBuilder()
                .setTitle('🗡️ Boss Data')
                .setColor(0x2F3136)
                .addFields([
                    { name: '👹 Boss', value: bossData.name, inline: true },
                    { name: '💀 Death Time', value: bossData.deathTime, inline: true },
                    { name: '⏱️ Respawn Duration', value: bossData.respawnDuration, inline: true },
                    { name: '🕒 Last Death', value: bossTracker.formatDateTime(new Date(bossData.lastDeath)), inline: true },
                    { name: '🔄 Next Respawn', value: bossTracker.formatDateTime(new Date(bossData.nextRespawn)), inline: true },
                    { name: '📅 Added At', value: bossTracker.formatDateTime(new Date(bossData.addedAt)), inline: true }
                ])
                .setTimestamp()
                .setFooter({ text: 'Boss Storage Data - Updated' });

            await message.edit({ embeds: [embed] });
            return bossData.messageId;
        } catch (error) {
            console.log('Could not update existing message, creating new one');
            return await this.saveBossToChannel(bossData);
        }
    }

    async addBoss(deathTime, bossName, respawnDuration, inputMessageId) {
        if (!this.initialized) await this.initialize();
        
        const respawnMinutes = this.parseRespawnDuration(respawnDuration);
        
        if (!respawnMinutes) {
            throw new Error('Invalid respawn duration format');
        }

        const timeData = this.calculateRespawnTime(deathTime, respawnMinutes);
        
        const bossData = {
            name: bossName,
            deathTime,
            respawnDuration,
            respawnMinutes,
            lastDeath: timeData.deathDateTime.toISOString(),
            nextRespawn: timeData.respawnDateTime.toISOString(),
            isActive: timeData.isActive,
            inputMessageId,
            addedAt: new Date().toISOString()
        };

        // Check if boss already exists
        const existingBoss = this.bosses.get(bossName.toLowerCase());
        
        let storageMessageId;
        if (existingBoss) {
            // Update existing boss
            bossData.messageId = existingBoss.messageId;
            bossData.addedAt = existingBoss.addedAt; // Keep original added time
            storageMessageId = await this.updateBossInChannel(bossData);
        } else {
            // Save new boss to storage channel
            storageMessageId = await this.saveBossToChannel(bossData);
        }
        
        bossData.messageId = storageMessageId;
        this.bosses.set(bossName.toLowerCase(), bossData);
        
        await this.cleanupRespawnedBosses();
        
        return bossData;
    }

    async removeBoss(bossName) {
        if (!this.initialized) await this.initialize();
        
        const bossKey = bossName.toLowerCase();
        const boss = this.bosses.get(bossKey);
        
        if (!boss) {
            throw new Error('Boss not found in database');
        }

        // Delete the message from storage channel
        try {
            const message = await this.storageChannel.messages.fetch(boss.messageId);
            await message.delete();
        } catch (error) {
            console.log(`Could not delete storage message for ${boss.name}:`, error.message);
        }

        this.bosses.delete(bossKey);
        await this.cleanupRespawnedBosses();
        
        return boss;
    }

    getBoss(bossName) {
        return this.bosses.get(bossName.toLowerCase());
    }

    getActiveBosses() {
        const now = new Date();
        return Array.from(this.bosses.values())
            .filter(boss => new Date(boss.nextRespawn) > now)
            .sort((a, b) => new Date(a.nextRespawn) - new Date(b.nextRespawn));
    }

    getAllBosses() {
        return Array.from(this.bosses.values())
            .sort((a, b) => new Date(b.lastDeath) - new Date(a.lastDeath));
    }
}

// Initialize boss tracker
const bossTracker = new BossTracker();

// Bot event handler
client.once('ready', async () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    console.log(`📥 Input channel: ${CONFIG.INPUT_CHANNEL_ID}`);
    console.log(`📤 Output channel: ${CONFIG.OUTPUT_CHANNEL_ID}`);
    console.log(`💾 Storage channel: ${CONFIG.STORAGE_CHANNEL_ID}`);
    
    // Initialize boss tracker
    try {
        await bossTracker.initialize();
    } catch (error) {
        console.error('❌ Failed to initialize boss tracker:', error);
        process.exit(1);
    }
    
    // Register slash commands
    await registerCommands();

    // Cleanup interval (every 5 minutes)
    setInterval(() => bossTracker.cleanupRespawnedBosses(), 5 * 60 * 1000);
});

client.on('messageCreate', async (message) => {
    // Ignore bot messages and messages not in input channel
    if (message.author.bot || message.channel.id !== CONFIG.INPUT_CHANNEL_ID) return;

    try {
        const parsed = bossTracker.parseMessage(message.content);
        
        if (!parsed) {
            console.log('Message format does not match boss death pattern');
            return;
        }
        console.log('Parsed boss data:', parsed);

        const { deathTime, bossName, respawnDuration } = parsed;
        
        // Check if boss already exists
        const existingBoss = bossTracker.getBoss(bossName);
        
        // Add/update boss
        const bossData = await bossTracker.addBoss(deathTime, bossName, respawnDuration, message.id);

        // Get the output channel
        const outputChannel = client.channels.cache.get(CONFIG.OUTPUT_CHANNEL_ID);
        if (!outputChannel) {
            console.error('Output channel not found!');
            await message.reply('❌ Output channel not configured properly.');
            return;
        }

        // Create response embed for output channel
        const embed = new EmbedBuilder()
            .setTitle('🗡️ Boss Death Recorded')
            .setColor(existingBoss ? 0xFFA500 : 0x00FF00)
            .addFields([
                { name: '👹 Boss', value: bossData.name, inline: true },
                { name: '💀 Death Time', value: bossData.deathTime, inline: true },
                { name: '⏱️ Respawn Duration', value: bossData.respawnDuration, inline: true },
                { 
                    name: '🔄 Next Respawn', 
                    value: bossTracker.formatDateTime(new Date(bossData.nextRespawn)), 
                    inline: false 
                }
            ])
            .setTimestamp()
            .setFooter({ 
                text: existingBoss ? 'Boss respawn updated' : 'New boss added to tracker' 
            });

        // Send embed to output channel
        await outputChannel.send({ embeds: [embed] });

        // React to input message
        await message.react('✅');

    } catch (error) {
        console.error('Error processing message:', error);
        
        const outputChannel = client.channels.cache.get(CONFIG.OUTPUT_CHANNEL_ID);
        if (outputChannel) {
            await outputChannel.send(`❌ Error processing boss death: ${error.message}`);
        } else {
            await message.reply(`❌ Error: ${error.message}`);
        }
    }
});

// Slash commands handling
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    try {
        switch (commandName) {
            case 'list_boss':
                const activeBosses = bossTracker.getActiveBosses();
                
                if (activeBosses.length === 0) {
                    await interaction.reply('📭 No active boss respawns at the moment.');
                    return;
                }

                const embed = new EmbedBuilder()
                    .setTitle('⚔️ Active Boss Respawns')
                    .setColor(0x0099FF)
                    .setTimestamp();

                activeBosses.slice(0, 10).forEach((boss, index) => {
                    const respawnTime = new Date(boss.nextRespawn);
                    const timeLeft = bossTracker.getTimeUntilRespawn(boss);
                    
                    embed.addFields({
                        name: `${index + 1}. ${boss.name}`,
                        value: `Respawns: ${bossTracker.formatDateTime(respawnTime)}\nTime left: ${timeLeft.hours}h ${timeLeft.minutes}m`,
                        inline: true
                    });
                });

                await interaction.reply({ embeds: [embed] });
                break;

            case 'allbosses':
                const allBosses = bossTracker.getAllBosses();
                
                if (allBosses.length === 0) {
                    await interaction.reply('📭 No bosses in the database.');
                    return;
                }

                const allEmbed = new EmbedBuilder()
                    .setTitle('📋 All Tracked Bosses')
                    .setColor(0x800080)
                    .setTimestamp();

                allBosses.slice(0, 10).forEach((boss, index) => {
                    const status = new Date(boss.nextRespawn) > Date.now() ? '🟢 Active' : '🔴 Respawned';
                    allEmbed.addFields({
                        name: `${index + 1}. ${boss.name}`,
                        value: `Status: ${status}\nLast Death: ${boss.deathTime}\nRespawn Time: ${boss.respawnDuration}`,
                        inline: true
                    });
                });

                await interaction.reply({ embeds: [allEmbed] });
                break;

            case 'boss_status':
                const bossName = interaction.options.getString('name');
                const boss = bossTracker.getBoss(bossName);
                
                if (!boss) {
                    await interaction.reply(`❌ Boss "${bossName}" not found in database.`);
                    return;
                }

                const timeLeft = bossTracker.getTimeUntilRespawn(boss);
                const statusEmbed = new EmbedBuilder()
                    .setTitle(`🔍 ${boss.name} Status`)
                    .setColor(timeLeft.isExpired ? 0xFF0000 : 0x00FF00)
                    .addFields([
                        { name: '💀 Last Death', value: boss.deathTime, inline: true },
                        { name: '⏱️ Respawn Duration', value: boss.respawnDuration, inline: true },
                        { name: '🔄 Next Respawn', value: bossTracker.formatDateTime(new Date(boss.nextRespawn)), inline: true },
                        { 
                            name: '⏰ Time Left', 
                            value: timeLeft.isExpired ? '**RESPAWNED!**' : `${timeLeft.hours}h ${timeLeft.minutes}m`,
                            inline: false 
                        }
                    ])
                    .setTimestamp();

                await interaction.reply({ embeds: [statusEmbed] });
                break;

            case 'remove_boss':
                const removeBossName = interaction.options.getString('name');
                try {
                    const removedBoss = await bossTracker.removeBoss(removeBossName);
                    await interaction.reply(`✅ Boss "${removedBoss.name}" has been removed from tracking.`);
                } catch (error) {
                    await interaction.reply(`❌ ${error.message}`);
                }
                break;

            case 'cleanup_storage':
                if (!interaction.member.permissions.has('ADMINISTRATOR')) {
                    await interaction.reply('❌ You need administrator permissions to use this command.');
                    return;
                }
                
                await bossTracker.cleanupRespawnedBosses();
                await interaction.reply('✅ Storage cleanup completed!');
                break;
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        await interaction.reply('❌ An error occurred while processing your request.');
    }
});

// Error handling
client.on('error', console.error);

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the bot
client.login(CONFIG.TOKEN);