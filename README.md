# Discord Voice Bridge 🎤

A web application that allows users to join Discord voice channels through their browser with **two-way audio**. Perfect for situations where VPNs don't work well.

## Features

- 🔐 **Secure Login** - Password-protected access via `.env` credentials
- 🎙️ **Two-Way Audio** - Talk and listen to Discord voice channels
- 🤖 **Easy Setup** - Just ping the bot in Discord to have it join your channel
- 🎨 **Beautiful UI** - Premium dark theme with smooth animations
- 🔊 **Volume Control** - Adjust incoming audio volume
- 🔇 **Mute Toggle** - Quickly mute/unmute your microphone

## Setup

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to "Bot" section and click "Add Bot"
4. Enable these **Privileged Gateway Intents**:
   - Message Content Intent
5. Copy the bot token

### 2. Invite the Bot

1. Go to "OAuth2" > "URL Generator"
2. Select scopes: `bot`
3. Select permissions:
   - View Channels
   - Send Messages
   - Connect
   - Speak
   - Read Message History
4. Copy the generated URL and open it to invite the bot

### 3. Configure Environment

```bash
# Copy the example file
cp .env.example .env

# Edit .env with your values
```

Fill in your `.env`:
```env
BOT_TOKEN=your_discord_bot_token
CLIENT_ID=your_bot_client_id
LOGIN_USERNAME=friend
LOGIN_PASSWORD=your_secret_password
SESSION_SECRET=random_32_char_string
PORT=3000
```

### 4. Install Dependencies

```bash
npm install
```

### 5. Start the Server

```bash
npm start
```

## Usage

1. **Start the server** on your PC or VPS
2. **Ping the bot** in Discord while in a voice channel: `@VoiceBridge`
3. **Open the web interface** at `http://your-ip:3000`
4. **Login** with the credentials from your `.env`
5. **Start talking!** 🎉

## Making it Accessible from the Internet

For your friend to access this from Russia, you need to make the server publicly accessible:

### Option A: VPS/Cloud Server (Recommended)
Deploy on a VPS (DigitalOcean, Vultr, Linode, etc.) and use the server's public IP.

### Option B: ngrok (For Testing)
```bash
# Install ngrok and run:
ngrok http 3000
```
Share the ngrok URL with your friend.

### Option C: Port Forwarding
Forward port 3000 on your router to your PC's local IP.

## Troubleshooting

### Bot doesn't join voice channel
- Make sure you pinged the bot while being in a voice channel yourself
- Check that the bot has Connect and Speak permissions

### No audio
- Allow microphone access in your browser
- Check that you're not muted
- Verify the volume slider isn't at 0%

### High latency
- Audio delay of 100-300ms is normal for this type of bridge
- Using a server closer to your friend's location may help

## Tech Stack

- **Backend**: Node.js, Express, Socket.io
- **Discord**: discord.js, @discordjs/voice
- **Frontend**: Vanilla JS, Web Audio API
- **Styling**: Custom CSS with Discord-inspired theme
