require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    EndBehaviorType,
    getVoiceConnection
} = require('@discordjs/voice');
const { PassThrough, Readable } = require('stream');
const prism = require('prism-media');

// ============================================
// Configuration
// ============================================
const PORT = process.env.PORT || 3000;
const LOGIN_USERNAME = process.env.LOGIN_USERNAME;
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!LOGIN_USERNAME || !LOGIN_PASSWORD || !BOT_TOKEN) {
    console.error('❌ Missing required environment variables!');
    console.error('   Please copy .env.example to .env and fill in the values.');
    process.exit(1);
}

// ============================================
// Express Server Setup
// ============================================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' },
    maxHttpBufferSize: 1e8 // 100MB for audio chunks
});

app.use(express.json());
app.use(express.static('public'));

// Session middleware
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'voice-bridge-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true if using HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
});
app.use(sessionMiddleware);

// Share session with Socket.io
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

// ============================================
// Authentication Routes
// ============================================
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (username === LOGIN_USERNAME && password === LOGIN_PASSWORD) {
        req.session.authenticated = true;
        req.session.username = username;
        console.log(`✅ User "${username}" logged in successfully`);
        res.json({ success: true });
    } else {
        console.log(`❌ Failed login attempt for "${username}"`);
        res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
});

app.get('/api/check-auth', (req, res) => {
    res.json({ authenticated: !!req.session.authenticated });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// ============================================
// Discord Bot Setup
// ============================================
console.log('📝 Initializing Discord Client with intents: Guilds, GuildMessages, MessageContent, GuildVoiceStates');

const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Debug: Log when we get specific events
discordClient.on('debug', (info) => {
    // Filter out heartbeat messages to keep logs clean
    if (!info.includes('Heartbeat')) {
        console.log(`[Discord Debug] ${info}`);
    }
});

discordClient.on('error', (error) => {
    console.error('❌ Discord Client Error:', error);
});

let currentVoiceConnection = null;
let currentVoiceChannel = null;
let audioPlayer = null;
let connectedSocket = null;
let isReceivingAudio = false;

// Audio buffer for incoming browser audio
let audioQueue = [];
let isPlaying = false;

discordClient.once(Events.ClientReady, () => {
    console.log(`🤖 Discord bot logged in as ${discordClient.user.tag}`);

    // Start Web Server ONLY after bot is ready
    server.listen(PORT, () => {
        console.log(`\n🌐 Voice Bridge server running at http://localhost:${PORT}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📋 Setup Instructions:');
        console.log('   1. Ping the bot in Discord while in a voice channel');
        console.log('   2. Open the web interface and login');
        console.log('   3. Start talking!\n');
    });
});

// Handle bot mentions to join voice channel
discordClient.on(Events.MessageCreate, async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Check if bot was mentioned
    if (!message.mentions.has(discordClient.user)) return;

    // Check if user is in a voice channel
    const member = message.member;
    if (!member?.voice?.channel) {
        await message.reply('❌ You need to be in a voice channel for me to join!');
        return;
    }

    const voiceChannel = member.voice.channel;

    try {
        // Leave existing connection if any
        if (currentVoiceConnection) {
            currentVoiceConnection.destroy();
        }

        // Join the voice channel
        currentVoiceConnection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        currentVoiceChannel = voiceChannel;

        // Create audio player
        audioPlayer = createAudioPlayer();
        currentVoiceConnection.subscribe(audioPlayer);

        // Handle connection state changes
        currentVoiceConnection.on(VoiceConnectionStatus.Ready, () => {
            console.log(`🔊 Connected to voice channel: ${voiceChannel.name}`);
            notifySocketOfStatus();

            // Start receiving audio from Discord
            startReceivingDiscordAudio();
        });

        currentVoiceConnection.on(VoiceConnectionStatus.Disconnected, () => {
            console.log('🔇 Disconnected from voice channel');
            currentVoiceConnection = null;
            currentVoiceChannel = null;
            notifySocketOfStatus();
        });

        await message.reply(`✅ Joined **${voiceChannel.name}**! Your friend can now connect through the web interface.`);

    } catch (error) {
        console.error('Error joining voice channel:', error);
        await message.reply('❌ Failed to join the voice channel.');
    }
});

// ============================================
// Discord Audio Receiving (Discord -> Browser)
// ============================================
function startReceivingDiscordAudio() {
    if (!currentVoiceConnection || isReceivingAudio) return;
    isReceivingAudio = true;

    const receiver = currentVoiceConnection.receiver;

    receiver.speaking.on('start', (userId) => {
        // Don't capture our own audio
        if (userId === discordClient.user.id) return;

        const audioStream = receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: 100
            }
        });

        // Decode Opus to PCM
        const decoder = new prism.opus.Decoder({
            rate: 48000,
            channels: 2,
            frameSize: 960
        });

        audioStream.pipe(decoder).on('data', (chunk) => {
            if (connectedSocket) {
                // Convert to base64 and send to browser
                connectedSocket.emit('audio-in', chunk.toString('base64'));
            }
        });
    });
}

// ============================================
// Browser Audio Receiving (Browser -> Discord)
// ============================================
function playAudioToDiscord(audioData) {
    if (!currentVoiceConnection || !audioPlayer) return;

    audioQueue.push(audioData);

    if (!isPlaying) {
        processAudioQueue();
    }
}

function processAudioQueue() {
    if (audioQueue.length === 0) {
        isPlaying = false;
        return;
    }

    isPlaying = true;
    const audioData = audioQueue.shift();

    try {
        // Create a readable stream from the audio data
        const audioBuffer = Buffer.from(audioData, 'base64');
        const stream = new PassThrough();
        stream.end(audioBuffer);

        // Create an Opus encoder for Discord
        const encoder = new prism.opus.Encoder({
            rate: 48000,
            channels: 2,
            frameSize: 960
        });

        const opusStream = stream.pipe(encoder);
        const resource = createAudioResource(opusStream, {
            inputType: 'opus'
        });

        audioPlayer.play(resource);

        audioPlayer.once(AudioPlayerStatus.Idle, () => {
            processAudioQueue();
        });

    } catch (error) {
        console.error('Error playing audio:', error);
        isPlaying = false;
        processAudioQueue();
    }
}

// ============================================
// Socket.io Connection Handling
// ============================================
io.on('connection', (socket) => {
    const session = socket.request.session;

    // Check authentication
    if (!session?.authenticated) {
        console.log('❌ Unauthenticated socket connection rejected');
        socket.emit('error', { message: 'Not authenticated' });
        socket.disconnect();
        return;
    }

    console.log(`🔌 Web client connected: ${session.username}`);
    connectedSocket = socket;

    // Send current status
    notifySocketOfStatus();

    // Handle audio from browser
    socket.on('audio-out', (audioData) => {
        playAudioToDiscord(audioData);
    });

    // Handle mute toggle
    socket.on('mute', (isMuted) => {
        console.log(`🎤 User ${isMuted ? 'muted' : 'unmuted'}`);
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`🔌 Web client disconnected: ${session.username}`);
        if (connectedSocket === socket) {
            connectedSocket = null;
        }
    });

    // Handle request to leave voice channel
    socket.on('leave-voice', () => {
        if (currentVoiceConnection) {
            currentVoiceConnection.destroy();
            currentVoiceConnection = null;
            currentVoiceChannel = null;
            isReceivingAudio = false;
            console.log('🔇 Left voice channel by web request');
            notifySocketOfStatus();
        }
    });
});

function notifySocketOfStatus() {
    if (!connectedSocket) return;

    connectedSocket.emit('status', {
        connected: !!currentVoiceConnection,
        channelName: currentVoiceChannel?.name || null,
        guildName: currentVoiceChannel?.guild?.name || null
    });
}

// ============================================
// Start Server
// ============================================
// Web Server start moved to ClientReady event

// Login to Discord
console.log('🔄 Attempting to login to Discord...');
console.log(`🔑 Token check: starts with "${BOT_TOKEN.substring(0, 5)}..." (Length: ${BOT_TOKEN.length})`);

discordClient.login(BOT_TOKEN).then(() => {
    console.log('✅ Discord login request sent successfully (waiting for ready event)');
}).catch((error) => {
    console.error('❌ Failed to login to Discord');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    if (error.code) console.error('Error code:', error.code);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    if (currentVoiceConnection) {
        currentVoiceConnection.destroy();
    }
    discordClient.destroy();
    server.close();
    process.exit(0);
});
