'use strict';

const {
  PermissionFlagsBits,
  ChannelType,
  AttachmentBuilder,
  EmbedBuilder,
} = require('discord.js');
const QRCode = require('qrcode');
const config = require('./config');
const data = require('./data');
const embeds = require('./embeds');
const { generateWallet } = require('./wallet');
const { startPolling, stopPolling } = require('./poller');

const SUPPORT_ROLE = '1502792396218306701';

function ticketChannelName(type, username) {
  const clean = username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';
  return `${type}-${clean}`;
}

async function verifyOrClearTicket(client, userId, type) {
  const existing = data.getTicket(userId, type);
  if (!existing) return null;

  // Check if channel still actually exists — admin may have deleted it manually
  try {
    const channel = await client.channels.fetch(existing.channelId);
    if (channel) return existing; // Still exists, block the user
  } catch {
    // Channel not found — clear the stale record and allow a new ticket
    data.closeTicket(userId, 'stale', type);
    console.log(`[tickets] Stale ${type} ticket cleared for ${userId}`);
  }
  return null;
}

async function createTicket(interaction, type) {
  const user = interaction.user;
  const guild = interaction.guild;

  // Recheck: verify channel still exists, clear stale records if not
  const existing = await verifyOrClearTicket(interaction.client, user.id, type);
  if (existing) {
    return interaction.reply({
      content: `❌ You already have an open ${type} ticket: <#${existing.channelId}>`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const channelName = ticketChannelName(type, user.username);

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: config.TICKET_CATEGORY,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
      ],
    });

    const ticket = {
      userId: user.id,
      username: user.tag,
      channelId: channel.id,
      type,
      createdAt: new Date().toISOString(),
      status: 'open',
      amountReceived: 0,
      knownSignatures: [],
      walletAddress: null,
      privateKey: null,
    };

    if (type === 'invest') {
      await handleInvestTicket(guild, channel, user, ticket);
    } else {
      await handleSupportTicket(channel, user);
    }

    data.saveTicket(ticket);

    if (type === 'invest') {
      startPolling(interaction.client, ticket);
    }

    await interaction.editReply({ content: `✅ Your ${type} ticket has been created: <#${channel.id}>` });
  } catch (err) {
    console.error(`[tickets] createTicket (${type}) error:`, err);
    await interaction.editReply({ content: '❌ Failed to create ticket. Please try again.' });
  }
}

async function handleInvestTicket(guild, channel, user, ticket) {
  const wallet = generateWallet();
  ticket.walletAddress = wallet.address;
  ticket.privateKey = wallet.privateKey;

  const qrBuffer = await QRCode.toBuffer(wallet.address, { width: 300 });
  const qrAttachment = new AttachmentBuilder(qrBuffer, { name: 'wallet-qr.png' });

  await channel.send({
    embeds: [embeds.ticketWelcomeEmbed(wallet.address)],
    files: [qrAttachment],
  });

  // Recovery info to admin channel
  const adminChannel = await guild.channels.fetch(config.ADMIN_KEY_CHANNEL).catch(() => null);
  if (adminChannel) {
    await adminChannel.send({ embeds: [embeds.adminKeyEmbed(user, channel.id, wallet.address, wallet.privateKey)] });
  }
}

async function handleSupportTicket(channel, user) {
  const embed = new EmbedBuilder()
    .setColor(0x000000)
    .setTitle('🛠️ Support Ticket Opened')
    .setDescription(`<@${user.id}> — a support member will be with you shortly. Describe your issue below.`)
    .setTimestamp();

  await channel.send({
    content: `<@&${SUPPORT_ROLE}>`,
    embeds: [embed],
  });
}

async function forceCloseTicket(client, ticket, reason = 'closed') {
  try {
    stopPolling(ticket.userId);

    const guild = client.guilds.cache.first();
    if (!guild) return;

    const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
    if (channel) {
      await channel.delete('Ticket closed').catch(() => {});
    }

    data.closeTicket(ticket.userId, reason, ticket.type);

    // Send closed notice in the ticket channel itself
    try {
      const closedChannel = await guild.channels.fetch(ticket.channelId).catch(() => null);
      if (closedChannel) {
        const closeEmbed = reason === 'expired'
          ? embeds.ticketExpiredEmbed()
          : embeds.ticketClosedByAdminEmbed();
        await closedChannel.send({ embeds: [closeEmbed] });
      }
    } catch (notifyErr) {
      console.error('[tickets] Could not send close notice:', notifyErr.message);
    }
  } catch (err) {
    console.error('[tickets] forceCloseTicket error:', err);
  }
}

module.exports = { createTicket, forceCloseTicket };
