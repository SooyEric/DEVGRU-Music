const {
  Client,
  GatewayIntentBits,
  ActivityType,
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

function startExpressServer() {
  if (!config.express.enabled) return;

  const app = express();

  app.get('/', (req, res) => {
    res.json({
      status: 'online',
      bot: client?.user ? client.user.tag : 'Starting...',
      servers: client?.guilds?.cache ? client.guilds.cache.size : 0,
      uptime: process.uptime(),
      lavalink: isLavalinkConnected ? 'connected' : 'disconnected'
    });
  });

  app.get('/stats', (req, res) => {
    res.json({
      guilds: client?.guilds?.cache ? client.guilds.cache.size : 0,
      users: client?.guilds?.cache
        ? client.guilds.cache.reduce(
            (acc, guild) => acc + guild.memberCount,
            0
          )
        : 0,
      players: riffy?.players ? riffy.players.size : 0,
      uptime: process.uptime(),
      memory: process.memoryUsage().heapUsed / 1024 / 1024,
      ping: client?.ws ? client.ws.ping : 0,
      lavalink: isLavalinkConnected
    });
  });

  app.listen(config.express.port, '0.0.0.0', () => {
    console.log(
      `🌐 Express server running on port ${config.express.port}`
    );
  });
}

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessages
];

if (config.enablePrefix) {
  intents.push(GatewayIntentBits.MessageContent);
}

client = new Client({ intents });

riffy = new Riffy(client, config.lavalink.nodes, {
  send: (payload) => {
    const guild = client.guilds.cache.get(payload.d.guild_id);

    if (guild) {
      guild.shard.send(payload);
    }
  },

  defaultSearchPlatform: 'ytmsearch',
  restVersion: 'v4'
});

try {
  const { Node } = require('riffy/build/structures/Node');

  const originalDefineProperty = Object.defineProperty;

  Object.defineProperty = function (obj, prop, descriptor) {
    if (
      obj instanceof Node &&
      (
        prop === 'host' ||
        prop === 'port' ||
        prop === 'password' ||
        prop === 'secure' ||
        prop === 'identifier'
      )
    ) {
      return originalDefineProperty(obj, prop, {
        value: descriptor.value,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }

    try {
      return originalDefineProperty(obj, prop, descriptor);
    } catch (error) {
      if (
        error instanceof TypeError &&
        error.message.includes('Invalid property descriptor')
      ) {
        return originalDefineProperty(obj, prop, {
          value: descriptor.value,
          writable: true,
          enumerable: true,
          configurable: true
        });
      }

      throw error;
    }
  };
} catch (error) {
  console.log('⚠️ Riffy Node workaround could not be loaded.');
}

const queue247 = new Set();
const nowPlayingMessages = new Map();

function formatTime(ms) {
  const milliseconds = Number(ms) || 0;

  const seconds = Math.floor((milliseconds / 1000) % 60);
  const minutes = Math.floor((milliseconds / (1000 * 60)) % 60);
  const hours = Math.floor(
    (milliseconds / (1000 * 60 * 60)) % 24
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

function createNowPlayingContainer(
  player,
  track,
  disabled = false
) {
  const info = track?.info ?? {};

  const thumbnail = getTrackThumbnail(info);

  const isPaused = player.paused;

  const container = new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(
              `## ${config.emojis.music} Now Playing\n` +
              `**[${info.title || 'Unknown Title'}](${info.uri || 'https://youtube.com'})**`
            )
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(thumbnail)
            .setDescription(
              info.title || 'Song Thumbnail'
            )
        )
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder()
        .setContent(
          `**Duration:** ${formatTime(info.length || 0)} • ` +
          `**Requested By:** <@${info.requester || '0'}>`
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addActionRowComponents(
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              isPaused ? 'resume' : 'pause'
            )
            .setEmoji(
              isPaused
                ? config.emojis.play
                : config.emojis.pause
            )
            .setStyle(
              isPaused
                ? ButtonStyle.Success
                : ButtonStyle.Primary
            )
            .setDisabled(disabled),

          new ButtonBuilder()
            .setCustomId('skip')
            .setEmoji(config.emojis.skip)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled),

          new ButtonBuilder()
            .setCustomId('stop')
            .setEmoji(config.emojis.stop)
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled),

          new ButtonBuilder()
            .setCustomId('shuffle')
            .setEmoji(config.emojis.shuffle)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled),

          new ButtonBuilder()
            .setCustomId('queue')
            .setEmoji(config.emojis.queue)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled)
        )
    )
    .addActionRowComponents(
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('loop')
            .setEmoji(config.emojis.loop)
            .setStyle(
              player.loop &&
              player.loop !== 'none'
                ? ButtonStyle.Success
                : ButtonStyle.Secondary
            )
            .setDisabled(disabled)
        )
    );

  return container;
}

function createSimpleContainer(
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
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
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
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    );
}

function createQueueContainer(player) {
  const queue = player.queue ?? [];
  const current = player.current;

  let description = '';

  if (current?.info) {
    description +=
      `**Now Playing:**\n` +
      `**[${current.info.title}](${current.info.uri})**\n` +
      `${current.info.author || 'Unknown'} • ` +
      `${formatTime(current.info.length || 0)} • ` +
      `<@${current.info.requester || '0'}>\n\n`;
  }

  if (queue.length > 0) {
    description += '**Up Next:**\n';

    const upcoming = queue.slice(0, 10);

    upcoming.forEach((track, index) => {
      const info = track.info || {};

      description +=
        `\`${index + 1}.\` ` +
        `**[${info.title || 'Unknown'}](${info.uri || 'https://youtube.com'})**\n` +
        `${info.author || 'Unknown'} • ` +
        `${formatTime(info.length || 0)} • ` +
        `<@${info.requester || '0'}>\n`;
    });

    if (queue.length > 10) {
      description +=
        `\n*...and ${queue.length - 10} more track(s)*`;
    }
  } else if (!current) {
    description =
      'The queue is currently empty.';
  }

  const totalTracks =
    queue.length + (current ? 1 : 0);

  description +=
    `\n\n**Loop:** ` +
    `${!player.loop || player.loop === 'none'
      ? 'off'
      : player.loop}` +
    ` | **Total:** ${totalTracks} tracks`;

  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(
              `## ${config.emojis.queue} Queue\n${description}`
            )
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(
              client.user.displayAvatarURL({
                size: 1024
              })
            )
            .setDescription('Queue')
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    );
}

function createStatsContainer() {
  const uptime = formatTime(client.uptime);

  const players = riffy.players.size;

  const totalUsers =
    client.guilds.cache.reduce(
      (acc, guild) =>
        acc + guild.memberCount,
      0
    );

  const memory =
    (
      process.memoryUsage().heapUsed /
      1024 /
      1024
    ).toFixed(2);

  const description =
    `**Servers:** ${client.guilds.cache.size}\n` +
    `**Users:** ${totalUsers}\n` +
    `**Players:** ${players}\n` +
    `**Uptime:** ${uptime}\n` +
    `**Ping:** ${client.ws.ping}ms\n` +
    `**Memory:** ${memory} MB`;

  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(
              `## ${config.emojis.info} Bot Statistics\n${description}`
            )
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(
              client.user.displayAvatarURL({
                size: 1024
              })
            )
            .setDescription('Bot Avatar')
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    );
}

function createHelpContainer() {
  const lavalinkStatus =
    isLavalinkConnected
      ? '🟢 Connected'
      : '🔴 Not Connected';

  const description =
    `A powerful music bot with high quality audio\n\n` +
    `**Prefix:** \`${config.prefix}\`\n` +
    `**Lavalink:** ${lavalinkStatus}\n\n` +

    `**${config.emojis.music} Music Commands**\n` +
    `**play** (p) - Play a song\n` +
    `**pause** (pa) - Pause current song\n` +
    `**resume** (r, res) - Resume playback\n` +
    `**skip** (s, next) - Skip current song\n` +
    `**stop** (st, leave) - Stop player\n` +
    `**nowplaying** (np) - Show current song\n` +
    `**queue** (q) - Show queue\n` +
    `**loop** (l, repeat) - Loop mode\n` +
    `**shuffle** (sh, mix) - Shuffle queue\n` +
    `**volume** (v, vol) - Set volume\n` +
    `**clearqueue** (cq, clear) - Clear queue\n` +
    `**remove** (rm, delete) - Remove from queue\n` +
    `**move** (mv) - Move in queue\n` +
    `**247** (24/7, stay) - Toggle 24/7\n\n` +

    `**${config.emojis.info} Utility Commands**\n` +
    `**stats** (status, info) - Bot stats\n` +
    `**ping** (latency) - Bot ping\n` +
    `**invite** (inv) - Invite link\n` +
    `**support** (server) - Support server\n` +
    `**help** (h, cmd) - This message`;

  const invite =
    `https://discord.com/api/oauth2/authorize` +
    `?client_id=${client.user.id}` +
    `&permissions=3165184` +
    `&scope=bot`;

  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder()
            .setContent(
              `## ${client.user.username} Help\n${description}`
            )
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(
              client.user.displayAvatarURL({
                size: 1024
              })
            )
            .setDescription('Bot Avatar')
        )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addActionRowComponents(
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('Invite Me')
            .setStyle(ButtonStyle.Link)
            .setURL(invite),

          new ButtonBuilder()
            .setLabel('Support')
            .setStyle(ButtonStyle.Link)
            .setURL(config.supportServer)
        )
    );
}

riffy.on('nodeConnect', (node) => {
  console.log(
    `${config.emojis.success} Node ${node.name} connected`
  );

  isLavalinkConnected = true;
});

riffy.on('nodeError', (node, error) => {
  console.error(
    `${config.emojis.error} Node ${node.name} error:`,
    error
  );

  isLavalinkConnected = false;
});

riffy.on('nodeDisconnect', (node) => {
  console.log(
    `${config.emojis.error} Node ${node.name} disconnected`
  );

  isLavalinkConnected = false;
});

riffy.on('trackStart', async (player, track) => {
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
        components: [container],
        flags:
          MessageFlags.IsPersistent |
          MessageFlags.IsComponentsV2
      });

    nowPlayingMessages.set(
      player.guildId,
      message
    );
  } catch (error) {
    console.error(
      'Failed to send Now Playing message:',
      error
    );
  }
});

riffy.on('queueEnd', async (player) => {
  const channel =
    client.channels.cache.get(
      player.textChannel
    );

  const message =
    nowPlayingMessages.get(
      player.guildId
    );

  if (message && player.current) {
    try {
      const disabledContainer =
        createNowPlayingContainer(
          player,
          player.current,
          true
        );

      await message.edit({
        components: [disabledContainer],
        flags:
          MessageFlags.IsPersistent |
          MessageFlags.IsComponentsV2
      });
    } catch (error) {
      console.error(
        'Failed to disable buttons:',
        error
      );
    }

    nowPlayingMessages.delete(
      player.guildId
    );
  }

  if (queue247.has(player.guildId)) {
    if (channel) {
      const container =
        createSimpleContainerNoButtons(
          '24/7 Mode',
          'Queue ended but staying in 24/7 mode',
          config.emojis.info
        );

      await channel.send({
        components: [container],
        flags:
          MessageFlags.IsPersistent |
          MessageFlags.IsComponentsV2
      });
    }

    return;
  }

  if (channel) {
    const container =
      createSimpleContainerNoButtons(
        'Queue Ended',
        'Queue ended, leaving voice channel',
        config.emojis.success
      );

    await channel.send({
      components: [container],
      flags:
        MessageFlags.IsPersistent |
        MessageFlags.IsComponentsV2
    });
  }

  player.destroy();
});

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
        content:
          `${config.emojis.error} No player found`,
        flags: MessageFlags.Ephemeral
      });
    }

    const member =
      interaction.member;

    if (!member.voice?.channel) {
      return interaction.reply({
        content:
          `${config.emojis.error} You need to be in a voice channel`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (
      member.voice.channel.id !==
      player.voiceChannel
    ) {
      return interaction.reply({
        content:
          `${config.emojis.error} You need to be in the same voice channel`,
        flags: MessageFlags.Ephemeral
      });
    }

    switch (interaction.customId) {

      case 'pause':
      case 'resume': {
        const message =
          nowPlayingMessages.get(
            player.guildId
          );

        const shouldPause =
          interaction.customId === 'pause';

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
            components: [updatedContainer],
            flags:
              MessageFlags.IsPersistent |
              MessageFlags.IsComponentsV2
          }).catch(() => {});
        }

        return interaction.reply({
          content: shouldPause
            ? `${config.emojis.pause} Paused`
            : `${config.emojis.play} Resumed`,
          flags: MessageFlags.Ephemeral
        });
      }

      case 'skip': {
        if (!player.current) {
          return interaction.reply({
            content:
              `${config.emojis.error} Nothing is playing`,
            flags: MessageFlags.Ephemeral
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
            components: [disabledContainer],
            flags:
              MessageFlags.IsPersistent |
              MessageFlags.IsComponentsV2
          })
          .catch(() => {});

        player.stop();

        return interaction.reply({
          content:
            `${config.emojis.skip} Skipped`,
          flags: MessageFlags.Ephemeral
        });
      }

      case 'stop': {
        if (player.current) {
          const disabledContainer =
            createNowPlayingContainer(
              player,
              player.current,
              true
            );

          await interaction.message
            .edit({
              components: [disabledContainer],
              flags:
                MessageFlags.IsPersistent |
                MessageFlags.IsComponentsV2
            })
            .catch(() => {});
        }

        player.destroy();

        return interaction.reply({
          content:
            `${config.emojis.stop} Stopped`,
          flags: MessageFlags.Ephemeral
        });
      }

      case 'shuffle': {
        if (
          player.queue.length === 0
        ) {
          return interaction.reply({
            content:
              `${config.emojis.error} Queue is empty`,
            flags: MessageFlags.Ephemeral
          });
        }

        player.queue.shuffle();

        return interaction.reply({
          content:
            `${config.emojis.shuffle} Shuffled queue`,
          flags: MessageFlags.Ephemeral
        });
      }

      case 'loop': {
        const modes = [
          'none',
          'track',
          'queue'
        ];

        const currentMode =
          player.loop || 'none';

        const nextMode =
          modes[
            (
              modes.indexOf(currentMode) + 1
            ) % modes.length
          ];

        player.setLoop(
          nextMode
        );

        const message =
          nowPlayingMessages.get(
            player.guildId
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
            components: [updatedContainer],
            flags:
              MessageFlags.IsPersistent |
              MessageFlags.IsComponentsV2
          }).catch(() => {});
        }

        return interaction.reply({
          content:
            `${config.emojis.loop} Loop set to: ` +
            `${nextMode === 'none'
              ? 'off'
              : nextMode}`,
          flags: MessageFlags.Ephemeral
        });
      }

      case 'queue': {
        const queueContainer =
          createQueueContainer(
            player
          );

        return interaction.reply({
          components: [queueContainer],
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

      if (
        !message.content.startsWith(
          config.prefix
        )
      ) {
        return;
      }

      const args =
        message.content
          .slice(config.prefix.length)
          .trim()
          .split(/ +/);

      let command =
        args.shift()?.toLowerCase();

      if (!command) return;

      if (config.aliases) {
        for (
          const [cmd, aliases]
          of Object.entries(config.aliases)
        ) {
          if (
            Array.isArray(aliases) &&
            aliases.includes(command)
          ) {
            command = cmd;
            break;
          }
        }
      }

      if (command === 'play') {
        const query =
          args.join(' ');

        if (!query) {
          return message.reply(
            `${config.emojis.error} Please provide a song name or URL`
          );
        }

        if (
          !message.member.voice?.channel
        ) {
          return message.reply(
            `${config.emojis.error} You need to be in a voice channel`
          );
        }

        if (!isLavalinkConnected) {
          return message.reply(
            `${config.emojis.error} Lavalink is not connected. Music commands are unavailable.`
          );
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
          }

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
            return message.reply(
              `${config.emojis.error} No results found`
            );
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
                'Playlist Added',
                `Added playlist **${resolve.playlistInfo?.name || 'Unknown Playlist'}** ` +
                `(${resolve.tracks.length} tracks)`,
                config.emojis.success
              );

            await message.reply({
              components: [container],
              flags:
                MessageFlags.IsPersistent |
                MessageFlags.IsComponentsV2
            });
          }

          else if (
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
              createSimpleContainerNoButtons(
                'Added to Queue',
                `[${track.info.title}](${track.info.uri})`,
                config.emojis.success
              );

            await message.reply({
              components: [container],
              flags:
                MessageFlags.IsPersistent |
                MessageFlags.IsComponentsV2
            });
          }

          else {
            return message.reply(
              `${config.emojis.error} No results found`
            );
          }

          if (
            !player.playing &&
            !player.paused
          ) {
            player.play();
          }

        } catch (error) {
          console.error(
            'Play command error:',
            error
          );

          return message.reply(
            `${config.emojis.error} An error occurred while playing the song`
          );
        }

        return;
      }

      if (command === 'pause') {
        const player =
          riffy.players.get(
            message.guild.id
          );

        if (!player) {
          return message.reply(
            `${config.emojis.error} No player found`
          );
        }

        if (
          !message.member.voice?.channel ||
          message.member.voice.channel.id !==
            player.voiceChannel
        ) {
          return message.reply(
            `${config.emojis.error} You need to be in the same voice channel`
          );
        }

        player.pause(true);

        const container =
          createSimpleContainer(
            'Paused',
            'Playback paused',
            config.emojis.pause
          );

        await message.reply({
          components: [container],
          flags:
            MessageFlags.IsComponentsV2
        });

        return;
      }

      if (command === 'resume') {
        const player =
          riffy.players.get(
            message.guild.id
          );

        if (!player) {
          return message.reply(
            `${config.emojis.error} No player found`
          );
        }

        if (
          !message.member.voice?.channel ||
          message.member.voice.channel.id !==
            player.voiceChannel
        ) {
          return message.reply(
            `${config.emojis.error} You need to be in the same voice channel`
          );
        }

        player.pause(false);

        const container =
          createSimpleContainer(
            'Resumed',
            'Playback resumed',
            config.emojis.play
          );

        await message.reply({
          components: [container],
          flags:
            MessageFlags.IsComponentsV2
        });

        return;
      }

      if (command === 'skip') {
        const player =
          riffy.players.get(
            message.guild.id
          );

        if (!player) {
          return message.reply(
            `${config.emojis.error} No player found`
          );
        }

        if (
          !message.member.voice?.channel ||
          message.member.voice.channel.id !==
            player.voiceChannel
        ) {
          return message.reply(
            `${config.emojis.error} You need to be in the same voice channel`
          );
        }

        player.stop();

        const container =
          createSimpleContainer(
            'Skipped',
            'Skipped to next track',
            config.emojis.skip
          );

        await message.reply({
          components: [container],
          flags:
            MessageFlags.IsComponentsV2
        });

        return;
      }

      if (command === 'stop') {
        const player =
          riffy.players.get(
            message.guild.id
          );

        if (!player) {
          return message.reply(
            `${config.emojis.error} No player found`
          );
        }

        if (
          !message.member.voice?.channel ||
          message.member.voice.channel.id !==
            player.voiceChannel
        ) {
          return message.reply(
            `${config.emojis.error} You need to be in the same voice channel`
          );
        }

        player.destroy();

        const container =
          createSimpleContainer(
            'Stopped',
            'Stopped and cleared queue',
            config.emojis.stop
          );

        await message.reply({
          components: [container],
          flags:
            MessageFlags.IsComponentsV2
        });

        return;
      }

      if (command === 'volume') {
        const player =
          riffy.players.get(
            message.guild.id
          );

        if (!player) {
          return message.reply(
            `${config.emojis.error} No player found`
          );
        }

        if (
          !message.member.voice?.channel ||
          message.member.voice.channel.id !==
            player.voiceChannel
        ) {
          return message.reply(
            `${config.emojis.error} You need to be in the same voice channel`
          );
        }

        const volume =
          parseInt(args[0]);

        if (
          Number.isNaN(volume) ||
          volume < 1 ||
          volume > 100
        ) {
          return message.reply(
            `${config.emojis.error} Please provide a volume between 1-100`
          );
        }

        player.setVolume(
          volume
        );

        const container =
          createSimpleContainer(
            'Volume Set',
            `Volume set to ${volume}%`,
            config.emojis.volume
          );

        await message.reply({
          components: [container],
          flags:
            MessageFlags.IsComponentsV2
        });

        return;
      }

      if (command === 'queue') {
        const player =
          riffy.players.get(
            message.guild.id
          );

        if (!player) {
          return message.reply(
            `${config.emojis.error} No player found`
          );
        }

        if (
          player.queue.length === 0 &&
          !player.current
        ) {
          return message.reply(
            `${config.emojis.error} Queue is empty`
          );
        }

        const container =
          createQueueContainer(
            player
          );

        await message.reply({
          components: [container],
          flags:
            MessageFlags.IsComponentsV2
        });

        return;
      }

      if (
        command === 'nowplaying'
      ) {
        const player =
          riffy.players.get(
            message.guild.id
          );

        if (
          !player ||
          !player.current
        ) {
          return message.reply(
            `${config.emojis.error} Nothing is playing`
          );
        }

        const info =
          player.current.info ?? {};

        const thumbnail =
          getTrackThumbnail(info);

        const currentPosition =
          player.position || 0;

        const totalDuration =
          info.length || 0;

        const status =
          player.paused
            ? '⏸️ Paused'
            : '▶️ Playing';

        const description =
          `**[${info.title || 'Unknown Title'}](${info.uri || 'https://youtube.com'})**\n\n` +
          `**Status:** ${status}\n` +
          `**Current Duration:** ${formatTime(currentPosition)} / ${formatTime(totalDuration)}\n` +
          `**Requested By:** <@${info.requester || '0'}>\n` +
          `**Loop:** ${
            !player.loop ||
            player.loop === 'none'
              ? 'off'
              : player.loop
          }`;

        const container =
          new ContainerBuilder()
            .addSectionComponents(
              new SectionBuilder()
                .addTextDisplayComponents(
                  new TextDisplayBuilder()
                    .setContent(
                      `## ${config.emojis.music} Now Playing\n${description}`
                    )
                )
                .setThumbnailAccessory(
                  new ThumbnailBuilder()
                    .setURL(thumbnail)
                    .setDescription(
                      info.title ||
                      'Song Thumbnail'
                    )
                )
            )
            .addSeparatorComponents(
              new SeparatorBuilder()
                .setSpacing(
                  SeparatorSpacingSize.Small
                )
                .setDivider(true)
            );

        await message.reply({
          components: [container],
          flags:
            MessageFlags.IsComponentsV2
        });

        return;
      }

      if (command === 'shuffle') {
        const player =
          riffy.players.get(
            message.guild.id
          );

        if (!player) {
          return message.reply(
            `${config.emojis.error} No player found`
          );
        }

        if (
          !message.member.voice?.channel ||
          message.member.voice.channel.id !==
            player.voiceChannel
        ) {
          return message.reply(
            `${config.emojis.error} You need to be in the same voice channel`
          );
        }

        if (
          player.queue.length === 0
        ) {
          return message.reply(
            `${config.emojis.error} Queue is empty`
          );
        }

        player.queue.shuffle();

        const container =
          createSimpleContainer(
            'Shuffled',
            'Shuffled the queue',
            config.emojis.shuffle
          );

        await message.reply({
          components: [container],
          flags:
            MessageFlags.IsComponentsV2
        });

        return;
      }

      if (command === 'loop') {
        const player =
          riffy.players.get(
            message.guild.id
          );

        if (!player) {
          return message.reply(
            `${config.emojis.error} No player found`
          );
        }

        if (
          !message.member.voice?.channel ||
          message.member.voice.channel.id !==
            player.voiceChannel
        ) {
          return message.reply(
            `${config.emojis.error} You need to be in the same voice channel`
          );
        }

        const mode =
          args[0]?.toLowerCase();

        if (
          !mode ||
          ![
            'off',
            'none',
            'track',
            'queue'
          ].includes(mode)
        ) {
          return message.reply(
            `${config.emojis.error} Please specify: off, track, or queue`
          );
        }

        const finalMode =
          mode === 'off'
            ? 'none'
            : mode;

        player.setLoop(
          finalMode
        );

        const container =
          createSimpleContainer(
            'Loop Set',
            `Loop set to: ${
              finalMode === 'none'
                ? 'off'
                : finalMode
            }`,
            config.emojis.loop
          );

        await message.reply({
          components: [container],
          flags:
            MessageFlags.IsComponentsV2
        });

        return;
      }

      if (command === 'remove') {
        const player =
          riffy.players.get(
            message.guild.id
          );

        if (!player) {
          return message.reply(
            `${config.emojis.error} No player found`
          );
        }

        if (
          !message.member.voice?.channel ||
          message.member.voice.channel.id !==
            player.voiceChannel
        ) {
          return message.reply(
            `${config.emojis.error} You need to be in the same voice channel`
          );
        }

        const position =
          parseInt(args[0]) - 1;

        if (
          Number.isNaN(position) ||
          position < 0 ||
          position >=
            player.queue.length
        ) {
          return message.reply(
            `${config.emojis.error} Invalid position`
          );
        }

        const removed =
          player.queue.remove(
            position
          );

        const container =
          createSimpleContainer(
            'Removed',
            `Removed: ${removed.info.title}`,
            config.emojis.success
          );

        await message.reply({
          components: [container],
          flags:
            MessageFlags.IsComponentsV2
        });

        return;
      }

      if (command === 'move') {
        const player =
          riffy.players.get(
            message.guild.id
          );

        if (!player) {
          return message.reply(
            `${config.emojis.error} No player found`
          );
        }

        if (
          !message.member.voice?.channel ||
          message.member.voice.channel.id !==
            player.voiceChannel
        ) {
          return message.reply(
            `${config.emojis.error} You need to be in the same voice channel`
          );
        }

        const from =
          parseInt(args[0]) - 1;

        const to =
          parseInt(args[1]) - 1;

        if (
          Number.isNaN(from) ||
          Number.isNaN(to) ||
          from < 0 ||
          from >= player.queue.length ||
          to < 0 ||
          to >= player.queue.length
        ) {
          return message.reply(
            `${config.emojis.error} Invalid positions`
          );
        }

        const track =
          player.queue.remove(
            from
          );

        player.queue.splice(
          to,
          0,
          track
        );

        const container =
          createSimpleContainer(
            'Moved',
            `Moved: ${track.info.title}`,
            config.emojis.success
          );

        await message.reply({
          components: [container],
          flags:
            MessageFlags.IsComponentsV2
        });

        return;
      }

      if (
        command === 'clearqueue'
      ) {
        const player =
          riffy.players.get(
            message.guild.id
          );

        if (!player) {
          return message.reply(
            `${config.emojis.error} No player found`
          );
        }

        if (
          !message.member.voice?.channel ||
          message.member.voice.channel.id !==
            player.voiceChannel
        ) {
          return message.reply(
            `${config.emojis.error} You need to be in the same voice channel`
          );
        }

        player.queue.clear();

        const container =
          createSimpleContainer(
            'Queue Cleared',
            'Cleared the queue',
            config.emojis.success
          );

        await message.reply({
          components: [container],
          flags:
            MessageFlags.IsComponentsV2
        });

        return;
      }

      if (command === '247') {
        if (
          !message.member.voice?.channel
        ) {
          return message.reply(
            `${config.emojis.error} You need to be in a voice channel`
          );
        }

        if (
          queue247.has(
            message.guild.id
          )
        ) {
          queue247.delete(
            message.guild.id
          );

          const container =
            createSimpleContainer(
              '24/7 Disabled',
              '24/7 mode disabled',
              config.emojis.success
            );

          await message.reply({
            components: [container],
            flags:
              MessageFlags.IsComponentsV2
          });

          return;
        }

        queue247.add(
          message.guild.id
        );

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
        }

        const container =
          createSimpleContainer(
            '24/7 Enabled',
            '24/7 mode enabled',
            config.emojis.success
          );

        await message.reply({
          components: [container],
          flags:
            MessageFlags.IsComponentsV2
        });

        return;
      }

      if (command === 'stats') {
        const container =
          createStatsContainer();

        await message.reply({
          components: [container],
          flags:
            MessageFlags.IsComponentsV2
        });

        return;
      }

      if (command === 'ping') {
        const container =
          createSimpleContainer(
            'Pong!',
            `Latency: ${client.ws.ping}ms`,
            config.emojis.info
          );

        await message.reply({
          components: [container],
          flags:
            MessageFlags.IsComponentsV2
        });

        return;
      }

      if (command === 'invite') {
        const invite =
          `https://discord.com/api/oauth2/authorize` +
          `?client_id=${client.user.id}` +
          `&permissions=3165184` +
          `&scope=bot`;

        const container =
          new ContainerBuilder()
            .addSectionComponents(
              new SectionBuilder()
                .addTextDisplayComponents(
                  new TextDisplayBuilder()
                    .setContent(
                      `## ${config.emojis.success} Invite Bot\n` +
                      `[Click here to invite me](${invite})`
                    )
                )
                .setThumbnailAccessory(
                  new ThumbnailBuilder()
                    .setURL(
                      client.user.displayAvatarURL({
                        size: 1024
                      })
                    )
                    .setDescription(
                      'Invite Bot'
                    )
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
                    .setLabel(
                      'Invite Me'
                    )
                    .setStyle(
                      ButtonStyle.Link
                    )
                    .setURL(invite)
                )
            );

        await message.reply({
          components: [container],
          flags:
            MessageFlags.IsComponentsV2
        });

        return;
      }

      if (command === 'support') {
        const container =
          new ContainerBuilder()
            .addSectionComponents(
              new SectionBuilder()
                .addTextDisplayComponents(
                  new TextDisplayBuilder()
                    .setContent(
                      `## ${config.emojis.info} Support Server\n` +
                      `[Join our support server](${config.supportServer})`
                    )
                )
                .setThumbnailAccessory(
                  new ThumbnailBuilder()
                    .setURL(
                      client.user.displayAvatarURL({
                        size: 1024
                      })
                    )
                    .setDescription(
                      'Support Server'
                    )
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
                    .setLabel(
                      'Support'
                    )
                    .setStyle(
                      ButtonStyle.Link
                    )
                    .setURL(
                      config.supportServer
                    )
                )
            );

        await message.reply({
          components: [container],
          flags:
            MessageFlags.IsComponentsV2
        });

        return;
      }

      if (command === 'help') {
        const container =
          createHelpContainer();

        await message.reply({
          components: [container],
          flags:
            MessageFlags.IsComponentsV2
        });

        return;
      }
    }
  );
}

client.on('raw', (data) => {
  riffy.updateVoiceState(data);
});

client.once('ready', async () => {
  console.log(
    `${config.emojis.success} Logged in as ${client.user.tag}`
  );

  try {
    riffy.init(
      client.user.id
    );
  } catch (error) {
    console.error(
      `${config.emojis.error} Failed to initialize Riffy:`,
      error
    );
  }

  const activityTypes = {
    PLAYING: ActivityType.Playing,
    LISTENING: ActivityType.Listening,
    WATCHING: ActivityType.Watching,
    STREAMING: ActivityType.Streaming,
    COMPETING: ActivityType.Competing
  };

  const activityType =
    activityTypes[
      config.activity.type
    ] ||
    ActivityType.Listening;

  client.user.setActivity(
    config.activity.name,
    {
      type: activityType
    }
  );

  console.log(
    `${config.emojis.success} Activity set: ` +
    `${config.activity.type} ` +
    `${config.activity.name}`
  );

  console.log(
    `${config.emojis.success} Prefix command system ready`
  );
});

startExpressServer();

client.login(
  config.token
);