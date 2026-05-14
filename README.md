# Whale Rugs Discord Bot

A Discord investment bot with Solana wallet generation, on-chain payment detection, and pool management.

---

## What to upload to GitHub

Upload **only the `bot-deploy/` folder contents** to your GitHub repo.

The folder you push should look like this:
```
your-repo/
├── index.js
├── config.js
├── commands.js
├── tickets.js
├── payment.js
├── poller.js
├── wallet.js
├── embeds.js
├── pool.js
├── data.js
├── package.json
├── ecosystem.config.cjs
├── .env.example
├── .gitignore
└── README.md
```

> **Never commit `.env` or `data.json`** — they contain secrets and private keys.

---

## Does this need TypeScript?

**No.** This bot is plain JavaScript. There are no build steps. You run it directly with `node index.js`.

---

## VPS Setup (Ubuntu 24.04 + DigitalOcean)

### 1. Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # should print v20.x.x
```

### 2. Install PM2

```bash
sudo npm install -g pm2
```

### 3. Clone your repo

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO
```

### 4. Install dependencies

```bash
npm install
```

### 5. Create your `.env` file

```bash
cp .env.example .env
nano .env
```

Fill in your values:
```
DISCORD_TOKEN=your_token_here
GUILD_ID=your_server_id_here
ADMIN_ID=your_user_id_here
SOLANA_RPC=https://mainnet.helius-rpc.com/?api-key=your_key
SERVER_NAME=Your Server Name
```

Save with `Ctrl+X`, then `Y`, then `Enter`.

### 6. Start the bot with PM2

```bash
pm2 start ecosystem.config.cjs
```

### 7. Make PM2 auto-start on reboot

```bash
pm2 save
pm2 startup
# Copy and run the command it prints
```

---

## Managing the bot

| Task | Command |
|------|---------|
| View logs | `pm2 logs whale-rugs-bot` |
| Check status | `pm2 status` |
| Restart bot | `pm2 restart whale-rugs-bot` |
| Stop bot | `pm2 stop whale-rugs-bot` |
| Update bot | `git pull && pm2 restart whale-rugs-bot` |

---

## Updating the bot

```bash
cd YOUR_REPO
git pull
pm2 restart whale-rugs-bot
```

That's it. No build steps needed.

---

## Admin Commands

| Command | Description |
|---------|-------------|
| `/startpool <sol>` | Open a new investment pool |
| `/credit <sol>` | Add SOL to the active pool |
| `/addbalance @user <sol>` | Manually credit a user |
| `/investments` | View all investment stats |
| `/poolstatus` | View current pool progress |
| `/closeticket` | Force close a ticket channel |
| `/resetticket @user` | Reset a stuck ticket |

---

## Notes

- `data.json` is created automatically on first run — **do not delete it**, it stores all investment records
- If you lose `data.json`, use `/resetticket` to clear stuck tickets
- Bot automatically recovers open tickets and missed payments on restart
