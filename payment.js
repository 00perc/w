'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('./config');
const data = require('./data');
const embeds = require('./embeds');
const poolManager = require('./pool');
const { sweepToTreasury } = require('./wallet');
const { stopPolling } = require('./poller');

async function handlePayment(client, ticket, amount, method = 'On-chain') {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  const userId = ticket.userId;

  // Sweep received SOL to treasury (on-chain payments only)
  if (method === 'On-chain' && ticket.privateKey) {
    await sweepToTreasury(ticket.privateKey, amount);
  }

  // 1. Update user record
  const user = data.getUser(userId);
  user.lifetimeTotal = (user.lifetimeTotal || 0) + amount;
  user.investmentCount = (user.investmentCount || 0) + 1;

  // 2. Assign role
  const roleId = user.lifetimeTotal >= 5 ? config.ROLE_5_PLUS : config.ROLE_0_5;
  const oldRoleId = user.currentRole;
  user.currentRole = roleId;
  data.saveUser(userId, user);

  try {
    const member = await guild.members.fetch(userId);
    if (oldRoleId && oldRoleId !== roleId) await member.roles.remove(oldRoleId).catch(() => {});
    await member.roles.add(roleId).catch(() => {});
  } catch (err) {
    console.error('[payment] Role assignment error:', err.message);
  }

  // 3. Record investment
  const discordUser = await client.users.fetch(userId).catch(() => ({ tag: ticket.username, id: userId }));
  data.addInvestment({
    userId,
    username: ticket.username,
    amount,
    lifetimeTotal: user.lifetimeTotal,
    timestamp: new Date().toISOString(),
    method,
    walletAddress: method === 'Manual' ? 'Manual Credit' : ticket.walletAddress,
  });

  // 4. Private admin log
  try {
    const logChannel = await client.channels.fetch(config.PRIVATE_LOG_CHANNEL);
    await logChannel.send({
      embeds: [embeds.privateLogEmbed(
        discordUser, amount, user.lifetimeTotal,
        method === 'Manual' ? 'Manual Credit' : ticket.walletAddress,
        roleId, method
      )],
    });
  } catch (err) {
    console.error('[payment] Private log error:', err.message);
  }

  // 5. Show/Hide prompt + confirmation in ticket channel (on-chain only)
  let displayName = 'Anonymous';
  if (method !== 'Manual') {
    try {
      const ticketChannel = await client.channels.fetch(ticket.channelId).catch(() => null);
      if (ticketChannel) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`show_name_${userId}`).setLabel('👤 Show My Name').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`stay_anon_${userId}`).setLabel('🔒 Stay Anonymous').setStyle(ButtonStyle.Secondary),
        );

        const promptMsg = await ticketChannel.send({
          content: '💬 Would you like your name shown on the public investment board?',
          components: [row],
        });

        displayName = await waitForNameChoice(client, promptMsg, userId, discordUser.username, 10000);

        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`show_name_${userId}`).setLabel('👤 Show My Name').setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId(`stay_anon_${userId}`).setLabel('🔒 Stay Anonymous').setStyle(ButtonStyle.Secondary).setDisabled(true),
        );
        await promptMsg.edit({ components: [disabledRow] }).catch(() => {});

        // Send confirmation in ticket channel
        const guildMember = await guild.members.fetch(userId).catch(() => null);
        const roleName = guildMember?.roles.cache.get(roleId)?.name || (roleId === config.ROLE_5_PLUS ? '5+ SOL Investor' : '0-5 SOL Investor');
        await ticketChannel.send({ embeds: [embeds.dmConfirmationEmbed(amount, user.lifetimeTotal, roleName)] });
      }
    } catch (err) {
      console.error('[payment] Ticket channel error:', err.message);
    }
  } else {
    displayName = discordUser.username || ticket.username || 'Anonymous';
  }

  // 6. Update pool
  const pool = poolManager.addToPool(userId, ticket.username, amount);

  // 7. Public investment embed
  try {
    const pubChannel = await client.channels.fetch(config.PUBLIC_INVESTMENTS_CHANNEL);
    await pubChannel.send({ embeds: [embeds.publicInvestmentEmbed(displayName, amount, pool)] });
  } catch (err) {
    console.error('[payment] Public embed error:', err.message);
  }

  // 8. Check pool completion
  if (pool && poolManager.isPoolFilled(pool)) {
    await handlePoolComplete(client, pool);
  }

  // 9. Stop monitoring — ticket stays open, channel remains (on-chain only)
  if (method !== 'Manual') {
    stopPolling(userId);
    const updatedTicket = data.getTicket(userId) || ticket;
    updatedTicket.amountReceived = (updatedTicket.amountReceived || 0) + amount;
    updatedTicket.status = 'paid';
    data.saveTicket(updatedTicket);
  }
}

async function waitForNameChoice(client, message, userId, username, timeout) {
  return new Promise(resolve => {
    const collector = message.createMessageComponentCollector({
      filter: i => i.user.id === userId && (i.customId === `show_name_${userId}` || i.customId === `stay_anon_${userId}`),
      time: timeout,
      max: 1,
    });
    collector.on('collect', async i => {
      await i.deferUpdate().catch(() => {});
      resolve(i.customId === `show_name_${userId}` ? username : 'Anonymous');
    });
    collector.on('end', collected => {
      if (collected.size === 0) resolve('Anonymous');
    });
  });
}

async function handlePoolComplete(client, pool) {
  try {
    const uniqueInvestors = (pool.contributors || []).length;
    const pingChannel = await client.channels.fetch(config.POOL_COMPLETE_CHANNEL);
    await pingChannel.send({
      content: '@everyone',
      embeds: [embeds.poolFilledEmbed(pool.current, uniqueInvestors)],
    });
    data.completePool(pool);
  } catch (err) {
    console.error('[payment] Pool complete error:', err.message);
  }
}

module.exports = { handlePayment };
