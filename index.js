const express = require('express');
const fs = require('fs');

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

/* =========================================================
   TVB ASSISTANT
   Discord.js 14
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN;
const PORT = Number(process.env.PORT || 10000);

const CONFIG_FILE = './config.json';

/*
  IMPORTANT:
  This heartbeat runs FOREVER while Node is running.
  Every 5 minutes it sends "a" to #bot-activity.
*/
const HEARTBEAT_INTERVAL = 5 * 60 * 1000;

if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN is missing.');
  process.exit(1);
}

/* =========================================================
   EXPRESS SERVER
========================================================= */

const app = express();

app.get('/', (_req, res) => {
  res.status(200).send('TVB Assistant is online.');
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    online: true,
    bot: client.user?.tag || null,
    heartbeat: '5 minutes',
    time: new Date().toISOString(),
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Web server listening on port ${PORT}`);
});

/* =========================================================
   DISCORD CLIENT
========================================================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],

  partials: [
    Partials.Channel,
  ],
});

/* =========================================================
   CONFIG
========================================================= */

let config = {};

try {
  if (fs.existsSync(CONFIG_FILE)) {
    config = JSON.parse(
      fs.readFileSync(CONFIG_FILE, 'utf8')
    );
  }
} catch (error) {
  console.error('⚠️ Could not load config.json:', error);
  config = {};
}

function saveConfig() {
  try {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(config, null, 2)
    );
  } catch (error) {
    console.error('❌ Could not save config:', error);
  }
}

function guildConfig(guildId) {
  if (!config[guildId]) {
    config[guildId] = {
      welcomeChannel: null,
      welcomeMessage:
        'Welcome {user} to **{server}**! 🎉',

      autorole: null,

      ticketCategory: null,

      ticketStaffRole: null,

      builderRole: null,

      updatesRole: null,

      activityChannel: 'bot-activity',

      buttonRoles: [],
    };
  }

  const cfg = config[guildId];

  if (!Array.isArray(cfg.buttonRoles)) {
    cfg.buttonRoles = [];
  }

  if (!cfg.activityChannel) {
    cfg.activityChannel = 'bot-activity';
  }

  return cfg;
}

/* =========================================================
   PERMISSIONS
========================================================= */

function manager(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(
      PermissionsBitField.Flags.ManageGuild
    ) ||
    interaction.memberPermissions?.has(
      PermissionsBitField.Flags.ManageRoles
    )
  );
}

function moderator(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(
      PermissionsBitField.Flags.ModerateMembers
    ) ||
    manager(interaction)
  );
}

/* =========================================================
   HELPERS
========================================================= */

function safe(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 70) || 'user';
}

function makeEmbed(
  title,
  description,
  color = 0x7c5cff
) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({
      text: 'TVB Assistant',
    })
    .setTimestamp();
}

function findText(guild, name) {
  return guild.channels.cache.find(
    channel =>
      channel.type === ChannelType.GuildText &&
      channel.name.toLowerCase() ===
        name.toLowerCase()
  );
}

function findRoleByNames(guild, names) {
  const wanted = names.map(name =>
    name.toLowerCase()
  );

  return guild.roles.cache.find(role =>
    wanted.includes(
      role.name.toLowerCase()
    )
  );
}

function replacePlaceholders(
  text,
  {
    user,
    server,
    fromRole = '',
    toRole = '',
  }
) {
  return String(text || '')
    .replace(
      /{user}/gi,
      `${user || ''}`
    )
    .replace(
      /{username}/gi,
      user?.user?.username ||
        user?.username ||
        ''
    )
    .replace(
      /{server}/gi,
      server?.name || ''
    )
    .replace(
      /{fromrole}/gi,
      fromRole
        ? `${fromRole}`
        : ''
    )
    .replace(
      /{torole}/gi,
      toRole
        ? `${toRole}`
        : ''
    );
}

/* =========================================================
   TICKETS
========================================================= */

const TICKETS = {
  general: {
    label: 'General Support',
    emoji: '💬',
    desc:
      'Questions, help, bugs, or anything else.',

    q: [
      'What do you need help with?',
      'What happened?',
      'Which server/channel is this about?',
      'What have you tried already?',
      'Anything else we should know?',
    ],
  },

  purchase: {
    label: 'Purchase Support',
    emoji: '🛒',
    desc:
      'Purchases, payments, orders, or missing items.',

    q: [
      'What did you purchase?',
      'When did you purchase it?',
      'What went wrong?',
      'Do you have an order/transaction ID?',
      'What would you like us to do?',
    ],
  },

  player: {
    label: 'Player Report',
    emoji: '🚨',
    desc:
      'Report cheating, rule breaking, or another player.',

    q: [
      'What is the player username?',
      'What happened?',
      'When and where did it happen?',
      'Do you have proof/screenshots/video?',
      'Anything else staff should know?',
    ],
  },

  staff: {
    label: 'Staff Report',
    emoji: '🛡️',
    desc:
      'Report a concern involving a staff member.',

    q: [
      'Which staff member?',
      'What happened?',
      'When and where did this occur?',
      'Do you have proof/screenshots/video?',
      'What outcome are you looking for?',
    ],
  },
};

/* =========================================================
   SERVICES
========================================================= */

const SERVICES = {
  base: {
    label: 'Base',
    emoji: '🏠',
    desc:
      'Custom Minecraft bases and structures.',
  },

  farm: {
    label: 'Farm',
    emoji: '🌾',
    desc:
      'Custom farms and functional builds.',
  },

  mapart: {
    label: 'Map Art',
    emoji: '🖼️',
    desc:
      'Custom Minecraft map art.',
  },
};

/* =========================================================
   APPLICATIONS
========================================================= */

const APPS = {
  builder: {
    label: 'Builder Application',
    emoji: '🧱',

    channel:
      '📋・builder-submissions',

    acceptedRoles: [
      'builder',
    ],

    blacklistRoles: [
      'builder application blacklist',
    ],

    q: [
      'What is your Minecraft username?',
      'How old are you?',
      'What is your timezone?',
      'How many years of Minecraft building experience do you have?',
      'Which building styles are you strongest in?',
      'What type of projects do you consider yourself best suited for?',
      'What is the strongest build you have created and why?',
      'What aspects of your building do you believe need improvement?',
      'How many hours per week can you realistically dedicate to commissions?',
      'Why are you interested in becoming a TVB builder?',
      'How do you respond when a client or senior builder heavily critiques your work?',
      'How comfortable are you working as part of a structured build team?',
      'How would you handle a client requesting major changes late in a project?',
      'What do you believe separates a professional Minecraft build from an average one?',
      'Provide a screenshot, portfolio, or link to your strongest work.',
    ],
  },

  staff: {
    label: 'Staff Application',
    emoji: '🛡️',

    channel:
      '📋・staff-submissions',

    acceptedRoles: [
      'staff team',
      'helper',
    ],

    blacklistRoles: [
      'staff application blacklist',
    ],

    q: [
      'What is your Discord username?',
      'How old are you?',
      'What is your timezone?',
      'How long have you been part of the TVB community?',
      'What previous moderation, leadership, or community-management experience do you have?',
      'How many hours per week can you consistently dedicate to staff responsibilities?',
      'Why do you believe you would be a strong addition to the TVB staff team?',
      'What qualities do you believe are essential for an effective and respected moderator?',
      'How would you de-escalate a conflict between two members while remaining impartial and professional?',
      'How would you handle a close friend violating a rule that you are responsible for enforcing?',
      'What would you do if a member repeatedly ignored increasingly serious warnings?',
      'How would you investigate a player report before deciding whether disciplinary action is justified?',
      'How would you handle confidential staff information that should not be shared with regular members?',
      'What specific strengths would you bring to the staff team?',
      'What is one area of your communication, judgment, or leadership that you are actively working to improve?',
    ],
  },
};

/* =========================================================
   SESSION STORAGE
========================================================= */

const appSessions = new Map();
const ticketSessions = new Map();

/* =========================================================
   TICKET MENUS
========================================================= */

function ticketMenu() {
  return new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('ticket-select')
        .setPlaceholder(
          '🎫 Select support type...'
        )
        .addOptions(
          Object.entries(TICKETS).map(
            ([value, ticket]) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(
                  ticket.label
                )
                .setValue(value)
                .setEmoji(
                  ticket.emoji
                )
                .setDescription(
                  ticket.desc
                )
          )
        )
    );
}

function serviceMenu() {
  return new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(
          'service-select'
        )
        .setPlaceholder(
          '🛠️ Select a service...'
        )
        .addOptions(
          Object.entries(SERVICES).map(
            ([value, service]) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(
                  service.label
                )
                .setValue(value)
                .setEmoji(
                  service.emoji
                )
                .setDescription(
                  service.desc
                )
          )
        )
    );
}

/* =========================================================
   APPLICATION MENU
========================================================= */

function appMenu() {
  return new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(
          'application-select'
        )
        .setPlaceholder(
          '📋 Choose an application...'
        )
        .addOptions(
          Object.entries(APPS).map(
            ([value, app]) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(
                  app.label
                )
                .setValue(value)
                .setEmoji(
                  app.emoji
                )
                .setDescription(
                  '15 questions • completed privately in DMs'
                )
          )
        )
    );
}

/* =========================================================
   TICKET MODALS
========================================================= */

function ticketModal(type) {
  const ticket =
    TICKETS[type];

  const modal =
    new ModalBuilder()
      .setCustomId(
        `ticket-modal-${type}`
      )
      .setTitle(
        ticket.label
      );

  ticket.q.forEach(
    (question, index) => {
      modal.addComponents(
        new ActionRowBuilder()
          .addComponents(
            new TextInputBuilder()
              .setCustomId(
                `answer-${index}`
              )
              .setLabel(
                question.slice(
                  0,
                  45
                )
              )
              .setStyle(
                TextInputStyle.Paragraph
              )
              .setRequired(true)
              .setMaxLength(1000)
          )
      );
    }
  );

  return modal;
}

/* =========================================================
   SERVICE MODAL
========================================================= */

function serviceModal(type) {
  const service =
    SERVICES[type];

  return new ModalBuilder()
    .setCustomId(
      `service-modal-${type}`
    )
    .setTitle(
      `${service.label} Service Request`
    )
    .addComponents(

      new ActionRowBuilder()
        .addComponents(
          new TextInputBuilder()
            .setCustomId(
              'service-looking'
            )
            .setLabel(
              'What Are You Looking For?'
            )
            .setStyle(
              TextInputStyle.Paragraph
            )
            .setRequired(true)
            .setMaxLength(1000)
        ),

      new ActionRowBuilder()
        .addComponents(
          new TextInputBuilder()
            .setCustomId(
              'service-price'
            )
            .setLabel(
              'What Is Your Price Range?'
            )
            .setStyle(
              TextInputStyle.Short
            )
            .setRequired(true)
            .setMaxLength(200)
        ),

      new ActionRowBuilder()
        .addComponents(
          new TextInputBuilder()
            .setCustomId(
              'service-addons'
            )
            .setLabel(
              'Any Add Ons?'
            )
            .setStyle(
              TextInputStyle.Paragraph
            )
            .setRequired(false)
            .setMaxLength(1000)
        )
    );
}

/* =========================================================
   TICKET PERMISSIONS
========================================================= */

function ticketOverwrites(
  guild,
  member,
  staffRole,
  builderRole,
  isService
) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,

      deny: [
        PermissionsBitField.Flags.ViewChannel,
      ],
    },

    {
      id: member.id,

      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },
  ];

  /*
    STAFF TEAM:
    Can see normal tickets AND service tickets.
  */

  if (staffRole) {
    overwrites.push({
      id: staffRole.id,

      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageMessages,
      ],
    });
  }

  /*
    BUILDER:
    Can ONLY see service tickets.
  */

  if (
    isService &&
    builderRole &&
    (!staffRole ||
      builderRole.id !== staffRole.id)
  ) {
    overwrites.push({
      id: builderRole.id,

      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    });
  }

  return overwrites;
}

/* =========================================================
   CREATE NORMAL TICKET
========================================================= */

async function createTicket(
  interaction,
  type,
  answers
) {
  const guild =
    interaction.guild;

  const member =
    interaction.member;

  const cfg =
    guildConfig(
      guild.id
    );

  const ticket =
    TICKETS[type];

  if (!ticket) {
    return interaction.reply({
      content:
        '❌ Invalid ticket type.',
      ephemeral: true,
    });
  }

  const existing =
    guild.channels.cache.find(
      channel =>
        channel.type ===
          ChannelType.GuildText &&
        channel.topic ===
          `TVB-TICKET:${member.id}`
    );

  if (existing) {
    return interaction.reply({
      content:
        `❌ You already have an open ticket: ${existing}`,
      ephemeral: true,
    });
  }

  const staffRole =
    cfg.ticketStaffRole
      ? guild.roles.cache.get(
          cfg.ticketStaffRole
        )
      : null;

  try {
    const channel =
      await guild.channels.create({
        name:
          `${type}-${safe(
            member.user.username
          )}`.slice(0, 100),

        type:
          ChannelType.GuildText,

        parent:
          cfg.ticketCategory ||
          undefined,

        topic:
          `TVB-TICKET:${member.id}`,

        permissionOverwrites:
          ticketOverwrites(
            guild,
            member,
            staffRole,
            null,
            false
          ),

        reason:
          `TVB Assistant • ${ticket.label}`,
      });

    ticketSessions.set(
      channel.id,
      {
        userId:
          member.id,

        kind:
          'ticket',
      }
    );

    const answerText =
      ticket.q
        .map(
          (question, index) =>
            `**${index + 1}. ${question}**\n> ${
              answers[index] ||
              'No answer provided.'
            }`
        )
        .join('\n\n');

    const ticketEmbed =
      makeEmbed(
        `${ticket.emoji} ${ticket.label}`,
        [
          `Welcome ${member}!`,
          '',
          `**${ticket.desc}**`,
          '',
          answerText,
          '',
          'A staff member will review your ticket shortly.',
        ].join('\n')
      );

    const buttons =
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              'ticket-close'
            )
            .setLabel(
              'Close Ticket'
            )
            .setEmoji('🔒')
            .setStyle(
              ButtonStyle.Danger
            )
        );

    await channel.send({
      content:
        `${member}${
          staffRole
            ? ` ${staffRole}`
            : ''
        }`,

      embeds: [
        ticketEmbed,
      ],

      components: [
        buttons,
      ],
    });

    return interaction.reply({
      content:
        `✅ Your ticket has been created: ${channel}`,
      ephemeral: true,
    });

  } catch (error) {
    console.error(
      '❌ Could not create ticket:',
      error
    );

    return interaction.reply({
      content:
        '❌ I could not create the ticket. Check my permissions and category settings.',
      ephemeral: true,
    });
  }
}

/* =========================================================
   CREATE SERVICE TICKET
========================================================= */

async function createServiceTicket(
  interaction,
  type,
  answers
) {
  const guild =
    interaction.guild;

  const member =
    interaction.member;

  const cfg =
    guildConfig(
      guild.id
    );

  const service =
    SERVICES[type];

  const existing =
    guild.channels.cache.find(
      channel =>
        channel.type ===
          ChannelType.GuildText &&
        channel.topic ===
          `TVB-SERVICE:${member.id}`
    );

  if (existing) {
    return interaction.reply({
      content:
        `❌ You already have an open service request: ${existing}`,
      ephemeral: true,
    });
  }

  const staffRole =
    cfg.ticketStaffRole
      ? guild.roles.cache.get(
          cfg.ticketStaffRole
        )
      : null;

  const builderRole =
    cfg.builderRole
      ? guild.roles.cache.get(
          cfg.builderRole
        )
      : null;

  try {
    const channel =
      await guild.channels.create({
        name:
          `service-${type}-${safe(
            member.user.username
          )}`.slice(0, 100),

        type:
          ChannelType.GuildText,

        parent:
          cfg.ticketCategory ||
          undefined,

        topic:
          `TVB-SERVICE:${member.id}`,

        permissionOverwrites:
          ticketOverwrites(
            guild,
            member,
            staffRole,
            builderRole,
            true
          ),

        reason:
          `TVB Assistant • ${service.label} service`,
      });

    ticketSessions.set(
      channel.id,
      {
        userId:
          member.id,

        kind:
          'service',
      }
    );

    const serviceEmbed =
      makeEmbed(
        `${service.emoji} ${service.label} Request`,
        [
          `**Customer:** ${member}`,
          '',
          '**What Are You Looking For?**',
          `> ${answers.lookingFor}`,
          '',
          '**What Is Your Price Range?**',
          `> ${answers.price}`,
          '',
          '**Any Add Ons?**',
          `> ${
            answers.addons ||
            'None specified.'
          }`,
          '',
          'A member of the TVB team will review your request shortly.',
        ].join('\n'),
        0xf5a623
      );

    const buttons =
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              'ticket-close'
            )
            .setLabel(
              'Close Request'
            )
            .setEmoji('🔒')
            .setStyle(
              ButtonStyle.Danger
            )
        );

    const mentions =
      [
        member.toString(),
        staffRole
          ? staffRole.toString()
          : null,
        builderRole
          ? builderRole.toString()
          : null,
      ]
        .filter(Boolean)
        .join(' ');

    await channel.send({
      content:
        mentions,

      embeds: [
        serviceEmbed,
      ],

      components: [
        buttons,
      ],
    });

    return interaction.reply({
      content:
        `✅ Your ${service.label} request has been created: ${channel}`,
      ephemeral: true,
    });

  } catch (error) {
    console.error(
      '❌ Could not create service ticket:',
      error
    );

    return interaction.reply({
      content:
        '❌ I could not create the service ticket. Check my permissions.',
      ephemeral: true,
    });
  }
}

/* =========================================================
   TICKET PANEL
========================================================= */

async function sendTicketPanel(
  interaction
) {
  const panel =
    new EmbedBuilder()
      .setColor(0x7c5cff)
      .setTitle(
        '🎫 TVB Support Center'
      )
      .setDescription(
        [
          '# Need some help?',
          '',
          'Welcome to the **TVB Support Center**!',
          '',
          'Select the category below that best matches your issue.',
          '',
          '💬 **General Support**',
          'Questions, bugs, help, or anything else.',
          '',
          '🛒 **Purchase Support**',
          'Purchases, payments, orders, or missing items.',
          '',
          '🚨 **Player Report**',
          'Report cheating or rule breaking.',
          '',
          '🛡️ **Staff Report**',
          'Report a concern involving staff.',
          '',
          '━━━━━━━━━━━━━━━━━━━━',
          '🔒 **Tickets are private.**',
          '',
          'Select an option below to get started.',
        ].join('\n')
      )
      .setFooter({
        text:
          'TVB Assistant • Support Center',
      })
      .setTimestamp();

  await interaction.channel.send({
    embeds: [
      panel,
    ],

    components: [
      ticketMenu(),
    ],
  });

  return interaction.reply({
    content:
      '✅ Ticket panel posted!',
    ephemeral: true,
  });
}

/* =========================================================
   SERVICE PANEL
========================================================= */

async function sendServicePanel(
  interaction
) {
  const panel =
    new EmbedBuilder()
      .setColor(0xf5a623)
      .setTitle(
        '🛠️ TVB Services'
      )
      .setDescription(
        [
          '# Need Something Built?',
          '',
          'Looking for a custom Minecraft service?',
          '',
          'Choose what you are interested in below.',
          '',
          '🏠 **Base**',
          'Custom bases and structures.',
          '',
          '🌾 **Farm**',
          'Functional farms and resource systems.',
          '',
          '🖼️ **Map Art**',
          'Custom Minecraft map art.',
          '',
          '━━━━━━━━━━━━━━━━━━━━',
          '🔒 **Service requests are private.**',
          '',
          'Select a service below to get started.',
        ].join('\n')
      )
      .setFooter({
        text:
          'TVB Assistant • Services',
      })
      .setTimestamp();

  await interaction.channel.send({
    embeds: [
      panel,
    ],

    components: [
      serviceMenu(),
    ],
  });

  return interaction.reply({
    content:
      '✅ Service panel posted!',
    ephemeral: true,
  });
}

/* =========================================================
   CLOSE TICKET
========================================================= */

async function closeTicket(
  interaction
) {
  const channel =
    interaction.channel;

  const session =
    ticketSessions.get(
      channel.id
    );

  if (!session) {
    return interaction.reply({
      content:
        "⚠️ This isn't an active TVB ticket.",
      ephemeral: true,
    });
  }

  const cfg =
    guildConfig(
      interaction.guild.id
    );

  const staffRole =
    cfg.ticketStaffRole
      ? interaction.guild.roles.cache.get(
          cfg.ticketStaffRole
        )
      : null;

  const isStaff =
    staffRole &&
    interaction.member.roles.cache.has(
      staffRole.id
    );

  if (
    session.userId !==
      interaction.user.id &&
    !isStaff &&
    !moderator(interaction)
  ) {
    return interaction.reply({
      content:
        '❌ Only the ticket creator or ticket staff can close this ticket.',
      ephemeral: true,
    });
  }

  await interaction.reply({
    content:
      '🔒 Closing this ticket in 5 seconds...',
  });

  ticketSessions.delete(
    channel.id
  );

  setTimeout(
    async () => {
      try {
        await channel.delete(
          'TVB Assistant ticket closed'
        );
      } catch (error) {
        console.error(
          '❌ Could not delete ticket:',
          error
        );
      }
    },
    5000
  );
}

/* =========================================================
   APPLICATION PANEL
========================================================= */

async function sendApplicationPanel(
  interaction
) {
  const panel =
    new EmbedBuilder()
      .setColor(0x7c5cff)
      .setTitle(
        '📋 TVB Applications'
      )
      .setDescription(
        [
          '# Join the Team!',
          '',
          'Want to become part of the TVB team?',
          '',
          'Choose the application that matches the position you want.',
          '',
          '🧱 **Builder Application**',
          'Help create professional builds and projects.',
          '',
          '🛡️ **Staff Application**',
          'Help moderate and support the community.',
          '',
          '━━━━━━━━━━━━━━━━━━━━',
          '📨 **How it works**',
          '',
          'After selecting an application, I will DM you **15 questions**, one at a time.',
          '',
          '⚠️ Make sure your Discord DMs are enabled.',
          '',
          'Select an application below to begin.',
        ].join('\n')
      )
      .setFooter({
        text:
          'TVB Assistant • Applications',
      })
      .setTimestamp();

  await interaction.channel.send({
    embeds: [
      panel,
    ],

    components: [
      appMenu(),
    ],
  });

  return interaction.reply({
    content:
      '✅ Application panel posted!',
    ephemeral: true,
  });
}

/* =========================================================
   START APPLICATION
========================================================= */

async function startApplication(
  interaction,
  type
) {
  const application =
    APPS[type];

  if (!application) {
    return interaction.reply({
      content:
        '❌ Invalid application type.',
      ephemeral: true,
    });
  }

  if (
    appSessions.has(
      interaction.user.id
    )
  ) {
    return interaction.reply({
      content:
        '❌ You already have an application in progress. Check your DMs.',
      ephemeral: true,
    });
  }

  try {
    const dm =
      await interaction.user.createDM();

    const session = {
      userId:
        interaction.user.id,

      guildId:
        interaction.guild.id,

      type,

      questionIndex:
        0,

      answers: [],
    };

    appSessions.set(
      interaction.user.id,
      session
    );

    await interaction.reply({
      content:
        `📋 **${application.label} started!**\n\nI've sent you a DM with your questions.\n\n⚠️ Make sure your Discord DMs are enabled.`,
      ephemeral: true,
    });

    await dm.send({
      embeds: [
        makeEmbed(
          `${application.emoji} ${application.label}`,
          [
            `Welcome to the **${application.label}**!`,
            '',
            'You will answer **15 questions**, one at a time.',
            '',
            '📝 Answer each question honestly.',
            '💬 Just type your answer normally.',
            '❌ Type `cancel` at any time to stop.',
            '',
            "Let's get started!",
          ].join('\n')
        ),
      ],
    });

    await sendNextApplicationQuestion(
      dm,
      session
    );

  } catch (error) {
    console.error(
      '❌ Could not start application:',
      error
    );

    appSessions.delete(
      interaction.user.id
    );

    if (
      !interaction.replied &&
      !interaction.deferred
    ) {
      await interaction.reply({
        content:
          "❌ I couldn't DM you. Please enable your server DMs and try again.",
        ephemeral: true,
      }).catch(() => {});
    }
  }
}

/* =========================================================
   APPLICATION QUESTIONS
========================================================= */

async function sendNextApplicationQuestion(
  dm,
  session
) {
  const application =
    APPS[session.type];

  if (
    session.questionIndex >=
    application.q.length
  ) {
    return finishApplication(
      dm,
      session
    );
  }

  const question =
    application.q[
      session.questionIndex
    ];

  await dm.send({
    embeds: [
      makeEmbed(
        `${application.emoji} ${application.label}`,
        [
          `### Question ${
            session.questionIndex + 1
          } of 15`,
          '',
          question,
          '',
          '💡 Take your time and give your best answer.',
          '❌ Type `cancel` to stop.',
        ].join('\n')
      ),
    ],
  });
}

/* =========================================================
   FINISH APPLICATION
========================================================= */

async function finishApplication(
  dm,
  session
) {
  const application =
    APPS[session.type];

  try {
    const guild =
      await client.guilds.fetch(
        session.guildId
      );

    const member =
      await guild.members.fetch(
        session.userId
      );

    const submissionChannel =
      findText(
        guild,
        application.channel
      );

    if (!submissionChannel) {
      await dm.send({
        embeds: [
          makeEmbed(
            '❌ Application Finished',
            [
              'Your application was completed,',
              `but I couldn't find **${application.channel}**.`,
              '',
              'Please contact a server administrator.',
            ].join('\n'),
            0xed4245
          ),
        ],
      });

      appSessions.delete(
        session.userId
      );

      return;
    }

    const applicationId =
      `${session.type}-${member.id}-${Date.now()}`;

    const answersText =
      application.q
        .map(
          (question, index) =>
            `**${index + 1}. ${question}**\n> ${
              session.answers[index] ||
              'No answer provided.'
            }`
        )
        .join('\n\n');

    const submissionEmbed =
      new EmbedBuilder()
        .setColor(0x7c5cff)
        .setTitle(
          `${application.emoji} New ${application.label}`
        )
        .setDescription(
          [
            `**Applicant:** ${member}`,
            `**Username:** ${member.user.tag}`,
            `**User ID:** ${member.id}`,
            '',
            answersText,
          ].join('\n')
        )
        .setFooter({
          text:
            `Application ID: ${applicationId}`,
        })
        .setTimestamp();

    const buttons =
      new ActionRowBuilder()
        .addComponents(

          new ButtonBuilder()
            .setCustomId(
              `app-accept-${session.type}-${member.id}`
            )
            .setLabel(
              'Accept'
            )
            .setEmoji('✅')
            .setStyle(
              ButtonStyle.Success
            ),

          new ButtonBuilder()
            .setCustomId(
              `app-deny-${session.type}-${member.id}`
            )
            .setLabel(
              'Deny'
            )
            .setEmoji('❌')
            .setStyle(
              ButtonStyle.Danger
            ),

          new ButtonBuilder()
            .setCustomId(
              `app-blacklist-${session.type}-${member.id}`
            )
            .setLabel(
              'Blacklist'
            )
            .setEmoji('🚫')
            .setStyle(
              ButtonStyle.Secondary
            )
        );

    await submissionChannel.send({
      embeds: [
        submissionEmbed,
      ],

      components: [
        buttons,
      ],
    });

    await dm.send({
      embeds: [
        makeEmbed(
          '✅ Application Submitted!',
          [
            `Your **${application.label}** has been submitted successfully.`,
            '',
            'Staff will review your application.',
            '',
            'Thank you for applying to TVB! 💙',
          ].join('\n'),
          0x57f287
        ),
      ],
    });

    appSessions.delete(
      session.userId
    );

  } catch (error) {
    console.error(
      '❌ Could not finish application:',
      error
    );

    await dm.send({
      content:
        '❌ Something went wrong while submitting your application. Please contact staff.',
    }).catch(() => {});

    appSessions.delete(
      session.userId
    );
  }
}

/* =========================================================
   APPLICATION DM HANDLER
========================================================= */

async function handleApplicationDM(
  message
) {
  if (message.author.bot) {
    return;
  }

  const session =
    appSessions.get(
      message.author.id
    );

  if (!session) {
    return;
  }

  const answer =
    message.content.trim();

  if (!answer) {
    return;
  }

  if (
    answer.toLowerCase() ===
    'cancel'
  ) {
    appSessions.delete(
      message.author.id
    );

    await message.channel.send({
      embeds: [
        makeEmbed(
          '❌ Application Cancelled',
          'Your application has been cancelled. You can start a new one from the server whenever you are ready.',
          0xed4245
        ),
      ],
    });

    return;
  }

  session.answers.push(
    answer
  );

  session.questionIndex++;

  await message.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setDescription(
          `✅ **Answer ${session.questionIndex}/15 saved!**`
        ),
    ],
  });

  await sendNextApplicationQuestion(
    message.channel,
    session
  );
}

/* =========================================================
   APPLICATION ACTIONS
========================================================= */

async function handleApplicationAction(
  interaction
) {
  const parts =
    interaction.customId.split('-');

  const action =
    parts[1];

  const type =
    parts[2];

  const userId =
    parts[3];

  if (!interaction.guild) {
    return interaction.reply({
      content:
        '❌ This can only be used inside the server.',
      ephemeral: true,
    });
  }

  if (!moderator(interaction)) {
    return interaction.reply({
      content:
        '❌ You need moderation permissions to process applications.',
      ephemeral: true,
    });
  }

  const member =
    await interaction.guild.members
      .fetch(userId)
      .catch(() => null);

  if (!member) {
    return interaction.reply({
      content:
        '❌ I could not find that member.',
      ephemeral: true,
    });
  }

  const application =
    APPS[type];

  if (!application) {
    return interaction.reply({
      content:
        '❌ Invalid application type.',
      ephemeral: true,
    });
  }

  if (
    action === 'accept'
  ) {
    const added = [];

    for (
      const roleName of
      application.acceptedRoles
    ) {
      const role =
        findRoleByNames(
          interaction.guild,
          [roleName]
        );

      if (!role) {
        continue;
      }

      if (!role.editable) {
        continue;
      }

      try {
        await member.roles.add(
          role
        );

        added.push(
          `${role}`
        );
      } catch (error) {
        console.error(
          `Could not add ${role.name}:`,
          error
        );
      }
    }

    return interaction.update({
      embeds: [
        makeEmbed(
          '✅ Application Accepted',
          [
            `**Applicant:** ${member}`,
            '',
            `Processed by: ${interaction.user}`,
            '',
            added.length
              ? `Roles added: ${added.join(', ')}`
              : '⚠️ No matching roles could be added.',
          ].join('\n'),
          0x57f287
        ),
      ],

      components: [],
    });
  }

  if (
    action === 'deny'
  ) {
    return interaction.update({
      embeds: [
        makeEmbed(
          '❌ Application Denied',
          [
            `**Applicant:** ${member}`,
            '',
            `Denied by: ${interaction.user}`,
          ].join('\n'),
          0xed4245
        ),
      ],

      components: [],
    });
  }

  if (
    action === 'blacklist'
  ) {
    let blacklistRole = null;

    for (
      const roleName of
      application.blacklistRoles
    ) {
      const role =
        findRoleByNames(
          interaction.guild,
          [roleName]
        );

      if (role) {
        blacklistRole = role;
        break;
      }
    }

    if (
      blacklistRole &&
      blacklistRole.editable
    ) {
      try {
        await member.roles.add(
          blacklistRole
        );
      } catch (error) {
        console.error(
          'Could not add blacklist role:',
          error
        );
      }
    }

    return interaction.update({
      embeds: [
        makeEmbed(
          '🚫 Application Blacklisted',
          [
            `**Applicant:** ${member}`,
            '',
            `Blacklisted by: ${interaction.user}`,
            '',
            blacklistRole
              ? `Added ${blacklistRole}`
              : '⚠️ Blacklist role was not found or could not be managed.',
          ].join('\n'),
          0x2b2d31
        ),
      ],

      components: [],
    });
  }
}

/* =========================================================
   EMOJI SYSTEM
========================================================= */

function parseEmoji(input) {
  if (!input) {
    return null;
  }

  const match =
    input.match(
      /^<a?:([A-Za-z0-9_]+):(\d+)>$/
    );

  if (match) {
    return {
      name:
        match[1],

      id:
        match[2],

      animated:
        input.startsWith('<a:'),
    };
  }

  if (
    /^\p{Extended_Pictographic}$/u.test(
      input
    )
  ) {
    return input;
  }

  return null;
}

function buildRoleButton(
  role,
  emoji
) {
  const button =
    new ButtonBuilder()
      .setCustomId(
        `role-${role.id}`
      )
      .setLabel(
        role.name
      )
      .setStyle(
        ButtonStyle.Secondary
      );

  const parsed =
    parseEmoji(emoji);

  if (parsed) {
    if (
      typeof parsed ===
      'string'
    ) {
      button.setEmoji(
        parsed
      );
    } else {
      button.setEmoji({
        name:
          parsed.name,

        id:
          parsed.id,

        animated:
          parsed.animated,
      });
    }
  }

  return button;
}

/* =========================================================
   BUTTON ROLE PANEL
========================================================= */

async function sendButtonRolePanel(
  interaction
) {
  const cfg =
    guildConfig(
      interaction.guild.id
    );

  if (
    !cfg.buttonRoles.length
  ) {
    return interaction.reply({
      content:
        '❌ No button roles have been configured yet.\n\nUse `/buttonrole add` first.',
      ephemeral: true,
    });
  }

  const rows = [];
  let row =
    new ActionRowBuilder();

  for (
    const item of
    cfg.buttonRoles
  ) {
    const role =
      interaction.guild.roles.cache.get(
        item.roleId
      );

    if (!role) {
      continue;
    }

    row.addComponents(
      buildRoleButton(
        role,
        item.emoji
      )
    );

    if (
      row.components.length ===
      5
    ) {
      rows.push(row);
      row =
        new ActionRowBuilder();
    }
  }

  if (
    row.components.length
  ) {
    rows.push(row);
  }

  if (!rows.length) {
    return interaction.reply({
      content:
        '❌ None of the configured roles still exist.',
      ephemeral: true,
    });
  }

  const panel =
    new EmbedBuilder()
      .setColor(0x7c5cff)
      .setTitle(
        '🔘 TVB Role Selection'
      )
      .setDescription(
        [
          'Choose the roles you want.',
          '',
          'Click a button to **add or remove** a role.',
          '',
          '✨ You can change your roles whenever you want.',
        ].join('\n')
      )
      .setFooter({
        text:
          'TVB Assistant • Button Roles',
      });

  await interaction.channel.send({
    embeds: [
      panel,
    ],

    components:
      rows,
  });

  return interaction.reply({
    content:
      '✅ Button-role panel posted!',
    ephemeral: true,
  });
}

/* =========================================================
   TOGGLE BUTTON ROLE
========================================================= */

async function toggleButtonRole(
  interaction
) {
  const roleId =
    interaction.customId.replace(
      'role-',
      ''
    );

  const role =
    interaction.guild.roles.cache.get(
      roleId
    );

  if (!role) {
    return interaction.reply({
      content:
        '❌ That role no longer exists.',
      ephemeral: true,
    });
  }

  const botMember =
    interaction.guild.members.me;

  if (
    !botMember ||
    role.position >=
      botMember.roles.highest.position
  ) {
    return interaction.reply({
      content:
        "❌ I can't manage that role. Make sure my bot role is above it.",
      ephemeral: true,
    });
  }

  try {
    if (
      interaction.member.roles.cache.has(
        role.id
      )
    ) {
      await interaction.member.roles.remove(
        role
      );

      return interaction.reply({
        content:
          `➖ Removed **${role.name}** from you.`,
        ephemeral: true,
      });
    }

    await interaction.member.roles.add(
      role
    );

    return interaction.reply({
      content:
        `➕ Added **${role.name}** to you!`,
      ephemeral: true,
    });

  } catch (error) {
    console.error(
      '❌ Button role error:',
      error
    );

    return interaction.reply({
      content:
        "❌ I couldn't change that role. Check my bot permissions and role position.",
      ephemeral: true,
    });
  }
}

/* =========================================================
   STAFF / BUILDER COMMANDS
========================================================= */

async function handleTeamAction(
  interaction,
  team,
  action
) {
  if (!manager(interaction)) {
    return interaction.reply({
      content:
        '❌ You need Manage Server or Manage Roles to use this command.',
      ephemeral: true,
    });
  }

  const member =
    interaction.options.getMember(
      'member'
    );

  const fromRole =
    interaction.options.getRole(
      'fromrole'
    );

  const toRole =
    interaction.options.getRole(
      'torole'
    );

  const message =
    interaction.options.getString(
      'message'
    );

  if (!member) {
    return interaction.reply({
      content:
        '❌ I could not find that member.',
      ephemeral: true,
    });
  }

  const botMember =
    interaction.guild.members.me;

  if (!botMember) {
    return interaction.reply({
      content:
        '❌ I could not determine my bot member.',
      ephemeral: true,
    });
  }

  if (
    fromRole &&
    fromRole.position >=
      botMember.roles.highest.position
  ) {
    return interaction.reply({
      content:
        `❌ I can't manage ${fromRole}. My bot role must be above it.`,
      ephemeral: true,
    });
  }

  if (
    toRole &&
    toRole.position >=
      botMember.roles.highest.position
  ) {
    return interaction.reply({
      content:
        `❌ I can't manage ${toRole}. My bot role must be above it.`,
      ephemeral: true,
    });
  }

  try {
    if (
      fromRole &&
      member.roles.cache.has(
        fromRole.id
      )
    ) {
      await member.roles.remove(
        fromRole
      );
    }

    if (
      toRole &&
      !member.roles.cache.has(
        toRole.id
      )
    ) {
      await member.roles.add(
        toRole
      );
    }

    const labels = {
      hire:
        'Hired',

      fire:
        'Fired',

      promote:
        'Promoted',

      demote:
        'Demoted',
    };

    const title =
      labels[action] ||
      action;

    const defaults = {
      hire:
        'Welcome {user}!',

      fire:
        'Thank you for your time with the team.',

      promote:
        'Congratulations on your promotion!',

      demote:
        'Thank you for your continued work with the team.',
    };

    const finalMessage =
      replacePlaceholders(
        message ||
          defaults[action] ||
          '',

        {
          user:
            member,

          server:
            interaction.guild,

          fromRole,

          toRole,
        }
      );

    const output =
      [
        `\`[${title}]\` - ${member}`,
        '',
        `${fromRole || 'Member'} --> ${toRole || 'Member'}`,
        '',
        `-# ${finalMessage}`,
      ].join('\n');

    await interaction.channel.send({
      content:
        output,
    });

    return interaction.reply({
      content:
        `✅ ${title} action completed for ${member}.`,
      ephemeral: true,
    });

  } catch (error) {
    console.error(
      '❌ Team action error:',
      error
    );

    return interaction.reply({
      content:
        '❌ I could not complete that action. Check my role permissions and hierarchy.',
      ephemeral: true,
    });
  }
}

/* =========================================================
   UPDATE SYSTEM
========================================================= */

function updateEmbed(
  type,
  title,
  description,
  extra
) {
  const labels = {
    feature:
      '✨ Feature',

    update:
      '🔄 Update',

    announcement:
      '📢 Announcement',

    important:
      '⚠️ Important',
  };

  const lines = [
    description,
    '',
  ];

  if (extra) {
    lines.push(
      `||${extra}||`
    );
  }

  return new EmbedBuilder()
    .setColor(0x7c5cff)
    .setTitle(
      `${labels[type] || '📢 Update'} • ${title}`
    )
    .setDescription(
      lines.join('\n')
    )
    .setFooter({
      text:
        'TVB Assistant • Updates',
    })
    .setTimestamp();
}

/* =========================================================
   COMMAND BUILDERS
========================================================= */

const commands = [

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription(
      'Check if TVB Assistant is online.'
    ),

  new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription(
      'Post the TVB ticket panel.'
    ),

  new SlashCommandBuilder()
    .setName('servicepanel')
    .setDescription(
      'Post the TVB services panel.'
    ),

  new SlashCommandBuilder()
    .setName('applicationpanel')
    .setDescription(
      'Post the TVB application panel.'
    ),

  new SlashCommandBuilder()
    .setName('buttonrole')
    .setDescription(
      'Manage button roles.'
    )

    .addSubcommand(
      sub =>
        sub
          .setName('add')
          .setDescription(
            'Add a role to the button panel.'
          )

          .addRoleOption(
            option =>
              option
                .setName('role')
                .setDescription(
                  'The role to give.'
                )
                .setRequired(true)
          )

          .addStringOption(
            option =>
              option
                .setName('emoji')
                .setDescription(
                  'Emoji to display on the button.'
                )
                .setRequired(false)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('remove')
          .setDescription(
            'Remove a role from the button panel.'
          )

          .addRoleOption(
            option =>
              option
                .setName('role')
                .setDescription(
                  'The role to remove.'
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('list')
          .setDescription(
            'Show configured button roles.'
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('panel')
          .setDescription(
            'Post the button role panel.'
          )
    ),

  new SlashCommandBuilder()
    .setName('setwelcome')
    .setDescription(
      'Configure the welcome system.'
    )

    .addChannelOption(
      option =>
        option
          .setName('channel')
          .setDescription(
            'Welcome channel.'
          )
          .addChannelTypes(
            ChannelType.GuildText
          )
          .setRequired(true)
    )

    .addStringOption(
      option =>
        option
          .setName('message')
          .setDescription(
            'Use {user}, {username}, and {server}.'
          )
          .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('setautorole')
    .setDescription(
      'Set the automatic member role.'
    )

    .addRoleOption(
      option =>
        option
          .setName('role')
          .setDescription(
            'Role new members receive.'
          )
          .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('setticketstaff')
    .setDescription(
      'Set the staff role for tickets.'
    )

    .addRoleOption(
      option =>
        option
          .setName('role')
          .setDescription(
            'Staff Team role.'
          )
          .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('setbuilderrole')
    .setDescription(
      'Set the builder role for service tickets.'
    )

    .addRoleOption(
      option =>
        option
          .setName('role')
          .setDescription(
            'Builder role.'
          )
          .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('setticketcategory')
    .setDescription(
      'Set the ticket category.'
    )

    .addChannelOption(
      option =>
        option
          .setName('category')
          .setDescription(
            'Category where tickets are created.'
          )
          .addChannelTypes(
            ChannelType.GuildCategory
          )
          .setRequired(true)
    ),

  /* =====================================================
     STAFF
  ===================================================== */

  new SlashCommandBuilder()
    .setName('staff')
    .setDescription(
      'Manage TVB staff.'
    )

    .addSubcommand(
      sub =>
        sub
          .setName('hire')
          .setDescription(
            'Hire a staff member.'
          )

          .addUserOption(
            option =>
              option
                .setName('member')
                .setDescription(
                  'Member.'
                )
                .setRequired(true)
          )

          .addRoleOption(
            option =>
              option
                .setName('fromrole')
                .setDescription(
                  'Current role.'
                )
                .setRequired(true)
          )

          .addRoleOption(
            option =>
              option
                .setName('torole')
                .setDescription(
                  'New role.'
                )
                .setRequired(true)
          )

          .addStringOption(
            option =>
              option
                .setName('message')
                .setDescription(
                  'Message. Supports {user}, {server}, {fromrole}, {torole}.'
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('fire')
          .setDescription(
            'Fire a staff member.'
          )

          .addUserOption(
            option =>
              option
                .setName('member')
                .setDescription(
                  'Member.'
                )
                .setRequired(true)
          )

          .addRoleOption(
            option =>
              option
                .setName('fromrole')
                .setDescription(
                  'Current role.'
                )
                .setRequired(true)
          )

          .addRoleOption(
            option =>
              option
                .setName('torole')
                .setDescription(
                  'Role to move them to.'
                )
                .setRequired(true)
          )

          .addStringOption(
            option =>
              option
                .setName('message')
                .setDescription(
                  'Message. Supports {user}, {server}, {fromrole}, {torole}.'
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('promote')
          .setDescription(
            'Promote a staff member.'
          )

          .addUserOption(
            option =>
              option
                .setName('member')
                .setDescription(
                  'Member.'
                )
                .setRequired(true)
          )

          .addRoleOption(
            option =>
              option
                .setName('fromrole')
                .setDescription(
                  'Current role.'
                )
                .setRequired(true)
          )

          .addRoleOption(
            option =>
              option
                .setName('torole')
                .setDescription(
                  'New role.'
                )
                .setRequired(true)
          )

          .addStringOption(
            option =>
              option
                .setName('message')
                .setDescription(
                  'Message. Supports {user}, {server}, {fromrole}, {torole}.'
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('demote')
          .setDescription(
            'Demote a staff member.'
          )

          .addUserOption(
            option =>
              option
                .setName('member')
                .setDescription(
                  'Member.'
                )
                .setRequired(true)
          )

          .addRoleOption(
            option =>
              option
                .setName('fromrole')
                .setDescription(
                  'Current role.'
                )
                .setRequired(true)
          )

          .addRoleOption(
            option =>
              option
                .setName('torole')
                .setDescription(
                  'New role.'
                )
                .setRequired(true)
          )

          .addStringOption(
            option =>
              option
                .setName('message')
                .setDescription(
                  'Message. Supports {user}, {server}, {fromrole}, {torole}.'
                )
                .setRequired(true)
          )
    ),

  /* =====================================================
     BUILDER
  ===================================================== */

  new SlashCommandBuilder()
    .setName('builder')
    .setDescription(
      'Manage TVB builders.'
    )

    .addSubcommand(
      sub =>
        sub
          .setName('hire')
          .setDescription(
            'Hire a builder.'
          )

          .addUserOption(
            option =>
              option
                .setName('member')
                .setDescription(
                  'Member.'
                )
                .setRequired(true)
          )

          .addRoleOption(
            option =>
              option
                .setName('fromrole')
                .setDescription(
                  'Current role.'
                )
                .setRequired(true)
          )

          .addRoleOption(
            option =>
              option
                .setName('torole')
                .setDescription(
                  'New role.'
                )
                .setRequired(true)
          )

          .addStringOption(
            option =>
              option
                .setName('message')
                .setDescription(
                  'Message. Supports {user}, {server}, {fromrole}, {torole}.'
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('fire')
          .setDescription(
            'Fire a builder.'
          )

          .addUserOption(
            option =>
              option
                .setName('member')
                .setDescription(
                  'Member.'
                )
                .setRequired(true)
          )

          .addRoleOption(
            option =>
              option
                .setName('fromrole')
                .setDescription(
                  'Current role.'
                )
                .setRequired(true)
          )

          .addRoleOption(
            option =>
              option
                .setName('torole')
                .setDescription(
                  'New role.'
                )
                .setRequired(true)
          )

          .addStringOption(
            option =>
              option
                .setName('message')
                .setDescription(
                  'Message. Supports {user}, {server}, {fromrole}, {torole}.'
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('promote')
          .setDescription(
            'Promote a builder.'
          )

          .addUserOption(
            option =>
              option
                .setName('member')
                .setDescription(
                  'Member.'
                )
                .setRequired(true)
          )

          .addRoleOption(
            option =>
              option
                .setName('fromrole')
                .setDescription(
                  'Current role.'
                )
                .setRequired(true)
          )

          .addRoleOption(
            option =>
              option
                .setName('torole')
                .setDescription(
                  'New role.'
                )
                .setRequired(true)
          )

          .addStringOption(
            option =>
              option
                .setName('message')
                .setDescription(
                  'Message. Supports {user}, {server}, {fromrole}, {torole}.'
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('demote')
          .setDescription(
            'Demote a builder.'
          )

          .addUserOption(
            option =>
              option
                .setName('member')
                .setDescription(
                  'Member.'
                )
                .setRequired(true)
          )

          .addRoleOption(
            option =>
              option
                .setName('fromrole')
                .setDescription(
                  'Current role.'
                )
                .setRequired(true)
          )

          .addRoleOption(
            option =>
              option
                .setName('torole')
                .setDescription(
                  'New role.'
                )
                .setRequired(true)
          )

          .addStringOption(
            option =>
              option
                .setName('message')
                .setDescription(
                  'Message. Supports {user}, {server}, {fromrole}, {torole}.'
                )
                .setRequired(true)
          )
    ),

  /* =====================================================
     UPDATE
  ===================================================== */

  new SlashCommandBuilder()
    .setName('update')
    .setDescription(
      'Post a detailed TVB update.'
    )

    .addStringOption(
      option =>
        option
          .setName('type')
          .setDescription(
            'Update type.'
          )
          .setRequired(true)
          .addChoices(
            {
              name:
                'Feature',
              value:
                'feature',
            },
            {
              name:
                'Update',
              value:
                'update',
            },
            {
              name:
                'Announcement',
              value:
                'announcement',
            },
            {
              name:
                'Important',
              value:
                'important',
            }
          )
    )

    .addStringOption(
      option =>
        option
          .setName('title')
          .setDescription(
            'Update title.'
          )
          .setRequired(true)
    )

    .addStringOption(
      option =>
        option
          .setName('description')
          .setDescription(
            'Main update text.'
          )
          .setRequired(true)
    )

    .addStringOption(
      option =>
        option
          .setName('extra')
          .setDescription(
            'Extra details hidden inside || ||.'
          )
          .setRequired(false)
    ),
].map(
  command =>
    command.toJSON()
);

/* =========================================================
   COMMAND REGISTRATION
========================================================= */

async function registerCommands(
  guildId
) {
  try {
    const rest =
      new REST({
        version:
          '10',
      }).setToken(
        TOKEN
      );

    await rest.put(
      Routes.applicationGuildCommands(
        client.user.id,
        guildId
      ),
      {
        body:
          commands,
      }
    );

    console.log(
      `✅ Commands registered in ${guildId}`
    );

  } catch (error) {
    console.error(
      `❌ Could not register commands in ${guildId}:`,
      error
    );
  }
}

/* =========================================================
   PERMANENT 5-MINUTE ACTIVITY SYSTEM
========================================================= */

/*
  THIS IS ALWAYS HAPPENING WHILE THE BOT PROCESS IS RUNNING.

  Every 5 minutes:
      #bot-activity
            ↓
           "a"

  We use a self-rescheduling timeout instead of setInterval.
  This prevents multiple heartbeat loops from accidentally
  stacking on top of each other.
*/

let heartbeatTimer = null;
let heartbeatRunning = false;

async function sendHeartbeat() {
  if (heartbeatRunning) {
    console.log(
      '⏳ Heartbeat already running; skipping duplicate.'
    );

    return;
  }

  heartbeatRunning = true;

  try {
    console.log(
      `💓 Heartbeat started: ${new Date().toISOString()}`
    );

    for (
      const guild of
      client.guilds.cache.values()
    ) {
      try {
        const cfg =
          guildConfig(
            guild.id
          );

        const channelName =
          cfg.activityChannel ||
          'bot-activity';

        const channel =
          findText(
            guild,
            channelName
          );

        if (!channel) {
          console.log(
            `⚠️ #${channelName} was not found in ${guild.name}`
          );

          continue;
        }

        const me =
          guild.members.me;

        if (!me) {
          console.log(
            `⚠️ Could not find bot member in ${guild.name}`
          );

          continue;
        }

        const permissions =
          channel.permissionsFor(
            me
          );

        if (
          !permissions?.has(
            PermissionsBitField.Flags.SendMessages
          )
        ) {
          console.log(
            `⚠️ Missing Send Messages permission in #${channel.name} (${guild.name})`
          );

          continue;
        }

        await channel.send(
          'a'
        );

        console.log(
          `✅ Sent "a" in #${channel.name} (${guild.name}) at ${new Date().toISOString()}`
        );

      } catch (error) {
        console.error(
          `❌ Heartbeat failed in a guild:`,
          error
        );
      }
    }

  } catch (error) {
    console.error(
      '❌ Global heartbeat error:',
      error
    );

  } finally {
    heartbeatRunning =
      false;
  }
}

function scheduleHeartbeat() {
  if (heartbeatTimer) {
    clearTimeout(
      heartbeatTimer
    );

    heartbeatTimer =
      null;
  }

  heartbeatTimer =
    setTimeout(
      async () => {
        await sendHeartbeat();

        scheduleHeartbeat();
      },

      HEARTBEAT_INTERVAL
    );

  if (
    typeof heartbeatTimer.unref ===
    'function'
  ) {
    /*
      Do NOT unref this timer.
      The timer should help keep the Node process alive.
    */
  }
}

function startHeartbeat() {
  if (heartbeatTimer) {
    clearTimeout(
      heartbeatTimer
    );

    heartbeatTimer =
      null;
  }

  console.log(
    '💓 PERMANENT 5-MINUTE #bot-activity SYSTEM STARTED.'
  );

  console.log(
    '💓 Next "a" will be sent in 5 minutes.'
  );

  /*
    Start the timer.

    It intentionally waits 5 minutes after startup
    before sending the first heartbeat.
  */

  scheduleHeartbeat();
}

/* =========================================================
   READY
========================================================= */

client.once(
  'ready',
  async () => {
    console.log(
      `🤖 Logged in as ${client.user.tag}`
    );

    for (
      const guild of
      client.guilds.cache.values()
    ) {
      guildConfig(
        guild.id
      );

      saveConfig();

      await registerCommands(
        guild.id
      );
    }

    console.log(
      `✅ TVB Assistant ready in ${client.guilds.cache.size} server(s).`
    );

    /*
      START THE PERMANENT HEARTBEAT.
    */

    startHeartbeat();
  }
);

/* =========================================================
   NEW SERVER
========================================================= */

client.on(
  'guildCreate',
  async guild => {
    guildConfig(
      guild.id
    );

    saveConfig();

    await registerCommands(
      guild.id
    );
  }
);

/* =========================================================
   MEMBER JOIN
========================================================= */

client.on(
  'guildMemberAdd',
  async member => {
    const cfg =
      guildConfig(
        member.guild.id
      );

    /* AUTOROLE */

    if (
      cfg.autorole
    ) {
      const role =
        member.guild.roles.cache.get(
          cfg.autorole
        );

      if (
        role &&
        role.editable
      ) {
        try {
          await member.roles.add(
            role
          );
        } catch (error) {
          console.error(
            '❌ Could not assign autorole:',
            error
          );
        }
      }
    }

    /* WELCOME */

    if (
      cfg.welcomeChannel
    ) {
      const channel =
        member.guild.channels.cache.get(
          cfg.welcomeChannel
        );

      if (
        channel &&
        channel.isTextBased()
      ) {
        const message =
          replacePlaceholders(
            cfg.welcomeMessage,
            {
              user:
                member,

              server:
                member.guild,
            }
          );

        const welcomeEmbed =
          new EmbedBuilder()
            .setColor(
              0x7c5cff
            )
            .setTitle(
              '👋 Welcome!'
            )
            .setDescription(
              message
            )
            .setThumbnail(
              member.user.displayAvatarURL({
                size:
                  256,
              })
            )
            .setFooter({
              text:
                `Member #${member.guild.memberCount}`,
            })
            .setTimestamp();

        try {
          await channel.send({
            embeds: [
              welcomeEmbed,
            ],
          });
        } catch (error) {
          console.error(
            '❌ Could not send welcome:',
            error
          );
        }
      }
    }
  }
);

/* =========================================================
   MESSAGE CREATE
========================================================= */

client.on(
  'messageCreate',
  async message => {
    if (
      message.author.bot
    ) {
      return;
    }

    if (
      !message.guild
    ) {
      await handleApplicationDM(
        message
      );
    }
  }
);

/* =========================================================
   INTERACTIONS
========================================================= */

client.on(
  'interactionCreate',
  async interaction => {
    try {

      /* ===================================================
         SLASH COMMANDS
      =================================================== */

      if (
        interaction.isChatInputCommand()
      ) {
        const name =
          interaction.commandName;

        /* PING */

        if (
          name ===
          'ping'
        ) {
          return interaction.reply({
            content:
              '🏓 Pong! TVB Assistant is online.',
            ephemeral:
              true,
          });
        }

        /* PANELS */

        if (
          name ===
          'ticketpanel'
        ) {
          if (
            !manager(
              interaction
            )
          ) {
            return interaction.reply({
              content:
                '❌ You need Manage Server to use this command.',
              ephemeral:
                true,
            });
          }

          return sendTicketPanel(
            interaction
          );
        }

        if (
          name ===
          'servicepanel'
        ) {
          if (
            !manager(
              interaction
            )
          ) {
            return interaction.reply({
              content:
                '❌ You need Manage Server to use this command.',
              ephemeral:
                true,
            });
          }

          return sendServicePanel(
            interaction
          );
        }

        if (
          name ===
          'applicationpanel'
        ) {
          if (
            !manager(
              interaction
            )
          ) {
            return interaction.reply({
              content:
                '❌ You need Manage Server to use this command.',
              ephemeral:
                true,
            });
          }

          return sendApplicationPanel(
            interaction
          );
        }

        /* BUTTON ROLES */

        if (
          name ===
          'buttonrole'
        ) {
          if (
            !manager(
              interaction
            )
          ) {
            return interaction.reply({
              content:
                '❌ You need Manage Server to use this command.',
              ephemeral:
                true,
            });
          }

          const subcommand =
            interaction.options.getSubcommand();

          const cfg =
            guildConfig(
              interaction.guild.id
            );

          if (
            subcommand ===
            'add'
          ) {
            const role =
              interaction.options.getRole(
                'role'
              );

            const emoji =
              interaction.options.getString(
                'emoji'
              ) ||
              '🔘';

            if (
              !role.editable
            ) {
              return interaction.reply({
                content:
                  '❌ My bot role must be above that role.',
                ephemeral:
                  true,
              });
            }

            const existing =
              cfg.buttonRoles.find(
                item =>
                  item.roleId ===
                  role.id
              );

            if (existing) {
              existing.emoji =
                emoji;
            } else {
              cfg.buttonRoles.push({
                roleId:
                  role.id,

                emoji,
              });
            }

            saveConfig();

            return interaction.reply({
              content:
                `✅ **${role.name}** was configured for the button-role panel.`,
              ephemeral:
                true,
            });
          }

          if (
            subcommand ===
            'remove'
          ) {
            const role =
              interaction.options.getRole(
                'role'
              );

            cfg.buttonRoles =
              cfg.buttonRoles.filter(
                item =>
                  item.roleId !==
                  role.id
              );

            saveConfig();

            return interaction.reply({
              content:
                `✅ **${role.name}** was removed from the button-role panel.`,
              ephemeral:
                true,
            });
          }

          if (
            subcommand ===
            'list'
          ) {
            const list =
              cfg.buttonRoles
                .map(
                  item => {
                    const role =
                      interaction.guild.roles.cache.get(
                        item.roleId
                      );

                    return role
                      ? `${item.emoji} ${role}`
                      : null;
                  }
                )
                .filter(
                  Boolean
                );

            return interaction.reply({
              content:
                `### 🔘 Button Roles\n\n${
                  list.length
                    ? list.join(
                        '\n'
                      )
                    : 'None configured.'
                }`,
              ephemeral:
                true,
            });
          }

          if (
            subcommand ===
            'panel'
          ) {
            return sendButtonRolePanel(
              interaction
            );
          }
        }

        /* SET WELCOME */

        if (
          name ===
          'setwelcome'
        ) {
          if (
            !manager(
              interaction
            )
          ) {
            return interaction.reply({
              content:
                '❌ You need Manage Server.',
              ephemeral:
                true,
            });
          }

          const channel =
            interaction.options.getChannel(
              'channel'
            );

          const message =
            interaction.options.getString(
              'message'
            );

          const cfg =
            guildConfig(
              interaction.guild.id
            );

          cfg.welcomeChannel =
            channel.id;

          cfg.welcomeMessage =
            message;

          saveConfig();

          return interaction.reply({
            content:
              '✅ Welcome system updated!',
            ephemeral:
              true,
          });
        }

        /* SET AUTOROLE */

        if (
          name ===
          'setautorole'
        ) {
          if (
            !manager(
              interaction
            )
          ) {
            return interaction.reply({
              content:
                '❌ You need Manage Server.',
              ephemeral:
                true,
            });
          }

          const role =
            interaction.options.getRole(
              'role'
            );

          if (
            !role.editable
          ) {
            return interaction.reply({
              content:
                '❌ My bot role must be above the autorole.',
              ephemeral:
                true,
            });
          }

          const cfg =
            guildConfig(
              interaction.guild.id
            );

          cfg.autorole =
            role.id;

          saveConfig();

          return interaction.reply({
            content:
              `✅ New members will receive **${role.name}** automatically.`,
            ephemeral:
              true,
          });
        }

        /* SET TICKET STAFF */

        if (
          name ===
          'setticketstaff'
        ) {
          if (
            !manager(
              interaction
            )
          ) {
            return interaction.reply({
              content:
                '❌ You need Manage Server.',
              ephemeral:
                true,
            });
          }

          const role =
            interaction.options.getRole(
              'role'
            );

          const cfg =
            guildConfig(
              interaction.guild.id
            );

          cfg.ticketStaffRole =
            role.id;

          saveConfig();

          return interaction.reply({
            content:
              `✅ Normal tickets are now visible to ${role}.`,
            ephemeral:
              true,
          });
        }

        /* SET BUILDER ROLE */

        if (
          name ===
          'setbuilderrole'
        ) {
          if (
            !manager(
              interaction
            )
          ) {
            return interaction.reply({
              content:
                '❌ You need Manage Server.',
              ephemeral:
                true,
            });
          }

          const role =
            interaction.options.getRole(
              'role'
            );

          const cfg =
            guildConfig(
              interaction.guild.id
            );

          cfg.builderRole =
            role.id;

          saveConfig();

          return interaction.reply({
            content:
              `✅ Service tickets are now visible to ${role}.`,
            ephemeral:
              true,
          });
        }

        /* SET CATEGORY */

        if (
          name ===
          'setticketcategory'
        ) {
          if (
            !manager(
              interaction
            )
          ) {
            return interaction.reply({
              content:
                '❌ You need Manage Server.',
              ephemeral:
                true,
            });
          }

          const category =
            interaction.options.getChannel(
              'category'
            );

          const cfg =
            guildConfig(
              interaction.guild.id
            );

          cfg.ticketCategory =
            category.id;

          saveConfig();

          return interaction.reply({
            content:
              `✅ Tickets will now be created in **${category.name}**.`,
            ephemeral:
              true,
          });
        }

        /* STAFF */

        if (
          name ===
          'staff'
        ) {
          return handleTeamAction(
            interaction,
            'staff',
            interaction.options.getSubcommand()
          );
        }

        /* BUILDER */

        if (
          name ===
          'builder'
        ) {
          return handleTeamAction(
            interaction,
            'builder',
            interaction.options.getSubcommand()
          );
        }

        /* UPDATE */

        if (
          name ===
          'update'
        ) {
          if (
            !manager(
              interaction
            )
          ) {
            return interaction.reply({
              content:
                '❌ You need Manage Server.',
              ephemeral:
                true,
            });
          }

          const type =
            interaction.options.getString(
              'type'
            );

          const title =
            interaction.options.getString(
              'title'
            );

          const description =
            interaction.options.getString(
              'description'
            );

          const extra =
            interaction.options.getString(
              'extra'
            );

          const cfg =
            guildConfig(
              interaction.guild.id
            );

          const updatesRole =
            cfg.updatesRole
              ? interaction.guild.roles.cache.get(
                  cfg.updatesRole
                )
              : findRoleByNames(
                  interaction.guild,
                  [
                    'updates',
                  ]
                );

          let content =
            '';

          let allowedMentions = {
            parse: [],
          };

          if (
            updatesRole
          ) {
            content =
              `||${updatesRole}||`;

            allowedMentions = {
              roles: [
                updatesRole.id,
              ],
            };
          } else {
            content =
              '||@updates||';
          }

          await interaction.channel.send({
            content,

            allowedMentions,

            embeds: [
              updateEmbed(
                type,
                title,
                description,
                extra
              ),
            ],
          });

          return interaction.reply({
            content:
              '✅ Update posted!',
            ephemeral:
              true,
          });
        }
      }

      /* ===================================================
         TICKET SELECT
      =================================================== */

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          'ticket-select'
      ) {
        const type =
          interaction.values[0];

        if (
          !TICKETS[type]
        ) {
          return interaction.reply({
            content:
              '❌ Invalid ticket type.',
            ephemeral:
              true,
          });
        }

        return interaction.showModal(
          ticketModal(
            type
          )
        );
      }

      /* ===================================================
         SERVICE SELECT
      =================================================== */

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          'service-select'
      ) {
        const type =
          interaction.values[0];

        if (
          !SERVICES[type]
        ) {
          return interaction.reply({
            content:
              '❌ Invalid service type.',
            ephemeral:
              true,
          });
        }

        return interaction.showModal(
          serviceModal(
            type
          )
        );
      }

      /* ===================================================
         APPLICATION SELECT
      =================================================== */

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          'application-select'
      ) {
        const type =
          interaction.values[0];

        return startApplication(
          interaction,
          type
        );
      }

      /* ===================================================
         TICKET MODAL
      =================================================== */

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'ticket-modal-'
        )
      ) {
        const type =
          interaction.customId.slice(
            'ticket-modal-'.length
          );

        const ticket =
          TICKETS[type];

        if (!ticket) {
          return interaction.reply({
            content:
              '❌ Invalid ticket type.',
            ephemeral:
              true,
          });
        }

        const answers =
          ticket.q.map(
            (_question, index) =>
              interaction.fields.getTextInputValue(
                `answer-${index}`
              )
          );

        return createTicket(
          interaction,
          type,
          answers
        );
      }

      /* ===================================================
         SERVICE MODAL
      =================================================== */

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'service-modal-'
        )
      ) {
        const type =
          interaction.customId.slice(
            'service-modal-'.length
          );

        if (
          !SERVICES[type]
        ) {
          return interaction.reply({
            content:
              '❌ Invalid service type.',
            ephemeral:
              true,
          });
        }

        return createServiceTicket(
          interaction,
          type,
          {
            lookingFor:
              interaction.fields.getTextInputValue(
                'service-looking'
              ),

            price:
              interaction.fields.getTextInputValue(
                'service-price'
              ),

            addons:
              interaction.fields.getTextInputValue(
                'service-addons'
              ),
          }
        );
      }

      /* ===================================================
         ROLE BUTTON
      =================================================== */

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'role-'
        )
      ) {
        return toggleButtonRole(
          interaction
        );
      }

      /* ===================================================
         CLOSE TICKET
      =================================================== */

      if (
        interaction.isButton() &&
        interaction.customId ===
          'ticket-close'
      ) {
        return closeTicket(
          interaction
        );
      }

      /* ===================================================
         APPLICATION BUTTON
      =================================================== */

      if (
        interaction.isButton() &&
        (
          interaction.customId.startsWith(
            'app-accept-'
          ) ||
          interaction.customId.startsWith(
            'app-deny-'
          ) ||
          interaction.customId.startsWith(
            'app-blacklist-'
          )
        )
      ) {
        return handleApplicationAction(
          interaction
        );
      }

    } catch (error) {
      console.error(
        '❌ Interaction error:',
        error
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {
        await interaction.reply({
          content:
            '❌ Something went wrong while processing that.',
          ephemeral:
            true,
        }).catch(
          () => {}
        );
      }
    }
  }
);

/* =========================================================
   PROCESS ERROR HANDLING
========================================================= */

process.on(
  'unhandledRejection',
  error => {
    console.error(
      '❌ Unhandled promise rejection:',
      error
    );
  }
);

process.on(
  'uncaughtException',
  error => {
    console.error(
      '❌ Uncaught exception:',
      error
    );
  }
);

/* =========================================================
   LOGIN
========================================================= */

client.login(
  TOKEN
).catch(
  error => {
    console.error(
      '❌ Discord login failed:',
      error
    );

    process.exit(1);
  }
);
