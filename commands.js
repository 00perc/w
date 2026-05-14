'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, Routes, EmbedBuilder } = require('discord.js');
const { REST } = require('@discordjs/rest');
const config = require('./config');
const data = require('./data');
const embeds = require('./embeds');
const poolManager = require('./pool');
const { handlePayment } = require('./payment');
const { forceCloseTicket } = require('./tickets');
const { stopPolling } = require('./poller');

const commands = [
  new SlashCommandBuilder()
    .setName('startpool')
    .setDescription('Start a new investment pool (admin only)')
    .addNumberOption(o => o.setName('target').setDescription('SOL target amount').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('credit')
    .setDescription('Add SOL to the active pool (admin only)')
    .addNumberOption(o => o.setName('amount').setDescription('SOL amount to credit').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('addbalance')
    .setDescription('Manually credit a user with SOL (admin only)')
    .addUserOption(o => o.setName('user').setDescription('The user to credit').setRequired(true))
    .addNumberOption(o => o.setName('amount').setDescription('SOL amount').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('investments')
    .setDescription('View investment statistics (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('poolstatus')
    .setDescription('View current pool status (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('closeticket')
    .setDescription('Force close this ticket channel (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('resetticket')
    .setDescription("Reset a user's open ticket status (admin only)")
    .addUserOption(o => o.setName('user').setDescription('The user to reset').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
];

async function registerCommands(clientId) {
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  try {
    console.log('[commands] Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(clientId, config.GUILD_ID), { body: commands });
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
    const target = interaction.options.getNumber('target');
    const existing = data.getPool();
    if (existing) {
      return interaction.editReply({ content: `❌ A pool is already active (${existing.current}/${existing.target} SOL).` });
    }
    const pool = { target, current: 0, contributors: [], startTime: new Date().toISOString() };
    data.savePool(pool);

    try {
      const pubChannel = await interaction.client.channels.fetch(config.PUBLIC_INVESTMENTS_CHANNEL);
      const announceEmbed = new EmbedBuilder()
        .setColor(config.COLOR_PRIMARY)
        .setTitle('🏊 New Investment Pool Opened!')
        .addFields(
          { name: '🎯 Target', value: `${target} SOL` },
          { name: '📊 Progress', value: embeds.poolProgressBar(0, target) },
        )
        .setFooter({ text: `Powered by ${config.SERVER_NAME}` })
        .setTimestamp();
      await pubChannel.send({ embeds: [announceEmbed] });
    } catch (err) {
      console.error('[commands] Pool announce error:', err.message);
    }

    return interaction.editReply({ content: `✅ Pool started with a target of **${target} SOL**.` });
  }

  if (commandName === 'credit') {
    await interaction.deferReply({ ephemeral: true });
    const amount = interaction.options.getNumber('amount');
    const pool = data.getPool();
    if (!pool) return interaction.editReply({ content: '❌ No active pool. Use `/startpool` first.' });

    pool.current = (pool.current || 0) + amount;
    data.savePool(pool);

    if (poolManager.isPoolFilled(pool)) {
      try {
        const pingChannel = await interaction.client.channels.fetch(config.POOL_COMPLETE_CHANNEL);
        await pingChannel.send({
          content: '@everyone',
          embeds: [embeds.poolFilledEmbed(pool.current, (pool.contributors || []).length)],
        });
        data.completePool(pool);
      } catch (err) {
        console.error('[commands] Pool complete error:', err.message);
      }
    }

    try {
      const pubChannel = await interaction.client.channels.fetch(config.PUBLIC_INVESTMENTS_CHANNEL);
      await pubChannel.send({ embeds: [embeds.publicInvestmentEmbed('Admin Credit', amount, data.getPool() || pool)] });
    } catch (err) {
      console.error('[commands] Credit public embed error:', err.message);
    }

    const bar = embeds.poolProgressBar(pool.current, pool.target);
    return interaction.editReply({ content: `✅ Credited **${amount} SOL** to pool.\n📊 ${bar}` });
  }

  if (commandName === 'addbalance') {
    await interaction.deferReply({ ephemeral: true });
    const targetUser = interaction.options.getUser('user');
    const amount = interaction.options.getNumber('amount');

    // Build a minimal ticket object — manual credits skip show/hide and ticket-close
    const realTicket = data.getTicket(targetUser.id);
    const usedTicket = realTicket || {
      userId: targetUser.id,
      username: targetUser.tag,
      channelId: null,
      walletAddress: 'Manual Credit',
      privateKey: '',
      type: 'invest',
    };

    await handlePayment(interaction.client, usedTicket, amount, 'Manual');
    return interaction.editReply({ content: `✅ Credited **${amount} SOL** to ${targetUser.tag}.` });
  }

  if (commandName === 'investments') {
    const d = data.read();
    return interaction.reply({ embeds: [embeds.investmentsStatsEmbed(d)], ephemeral: true });
  }

  if (commandName === 'poolstatus') {
    return interaction.reply({ embeds: [embeds.poolStatusEmbed(data.getPool())], ephemeral: true });
  }

  if (commandName === 'closeticket') {
    await interaction.deferReply({ ephemeral: true });
    const d = data.read();
    const ticket = d.tickets.find(t => t.channelId === interaction.channelId && t.status === 'open');
    if (!ticket) return interaction.editReply({ content: '❌ This is not an active ticket channel.' });
    stopPolling(ticket.userId);
    await forceCloseTicket(interaction.client, ticket, 'admin-closed');
    await interaction.editReply({ content: '✅ Ticket closed.' }).catch(() => {});
  }

  if (commandName === 'resetticket') {
    await interaction.deferReply({ ephemeral: true });
    const targetUser = interaction.options.getUser('user');
    const d = data.read();
    const idx = d.tickets.findIndex(t => t.userId === targetUser.id && t.status === 'open');
    if (idx === -1) return interaction.editReply({ content: `❌ ${targetUser.tag} has no open ticket.` });
    d.tickets[idx].status = 'reset';
    data.write(d);
    return interaction.editReply({ content: `✅ Reset ticket for ${targetUser.tag}. They can now open a new one.` });
  }
}

module.exports = { registerCommands, handleCommand };
