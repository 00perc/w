'use strict';

const { EmbedBuilder } = require('discord.js');
const config = require('./config');

function sol(amount) {
  return `\`${Number(amount).toFixed(4)} SOL\``;
}

function adminLogTitle(amount) {
  return amount >= 25 ? `🐋 ${amount} SOL Invested` : `📋 ${amount} SOL Invested`;
}

function poolProgressBar(current, target) {
  if (!target || target <= 0) return null;
  const pct = Math.min(current / target, 1);
  const filled = Math.round(pct * 20);
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
  return `\`[${bar}]\` **${Number(current).toFixed(2)}** / **${target} SOL** (${Math.round(pct * 100)}%)`;
}

// ─── Ticket Embeds ────────────────────────────────────────────────────────────

function ticketWelcomeEmbed(walletAddress) {
  return new EmbedBuilder()
    .setColor(0x000000)
    .setTitle('🎫 Investment Ticket Opened')
    .setDescription('Send SOL to the wallet below to complete your investment.')
    .addFields(
      { name: '💳 Wallet Address', value: `\`\`\`${walletAddress}\`\`\`` },
      {
        name: '📌 Steps',
        value: '**1.** Copy the wallet address above\n**2.** Send your SOL from any wallet\n**3.** Automatic confirmation + Auto Roles',
      },
    )
    .setTimestamp();
}

function adminKeyEmbed(user, channelId, walletAddress, privateKey) {
  return new EmbedBuilder()
    .setColor(0x000000)
    .setTitle('🔑 New Ticket — Recovery Info')
    .addFields(
      { name: '👤 User', value: `**${user.tag}** \`${user.id}\``, inline: true },
      { name: '📺 Channel', value: `<#${channelId}>`, inline: true },
      { name: '💳 Wallet', value: `\`\`\`${walletAddress}\`\`\`` },
      { name: '🔐 Private Key', value: `\`\`\`${privateKey}\`\`\`` },
    )
    .setTimestamp();
}

function ticketExpiryWarningEmbed() {
  return new EmbedBuilder()
    .setColor(0x000000)
    .setTitle('⚠️ Ticket Expiring Soon')
    .setDescription('**5 minutes remaining.** Send your payment now or your ticket will close.')
    .setTimestamp();
}

function ticketExpiredEmbed() {
  return new EmbedBuilder()
    .setColor(0x000000)
    .setTitle('❌ Ticket Expired')
    .setDescription('No payment was received. You can open a new ticket at any time.')
    .setTimestamp();
}

function ticketClosedByAdminEmbed() {
  return new EmbedBuilder()
    .setColor(0x000000)
    .setTitle('❌ Ticket Closed')
    .setDescription('Your ticket was closed by an admin. Open a support ticket if you have questions.')
    .setTimestamp();
}

// ─── Payment Embeds ───────────────────────────────────────────────────────────

function adminPaymentPingEmbed(user, amount, lifetimeTotal) {
  return new EmbedBuilder()
    .setColor(0x000000)
    .setTitle('💰 New Payment Received')
    .addFields(
      { name: '👤 User', value: `**${user.tag}**`, inline: true },
      { name: '💎 Amount', value: sol(amount), inline: true },
      { name: '📊 Lifetime', value: sol(lifetimeTotal), inline: true },
    )
    .setTimestamp();
}

function privateLogEmbed(user, amount, lifetimeTotal, walletAddress, roleId, method) {
  const s = parseFloat(amount.toFixed(4));
  return new EmbedBuilder()
    .setColor(0x000000)
    .setTitle(adminLogTitle(s))
    .addFields(
      { name: '👤 User', value: `**${user.tag}** \`${user.id}\`` },
      { name: '💎 Amount', value: sol(s), inline: true },
      { name: '📊 Lifetime', value: sol(lifetimeTotal), inline: true },
      { name: '🎖️ Role', value: `<@&${roleId}>`, inline: true },
      { name: '💳 Method', value: `**${method}**`, inline: true },
      { name: '🔑 Wallet', value: `\`${walletAddress}\`` },
    )
    .setTimestamp();
}

function publicInvestmentEmbed(displayName, amount, pool) {
  const embed = new EmbedBuilder()
    .setColor(0x000000)
    .setTitle('💎 New Investment')
    .addFields(
      { name: '👤 Investor', value: `**${displayName}**`, inline: true },
      { name: '💎 Amount', value: sol(amount), inline: true },
    )
    .setTimestamp();

  if (pool) {
    const bar = poolProgressBar(pool.current, pool.target);
    if (bar) embed.addFields({ name: '🏊 Pool', value: bar });
  }

  return embed;
}

function dmConfirmationEmbed(amount, lifetimeTotal, roleName) {
  return new EmbedBuilder()
    .setColor(0x000000)
    .setTitle('✅ Investment Confirmed')
    .setDescription('Your investment has been received and your role has been updated.')
    .addFields(
      { name: '💎 Amount', value: sol(amount), inline: true },
      { name: '📊 Lifetime', value: sol(lifetimeTotal), inline: true },
      { name: '🎖️ Role', value: `**${roleName}**`, inline: true },
    )
    .setTimestamp();
}

// ─── Pool Embeds ──────────────────────────────────────────────────────────────

function poolFilledEmbed(totalSol, uniqueInvestors) {
  return new EmbedBuilder()
    .setColor(0x000000)
    .setTitle('🎉 Pool Filled!')
    .addFields(
      { name: '💰 Total Raised', value: sol(totalSol), inline: true },
      { name: '👥 Investors', value: `\`${uniqueInvestors}\``, inline: true },
    )
    .setTimestamp();
}

function investmentsStatsEmbed(data) {
  const totalSol  = data.investments.reduce((s, i) => s + i.amount, 0);
  const realSol   = data.investments.filter(i => i.method === 'On-chain').reduce((s, i) => s + i.amount, 0);
  const manualSol = data.investments.filter(i => i.method === 'Manual').reduce((s, i) => s + i.amount, 0);

  const userList = Object.entries(data.users).map(([uid, u]) => {
    return `<@${uid}> — ${sol(u.lifetimeTotal)} · **${u.investmentCount}** invest(s) · <@&${u.currentRole}>`;
  }).join('\n') || '*No investors yet.*';

  const embed = new EmbedBuilder()
    .setColor(0x000000)
    .setTitle('📊 Investment Stats')
    .addFields(
      { name: '💰 Total SOL', value: sol(totalSol), inline: true },
      { name: '⛓️ On-chain', value: sol(realSol), inline: true },
      { name: '✍️ Manual', value: sol(manualSol), inline: true },
      { name: '👥 Investors', value: userList.slice(0, 1024) },
    )
    .setTimestamp();

  if (data.pool) {
    const bar = poolProgressBar(data.pool.current, data.pool.target);
    embed.addFields({ name: '🏊 Pool', value: bar || '*No data*' });
  }

  return embed;
}

function poolStatusEmbed(pool) {
  if (!pool) {
    return new EmbedBuilder()
      .setColor(0x000000)
      .setTitle('🏊 Pool Status')
      .setDescription('No active pool. Start one with `/startpool`.')
      .setTimestamp();
  }

  const bar = poolProgressBar(pool.current, pool.target);
  const contributors = (pool.contributors || [])
    .map(c => `**${c.username}** — ${sol(c.amount)}`)
    .join('\n') || '*No contributions yet.*';

  return new EmbedBuilder()
    .setColor(0x000000)
    .setTitle('🏊 Pool Status')
    .addFields(
      { name: '🎯 Target', value: sol(pool.target), inline: true },
      { name: '💰 Current', value: sol(pool.current || 0), inline: true },
      { name: '👥 Contributors', value: `\`${(pool.contributors || []).length}\``, inline: true },
      { name: '📊 Progress', value: bar || '*N/A*' },
      { name: '🧾 Breakdown', value: contributors.slice(0, 1024) },
    )
    .setTimestamp();
}

module.exports = {
  ticketWelcomeEmbed,
  adminKeyEmbed,
  ticketExpiryWarningEmbed,
  ticketExpiredEmbed,
  ticketClosedByAdminEmbed,
  adminPaymentPingEmbed,
  privateLogEmbed,
  publicInvestmentEmbed,
  dmConfirmationEmbed,
  poolFilledEmbed,
  investmentsStatsEmbed,
  poolStatusEmbed,
  poolProgressBar,
};
