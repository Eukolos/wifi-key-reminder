# WiFi Key Reminder

Telegram bot that sends a one-time reminder to hang up your keys when your phone connects to home WiFi. Uses ping monitoring with debouncing to detect phone presence and prevents duplicate reminders until the next WiFi session.

## Features

- 🔑 **One-time reminder**: Asks only once per WiFi session
- 📱 **Ping-based detection**: No app installation needed on phone
- ⏱️ **Configurable delays**: Customizable debouncing and ask delay
- 🔒 **Access control**: Restrict button responses to specific Telegram user
- 🤖 **Long-polling**: No static IP or webhook setup required
- 📊 **Status endpoint**: Monitor phone state via REST API

## Requirements

- Raspberry Pi or Linux server on your home network
- Node.js 14+ and npm
- Telegram Bot (create via [@BotFather](https://t.me/BotFather))
- Phone with static DHCP reservation on your router

## Installation

### 1. Clone or copy the project

```bash
mkdir -p ~/wifi-key-reminder
cd ~/wifi-key-reminder
```

Copy `index.js`, `package.json`, and `.env` to this directory.

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Edit `.env`:

```bash
# TELEGRAM
TG_TOKEN=123456:ABCDEF...              # Get from @BotFather
TG_CHAT_ID=                            # Leave empty, auto-captured on first /start
ALLOWED_USER_ID=                       # Optional: restrict button access to this user ID

# NETWORK
PHONE_IP=192.168.1.42                  # Reserve this IP for your phone in router DHCP

# TIMING
CHECK_EVERY=5                          # Ping interval in seconds
ASK_DELAY=90                           # Wait time after phone connects (in seconds)
DEBOUNCE_UP=2                          # Consecutive "online" checks before confirming
DEBOUNCE_DOWN=3                        # Consecutive "offline" checks before confirming

# EXPRESS
PORT=3000
```

**Getting your Telegram User ID:**
1. Start the bot: `npm start`
2. Send `/myid` to your bot
3. Copy the number to `ALLOWED_USER_ID` in `.env`

### 4. Set up DHCP reservation

In your router admin panel:
- Find DHCP settings
- Reserve a static IP for your phone's MAC address
- Use this IP in `.env` as `PHONE_IP`

### 5. Run the bot

```bash
npm start
```

Send `/start` to your bot on Telegram to capture the chat ID.

## Systemd Service (Auto-start)

Create `/etc/systemd/system/wifi-key-reminder.service`:

```ini
[Unit]
Description=WiFi Key Reminder Bot
After=network-online.target
Wants=network-online.target

[Service]
User=root
WorkingDirectory=/root/wifi-key-reminder
EnvironmentFile=/root/wifi-key-reminder/.env
ExecStart=/usr/bin/node /root/wifi-key-reminder/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wifi-key-reminder
sudo systemctl status wifi-key-reminder
```

View logs:

```bash
journalctl -u wifi-key-reminder -f
```

## API Endpoints

### `GET /status`

Returns current monitoring state:

```json
{
  "phoneIp": "192.168.1.42",
  "isOnline": true,
  "onlineStreak": 45,
  "offlineStreak": 0,
  "askedThisSession": false,
  "askDueInSec": 72,
  "lastPingOk": true,
  "lastAskAt": 1234567890000,
  "lastAnswer": {
    "at": 1234567890000,
    "fromId": 123456789,
    "value": "EVET"
  },
  "chatId": "-1001234567890",
  "allowedUserId": 123456789
}
```

### `GET /ask/test`

Manually send the reminder question (bypasses timing logic).

### `GET /monitoring/start`

Start the ping monitoring loop.

### `GET /monitoring/stop`

Stop the ping monitoring loop.

### `GET /health`

Health check endpoint.

## How It Works

1. **Ping Loop**: Every `CHECK_EVERY` seconds, the bot pings `PHONE_IP`
2. **Debouncing**: Requires `DEBOUNCE_UP` consecutive successful pings to confirm "online"
3. **Delay**: After confirming online, waits `ASK_DELAY` seconds before asking
4. **One-time Ask**: Sends Telegram message with YES/NO buttons
5. **Session Lock**: Won't ask again until phone goes offline (confirmed by `DEBOUNCE_DOWN` consecutive failed pings)
6. **Cycle Repeat**: When phone reconnects, process starts over

## Troubleshooting

**Bot doesn't detect phone:**
- Verify `PHONE_IP` is correct: `ping 192.168.1.42`
- Check DHCP reservation is active
- Some phones sleep and ignore pings - adjust `DEBOUNCE_UP` to 3-4

**Question never arrives:**
- Check `/status` endpoint - is `askDueInSec` counting down?
- Verify `CHAT_ID` was captured (send `/start` to bot)
- Check logs: `journalctl -u wifi-key-reminder -n 50`

**Question asked multiple times:**
- This shouldn't happen - check `askedThisSession` in `/status`
- If true, restart monitoring: `/monitoring/stop` then `/monitoring/start`

## License

MIT

## Author

Created for home automation - feel free to adapt for your needs.
