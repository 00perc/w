'use strict';

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, 'data.json');

const DEFAULT_DATA = {
  ticketMessageId: '',
  tickets: [],
  investments: [],
  users: {},
  pool: null,
  poolHistory: [],
};

function read() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      fs.writeFileSync(DATA_PATH, JSON.stringify(DEFAULT_DATA, null, 2));
      return { ...DEFAULT_DATA };
    }
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    return { ...DEFAULT_DATA, ...JSON.parse(raw) };
  } catch (err) {
    console.error('[data] Failed to read data.json:', err);
    return { ...DEFAULT_DATA };
  }
}

function write(data) {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[data] Failed to write data.json:', err);
  }
}

function getTicket(userId, type = null) {
  const data = read();
  if (type) {
    return data.tickets.find(t => t.userId === userId && t.status === 'open' && t.type === type) || null;
  }
  return data.tickets.find(t => t.userId === userId && t.status === 'open') || null;
}

function saveTicket(ticket) {
  const data = read();
  const idx = ticket.type
    ? data.tickets.findIndex(t => t.userId === ticket.userId && t.status === 'open' && t.type === ticket.type)
    : data.tickets.findIndex(t => t.userId === ticket.userId && t.status === 'open');
  if (idx >= 0) {
    data.tickets[idx] = ticket;
  } else {
    data.tickets.push(ticket);
  }
  write(data);
}

function closeTicket(userId, status = 'closed', type = null) {
  const data = read();
  const idx = type
    ? data.tickets.findIndex(t => t.userId === userId && t.status === 'open' && t.type === type)
    : data.tickets.findIndex(t => t.userId === userId && t.status === 'open');
  if (idx >= 0) {
    data.tickets[idx].status = status;
    write(data);
    return data.tickets[idx];
  }
  return null;
}

function closeTicketByChannelId(channelId, status = 'closed') {
  const data = read();
  const idx = data.tickets.findIndex(t => t.channelId === channelId && t.status === 'open');
  if (idx >= 0) {
    data.tickets[idx].status = status;
    write(data);
    return data.tickets[idx];
  }
  return null;
}

function getUser(userId) {
  const data = read();
  return data.users[userId] || { lifetimeTotal: 0, currentRole: null, investmentCount: 0 };
}

function saveUser(userId, userData) {
  const data = read();
  data.users[userId] = userData;
  write(data);
}

function addInvestment(investment) {
  const data = read();
  data.investments.push(investment);
  write(data);
}

function getPool() {
  const data = read();
  return data.pool;
}

function savePool(pool) {
  const data = read();
  data.pool = pool;
  write(data);
}

function completePool(pool) {
  const data = read();
  data.pool = null;
  data.poolHistory.push({ ...pool, endTime: new Date().toISOString() });
  write(data);
}

module.exports = {
  read,
  write,
  getTicket,
  saveTicket,
  closeTicket,
  closeTicketByChannelId,
  getUser,
  saveUser,
  addInvestment,
  getPool,
  savePool,
  completePool,
};
