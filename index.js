'use strict';

require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const express = require('express');
const config = require('./config');
const data = require('./data');
const { registerCommands, handleCommand } = require('./commands');
const { createTicket } = require('./tickets');
const { recoverTickets } = require('./poller');

// Keepalive HTTP server (keeps process alive on VPS)
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (_, res) => res.send('Bot is running.'));
app.listen(PORT, () => console.log(`[keepalive] HTTP server on port ${PORT}`));

// Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once('clientReady', async (readyClient) => {
  console.log(`[bot] Logged in as ${readyClient.user.tag}`);
  await registerCommands(readyClient.user.id);
  await ensureTicketMessage();
  await recoverTickets(client);
});

async function ensureTicketMessage() {
  const d = data.read();
  const channel = await client.channels.fetch(config.TICKET_BUTTON_CHANNEL).catch(() => null);
  if (!channel) {
    console.error('[bot] Ticket button channel not found:', config.TICKET_BUTTON_CHANNEL);
    return;
  }

  // Always delete old ticket message and resend fresh on every startup
  if (d.ticketMessageId) {
    const existing = await channel.messages.fetch(d.ticketMessageId).catch(() => null);
    if (existing) await existing.delete().catch(() => {});
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Investment Center')
    .setDescription(
      'Click the buttons below to open a private ticket.\n\n' +
      '**Invest** — Open a private ticket to invest SOL\n' +
      '**Support** — Open a support ticket'
    )
    .setFooter({ text: `Powered by ${config.SERVER_NAME}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('open_invest_ticket').setLabel('Invest').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('open_support_ticket').setLabel('Support').setStyle(ButtonStyle.Primary),
  );

  const msg = await channel.send({ embeds: [embed], components: [row] });
  const d2 = data.read();
  d2.ticketMessageId = msg.id;
  data.write(d2);
  console.log('[bot] Ticket message created:', msg.id);
}

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isButton()) {
      const { customId } = interaction;
      if (customId === 'open_invest_ticket') {
        await createTicket(interaction, 'invest');
        return;
      }
      if (customId === 'open_support_ticket') {
        await createTicket(interaction, 'support');
        return;
      }
      if (customId.startsWith('show_name_') || customId.startsWith('stay_anon_')) {
        await interaction.deferUpdate().catch(() => {});
        return;
      }
    }
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    }
  } catch (err) {
    console.error('[bot] Interaction error:', err);
    try {
      const errMsg = { content: 'An error occurred. Please try again.', ephemeral: true };
      if (interaction.deferred) await interaction.editReply(errMsg).catch(() => {});
      else if (!interaction.replied) await interaction.reply(errMsg).catch(() => {});
    } catch {}
  }
});

client.on('error', err => console.error('[bot] Client error:', err.message));
process.on('unhandledRejection', err => console.error('[bot] Unhandled rejection:', err));

client.login(config.DISCORD_TOKEN).catch(err => {
  console.error('[bot] Login failed:', err.message);
  process.exit(1);
});
