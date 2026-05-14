'use strict';

const { EmbedBuilder } = require('discord.js');
const config = require('./config');

const COLOR = 0x5865F2;

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

// ─── Ticket Embeds ────────────────────────────────────────────────────────────

function ticketWelcomeEmbed(walletAddress) {
  return new EmbedBuilder()
    .setColor(COLOR)
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
    .setColor(COLOR)
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
    .setColor(COLOR)
    .setTitle('Ticket Expiring Soon')
    .setDescription('5 minutes remaining. Send your payment now or the ticket will close.')
    .setTimestamp();
}

function ticketExpiredEmbed() {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('Ticket Expired')
    .setDescription('No payment was received. You can open a new ticket at any time.')
    .setTimestamp();
}

function ticketClosedByAdminEmbed() {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('Ticket Closed')
    .setDescription('Your ticket was closed by an admin. Open a support ticket if you have questions.')
    .setTimestamp();
}

// ─── Payment Embeds ───────────────────────────────────────────────────────────

function privateLogEmbed(user, amount, lifetimeTotal, walletAddress, roleId, method, txSignature = null) {
  const s = parseFloat(amount.toFixed(4));
  const embed = new EmbedBuilder()
    .setColor(COLOR)
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

  if (txSignature) {
    embed.addFields({ name: 'Transaction', value: `\`${txSignature}\`` });
  }

  return embed;
}

function publicInvestmentEmbed(displayName, amount, pool, txSignature = null) {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
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

  if (txSignature) {
    embed.addFields({ name: 'Transaction', value: `\`${txSignature}\`` });
  }

  return embed;
}

function dmConfirmationEmbed(amount, lifetimeTotal, roleName) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('Investment Confirmed')
    .addFields(
      { name: 'Amount', value: sol(amount), inline: true },
      { name: 'Lifetime', value: sol(lifetimeTotal), inline: true },
      { name: 'Role', value: roleName, inline: true },
    )
    .setTimestamp();
}

// ─── Pool Embeds ──────────────────────────────────────────────────────────────

function poolFilledEmbed(totalSol, uniqueInvestors) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('Pool Filled')
    .addFields(
      { name: 'Total Raised', value: sol(totalSol), inline: true },
      { name: 'Investors', value: `${uniqueInvestors}`, inline: true },
    )
    .setTimestamp();
}

function investmentsStatsEmbed(data) {
  const totalSol  = data.investments.reduce((s, i) => s + i.amount, 0);
  const realSol   = data.investments.filter(i => i.method === 'On-chain').reduce((s, i) => s + i.amount, 0);
  const manualSol = data.investments.filter(i => i.method === 'Manual').reduce((s, i) => s + i.amount, 0);

  const userList = Object.entries(data.users).map(([uid, u]) => {
    return `<@${uid}> — ${sol(u.lifetimeTotal)} · ${u.investmentCount} investment(s) · <@&${u.currentRole}>`;
  }).join('\n') || 'No investors yet.';

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('Investment Stats')
    .addFields(
      { name: 'Total SOL', value: sol(totalSol), inline: true },
      { name: 'On-chain', value: sol(realSol), inline: true },
      { name: 'Manual', value: sol(manualSol), inline: true },
      { name: 'Investors', value: userList.slice(0, 1024) },
    )
    .setTimestamp();

  if (data.pool) {
    const bar = poolProgressBar(data.pool.current, data.pool.target);
    embed.addFields({ name: 'Pool', value: bar || 'No data' });
  }

  return embed;
}

function poolStatusEmbed(pool) {
  if (!pool) {
    return new EmbedBuilder()
      .setColor(COLOR)
      .setTitle('Pool Status')
      .setDescription('No active pool. Start one with `/startpool`.')
      .setTimestamp();
  }

  const bar = poolProgressBar(pool.current, pool.target);
  const contributors = (pool.contributors || [])
    .map(c => `${c.username} — ${sol(c.amount)}`)
    .join('\n') || 'No contributions yet.';

  return new EmbedBuilder()
    .setColor(COLOR)
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

module.exports = {
  ticketWelcomeEmbed,
  adminKeyEmbed,
  ticketExpiryWarningEmbed,
  ticketExpiredEmbed,
  ticketClosedByAdminEmbed,
  privateLogEmbed,
  publicInvestmentEmbed,
  dmConfirmationEmbed,
  poolFilledEmbed,
  investmentsStatsEmbed,
  poolStatusEmbed,
  poolProgressBar,
};
