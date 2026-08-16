module.exports = {
  token: process.env.DISCORD_TOKEN,

  prefixes: ['!', '.', '-', '?', ','],
  enablePrefix: true,

  supportServer: 'https://discord.gg/9MVAPpfs8D',

  express: {
    enabled: true,
    port: 5000
  },

  emojis: {
    music: '🎵',
    queue: '📜',
    success: '✅',
    error: '❌',
    info: 'ℹ️'
  },

  lavalink: {
    nodes: [
      {
        name: 'Main Node',
        host: 'lavalinkv4.serenetia.com',
        port: 80,
        password: 'https://seretia.link/discord',
        secure: false
      }
    ]
  }
};