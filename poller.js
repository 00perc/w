'use strict';

const config = require('./config');
const data = require('./data');
const { getIncomingAmount } = require('./wallet');

const activeTimers = new Map();

function startPolling(client, ticket) {
  stopPolling(ticket.userId);

  const createdAt = new Date(ticket.createdAt).getTime();
  const now = Date.now();
  const elapsed = now - createdAt;

  if (elapsed >= config.CLOSE_AFTER_MS) {
    setImmediate(() => expireTicket(client, ticket));
    return;
  }

  const warnDelay = Math.max(0, config.WARN_AFTER_MS - elapsed);
  const closeDelay = Math.max(0, config.CLOSE_AFTER_MS - elapsed);
  const timers = {};

  if (warnDelay > 0) {
    timers.warnTimer = setTimeout(async () => {
      try {
        const chan = await client.channels.fetch(ticket.channelId).catch(() => null);
        if (chan) {
          const { ticketExpiryWarningEmbed } = require('./embeds');
          await chan.send({ embeds: [ticketExpiryWarningEmbed()] });
        }
      } catch (err) {
        console.error('[poller] Warning send error:', err.message);
      }
    }, warnDelay);
  }

  timers.closeTimer = setTimeout(async () => {
    const current = data.getTicket(ticket.userId);
    if (current && current.status === 'open') {
      await expireTicket(client, current);
    }
  }, closeDelay);

  timers.pollInterval = setInterval(async () => {
    try {
      const current = data.getTicket(ticket.userId);
      if (!current || current.status !== 'open') {
        stopPolling(ticket.userId);
        return;
      }

      // Skip tickets without a valid on-chain wallet
      if (!current.walletAddress || current.type === 'support' ||
          current.walletAddress === 'Manual Credit') {
        return;
      }

      const { amount, signatures } = await getIncomingAmount(current.walletAddress, current.knownSignatures || []);

      if (amount >= config.MIN_SOL) {
        stopPolling(ticket.userId);
        current.knownSignatures = [...(current.knownSignatures || []), ...signatures];
        data.saveTicket(current);
        const { handlePayment } = require('./payment');
        await handlePayment(client, current, amount, 'On-chain');
      }
    } catch (err) {
      console.error('[poller] Poll error:', err.message);
    }
  }, config.POLL_INTERVAL_MS);

  activeTimers.set(ticket.userId, timers);
}

function stopPolling(userId) {
  const timers = activeTimers.get(userId);
  if (!timers) return;
  if (timers.warnTimer) clearTimeout(timers.warnTimer);
  if (timers.closeTimer) clearTimeout(timers.closeTimer);
  if (timers.pollInterval) clearInterval(timers.pollInterval);
  activeTimers.delete(userId);
}

async function expireTicket(client, ticket) {
  const { forceCloseTicket } = require('./tickets');
  await forceCloseTicket(client, ticket, 'expired');
}

async function recoverTickets(client) {
  const d = data.read();
  const openTickets = d.tickets.filter(t => t.status === 'open');
  console.log(`[poller] Recovering ${openTickets.length} open ticket(s)...`);

  for (const ticket of openTickets) {
    try {
      const { amount, signatures } = await getIncomingAmount(ticket.walletAddress, ticket.knownSignatures || []);
      if (amount >= config.MIN_SOL) {
        console.log(`[poller] Found missed payment of ${amount} SOL for ${ticket.username}`);
        ticket.knownSignatures = [...(ticket.knownSignatures || []), ...signatures];
        data.saveTicket(ticket);
        const { handlePayment } = require('./payment');
        await handlePayment(client, ticket, amount, 'On-chain');
      } else {
        startPolling(client, ticket);
      }
    } catch (err) {
      console.error(`[poller] Recovery error for ${ticket.userId}:`, err.message);
    }
  }
}

module.exports = { startPolling, stopPolling, recoverTickets };
