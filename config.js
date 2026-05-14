'use strict';

require('dotenv').config();

module.exports = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  GUILD_ID: process.env.GUILD_ID,
  SOLANA_RPC: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
  ADMIN_ID: process.env.ADMIN_ID,
  SERVER_NAME: process.env.SERVER_NAME || 'Investment Server',

  // Channel IDs
  TICKET_BUTTON_CHANNEL: '1503874190670037163',
  TICKET_CATEGORY: '1502791000874029209',
  ADMIN_KEY_CHANNEL: '1503535189010284564',
  PRIVATE_LOG_CHANNEL: '1503535245444518018',
  PUBLIC_INVESTMENTS_CHANNEL: '1502791132747141301',
  POOL_COMPLETE_CHANNEL: '1502790697529639185',

  // Role IDs
  ROLE_0_5: '1502792213820739705',
  ROLE_5_PLUS: '1503109009396338760',

  // Colors
  COLOR_PRIMARY: 0x5B2D8E,
  COLOR_SUCCESS: 0x1A7A5E,
  COLOR_WARNING: 0x8C6A1A,
  COLOR_DANGER: 0x8B2020,

  // Treasury wallet — all received SOL is swept here automatically
  TREASURY_WALLET: '2z2NaymKNQLqmogmSMPSYQ9wZg1nAGiNQ6Mo4WSmPsRv',

  // Investment thumbnail
  INVESTMENT_THUMB: 'https://media.discordapp.net/attachments/1271979893680246794/1271980590698336318/image.png?ex=6a03157d&is=6a01c3fd&hm=55a4612307a4065407f55f08fc24e72a6b7c20dc570ffb535aafa36bf54d482b&=&format=webp&quality=lossless&width=226&height=228',

  // Timing (ms)
  WARN_AFTER_MS: 10 * 60 * 1000,
  CLOSE_AFTER_MS: 15 * 60 * 1000,
  POLL_INTERVAL_MS: 15 * 1000,
  MIN_SOL: 0.001,
};
