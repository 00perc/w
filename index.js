'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  PermissionFlagsBits,
  Routes,
  ChannelType,
  AttachmentBuilder,
} = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey, Transaction, SystemProgram } = require('@solana/web3.js');
const QRCode = require('qrcode');
const express = require('express');

// ─── Config ───────────────────────────────────────────────────────────────────

const config = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  GUILD_ID: process.env.GUILD_ID,
  SOLANA_RPC: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
  ADMIN_ID: process.env.ADMIN_ID,
  SERVER_NAME: process.env.SERVER_NAME || 'Investment Server',

  TICKET_BUTTON_CHANNEL: '1503874190670037163',
  TICKET_CATEGORY: '1502791000874029209',
  ADMIN_KEY_CHANNEL: '1503535189010284564',
  PRIVATE_LOG_CHANNEL: '1503535245444518018',
  PUBLIC_INVESTMENTS_CHANNEL: '1502791132747141301',
  POOL_COMPLETE_CHANNEL: '1502790697529639185',

  ROLE_0_5: '1502792213820739705',
  ROLE_5_PLUS: '1503109009396338760',
  SUPPORT_ROLE: '1502792396218306701',

  COLOR: 0x5865F2,
  TREASURY_WALLET: '2z2NaymKNQLqmogmSMPSYQ9wZg1nAGiNQ6Mo4WSmPsRv',

  WARN_AFTER_MS: 10 * 60 * 1000,
  CLOSE_AFTER_MS: 15 * 60 * 1000,
  POLL_INTERVAL_MS: 15 * 1000,
  MIN_SOL: 0.001,
};

// ─── Data ─────────────────────────────────────────────────────────────────────

const DATA_PATH = path.join(__dirname, 'data.json');
const DEFAULT_DATA = {
  ticketMessageId: '',
  tickets: [],
  investments: [],
  users: {},
  pool: null,
  poolHistory: [],
};

function readData() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      fs.writeFileSync(DATA_PATH, JSON.stringify(DEFAULT_DATA, null, 2));
      return { ...DEFAULT_DATA };
    }
    return { ...DEFAULT_DATA, ...JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')) };
  } catch (err) {
    console.error('[data] Failed to read data.json:', err);
    return { ...DEFAULT_DATA };
  }
}

function writeData(data) {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[data] Failed to write data.json:', err);
  }
}

function getTicket(userId, type = null) {
  const d = readData();
  if (type) return d.tickets.find(t => t.userId === userId && t.status === 'open' && t.type === type) || null;
  return d.tickets.find(t => t.userId === userId && t.status === 'open') || null;
}

function saveTicket(ticket) {
  const d = readData();
  const idx = ticket.type
    ? d.tickets.findIndex(t => t.userId === ticket.userId && t.status === 'open' && t.type === ticket.type)
    : d.tickets.findIndex(t => t.userId === ticket.userId && t.status === 'open');
  if (idx >= 0) d.tickets[idx] = ticket;
  else d.tickets.push(ticket);
  writeData(d);
}

function closeTicket(userId, status = 'closed', type = null) {
  const d = readData();
  const idx = type
    ? d.tickets.findIndex(t => t.userId === userId && t.status === 'open' && t.type === type)
    : d.tickets.findIndex(t => t.userId === userId && t.status === 'open');
  if (idx >= 0) {
    d.tickets[idx].status = status;
    writeData(d);
    return d.tickets[idx];
  }
  return null;
}

function getUser(userId) {
  const d = readData();
  return d.users[userId] || { lifetimeTotal: 0, currentRole: null, investmentCount: 0 };
}

function saveUser(userId, userData) {
  const d = readData();
  d.users[userId] = userData;
  writeData(d);
}

function addInvestment(investment) {
  const d = readData();
  d.investments.push(investment);
  writeData(d);
}

function getPool() {
  return readData().pool;
}

function savePool(pool) {
  const d = readData();
  d.pool = pool;
  writeData(d);
}

function completePool(pool) {
  const d = readData();
  d.pool = null;
  d.poolHistory.push({ ...pool, endTime: new Date().toISOString() });
  writeData(d);
}

// ─── Wallet ───────────────────────────────────────────────────────────────────

let connection;

function getConnection() {
  if (!connection) connection = new Connection(config.SOLANA_RPC, 'confirmed');
  return connection;
}

function generateWallet() {
  const keypair = Keypair.generate();
  return {
    address: keypair.publicKey.toBase58(),
    privateKey: Buffer.from(keypair.secretKey).toString('hex'),
  };
}

async function getIncomingAmount(address, knownSignatures = []) {
  try {
    const conn = getConnection();
    const pubkey = new PublicKey(address);
    const sigs = await conn.getSignaturesForAddress(pubkey, { limit: 20 });
    let totalNew = 0;
    const newSigs = [];
    for (const sigInfo of sigs) {
      if (knownSignatures.includes(sigInfo.signature)) continue;
      if (sigInfo.confirmationStatus === 'processed') continue;
      try {
        const tx = await conn.getTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 });
        if (!tx || !tx.meta) continue;
        const accountKeys = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;
        const addressIndex = accountKeys.findIndex(k => k.toBase58() === address);
        if (addressIndex === -1) continue;
        const diff = (tx.meta.postBalances[addressIndex] - tx.meta.preBalances[addressIndex]) / LAMPORTS_PER_SOL;
        if (diff >= config.MIN_SOL) { totalNew += diff; newSigs.push(sigInfo.signature); }
      } catch (txErr) {
        console.error('[wallet] tx parse error:', txErr.message);
      }
    }
    return { amount: totalNew, signatures: newSigs };
  } catch (err) {
    console.error('[wallet] getIncomingAmount error:', err.message);
    return { amount: 0, signatures: [] };
  }
}

async function sweepToTreasury(privateKeyHex, receivedLamports) {
  try {
    const conn = getConnection();
    const keypair = Keypair.fromSecretKey(Buffer.from(privateKeyHex, 'hex'));
    const treasury = new PublicKey(config.TREASURY_WALLET);
    const FEE = 5000;
    const lamports = Math.floor(receivedLamports * LAMPORTS_PER_SOL);
    const sendLamports = lamports - FEE;
    if (sendLamports <= 0) { console.log('[wallet] Sweep skipped — amount too small to cover fees'); return null; }
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: treasury, lamports: sendLamports }));
    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = keypair.publicKey;
    tx.sign(keypair);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await conn.confirmTransaction(sig, 'confirmed');
    console.log(`[wallet] Swept ${sendLamports / LAMPORTS_PER_SOL} SOL to treasury. Sig: ${sig}`);
    return sig;
  } catch (err) {
    console.error('[wallet] sweepToTreasury error:', err.message);
    return null;
  }
}

// ─── Embeds ───────────────────────────────────────────────────────────────────

function sol(amount) {
  return `${Number(amount).toFixed(4)} SOL`;
}

function poolProgressBar(current, target) {
  if (!target || target <= 0) return null;
  const pct = Math.min(current / target, 1);
  const filled = Math.round(pct * 20);
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
  return `[${bar}] ${Number(current).toFixed(2)} / ${target} SOL (${Math.round(pct * 100)}%)`;
}

function ticketWelcomeEmbed(walletAddress) {
  return new EmbedBuilder()
    .setColor(config.COLOR)
    .setTitle('Investment Ticket')
    .setDescription('Send SOL to the address below. Your ticket will be confirmed automatically.')
    .addFields(
      { name: 'Wallet', value: `\`\`\`${walletAddress}\`\`\`` },
      { name: 'Steps', value: '1. Copy the wallet address\n2. Send SOL from any wallet\n3. Confirmation and role assigned automatically' },
    )
    .setTimestamp();
}

function adminKeyEmbed(user, channelId, walletAddress, privateKey) {
  return new EmbedBuilder()
    .setColor(config.COLOR)
    .setTitle('New Ticket — Recovery Info')
    .addFields(
      { name: 'User', value: `${user.tag} \`${user.id}\``, inline: true },
      { name: 'Channel', value: `<#${channelId}>`, inline: true },
      { name: 'Wallet', value: `\`\`\`${walletAddress}\`\`\`` },
      { name: 'Private Key', value: `\`\`\`${privateKey}\`\`\`` },
    )
    .setTimestamp();
}

function ticketExpiryWarningEmbed() {
  return new EmbedBuilder()
    .setColor(config.COLOR)
    .setTitle('Ticket Expiring Soon')
    .setDescription('5 minutes remaining. Send your payment now or the ticket will close.')
    .setTimestamp();
}

function ticketExpiredEmbed() {
  return new EmbedBuilder()
    .setColor(config.COLOR)
    .setTitle('Ticket Expired')
    .setDescription('No payment was received. You can open a new ticket at any time.')
    .setTimestamp();
}

function ticketClosedByAdminEmbed() {
  return new EmbedBuilder()
    .setColor(config.COLOR)
    .setTitle('Ticket Closed')
    .setDescription('Your ticket was closed by an admin. Open a support ticket if you have questions.')
    .setTimestamp();
}

function privateLogEmbed(user, amount, lifetimeTotal, walletAddress, roleId, method, txSignature = null) {
  const s = parseFloat(amount.toFixed(4));
  const embed = new EmbedBuilder()
    .setColor(config.COLOR)
    .setTitle(`${s} SOL Invested`)
    .addFields(
      { name: 'User', value: `${user.tag} \`${user.id}\`` },
      { name: 'Amount', value: sol(s), inline: true },
      { name: 'Lifetime', value: sol(lifetimeTotal), inline: true },
      { name: 'Role', value: `<@&${roleId}>`, inline: true },
      { name: 'Method', value: method, inline: true },
      { name: 'Wallet', value: `\`${walletAddress}\`` },
    )
    .setTimestamp();
  if (txSignature) embed.addFields({ name: 'Transaction', value: `\`${txSignature}\`` });
  return embed;
}

function publicInvestmentEmbed(displayName, amount, pool, txSignature = null) {
  const embed = new EmbedBuilder()
    .setColor(config.COLOR)
    .setTitle('New Investment')
    .addFields(
      { name: 'Investor', value: displayName, inline: true },
      { name: 'Amount', value: sol(amount), inline: true },
    )
    .setTimestamp();
  if (pool) {
    const bar = poolProgressBar(pool.current, pool.target);
    if (bar) embed.addFields({ name: 'Pool', value: bar });
  }
  if (txSignature) embed.addFields({ name: 'Transaction', value: `\`${txSignature}\`` });
  return embed;
}

function dmConfirmationEmbed(amount, lifetimeTotal, roleName) {
  return new EmbedBuilder()
    .setColor(config.COLOR)
    .setTitle('Investment Confirmed')
    .addFields(
      { name: 'Amount', value: sol(amount), inline: true },
      { name: 'Lifetime', value: sol(lifetimeTotal), inline: true },
      { name: 'Role', value: roleName, inline: true },
    )
    .setTimestamp();
}

function poolFilledEmbed(totalSol, uniqueInvestors) {
  return new EmbedBuilder()
    .setColor(config.COLOR)
    .setTitle('Pool Filled')
    .addFields(
      { name: 'Total Raised', value: sol(totalSol), inline: true },
      { name: 'Investors', value: `${uniqueInvestors}`, inline: true },
    )
    .setTimestamp();
}

function investmentsStatsEmbed(d) {
  const totalSol  = d.investments.reduce((s, i) => s + i.amount, 0);
  const realSol   = d.investments.filter(i => i.method === 'On-chain').reduce((s, i) => s + i.amount, 0);
  const manualSol = d.investments.filter(i => i.method === 'Manual').reduce((s, i) => s + i.amount, 0);
  const userList  = Object.entries(d.users).map(([uid, u]) =>
    `<@${uid}> — ${sol(u.lifetimeTotal)} · ${u.investmentCount} investment(s) · <@&${u.currentRole}>`
  ).join('\n') || 'No investors yet.';
  const embed = new EmbedBuilder()
    .setColor(config.COLOR)
    .setTitle('Investment Stats')
    .addFields(
      { name: 'Total SOL', value: sol(totalSol), inline: true },
      { name: 'On-chain', value: sol(realSol), inline: true },
      { name: 'Manual', value: sol(manualSol), inline: true },
      { name: 'Investors', value: userList.slice(0, 1024) },
    )
    .setTimestamp();
  if (d.pool) {
    const bar = poolProgressBar(d.pool.current, d.pool.target);
    embed.addFields({ name: 'Pool', value: bar || 'No data' });
  }
  return embed;
}

function poolStatusEmbed(pool) {
  if (!pool) {
    return new EmbedBuilder()
      .setColor(config.COLOR)
      .setTitle('Pool Status')
      .setDescription('No active pool. Start one with `/startpool`.')
      .setTimestamp();
  }
  const bar = poolProgressBar(pool.current, pool.target);
  const contributors = (pool.contributors || []).map(c => `${c.username} — ${sol(c.amount)}`).join('\n') || 'No contributions yet.';
  return new EmbedBuilder()
    .setColor(config.COLOR)
    .setTitle('Pool Status')
    .addFields(
      { name: 'Target', value: sol(pool.target), inline: true },
      { name: 'Current', value: sol(pool.current || 0), inline: true },
      { name: 'Contributors', value: `${(pool.contributors || []).length}`, inline: true },
      { name: 'Progress', value: bar || 'N/A' },
      { name: 'Breakdown', value: contributors.slice(0, 1024) },
    )
    .setTimestamp();
}

// ─── Pool ─────────────────────────────────────────────────────────────────────

function addToPool(userId, username, amount) {
  const pool = getPool();
  if (!pool) return null;
  pool.current = (pool.current || 0) + amount;
  const existing = (pool.contributors || []).find(c => c.userId === userId);
  if (existing) existing.amount += amount;
  else { pool.contributors = pool.contributors || []; pool.contributors.push({ userId, username, amount }); }
  savePool(pool);
  return pool;
}

function isPoolFilled(pool) {
  if (!pool) return false;
  return (pool.current || 0) >= pool.target;
}

// ─── Poller ───────────────────────────────────────────────────────────────────

const activeTimers = new Map();

function startPolling(client, ticket) {
  stopPolling(ticket.userId);
  const elapsed = Date.now() - new Date(ticket.createdAt).getTime();
  if (elapsed >= config.CLOSE_AFTER_MS) { setImmediate(() => expireTicket(client, ticket)); return; }

  const warnDelay  = Math.max(0, config.WARN_AFTER_MS - elapsed);
  const closeDelay = Math.max(0, config.CLOSE_AFTER_MS - elapsed);
  const timers = {};

  if (warnDelay > 0) {
    timers.warnTimer = setTimeout(async () => {
      try {
        const chan = await client.channels.fetch(ticket.channelId).catch(() => null);
        if (chan) await chan.send({ embeds: [ticketExpiryWarningEmbed()] });
      } catch (err) { console.error('[poller] Warning send error:', err.message); }
    }, warnDelay);
  }

  timers.closeTimer = setTimeout(async () => {
    const current = getTicket(ticket.userId);
    if (current && current.status === 'open') await expireTicket(client, current);
  }, closeDelay);

  timers.pollInterval = setInterval(async () => {
    try {
      const current = getTicket(ticket.userId);
      if (!current || current.status !== 'open') { stopPolling(ticket.userId); return; }
      if (!current.walletAddress || current.type === 'support' || current.walletAddress === 'Manual Credit') return;
      const { amount, signatures } = await getIncomingAmount(current.walletAddress, current.knownSignatures || []);
      if (amount >= config.MIN_SOL) {
        stopPolling(ticket.userId);
        current.knownSignatures = [...(current.knownSignatures || []), ...signatures];
        saveTicket(current);
        await handlePayment(client, current, amount, 'On-chain', signatures[0] || null);
      }
    } catch (err) { console.error('[poller] Poll error:', err.message); }
  }, config.POLL_INTERVAL_MS);

  activeTimers.set(ticket.userId, timers);
}

function stopPolling(userId) {
  const timers = activeTimers.get(userId);
  if (!timers) return;
  if (timers.warnTimer)    clearTimeout(timers.warnTimer);
  if (timers.closeTimer)   clearTimeout(timers.closeTimer);
  if (timers.pollInterval) clearInterval(timers.pollInterval);
  activeTimers.delete(userId);
}

async function expireTicket(client, ticket) {
  await forceCloseTicket(client, ticket, 'expired');
}

async function recoverTickets(client) {
  const d = readData();
  const openTickets = d.tickets.filter(t => t.status === 'open');
  console.log(`[poller] Recovering ${openTickets.length} open ticket(s)...`);
  for (const ticket of openTickets) {
    try {
      const { amount, signatures } = await getIncomingAmount(ticket.walletAddress, ticket.knownSignatures || []);
      if (amount >= config.MIN_SOL) {
        console.log(`[poller] Found missed payment of ${amount} SOL for ${ticket.username}`);
        ticket.knownSignatures = [...(ticket.knownSignatures || []), ...signatures];
        saveTicket(ticket);
        await handlePayment(client, ticket, amount, 'On-chain', signatures[0] || null);
      } else {
        startPolling(client, ticket);
      }
    } catch (err) { console.error(`[poller] Recovery error for ${ticket.userId}:`, err.message); }
  }
}

// ─── Payment ──────────────────────────────────────────────────────────────────

async function handlePayment(client, ticket, amount, method = 'On-chain', txSignature = null) {
  const guild = client.guilds.cache.first();
  if (!guild) return;
  const userId = ticket.userId;

  if (method === 'On-chain' && ticket.privateKey) {
    const sweepSig = await sweepToTreasury(ticket.privateKey, amount);
    if (sweepSig && !txSignature) txSignature = sweepSig;
  }

  const user = getUser(userId);
  user.lifetimeTotal   = (user.lifetimeTotal || 0) + amount;
  user.investmentCount = (user.investmentCount || 0) + 1;
  const roleId    = user.lifetimeTotal >= 5 ? config.ROLE_5_PLUS : config.ROLE_0_5;
  const oldRoleId = user.currentRole;
  user.currentRole = roleId;
  saveUser(userId, user);

  try {
    const member = await guild.members.fetch(userId);
    if (oldRoleId && oldRoleId !== roleId) await member.roles.remove(oldRoleId).catch(() => {});
    await member.roles.add(roleId).catch(() => {});
  } catch (err) { console.error('[payment] Role assignment error:', err.message); }

  const discordUser = await client.users.fetch(userId).catch(() => ({ tag: ticket.username, id: userId }));
  addInvestment({
    userId, username: ticket.username, amount, lifetimeTotal: user.lifetimeTotal,
    timestamp: new Date().toISOString(), method,
    walletAddress: method === 'Manual' ? 'Manual Credit' : ticket.walletAddress,
    txSignature: txSignature || null,
  });

  // Private log
  try {
    const logChannel = await client.channels.fetch(config.PRIVATE_LOG_CHANNEL);
    const components = [];
    if (txSignature) {
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('View on Solscan').setStyle(ButtonStyle.Link).setURL(`https://solscan.io/tx/${txSignature}`)
      ));
    }
    await logChannel.send({
      embeds: [privateLogEmbed(discordUser, amount, user.lifetimeTotal, method === 'Manual' ? 'Manual Credit' : ticket.walletAddress, roleId, method, txSignature)],
      components,
    });
  } catch (err) { console.error('[payment] Private log error:', err.message); }

  // Show/hide name prompt
  let displayName = 'Anonymous';
  if (method !== 'Manual') {
    try {
      const ticketChannel = await client.channels.fetch(ticket.channelId).catch(() => null);
      if (ticketChannel) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`show_name_${userId}`).setLabel('Show My Name').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`stay_anon_${userId}`).setLabel('Stay Anonymous').setStyle(ButtonStyle.Primary),
        );
        const promptMsg = await ticketChannel.send({ content: 'Would you like your name shown on the public investment board?', components: [row] });
        displayName = await waitForNameChoice(client, promptMsg, userId, discordUser.username, 10000);
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`show_name_${userId}`).setLabel('Show My Name').setStyle(ButtonStyle.Primary).setDisabled(true),
          new ButtonBuilder().setCustomId(`stay_anon_${userId}`).setLabel('Stay Anonymous').setStyle(ButtonStyle.Primary).setDisabled(true),
        );
        await promptMsg.edit({ components: [disabledRow] }).catch(() => {});
        const guildMember = await guild.members.fetch(userId).catch(() => null);
        const roleName = guildMember?.roles.cache.get(roleId)?.name || (roleId === config.ROLE_5_PLUS ? '5+ SOL Investor' : '0-5 SOL Investor');
        await ticketChannel.send({ embeds: [dmConfirmationEmbed(amount, user.lifetimeTotal, roleName)] });
      }
    } catch (err) { console.error('[payment] Ticket channel error:', err.message); }
  } else {
    displayName = discordUser.username || ticket.username || 'Anonymous';
  }

  // Public embed
  const pool = addToPool(userId, ticket.username, amount);
  try {
    const pubChannel = await client.channels.fetch(config.PUBLIC_INVESTMENTS_CHANNEL);
    const components = [];
    if (txSignature) {
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('View on Solscan').setStyle(ButtonStyle.Link).setURL(`https://solscan.io/tx/${txSignature}`)
      ));
    }
    await pubChannel.send({ embeds: [publicInvestmentEmbed(displayName, amount, pool, txSignature)], components });
  } catch (err) { console.error('[payment] Public embed error:', err.message); }

  if (pool && isPoolFilled(pool)) {
    try {
      const pingChannel = await client.channels.fetch(config.POOL_COMPLETE_CHANNEL);
      await pingChannel.send({ content: '@everyone', embeds: [poolFilledEmbed(pool.current, (pool.contributors || []).length)] });
      completePool(pool);
    } catch (err) { console.error('[payment] Pool complete error:', err.message); }
  }

  if (method !== 'Manual') {
    stopPolling(userId);
    const updatedTicket = getTicket(userId) || ticket;
    updatedTicket.amountReceived = (updatedTicket.amountReceived || 0) + amount;
    updatedTicket.status = 'paid';
    saveTicket(updatedTicket);
  }
}

async function waitForNameChoice(client, message, userId, username, timeout) {
  return new Promise(resolve => {
    const collector = message.createMessageComponentCollector({
      filter: i => i.user.id === userId && (i.customId === `show_name_${userId}` || i.customId === `stay_anon_${userId}`),
      time: timeout,
      max: 1,
    });
    collector.on('collect', async i => { await i.deferUpdate().catch(() => {}); resolve(i.customId === `show_name_${userId}` ? username : 'Anonymous'); });
    collector.on('end', collected => { if (collected.size === 0) resolve('Anonymous'); });
  });
}

// ─── Tickets ──────────────────────────────────────────────────────────────────

function ticketChannelName(type, username) {
  const clean = username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';
  return `${type}-${clean}`;
}

async function verifyOrClearTicket(client, userId, type) {
  const existing = getTicket(userId, type);
  if (!existing) return null;
  try {
    const channel = await client.channels.fetch(existing.channelId);
    if (channel) return existing;
  } catch {
    closeTicket(userId, 'stale', type);
    console.log(`[tickets] Stale ${type} ticket cleared for ${userId}`);
  }
  return null;
}

async function createTicket(interaction, type) {
  const user  = interaction.user;
  const guild = interaction.guild;

  const existing = await verifyOrClearTicket(interaction.client, user.id, type);
  if (existing) return interaction.reply({ content: `You already have an open ${type} ticket: <#${existing.channelId}>`, ephemeral: true });

  await interaction.deferReply({ ephemeral: true });

  try {
    const channel = await guild.channels.create({
      name: ticketChannelName(type, user.username),
      type: ChannelType.GuildText,
      parent: config.TICKET_CATEGORY,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
      ],
    });

    const ticket = {
      userId: user.id, username: user.tag, channelId: channel.id, type,
      createdAt: new Date().toISOString(), status: 'open',
      amountReceived: 0, knownSignatures: [], walletAddress: null, privateKey: null,
    };

    if (type === 'invest') {
      const wallet = generateWallet();
      ticket.walletAddress = wallet.address;
      ticket.privateKey    = wallet.privateKey;
      const qrBuffer = await QRCode.toBuffer(wallet.address, { width: 300 });
      await channel.send({ embeds: [ticketWelcomeEmbed(wallet.address)], files: [new AttachmentBuilder(qrBuffer, { name: 'wallet-qr.png' })] });
      const adminChannel = await guild.channels.fetch(config.ADMIN_KEY_CHANNEL).catch(() => null);
      if (adminChannel) await adminChannel.send({ embeds: [adminKeyEmbed(user, channel.id, wallet.address, wallet.privateKey)] });
    } else {
      const embed = new EmbedBuilder()
        .setColor(config.COLOR)
        .setTitle('Support Ticket')
        .setDescription(`<@${user.id}> — a support member will be with you shortly. Describe your issue below.`)
        .setTimestamp();
      await channel.send({ content: `<@&${config.SUPPORT_ROLE}>`, embeds: [embed] });
    }

    saveTicket(ticket);
    if (type === 'invest') startPolling(interaction.client, ticket);
    await interaction.editReply({ content: `Your ${type} ticket has been created: <#${channel.id}>` });
  } catch (err) {
    console.error(`[tickets] createTicket (${type}) error:`, err);
    await interaction.editReply({ content: 'Failed to create ticket. Please try again.' });
  }
}

async function forceCloseTicket(client, ticket, reason = 'closed') {
  try {
    stopPolling(ticket.userId);
    const guild = client.guilds.cache.first();
    if (!guild) return;
    const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
    if (channel) {
      const closeEmbed = reason === 'expired' ? ticketExpiredEmbed() : ticketClosedByAdminEmbed();
      await channel.send({ embeds: [closeEmbed] }).catch(() => {});
      await channel.delete('Ticket closed').catch(() => {});
    }
    closeTicket(ticket.userId, reason, ticket.type);
  } catch (err) {
    console.error('[tickets] forceCloseTicket error:', err);
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

const slashCommands = [
  new SlashCommandBuilder().setName('startpool').setDescription('Start a new investment pool (admin only)').addNumberOption(o => o.setName('target').setDescription('SOL target amount').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator).toJSON(),
  new SlashCommandBuilder().setName('credit').setDescription('Add SOL to the active pool (admin only)').addNumberOption(o => o.setName('amount').setDescription('SOL amount to credit').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator).toJSON(),
  new SlashCommandBuilder().setName('addbalance').setDescription('Manually credit a user with SOL (admin only)').addUserOption(o => o.setName('user').setDescription('The user to credit').setRequired(true)).addNumberOption(o => o.setName('amount').setDescription('SOL amount').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator).toJSON(),
  new SlashCommandBuilder().setName('investments').setDescription('View investment statistics (admin only)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).toJSON(),
  new SlashCommandBuilder().setName('poolstatus').setDescription('View current pool status (admin only)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).toJSON(),
  new SlashCommandBuilder().setName('closeticket').setDescription('Force close this ticket channel (admin only)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).toJSON(),
  new SlashCommandBuilder().setName('resetticket').setDescription("Reset a user's open ticket status (admin only)").addUserOption(o => o.setName('user').setDescription('The user to reset').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator).toJSON(),
];

async function registerCommands(clientId) {
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  try {
    console.log('[commands] Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(clientId, config.GUILD_ID), { body: slashCommands });
    console.log('[commands] Slash commands registered.');
  } catch (err) {
    console.error('[commands] Failed to register commands:', err.message);
  }
}

async function handleCommand(interaction) {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  if (commandName === 'startpool') {
    await interaction.deferReply({ ephemeral: true });
    const target   = interaction.options.getNumber('target');
    const existing = getPool();
    if (existing) return interaction.editReply({ content: `A pool is already active (${existing.current}/${existing.target} SOL).` });
    savePool({ target, current: 0, contributors: [], startTime: new Date().toISOString() });
    try {
      const pubChannel = await interaction.client.channels.fetch(config.PUBLIC_INVESTMENTS_CHANNEL);
      await pubChannel.send({ embeds: [new EmbedBuilder().setColor(config.COLOR).setTitle('New Investment Pool').addFields({ name: 'Target', value: `${target} SOL` }, { name: 'Progress', value: poolProgressBar(0, target) }).setFooter({ text: `Powered by ${config.SERVER_NAME}` }).setTimestamp()] });
    } catch (err) { console.error('[commands] Pool announce error:', err.message); }
    return interaction.editReply({ content: `Pool started with a target of **${target} SOL**.` });
  }

  if (commandName === 'credit') {
    await interaction.deferReply({ ephemeral: true });
    const amount = interaction.options.getNumber('amount');
    const pool   = getPool();
    if (!pool) return interaction.editReply({ content: 'No active pool. Use `/startpool` first.' });
    pool.current = (pool.current || 0) + amount;
    savePool(pool);
    if (isPoolFilled(pool)) {
      try {
        const pingChannel = await interaction.client.channels.fetch(config.POOL_COMPLETE_CHANNEL);
        await pingChannel.send({ content: '@everyone', embeds: [poolFilledEmbed(pool.current, (pool.contributors || []).length)] });
        completePool(pool);
      } catch (err) { console.error('[commands] Pool complete error:', err.message); }
    }
    try {
      const pubChannel = await interaction.client.channels.fetch(config.PUBLIC_INVESTMENTS_CHANNEL);
      await pubChannel.send({ embeds: [publicInvestmentEmbed('Admin Credit', amount, getPool() || pool)] });
    } catch (err) { console.error('[commands] Credit public embed error:', err.message); }
    return interaction.editReply({ content: `Credited **${amount} SOL** to pool.\n${poolProgressBar(pool.current, pool.target)}` });
  }

  if (commandName === 'addbalance') {
    await interaction.deferReply({ ephemeral: true });
    const targetUser = interaction.options.getUser('user');
    const amount     = interaction.options.getNumber('amount');
    const realTicket = getTicket(targetUser.id);
    const usedTicket = realTicket || { userId: targetUser.id, username: targetUser.tag, channelId: null, walletAddress: 'Manual Credit', privateKey: '', type: 'invest' };
    await handlePayment(interaction.client, usedTicket, amount, 'Manual');
    return interaction.editReply({ content: `Credited **${amount} SOL** to ${targetUser.tag}.` });
  }

  if (commandName === 'investments') {
    return interaction.reply({ embeds: [investmentsStatsEmbed(readData())], ephemeral: true });
  }

  if (commandName === 'poolstatus') {
    return interaction.reply({ embeds: [poolStatusEmbed(getPool())], ephemeral: true });
  }

  if (commandName === 'closeticket') {
    await interaction.deferReply({ ephemeral: true });
    const d      = readData();
    const ticket = d.tickets.find(t => t.channelId === interaction.channelId && t.status === 'open');
    if (!ticket) return interaction.editReply({ content: 'This is not an active ticket channel.' });
    stopPolling(ticket.userId);
    await forceCloseTicket(interaction.client, ticket, 'admin-closed');
    await interaction.editReply({ content: 'Ticket closed.' }).catch(() => {});
  }

  if (commandName === 'resetticket') {
    await interaction.deferReply({ ephemeral: true });
    const targetUser = interaction.options.getUser('user');
    const d  = readData();
    const idx = d.tickets.findIndex(t => t.userId === targetUser.id && t.status === 'open');
    if (idx === -1) return interaction.editReply({ content: `${targetUser.tag} has no open ticket.` });
    d.tickets[idx].status = 'reset';
    writeData(d);
    return interaction.editReply({ content: `Reset ticket for ${targetUser.tag}.` });
  }
}

// ─── Bot ──────────────────────────────────────────────────────────────────────

const app = express();
app.get('/', (_, res) => res.send('Bot is running.'));
app.listen(process.env.PORT || 3000, () => console.log(`[keepalive] HTTP server on port ${process.env.PORT || 3000}`));

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
  const d = readData();
  const channel = await client.channels.fetch(config.TICKET_BUTTON_CHANNEL).catch(() => null);
  if (!channel) { console.error('[bot] Ticket button channel not found:', config.TICKET_BUTTON_CHANNEL); return; }

  if (d.ticketMessageId) {
    const existing = await channel.messages.fetch(d.ticketMessageId).catch(() => null);
    if (existing) await existing.delete().catch(() => {});
  }

  const embed = new EmbedBuilder()
    .setColor(config.COLOR)
    .setTitle('Investment Center')
    .setDescription('Click the buttons below to open a private ticket.\n\n**Invest** — Open a private ticket to invest SOL\n**Support** — Open a support ticket')
    .setFooter({ text: `Powered by ${config.SERVER_NAME}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('open_invest_ticket').setLabel('Invest').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('open_support_ticket').setLabel('Support').setStyle(ButtonStyle.Primary),
  );

  const msg = await channel.send({ embeds: [embed], components: [row] });
  const d2 = readData();
  d2.ticketMessageId = msg.id;
  writeData(d2);
  console.log('[bot] Ticket message created:', msg.id);
}

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isButton()) {
      const { customId } = interaction;
      if (customId === 'open_invest_ticket') { await createTicket(interaction, 'invest'); return; }
      if (customId === 'open_support_ticket') { await createTicket(interaction, 'support'); return; }
      if (customId.startsWith('show_name_') || customId.startsWith('stay_anon_')) { await interaction.deferUpdate().catch(() => {}); return; }
    }
    if (interaction.isChatInputCommand()) await handleCommand(interaction);
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
