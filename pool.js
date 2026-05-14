'use strict';

const data = require('./data');
const { poolProgressBar } = require('./embeds');

function addToPool(userId, username, amount) {
  const pool = data.getPool();
  if (!pool) return null;

  pool.current = (pool.current || 0) + amount;

  const existing = (pool.contributors || []).find(c => c.userId === userId);
  if (existing) {
    existing.amount += amount;
  } else {
    pool.contributors = pool.contributors || [];
    pool.contributors.push({ userId, username, amount });
  }

  data.savePool(pool);
  return pool;
}

function isPoolFilled(pool) {
  if (!pool) return false;
  return (pool.current || 0) >= pool.target;
}

module.exports = { addToPool, isPoolFilled };
