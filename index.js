const {
  Client,
  GatewayIntentBits,
  GatewayDispatchEvents,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags
} = require('discord.js');

const { Riffy } = require('riffy');
const config = require('./config.js');
const express = require('express');

require('dotenv').config();

let client;
let riffy;
let isLavalinkConnected = false;

const nowPlayingMessages = new Map();
const skipMessages = new Map();
const trackHistory = new Map();
const lastPlayedTracks = new Map();
const navigationActions = new Set();
const voiceIdleTimers = new Map();
const playLocks = new Set();
const protectedPlayers = new WeakSet();
const finishedQueues = new Set();
const playbackActions = new Map();
const playerDestroyReasons = new Map();
const startingPlayers = new Set();

function startExpressServer() {
  if (!config.express.enabled) return;

  const app = express();

  app.get('/', (req, res) => {
    res.json({
      status: 'online',
      bot: client?.user
        ? client.user.tag
        : 'Iniciando...',
      servers: client?.guilds?.cache
        ? client.guilds.cache.size
        : 0,
      uptime: process.uptime(),
      lavalink: isLavalinkConnected
        ? 'conectado'
        : 'desconectado'
    });
  });

  app.get('/stats', (req, res) => {
    res.json({
      guilds: client?.guilds?.cache
        ? client.guilds.cache.size
        : 0,
      users: client?.guilds?.cache
        ? client.guilds.cache.reduce(
            (acc, guild) => acc + guild.memberCount,
            0
          )
        : 0,
      players: riffy?.players
        ? riffy.players.size
        : 0,
      uptime: process.uptime(),
      memory:
        process.memoryUsage().heapUsed /
        1024 /
        1024,
      ping: client?.ws
        ? client.ws.ping
        : 0,
      lavalink: isLavalinkConnected
    });
  });

  app.listen(
    config.express.port,
    '0.0.0.0',
    () => {
      console.log(
        `🌐 Servidor Express ejecutándose en el puerto ${config.express.port}`
      );
    }
  );
}

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessages
];

if (config.enablePrefix) {
  intents.push(
    GatewayIntentBits.MessageContent
  );
}

client = new Client({
  intents
});

riffy = new Riffy(
  client,
  config.lavalink.nodes,
  {
    send: (payload) => {
      const guild =
        client.guilds.cache.get(
          payload.d.guild_id
        );

      if (guild) {
        guild.shard.send(payload);
      }
    },
    defaultSearchPlatform: 'ytmsearch',
    restVersion: 'v4'
  }
);

riffy.on(
  'nodeConnect',
  (node) => {
    console.log(
      `${config.emojis.success} Nodo ${node.name} conectado`
    );

    isLavalinkConnected = true;
  }
);

riffy.on(
  'nodeError',
  (node, error) => {
    console.error(
      `${config.emojis.error} Error en el nodo ${node.name}:`,
      error
    );

    isLavalinkConnected = false;
  }
);

riffy.on(
  'nodeDisconnect',
  (node) => {
    console.log(
      `${config.emojis.error} Nodo ${node.name} desconectado`
    );

    isLavalinkConnected = false;
  }
);

function protectPlayer(player) {
  if (!player || protectedPlayers.has(player)) {
    return player;
  }

  const originalPlay =
    player.play.bind(player);

  player.play = async function () {
    if (
      !this.queue ||
      this.queue.size === 0
    ) {
      return this;
    }

    return originalPlay();
  };

  protectedPlayers.add(player);

  return player;
}

async function startPlayer(player) {
  if (!player) return false;

  protectPlayer(player);

  const guildId = player.guildId;

  if (
    playLocks.has(guildId) ||
    startingPlayers.has(guildId)
  ) {
    return false;
  }

  if (
    player.playing ||
    player.paused ||
    !player.queue ||
    player.queue.size === 0
  ) {
    return false;
  }

  playLocks.add(guildId);
  startingPlayers.add(guildId);

  try {
    await new Promise(resolve =>
      setTimeout(resolve, 100)
    );

    if (
      player.playing ||
      player.paused ||
      !player.queue ||
      player.queue.size === 0
    ) {
      return false;
    }

    await player.play();

    return true;
  } catch (error) {
    console.error(
      `Error al iniciar la reproducción en ${guildId}:`,
      error
    );

    return false;
  } finally {
    playLocks.delete(guildId);
    startingPlayers.delete(guildId);
  }
}

function formatTime(ms) {
  const milliseconds =
    Number(ms) || 0;

  const seconds =
    Math.floor(
      (milliseconds / 1000) % 60
    );

  const minutes =
    Math.floor(
      (milliseconds / (1000 * 60)) % 60
    );

  const hours =
    Math.floor(
      (milliseconds /
        (1000 * 60 * 60)) %
        24
    );

  if (hours > 0) {
    return `${hours}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }

  return `${minutes}:${seconds
    .toString()
    .padStart(2, '0')}`;
}

function getTrackThumbnail(info) {
  let thumbnail =
    info.artworkUrl ||
    info.thumbnail ||
    null;

  if (
    !thumbnail &&
    info.uri &&
    info.uri.includes('youtube.com')
  ) {
    const videoId =
      info.uri
        .split('v=')[1]
        ?.split('&')[0];

    if (videoId) {
      thumbnail =
        `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    }
  }

  if (
    !thumbnail &&
    info.uri &&
    info.uri.includes('youtu.be')
  ) {
    const videoId =
      info.uri
        .split('youtu.be/')[1]
        ?.split('?')[0];

    if (videoId) {
      thumbnail =
        `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    }
  }

  if (!thumbnail) {
    thumbnail =
      'https://i.imgur.com/QYJfXQv.png';
  }

  return thumbnail;
}

function createErrorContainer(description) {
  return new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder()
        .setContent(
          `<:info:1538323825542963270> ${description}`
        )
    );
}

function createNowPlayingContainer(
  player,
  track,
  disabled = false,
  title = 'Reproduciendo'
) {
  const info =
    track?.info ?? {};

  const thumbnail =
    getTrackThumbnail(info);

  const isPaused =
    player.paused;

  const action =
    playbackActions.get(
      player.guildId
    );

  let actionLine = '';

  if (
    action?.type &&
    action?.userId
  ) {
    const actionLabels = {
      pause: 'Pausada por',
      restart: 'Reiniciada por',
      stop: 'Detenida por'
    };

    const label =
      actionLabels[action.type];

    if (label) {
      actionLine =
        `${label} <@${action.userId}>\n`;
    }
  }

  return new ContainerBuilder()
    .setAccentColor(0xffaf1a)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(
              `## <:songa:1538552887494443098> ${title}\n` +
              `\`${info.title || 'Título desconocido'}\``
            )
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(thumbnail)
            .setDescription(
              info.title ||
              'Miniatura de la canción'
            )
        )
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder()
        .setContent(
          `Solicitada por <@${info.requester || '0'}>\n` +
          actionLine +
          `Duración: \`${formatTime(info.length || 0)}\``
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(
          SeparatorSpacingSize.Small
        )
        .setDivider(true)
    )
    .addActionRowComponents(
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('restart')
            .setEmoji(
              '<:reset:1539037348254449705>'
            )
            .setStyle(
              ButtonStyle.Secondary
            )
            .setDisabled(disabled),

          new ButtonBuilder()
            .setCustomId(
              isPaused
                ? 'resume'
                : 'pause'
            )
            .setEmoji(
              isPaused
                ? '<:play:1538541584167997503>'
                : '<:pause:1538541612353855489>'
            )
            .setStyle(
              ButtonStyle.Secondary
            )
            .setDisabled(disabled),

          new ButtonBuilder()
            .setCustomId('skip')
            .setEmoji(
              '<:right:1538541644695998545>'
            )
            .setStyle(
              ButtonStyle.Secondary
            )
            .setDisabled(disabled),

          new ButtonBuilder()
            .setCustomId('queue')
            .setEmoji(
              '<:folder:1538542808648908891>'
            )
            .setStyle(
              ButtonStyle.Secondary
            )
            .setDisabled(disabled),

          new ButtonBuilder()
            .setCustomId('stop')
            .setEmoji(
              '<:cancel:1538544866659672144>'
            )
            .setStyle(
              ButtonStyle.Danger
            )
            .setDisabled(disabled)
        )
    );
}

async function markNowPlayingAsStopped(player) {
  if (!player?.current) return;

  const guildId =
    player.guildId;

  const message =
    nowPlayingMessages.get(
      guildId
    );

  if (!message) return;

  const stoppedContainer =
    createNowPlayingContainer(
      player,
      player.current,
      true,
      'Detenido'
    );

  try {
    await message.edit({
      components: [
        stoppedContainer
      ],
      flags:
        MessageFlags.IsPersistent |
        MessageFlags.IsComponentsV2
    });

    nowPlayingMessages.delete(
      guildId
    );
  } catch (error) {
    console.error(
      'Error al marcar la reproducción como detenida:',
      error
    );
  }
}

async function markNowPlayingAsStoppedWithoutPlayer(guildId) {
  const message =
    nowPlayingMessages.get(guildId);

  const track =
    lastPlayedTracks.get(guildId);

  if (!message || !track) return;

  const fakePlayer = {
    guildId,
    paused: false
  };

  const stoppedContainer =
    createNowPlayingContainer(
      fakePlayer,
      track,
      true,
      'Detenido'
    );

  try {
    await message.edit({
      components: [
        stoppedContainer
      ],
      flags:
        MessageFlags.IsPersistent |
        MessageFlags.IsComponentsV2
    });

    nowPlayingMessages.delete(
      guildId
    );
  } catch (error) {
    console.error(
      'Error al marcar la reproducción como detenida sin player:',
      error
    );
  }
}

function createSimpleContainerNoButtons(
  title,
  description,
  emoji = config.emojis.info
) {
  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(
              `## ${emoji} ${title}\n${description}`
            )
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(
              client.user.displayAvatarURL({
                size: 1024
              })
            )
            .setDescription(title)
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(
          SeparatorSpacingSize.Small
        )
        .setDivider(true)
    );
}

function createQueueContainer(player) {
  const queue =
    player.queue ?? [];

  let description = '';

  if (queue.size > 0) {
    description +=
      `<:song:1538552770200600706> **Siguiente:**\n`;

    const upcoming =
      queue.slice(0, 10);

    upcoming.forEach(
      (track, index) => {
        const info =
          track.info || {};

        description +=
          `**${index + 1}**. ` +
          `\`${info.title || 'Desconocido'}\` ` +
          `<@${info.requester || '0'}>\n`;
      }
    );

    description +=
      `\n${queue.size} cancion(es) en fila de reproducción.`;
  } else {
    description =
      'La fila de reproducción está vacía.';
  }

  return new ContainerBuilder()
    .setAccentColor(0xffaf1a)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(
              `## ${
                queue.size > 0
                  ? '<:foldera:1538552555649507409>'
                  : '<:songa:1538552887494443098>'
              } Siguiente(s)\n\n${description}`
            )
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(
              client.user.displayAvatarURL({
                size: 1024
              })
            )
            .setDescription('Siguiente(s)')
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(
          SeparatorSpacingSize.Small
        )
        .setDivider(true)
    );
}

function clearVoiceIdleTimer(guildId) {
  const timer =
    voiceIdleTimers.get(guildId);

  if (timer) {
    clearTimeout(timer);
    voiceIdleTimers.delete(guildId);
  }
}

function startVoiceIdleTimer(player) {
  const guildId =
    player.guildId;

  clearVoiceIdleTimer(guildId);

  const timer =
    setTimeout(
      async () => {
        voiceIdleTimers.delete(guildId);

        const guild =
          client.guilds.cache.get(guildId);

        if (!guild) return;

        const voiceChannel =
          guild.channels.cache.get(
            player.voiceChannel
          );

        if (!voiceChannel) return;

        const hasUsers =
          voiceChannel.members.some(
            member =>
              !member.user.bot
          );

        if (hasUsers) {
          return;
        }

        const channel =
          client.channels.cache.get(
            player.textChannel
          );

        if (channel) {
          try {
            await channel.send({
              components: [
                createErrorContainer(
                  'Abandoné el canal de voz por inactividad.'
                )
              ],
              flags:
                MessageFlags.IsComponentsV2
            });
          } catch (error) {
            console.error(
              'Error al enviar el mensaje de inactividad:',
              error
            );
          }
        }

        trackHistory.delete(guildId);
        lastPlayedTracks.delete(guildId);
        navigationActions.delete(guildId);
        playLocks.delete(guildId);
        startingPlayers.delete(guildId);
        playbackActions.delete(guildId);

        finishedQueues.delete(guild.id);

        playerDestroyReasons.set(
          guild.id,
          'voiceDisconnect'
        );
        
        player.destroy();
      },
      30000
    );

  voiceIdleTimers.set(
    guildId,
    timer
  );
}

client.on(
  'voiceStateUpdate',
  async (oldState, newState) => {
    if (!client.user) return;

    const guild =
      newState.guild ||
      oldState.guild;

    if (!guild) return;

    const player =
      riffy.players.get(guild.id);
      
    const destroyReason =
      playerDestroyReasons.get(guild.id);

    const botMember =
      guild.members.me;

    if (!botMember) return;

    const wasConnected =
      Boolean(oldState.channelId);

    const isConnected =
      Boolean(newState.channelId);

if (
  oldState.id === client.user.id &&
  wasConnected &&
  !isConnected &&
  !player
) {
  if (
    destroyReason === 'manualStop' ||
    destroyReason === 'voiceDisconnect'
  ) {
    playerDestroyReasons.delete(
      guild.id
    );

    clearVoiceIdleTimer(
      guild.id
    );

    return;
  }

  const message =
    nowPlayingMessages.get(
      guild.id
    );

  await markNowPlayingAsStoppedWithoutPlayer(
    guild.id
  );

  if (message) {
    try {
      await message.channel.send({
        components: [
          createErrorContainer(
            'Fui desconectado del canal de voz.'
          )
        ],
        flags:
          MessageFlags.IsComponentsV2
      });
    } catch (error) {
      console.error(
        'Error al enviar el mensaje de desconexión:',
        error
      );
    }
  }

  clearVoiceIdleTimer(
    guild.id
  );

  trackHistory.delete(
    guild.id
  );

  lastPlayedTracks.delete(
    guild.id
  );

  navigationActions.delete(
    guild.id
  );

  playLocks.delete(
    guild.id
  );

  playbackActions.delete(
    guild.id
  );

  finishedQueues.delete(
    guild.id
  );

  playerDestroyReasons.delete(
    guild.id
  );

  return;
}

    if (!player) return;

    if (
      oldState.id === client.user.id &&
      wasConnected &&
      newState.serverMute
    ) {
      try {
        if (botMember.voice.serverMute) {
          await botMember.voice.setMute(false);
        }
      } catch (error) {
        console.error(
          'Error al desmutear el bot:',
          error
        );
      }

      const channel =
        client.channels.cache.get(
          player.textChannel
        );

      if (channel) {
        try {
          await channel.send({
            components: [
              createErrorContainer(
                'Fui silenciado y abandoné el canal de voz.'
              )
            ],
            flags:
              MessageFlags.IsComponentsV2
          });
        } catch (error) {
          console.error(
            'Error al enviar el mensaje de mute:',
            error
          );
        }
      }

      await markNowPlayingAsStopped(
        player
      );
      
      clearVoiceIdleTimer(guild.id);
      trackHistory.delete(guild.id);
      lastPlayedTracks.delete(guild.id);
      navigationActions.delete(guild.id);
      playLocks.delete(guild.id);
      startingPlayers.delete(guild.id);
      playbackActions.delete(guild.id);
      
      finishedQueues.delete(guild.id);
      
      playerDestroyReasons.set(
        guild.id,
        'voiceDisconnect'
      );
      
      player.destroy();
      
      return;
    }

    if (
      oldState.id === client.user.id &&
      wasConnected &&
      isConnected &&
      oldState.channelId !== newState.channelId
    ) {
      const channel =
        client.channels.cache.get(
          player.textChannel
        );

      if (channel) {
        try {
          await channel.send({
            components: [
              createErrorContainer(
                'Fui movido de canal de voz y abandoné la conexión.'
              )
            ],
            flags:
              MessageFlags.IsComponentsV2
          });
        } catch (error) {
          console.error(
            'Error al enviar el mensaje de movimiento:',
            error
          );
        }
      }

      await markNowPlayingAsStopped(
        player
      );
      
      clearVoiceIdleTimer(guild.id);
      trackHistory.delete(guild.id);
      lastPlayedTracks.delete(guild.id);
      navigationActions.delete(guild.id);
      playLocks.delete(guild.id);
      startingPlayers.delete(guild.id);
      playbackActions.delete(guild.id);
      
      finishedQueues.delete(guild.id);
      
      playerDestroyReasons.set(
        guild.id,
        'voiceDisconnect'
      );
      
      player.destroy();
      
      return;
    }

    if (
      oldState.id === client.user.id &&
      wasConnected &&
      !isConnected
    ) {
      const channel =
        client.channels.cache.get(
          player.textChannel
        );

      if (channel) {
        try {
          await channel.send({
            components: [
              createErrorContainer(
                'Fui desconectado del canal de voz.'
              )
            ],
            flags:
              MessageFlags.IsComponentsV2
          });
        } catch (error) {
          console.error(
            'Error al enviar el mensaje de desconexión:',
            error
          );
        }
      }

      await markNowPlayingAsStopped(
        player
      );
      
      clearVoiceIdleTimer(guild.id);
      trackHistory.delete(guild.id);
      lastPlayedTracks.delete(guild.id);
      navigationActions.delete(guild.id);
      playLocks.delete(guild.id);
      startingPlayers.delete(guild.id);
      playbackActions.delete(guild.id);
      
      finishedQueues.delete(guild.id);
      
      playerDestroyReasons.set(
        guild.id,
        'voiceDisconnect'
      );
      
      player.destroy();
      
      return;
    }

    if (
      oldState.id === client.user.id
    ) {
      return;
    }

    if (!botMember.voice.channel) {
      clearVoiceIdleTimer(guild.id);
      return;
    }

    const botChannel =
      botMember.voice.channel;

    const hasUsers =
      botChannel.members.some(
        member =>
          !member.user.bot
      );

    if (hasUsers) {
      clearVoiceIdleTimer(guild.id);
      return;
    }

    if (
      !voiceIdleTimers.has(guild.id)
    ) {
      startVoiceIdleTimer(player);
    }
  }
);

riffy.on(
  'trackStart',
  async (player, track) => {
    const guildId =
      player.guildId;

    if (finishedQueues.has(guildId)) {
      return;
    }

    clearVoiceIdleTimer(
      guildId
    );

    const previousSkipMessage =
      skipMessages.get(guildId);

    skipMessages.delete(guildId);

    if (!trackHistory.has(guildId)) {
      trackHistory.set(
        guildId,
        []
      );
    }

    const history =
      trackHistory.get(guildId);

    const lastTrack =
      lastPlayedTracks.get(guildId);

    const isNavigation =
      navigationActions.has(guildId);

    if (
      lastTrack &&
      lastTrack.info?.uri !==
        track.info?.uri &&
      !isNavigation
    ) {
      history.push(lastTrack);

      if (history.length > 20) {
        history.shift();
      }
    }

    lastPlayedTracks.set(
      guildId,
      track
    );

    navigationActions.delete(
      guildId
    );

    playbackActions.delete(
      guildId
    );

    const channel =
      client.channels.cache.get(
        player.textChannel
      );

    if (!channel) return;

    const container =
      createNowPlayingContainer(
        player,
        track
      );

    try {
      const message =
        await channel.send({
          components: [
            container
          ],
          flags:
            MessageFlags.IsPersistent |
            MessageFlags.IsComponentsV2
        });

      nowPlayingMessages.set(
        guildId,
        message
      );

      if (previousSkipMessage) {
        try {
          await previousSkipMessage.delete();
        } catch (error) {
        }
      }
    } catch (error) {
      console.error(
        'Error al enviar el mensaje de reproducción:',
        error
      );
    }
  }
);

riffy.on(
  'queueEnd',
  async (player) => {
    const guildId =
      player.guildId;
      
    const destroyReason =
      playerDestroyReasons.get(
        player.guildId
      );

    if (destroyReason === 'voiceDisconnect') {
      playerDestroyReasons.delete(
        player.guildId
      );
      
        return;
      }

    playLocks.delete(guildId);

    finishedQueues.add(guildId);

    const channel =
      client.channels.cache.get(
        player.textChannel
      );

    const message =
      nowPlayingMessages.get(
        guildId
      );

    if (
      message &&
      player.current
    ) {
      try {
        const finishedContainer =
          createNowPlayingContainer(
            player,
            player.current,
            true,
            'Finalizada'
          );

        await message.edit({
          components: [
            finishedContainer
          ],
          flags:
            MessageFlags.IsPersistent |
            MessageFlags.IsComponentsV2
        });
      } catch (error) {
        console.error(
          'Error al marcar la reproducción como finalizada:',
          error
        );
      }

      nowPlayingMessages.delete(
        guildId
      );
    }

    if (channel) {
      const container =
        new ContainerBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder()
              .setContent(
                '<:info:1538323825542963270> Fila de reproducción finalizada.'
              )
          );

      try {
        await channel.send({
          components: [
            container
          ],
          flags:
            MessageFlags.IsPersistent |
            MessageFlags.IsComponentsV2
        });
      } catch (error) {
        console.error(
          'Error al enviar el mensaje de finalización:',
          error
        );
      }
    }

    trackHistory.delete(guildId);
    lastPlayedTracks.delete(guildId);
    navigationActions.delete(guildId);
    playbackActions.delete(guildId);

    const guild =
      client.guilds.cache.get(guildId);

    const botMember =
      guild?.members.me;

    if (
      botMember?.voice?.channel
    ) {
      const hasUsers =
        botMember.voice.channel.members.some(
          member =>
            !member.user.bot
        );

      if (!hasUsers) {
        startVoiceIdleTimer(player);
      }
    }
  }
);

client.on(
  'interactionCreate',
  async (interaction) => {
    if (!interaction.isButton()) {
      return;
    }

    const player =
      riffy.players.get(
        interaction.guildId
      );

    if (!player) {
      return interaction.reply({
        components: [
          createErrorContainer(
            'No se encontró ningún reproductor.'
          )
        ],
        flags:
          MessageFlags.IsComponentsV2 |
          MessageFlags.Ephemeral
      });
    }

    protectPlayer(player);

    const member =
      interaction.member;

    if (!member.voice?.channel) {
      return interaction.reply({
        components: [
          createErrorContainer(
            'Debes estar en un canal de voz.'
          )
        ],
        flags:
          MessageFlags.IsComponentsV2 |
          MessageFlags.Ephemeral
      });
    }

    const currentTrack =
      player.current;

    const requesterId =
      currentTrack?.info?.requester;

    const isRequester =
      requesterId === interaction.user.id;

    const isAdministrator =
      interaction.member.permissions.has(
        'Administrator'
      );

    if (
      !isRequester &&
      !isAdministrator
    ) {
      return interaction.reply({
        components: [
          createErrorContainer(
            'No tienes permiso para utilizar los controles de reproducción.'
          )
        ],
        flags:
          MessageFlags.IsComponentsV2 |
          MessageFlags.Ephemeral
      });
    }

    if (
      member.voice.channel.id !==
      player.voiceChannel
    ) {
      return interaction.reply({
        components: [
          createErrorContainer(
            'Debes estar en el mismo canal de voz.'
          )
        ],
        flags:
          MessageFlags.IsComponentsV2 |
          MessageFlags.Ephemeral
      });
    }

    switch (
      interaction.customId
    ) {

      case 'pause':
      case 'resume': {
        const message =
          nowPlayingMessages.get(
            player.guildId
          );

        const shouldPause =
          interaction.customId ===
          'pause';

        await player.pause(
          shouldPause
        );

        if (shouldPause) {
          playbackActions.set(
            player.guildId,
            {
              type: 'pause',
              userId:
                interaction.user.id
            }
          );
        } else {
          playbackActions.delete(
            player.guildId
          );
        }

        if (
          message &&
          player.current
        ) {
          const updatedContainer =
            createNowPlayingContainer(
              player,
              player.current,
              false,
              shouldPause
                ? 'Pausado'
                : 'Reproduciendo'
            );

          await message.edit({
            components: [
              updatedContainer
            ],
            flags:
              MessageFlags.IsPersistent |
              MessageFlags.IsComponentsV2
          }).catch(() => {});
        }

        return interaction.reply({
          content:
            shouldPause
              ? 'Pausada'
              : 'Reanudada',
          flags:
            MessageFlags.Ephemeral
        });
      }

      case 'restart': {
        if (!player.current) {
          return interaction.reply({
            components: [
              createErrorContainer(
                'No hay ninguna canción reproduciéndose.'
              )
            ],
            flags:
              MessageFlags.IsComponentsV2 |
              MessageFlags.Ephemeral
          });
        }

        const message =
          nowPlayingMessages.get(
            player.guildId
          );

        try {
          await player.seek(0);

          playbackActions.set(
            player.guildId,
            {
              type: 'restart',
              userId:
                interaction.user.id
            }
          );

          if (
            message &&
            player.current
          ) {
            const updatedContainer =
              createNowPlayingContainer(
                player,
                player.current,
                false,
                'Reproduciendo'
              );

            await message.edit({
              components: [
                updatedContainer
              ],
              flags:
                MessageFlags.IsPersistent |
                MessageFlags.IsComponentsV2
            }).catch(() => {});
          }

          return interaction.reply({
            content:
              'Reiniciada',
            flags:
              MessageFlags.Ephemeral
          });
        } catch (error) {
          console.error(
            'Error al reiniciar la canción:',
            error
          );

          return interaction.reply({
            components: [
              createErrorContainer(
                'No se pudo reiniciar la canción.'
              )
            ],
            flags:
              MessageFlags.IsComponentsV2 |
              MessageFlags.Ephemeral
          });
        }
      }

      case 'skip': {
        if (!player.current) {
          return interaction.reply({
            components: [
              createErrorContainer(
                'No hay ninguna canción reproduciéndose.'
              )
            ],
            flags:
              MessageFlags.IsComponentsV2 |
              MessageFlags.Ephemeral
          });
        }

        const disabledContainer =
          createNowPlayingContainer(
            player,
            player.current,
            true,
            'Finalizada'
          );

        await interaction.message
          .edit({
            components: [
              disabledContainer
            ],
            flags:
              MessageFlags.IsPersistent |
              MessageFlags.IsComponentsV2
          })
          .catch(() => {});

        skipMessages.set(
          player.guildId,
          interaction.message
        );

        playbackActions.delete(
          player.guildId
        );

        player.stop();

        return interaction.reply({
          content:
            'Siguiente',
          flags:
            MessageFlags.Ephemeral
        });
      }

      case 'stop': {
        const guildId =
          player.guildId;

        const channel =
          client.channels.cache.get(
            player.textChannel
          );

        clearVoiceIdleTimer(
          guildId
        );

        skipMessages.delete(
          guildId
        );

        finishedQueues.delete(
          guildId
        );

        playbackActions.set(
          guildId,
          {
            type: 'stop',
            userId:
              interaction.user.id
          }
        );

        if (player.current) {
          const disabledContainer =
            createNowPlayingContainer(
              player,
              player.current,
              true,
              'Detenido'
            );

          await interaction.message
            .edit({
              components: [
                disabledContainer
              ],
              flags:
                MessageFlags.IsPersistent |
                MessageFlags.IsComponentsV2
            })
            .catch(() => {});
        }

        trackHistory.delete(
          guildId
        );

        lastPlayedTracks.delete(
          guildId
        );

        navigationActions.delete(
          guildId
        );

        playLocks.delete(
          guildId
        );

        if (channel) {
          try {
            await channel.send({
              components: [
                createErrorContainer(
                  'Canción detenida, abandoné el canal de voz.'
                )
              ],
              flags:
                MessageFlags.IsComponentsV2
            });
          } catch (error) {
            console.error(
              'Error al enviar el mensaje de canción detenida:',
              error
            );
          }
        }

        playerDestroyReasons.set(
          guildId,
          'manualStop'
        );
        
        player.destroy();

        return interaction.reply({
          content:
            'Detenida',
          flags:
            MessageFlags.Ephemeral
        });
      }

      case 'queue': {
        const queueContainer =
          createQueueContainer(
            player
          );

        return interaction.reply({
          components: [
            queueContainer
          ],
          flags:
            MessageFlags.IsComponentsV2 |
            MessageFlags.Ephemeral
        });
      }

      default:
        return;
    }
  }
);

if (config.enablePrefix) {
  client.on(
    'messageCreate',
    async (message) => {
      if (
        message.author.bot ||
        !message.guild
      ) {
        return;
      }

      const usedPrefix =
        config.prefixes.find(
          prefix =>
            message.content.startsWith(
              prefix
            )
        );

      if (!usedPrefix) {
        return;
      }

      const args =
        message.content
          .slice(usedPrefix.length)
          .trim()
          .split(/ +/);

      const command =
        args
          .shift()
          ?.toLowerCase();

      if (
        !command ||
        !['play', 'p'].includes(command)
      ) {
        return;
      }

      const query =
        args.join(' ');

      if (!query) {
        return message.reply({
          components: [
            createErrorContainer(
              'Proporciona el nombre de una canción o una URL.'
            )
          ],
          flags:
            MessageFlags.IsComponentsV2
        });
      }

      if (
        !message.member.voice?.channel
      ) {
        return message.reply({
          components: [
            createErrorContainer(
              'Debes estar en un canal de voz.'
            )
          ],
          flags:
            MessageFlags.IsComponentsV2
        });
      }

      if (!isLavalinkConnected) {
        return message.reply({
          components: [
            createErrorContainer(
              'Lavalink no está conectado. Los comandos de música no están disponibles.'
            )
          ],
          flags:
            MessageFlags.IsComponentsV2
        });
      }

      try {
        let player =
          riffy.players.get(
            message.guild.id
          );

        if (!player) {
          player =
            riffy.createConnection({
              guildId:
                message.guild.id,
              voiceChannel:
                message.member.voice.channel.id,
              textChannel:
                message.channel.id,
              deaf: true
            });

          protectPlayer(player);
        } else {
          protectPlayer(player);

          player.textChannel =
            message.channel.id;

          if (
            player.voiceChannel !==
            message.member.voice.channel.id
          ) {
            return message.reply({
              components: [
                createErrorContainer(
                  'Debes estar en el mismo canal de voz.'
                )
              ],
              flags:
                MessageFlags.IsComponentsV2
            });
          }
        }

        clearVoiceIdleTimer(
          message.guild.id
        );

        finishedQueues.delete(
          message.guild.id
        );

        const resolve =
          await riffy.resolve({
            query,
            requester:
              message.author.id
          });

        if (
          !resolve ||
          !resolve.tracks ||
          !resolve.tracks.length
        ) {
          return message.reply({
            components: [
              createErrorContainer(
                'No se encontraron resultados.'
              )
            ],
            flags:
              MessageFlags.IsComponentsV2
          });
        }

        if (
          resolve.loadType ===
          'playlist'
        ) {
          for (
            const track
            of resolve.tracks
          ) {
            track.info.requester =
              message.author.id;

            player.queue.add(
              track
            );
          }

          const container =
            createSimpleContainerNoButtons(
              'Lista de reproducción agregada',
              `Se agregó la lista de reproducción **${resolve.playlistInfo?.name || 'Lista desconocida'}** (${resolve.tracks.length} canciones).`,
              config.emojis.success
            );

          await message.reply({
            components: [
              container
            ],
            flags:
              MessageFlags.IsPersistent |
              MessageFlags.IsComponentsV2
          });
        } else if (
          resolve.loadType ===
            'search' ||
          resolve.loadType ===
            'track'
        ) {
          const track =
            resolve.tracks[0];

          track.info.requester =
            message.author.id;

          player.queue.add(
            track
          );

          const container =
            new ContainerBuilder()
              .addTextDisplayComponents(
                new TextDisplayBuilder()
                  .setContent(
                    `<:thu:1538554141121581126> \`${track.info.title}\` Agregada a la fila de reproducción.`
                  )
              );

          await message.reply({
            components: [
              container
            ],
            flags:
              MessageFlags.IsPersistent |
              MessageFlags.IsComponentsV2
          });
        } else {
          return message.reply({
            components: [
              createErrorContainer(
                'No se encontraron resultados.'
              )
            ],
            flags:
              MessageFlags.IsComponentsV2
          });
        }

if (
  !player.playing &&
  !player.paused &&
  !startingPlayers.has(message.guild.id)
) {
  await startPlayer(player);
}
      } catch (error) {
        console.error(
          'Error en el comando de reproducción:',
          error
        );

        return message.reply({
          components: [
            createErrorContainer(
              'Ocurrió un error al reproducir la canción.'
            )
          ],
          flags:
            MessageFlags.IsComponentsV2
        });
      }
    }
  );
}

client.on(
  'raw',
  (data) => {
    if (
      ![
        GatewayDispatchEvents.VoiceStateUpdate,
        GatewayDispatchEvents.VoiceServerUpdate
      ].includes(data.t)
    ) {
      return;
    }

    riffy.updateVoiceState(
      data
    );
  }
);

client.once(
  'clientReady',
  async () => {
    console.log(
      `${config.emojis.success} Sesión iniciada como ${client.user.tag}`
    );

    try {
      riffy.init(
        client.user.id
      );

      console.log(
        `${config.emojis.success} Riffy inicializado`
      );
    } catch (error) {
      console.error(
        `${config.emojis.error} Error al inicializar Riffy:`,
        error
      );
    }

    console.log(
      `${config.emojis.success} Sistema de comandos con prefijo listo`
    );
  }
);

startExpressServer();

client.login(
  config.token
);