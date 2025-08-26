const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const ExcelJS = require('exceljs');
require('dotenv').config();

// Bot configuration
const CONFIG = {
    TOKEN: process.env.TOKEN, // Replace with your actual token
    CLIENT_ID: process.env.CLIENT_ID, // Replace with your bot's client ID
    GUILD_ID: process.env.GUILD_ID, // Replace with your server ID
    CHANNEL_ID: process.env.CHANNEL_ID,
    DATA_FILE: process.env.DATA_FILE || "boss_respawns.json",
    EXCEL_FILE: process.env.EXCEL_FILE || "boss_respawns.xlsx"
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
        .setName('export_excel')
        .setDescription('Export boss data to Excel file'),
    
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
        )
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
        this.bosses = new Map();
        this.dataFile = path.join(__dirname, CONFIG.DATA_FILE);
        this.excelFile = path.join(__dirname, CONFIG.EXCEL_FILE);
        this.loadData();
    }

    async loadData() {
        try {
            const data = await fs.readFile(this.dataFile, 'utf8');
            const parsed = JSON.parse(data);
            this.bosses = new Map(parsed.bosses || []);
            console.log(`Loaded ${this.bosses.size} boss entries`);
        } catch (error) {
            console.log('No existing data file found, starting fresh');
            this.bosses = new Map();
        }
    }

    async saveData() {
        try {
            const data = {
                lastUpdated: new Date().toISOString(),
                bosses: Array.from(this.bosses.entries())
            };
            await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2));
            console.log('Boss data saved successfully');
            
            // Also save to Excel
            await this.saveToExcel();
        } catch (error) {
            console.error('Error saving data:', error);
        }
    }

    async saveToExcel() {
        try {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Boss Respawns');

            // Add headers
            worksheet.columns = [
                { header: 'Boss Name', key: 'name', width: 20 },
                { header: 'Death Time', key: 'deathTime', width: 12 },
                { header: 'Respawn Duration', key: 'respawnDuration', width: 15 },
                { header: 'Last Death', key: 'lastDeath', width: 20 },
                { header: 'Next Respawn', key: 'nextRespawn', width: 20 },
                { header: 'Status', key: 'status', width: 12 },
                { header: 'Added At', key: 'addedAt', width: 20 }
            ];

            // Add data
            const allBosses = this.getAllBosses();
            allBosses.forEach(boss => {
                const isActive = new Date(boss.nextRespawn) > new Date();
                worksheet.addRow({
                    name: boss.name,
                    deathTime: boss.deathTime,
                    respawnDuration: boss.respawnDuration,
                    lastDeath: new Date(boss.lastDeath).toLocaleString(),
                    nextRespawn: new Date(boss.nextRespawn).toLocaleString(),
                    status: isActive ? 'Active' : 'Respawned',
                    addedAt: new Date(boss.addedAt).toLocaleString()
                });
            });

            // Style the header row
            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };

            await workbook.xlsx.writeFile(this.excelFile);
            console.log('Excel file saved successfully');
        } catch (error) {
            console.error('Error saving Excel file:', error);
        }
    }

parseMessage(content) {

        // Expected format: "Death Time - Boss Name - Respawn Time"
        // Example: "14:30 - Dragon King - 24 hrs" or "14:30 - Dragon King - 24 hours"
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
        // Parse formats like: "24 hrs", "12 hours", "6 hr", "1 hour"
        const timeRegex = /(\d+)\s*(?:hrs?|hours?)\s*$/i;
        const match = duration.trim().match(timeRegex);
        
        if (!match) return null;
        
        const hours = parseInt(match[1]);
        if (isNaN(hours) || hours < 0) return null;
        
        return hours * 60; // Return total minutes
    }

    calculateRespawnTime(deathTime, respawnMinutes) {
        // Get current time in Philippine timezone
        const now = new Date();
        const philippineNow = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Manila"}));
        const [hours, minutes] = deathTime.split(':').map(Number);
        // Create death time for today in Philippine time
        const deathDateTime = new Date(philippineNow);
        deathDateTime.setHours(hours, minutes, 0, 0);
        // If death time is in the future (next day scenario), set it to yesterday
        if (deathDateTime > philippineNow) {
            deathDateTime.setDate(deathDateTime.getDate() - 1);
        }
        // Calculate respawn time
        const respawnDateTime = new Date(deathDateTime.getTime() + (respawnMinutes * 60000));
        return {
            deathDateTime,
            respawnDateTime,
            isActive: respawnDateTime > philippineNow
        };
    }



    formatDateTime(date) {

        // Convert to Philippine time (GMT+8)

        const philippineTime = new Date(date.getTime() + (8 * 60 * 60 * 1000));

        return philippineTime.toLocaleString('en-PH', {
            timeZone: 'Asia/Manila',
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });

    }

    async addBoss(deathTime, bossName, respawnDuration, messageId) {
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
            messageId,
            addedAt: new Date().toISOString()
        };

        this.bosses.set(bossName.toLowerCase(), bossData);
        await this.saveData();
        
        return bossData;
    }

    async updateBossRespawn(bossName, newDeathTime) {
        const bossKey = bossName.toLowerCase();
        const existingBoss = this.bosses.get(bossKey);
        
        if (!existingBoss) {
            throw new Error('Boss not found in database');
        }

        const timeData = this.calculateRespawnTime(newDeathTime, existingBoss.respawnMinutes);
        
        existingBoss.deathTime = newDeathTime;
        existingBoss.lastDeath = timeData.deathDateTime.toISOString();
        existingBoss.nextRespawn = timeData.respawnDateTime.toISOString();
        existingBoss.isActive = timeData.isActive;
        existingBoss.updatedAt = new Date().toISOString();

        this.bosses.set(bossKey, existingBoss);
        await this.saveData();
        
        return existingBoss;
    }

    async removeBoss(bossName) {
        const bossKey = bossName.toLowerCase();
        const boss = this.bosses.get(bossKey);
        
        if (!boss) {
            throw new Error('Boss not found in database');
        }

        this.bosses.delete(bossKey);
        await this.saveData();
        
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

 getBossStatus(boss) {

        // Get current time in Philippine timezone

        const now = new Date();

        const philippineNow = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Manila"}));

        const respawnTime = new Date(boss.nextRespawn);

        

        if (respawnTime > philippineNow) {

            return { status: 'Dead', emoji: '💀', color: 0xFF0000 }; // Red for dead

        } else {

            return { status: 'Alive', emoji: '✅', color: 0x00FF00 }; // Green for alive

        }
    }
}

// Initialize boss tracker
const bossTracker = new BossTracker();

// Bot event handler
client.once('ready', async () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    console.log(`📊 Monitoring channel: ${CONFIG.CHANNEL_ID}`);
    
    // Register slash commands
    await registerCommands();
});

client.on('messageCreate', async (message) => {
    // Ignore bot messages and messages not in target channel
    if (message.author.bot || message.channel.id !== CONFIG.CHANNEL_ID) return;

    try {
        const parsed = bossTracker.parseMessage(message.content);
        
         if (!parsed) {
            console.log('Message format does not match boss death pattern');
            return; // Not a boss death message
        }
        console.log('Parsed boss data:', parsed);

        const { deathTime, bossName, respawnDuration } = parsed;
        
        // Check if boss already exists
        const existingBoss = bossTracker.bosses.get(bossName.toLowerCase());
        
        let bossData;
        if (existingBoss) {
            // Update existing boss
            bossData = await bossTracker.updateBossRespawn(bossName, deathTime);
        } else {
            // Add new boss
            bossData = await bossTracker.addBoss(deathTime, bossName, respawnDuration, message.id);
        }

        // Create response embed
        const embed = new EmbedBuilder()
            .setTitle('🗡️ Boss Death Recorded')
            .setColor(existingBoss ? 0xFFA500 : 0x00FF00) // Orange for update, Green for new
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

        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Error processing message:', error);
        await message.reply(`❌ Error: ${error.message}`);
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

            case 'export_excel':
                await bossTracker.saveToExcel();
                await interaction.reply({
                    content: '📊 Excel file has been updated!',
                    files: [CONFIG.EXCEL_FILE]
                });
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