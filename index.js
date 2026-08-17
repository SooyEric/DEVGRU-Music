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
const trackHistory = new Map();
const lastPlayedTracks = new Map();
const navigationActions = new Set();
const voiceIdleTimers = new Map();
const playLocks = new Set();

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

async function startPlayer(player) {
  if (!player) return false;

  const guildId =
    player.guildId;

  if (playLocks.has(guildId)) {
    return false;
  }

  if (
    player.playing ||
    player.paused ||
    !player.queue ||
    player.queue.length === 0
  ) {
    return false;
  }

  playLocks.add(guildId);

  try {
    if (
      !player.queue ||
      player.queue.length === 0 ||
      player.playing ||
      player.paused
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
  disabled = false
) {
  const info =
    track?.info ?? {};

  const thumbnail =
    getTrackThumbnail(info);

  const isPaused =
    player.paused;

  return new ContainerBuilder()
    .setAccentColor(0xffaf1a)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(
              `## <:songa:1538552887494443098> Reproduciendo\n` +
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
            .setCustomId('back')
            .setEmoji(
              '<:left:1538544846459899955>'
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

  if (queue.length > 0) {
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
      `\n${queue.length} cancion(es) en fila de reproducción.`;
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
                queue.length > 0
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

    if (
      oldState.id !== client.user.id &&
      newState.id !== client.user.id
    ) {
      return;
    }

    const guild =
      newState.guild ||
      oldState.guild;

    if (!guild) return;

    const player =
      riffy.players.get(guild.id);

    if (!player) return;

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

      clearVoiceIdleTimer(guild.id);
      trackHistory.delete(guild.id);
      lastPlayedTracks.delete(guild.id);
      navigationActions.delete(guild.id);
      playLocks.delete(guild.id);

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

      clearVoiceIdleTimer(guild.id);
      trackHistory.delete(guild.id);
      lastPlayedTracks.delete(guild.id);
      navigationActions.delete(guild.id);
      playLocks.delete(guild.id);

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

      clearVoiceIdleTimer(guild.id);
      trackHistory.delete(guild.id);
      lastPlayedTracks.delete(guild.id);
      navigationActions.delete(guild.id);
      playLocks.delete(guild.id);

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
    clearVoiceIdleTimer(
      player.guildId
    );

    const guildId =
      player.guildId;

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

    playLocks.delete(guildId);

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
        const disabledContainer =
          createNowPlayingContainer(
            player,
            player.current,
            true
          );

        await message.edit({
          components: [
            disabledContainer
          ],
          flags:
            MessageFlags.IsPersistent |
            MessageFlags.IsComponentsV2
        });
      } catch (error) {
        console.error(
          'Error al desactivar los botones:',
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
      case 'back': {
        const history =
          trackHistory.get(
            player.guildId
          ) || [];

        if (history.length > 0) {
          const previousTrack =
            history.pop();

          player.queue.unshift(
            previousTrack
          );

          navigationActions.add(
            player.guildId
          );

          player.stop();

          await interaction.reply({
            content: 'Anterior',
            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

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

        player.queue.unshift(
          player.current
        );

        navigationActions.add(
          player.guildId
        );

        player.stop();

        return interaction.reply({
          content: 'Reiniciada',
          flags:
            MessageFlags.Ephemeral
        });
      }

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

        if (
          message &&
          player.current
        ) {
          const updatedContainer =
            createNowPlayingContainer(
              player,
              player.current
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
            true
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

        player.stop();

        return interaction.reply({
          content: 'Siguiente',
          flags:
            MessageFlags.Ephemeral
        });
      }

      case 'stop': {
        clearVoiceIdleTimer(
          player.guildId
        );

        if (player.current) {
          const disabledContainer =
            createNowPlayingContainer(
              player,
              player.current,
              true
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
          player.guildId
        );

        lastPlayedTracks.delete(
          player.guildId
        );

        navigationActions.delete(
          player.guildId
        );

        playLocks.delete(
          player.guildId
        );

        player.destroy();

        return interaction.reply({
          content: 'Detenida',
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
        } else {
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

        await startPlayer(
          player
        );
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
  'ready',
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