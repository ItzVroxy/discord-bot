const express = require('express');

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
  TextInputStyle
} = require('discord.js');

const fs = require('fs');

// ============================================================
// CONFIG
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error('Missing DISCORD_TOKEN environment variable.');
  process.exit(1);
}

const PORT = process.env.PORT || 10000;

const app = express();

app.get('/', (_req, res) => {
  res.status(200).send('TVB Assistant is online.');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Web server listening on ${PORT}`);
});

// ============================================================
// DISCORD CLIENT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],

  partials: [
    Partials.Channel
  ]
});

// ============================================================
// CONFIG FILE
// ============================================================

const CONFIG_FILE = './config.json';

let config = {};

try {
  if (fs.existsSync(CONFIG_FILE)) {
    config = JSON.parse(
      fs.readFileSync(CONFIG_FILE, 'utf8')
    );
  }
} catch (error) {
  console.error('Could not load config:', error);
}

function saveConfig() {
  try {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(config, null, 2)
    );
  } catch (error) {
    console.error('Could not save config:', error);
  }
}

function guildConfig(id) {
  if (!config[id]) {
    config[id] = {
      welcomeChannel: null,

      welcomeMessage:
        'Welcome {user} to **{server}**! 🎉',

      autorole: null,

      ticketCategory: null,

      ticketStaffRole: null,

      buttonRoles: []
    };
  }

  const c = config[id];

  if (!Array.isArray(c.buttonRoles)) {
    c.buttonRoles = [];
  }

  return c;
}

// ============================================================
// PERMISSIONS
// ============================================================

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

// ============================================================
// UTILITIES
// ============================================================

function safe(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60) || 'user';
}

function embed(
  title,
  description,
  color = 0x7c5cff
) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({
      text: 'TVB Assistant'
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

// ============================================================
// ROLE HELPER
// ============================================================

async function createRoleIfMissing(guild, name) {
  const existing = guild.roles.cache.find(
    role =>
      role.name.toLowerCase() ===
      name.toLowerCase()
  );

  if (existing) {
    return existing;
  }

  return guild.roles.create({
    name,
    reason: 'TVB Assistant team system'
  });
}

// ============================================================
// TICKETS
// ============================================================

const TICKETS = {
  general: {
    label: 'General Support',
    emoji: '💬',
    desc: 'Questions, help, bugs, or anything else.',

    q: [
      'What do you need help with?',
      'Please describe the situation in as much detail as possible.',
      'Which server, channel, feature, or system is this regarding?',
      'What troubleshooting steps have you already attempted?',
      'Is there any additional information or evidence that may help staff?'
    ]
  },

  purchase: {
    label: 'Purchase Support',
    emoji: '🛒',
    desc: 'Purchases, payments, orders, or missing items.',

    q: [
      'What product or service did you purchase?',
      'Approximately when was the purchase made?',
      'Please explain the issue you encountered.',
      'Do you have an order, transaction, or payment ID?',
      'What resolution are you requesting from our support team?'
    ]
  },

  player: {
    label: 'Player Report',
    emoji: '🚨',
    desc: 'Report cheating, rule breaking, or another player.',

    q: [
      'What is the username of the player being reported?',
      'Please provide a detailed description of what occurred.',
      'When and where did the incident take place?',
      'Do you have screenshots, video, logs, or other evidence?',
      'Is there anything else staff should consider when reviewing this report?'
    ]
  },

  staff: {
    label: 'Staff Report',
    emoji: '🛡️',
    desc: 'Report a concern involving a staff member.',

    q: [
      'Which staff member is this report concerning?',
      'Please provide a factual and detailed description of what occurred.',
      'When and where did the incident take place?',
      'Do you have screenshots, recordings, messages, or other supporting evidence?',
      'What outcome or resolution would you consider appropriate?'
    ]
  }
};

// ============================================================
// APPLICATIONS
// ============================================================

const APPS = {
  builder: {
    label: 'Builder Application',
    emoji: '🧱',

    channel: '📋・builder-submissions',

    q: [
      'What is your Minecraft username?',
      'How old are you?',
      'What timezone are you located in?',
      'How long have you been actively building in Minecraft?',
      'Which building styles and architectural themes are you most experienced with?',
      'Which building project are you most proud of, and what made it successful?',
      'What types of structures or environments do you enjoy designing most?',
      'What building techniques or areas are you currently working to improve?',
      'Approximately how many hours per week can you consistently dedicate to building?',
      'Why are you interested in contributing to the TVB building team?',
      'How do you respond when another team member provides critical feedback on your work?',
      'Do you generally work more effectively independently or as part of a coordinated team, and why?',
      'Please provide screenshots, links, or other examples of your previous builds.',
      'What specific characteristics separate an average Minecraft build from an exceptional one?',
      'How would you handle a situation where your design vision conflicts with the direction established by the project lead?'
    ]
  },

  staff: {
    label: 'Staff Application',
    emoji: '🛡️',

    channel: '📋・staff-submissions',

    q: [
      'What is your Discord username and Minecraft username?',
      'How old are you?',
      'What timezone are you located in?',
      'How long have you been an active member of the TVB community?',
      'Have you previously held a moderation or administrative position? If so, briefly describe your responsibilities and experience.',
      'What does effective moderation mean to you, and what principles should guide a staff member when making decisions?',
      'Why are you interested in joining the TVB staff team specifically?',
      'What qualities do you believe distinguish an exceptional staff member from an average one?',
      'How would you approach a disagreement between two community members when both individuals believe they are justified?',
      'How would you handle a situation in which a close friend or teammate violates a server rule?',
      'If a member repeatedly ignores warnings and continues violating the rules, how would you determine the appropriate next step?',
      'A player submits a report containing conflicting or incomplete information. How would you investigate the situation before taking action?',
      'How would you protect confidential staff discussions, internal information, and evidence while still maintaining transparency with the community when appropriate?',
      'What strengths, skills, or perspectives would you bring to the TVB staff team that you believe would make a meaningful difference?',
      'What is one area of your communication, leadership, judgment, or moderation ability that you are actively working to improve?'
    ]
  }
};

// ============================================================
// SESSION STORAGE
// ============================================================

const appSessions = new Map();

// ============================================================
// TICKET MENU
// ============================================================

function ticketMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket-select')
      .setPlaceholder(
        '🎫 Select support type...'
      )
      .addOptions(
        Object.entries(TICKETS).map(
          ([value, ticket]) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(ticket.label)
              .setValue(value)
              .setEmoji(ticket.emoji)
              .setDescription(ticket.desc)
        )
      )
  );
}

// ============================================================
// APPLICATION MENU
// ============================================================

function appMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('application-select')
      .setPlaceholder(
        '📋 Choose an application...'
      )
      .addOptions(
        Object.entries(APPS).map(
          ([value, application]) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(application.label)
              .setValue(value)
              .setEmoji(application.emoji)
              .setDescription(
                '15 questions • completed privately in DMs'
              )
        )
      )
  );
}

// ============================================================
// TICKET MODAL
// ============================================================

function ticketModal(type) {
  const ticket = TICKETS[type];

  const modal = new ModalBuilder()
    .setCustomId(`ticket-modal-${type}`)
    .setTitle(ticket.label);

  const components = [];

  for (let i = 0; i < ticket.q.length; i++) {
    const input = new TextInputBuilder()
      .setCustomId(`ticket-answer-${i}`)
      .setLabel(
        ticket.q[i].slice(0, 45)
      )
      .setStyle(
        i === 0
          ? TextInputStyle.Short
          : TextInputStyle.Paragraph
      )
      .setRequired(true)
      .setMaxLength(1000)
      .setPlaceholder(
        'Please provide a detailed answer...'
      );

    components.push(
      new ActionRowBuilder().addComponents(input)
    );
  }

  modal.addComponents(components);

  return modal;
}

// ============================================================
// CREATE TICKET
// ============================================================

async function createTicket(
  interaction,
  type,
  answers
) {
  const guild = interaction.guild;
  const member = interaction.member;

  const cfg = guildConfig(guild.id);
  const ticket = TICKETS[type];

  if (!ticket) {
    return interaction.reply({
      content: '❌ Invalid ticket type.',
      ephemeral: true
    });
  }

  const existing = guild.channels.cache.find(
    channel =>
      channel.type === ChannelType.GuildText &&
      channel.topic ===
        `TVB-TICKET:${member.id}`
  );

  if (existing) {
    return interaction.reply({
      content:
        `❌ You already have an open ticket: ${existing}`,
      ephemeral: true
    });
  }

  const staffRole = cfg.ticketStaffRole
    ? guild.roles.cache.get(
        cfg.ticketStaffRole
      )
    : null;

  const overwrites = [
    {
      id: guild.roles.everyone.id,

      deny: [
        PermissionsBitField.Flags.ViewChannel
      ]
    },

    {
      id: member.id,

      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    }
  ];

  if (staffRole) {
    overwrites.push({
      id: staffRole.id,

      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageMessages
      ]
    });
  }

  // Make sure the bot itself can see/manage the ticket.
  if (guild.members.me) {
    overwrites.push({
      id: guild.members.me.id,

      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ManageMessages
      ]
    });
  }

  let channel;

  try {
    channel = await guild.channels.create({
      name: `${type}-${safe(member.user.username)}`,
      type: ChannelType.GuildText,
      parent: cfg.ticketCategory || null,
      topic: `TVB-TICKET:${member.id}`,
      permissionOverwrites: overwrites,

      reason:
        `TVB Assistant • ${ticket.label}`
    });
  } catch (error) {
    console.error(
      'Could not create ticket:',
      error
    );

    return interaction.reply({
      content:
        '❌ I could not create the ticket. Please make sure I have **Manage Channels** and **Manage Permissions**.',
      ephemeral: true
    });
  }

  const answerText = ticket.q
    .map(
      (question, index) =>
        `**${index + 1}. ${question}**\n> ${
          answers[index] ||
          'No answer provided.'
        }`
    )
    .join('\n\n');

  const ticketEmbed = embed(
    `${ticket.emoji} ${ticket.label}`,
    [
      `Welcome ${member}!`,
      '',
      `**${ticket.desc}**`,
      '',
      'Your ticket has been created.',
      'A member of the support team will review your request.',
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '',
      answerText
    ].join('\n')
  );

  const buttons =
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket-close')
        .setLabel('Close Ticket')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger)
    );

  try {
    await channel.send({
      content:
        `${member}${
          staffRole
            ? ` ${staffRole}`
            : ''
        }`,

      embeds: [
        ticketEmbed
      ],

      components: [
        buttons
      ]
    });
  } catch (error) {
    console.error(
      'Could not send ticket message:',
      error
    );
  }

  return interaction.reply({
    content:
      `✅ Your ticket has been created: ${channel}`,
    ephemeral: true
  });
}

// ============================================================
// CLOSE TICKET
// ============================================================

async function closeTicket(interaction) {
  const channel =
    interaction.channel;

  if (
    !channel ||
    channel.type !== ChannelType.GuildText
  ) {
    return interaction.reply({
      content:
        '❌ This is not a valid ticket channel.',
      ephemeral: true
    });
  }

  if (
    !channel.topic ||
    !channel.topic.startsWith(
      'TVB-TICKET:'
    )
  ) {
    return interaction.reply({
      content:
        "⚠️ This isn't an active TVB ticket.",
      ephemeral: true
    });
  }

  const creatorId =
    channel.topic.replace(
      'TVB-TICKET:',
      ''
    );

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
    creatorId !== interaction.user.id &&
    !isStaff &&
    !moderator(interaction)
  ) {
    return interaction.reply({
      content:
        '❌ Only the ticket creator or ticket staff can close this ticket.',
      ephemeral: true
    });
  }

  await interaction.reply({
    content:
      '🔒 Closing this ticket in **5 seconds**...'
  });

  setTimeout(async () => {
    try {
      await channel.delete(
        'TVB Assistant ticket closed'
      );
    } catch (error) {
      console.error(
        'Could not delete ticket:',
        error
      );
    }
  }, 5000);
}

// ============================================================
// TICKET PANEL
// ============================================================

async function sendTicketPanel(interaction) {
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
          'Select an option below to get started.'
        ].join('\n')
      )
      .setFooter({
        text:
          'TVB Assistant • Support Center'
      })
      .setTimestamp();

  await interaction.channel.send({
    embeds: [
      panel
    ],

    components: [
      ticketMenu()
    ]
  });

  return interaction.reply({
    content:
      '✅ Ticket panel posted!',
    ephemeral: true
  });
}

// ============================================================
// APPLICATION START
// ============================================================

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
      ephemeral: true
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
      ephemeral: true
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

      questionIndex: 0,

      answers: []
    };

    appSessions.set(
      interaction.user.id,
      session
    );

    await interaction.reply({
      content:
        `📋 **${application.label} started!**\n\nI've sent you a DM with your questions.\n\n⚠️ Make sure your Discord DMs are enabled.`,
      ephemeral: true
    });

    await dm.send({
      embeds: [
        embed(
          `${application.emoji} ${application.label}`,

          [
            `Welcome to the **${application.label}**!`,
            '',
            'You will answer **15 questions**, one at a time.',
            '',
            '📝 Answer each question honestly and thoughtfully.',
            '💬 Type your answer normally.',
            '❌ Type `cancel` at any time to stop.',
            '',
            "Let's get started!"
          ].join('\n')
        )
      ]
    });

    await sendNextApplicationQuestion(
      dm,
      session
    );
  } catch (error) {
    console.error(
      'Could not start application:',
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
        ephemeral: true
      }).catch(() => {});
    }
  }
}

// ============================================================
// APPLICATION QUESTIONS
// ============================================================

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
      embed(
        `${application.emoji} ${application.label}`,

        [
          `### Question ${
            session.questionIndex + 1
          } of ${application.q.length}`,
          '',
          question,
          '',
          '💡 Take your time and provide a thoughtful answer.',
          '❌ Type `cancel` to stop.'
        ].join('\n')
      )
    ]
  });
}

// ============================================================
// FINISH APPLICATION
// ============================================================

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
          embed(
            '❌ Application Finished',

            [
              'Your application was completed,',
              `but I couldn't find **#${application.channel}**.`,
              '',
              'Please contact a server administrator.'
            ].join('\n'),

            0xed4245
          )
        ]
      });

      appSessions.delete(
        session.userId
      );

      return;
    }

    await submissionChannel.send({
      embeds: [
        embed(
          `${application.emoji} New ${application.label}`,

          [
            `**Applicant:** ${member}`,
            `**Username:** ${member.user.tag}`,
            `**User ID:** ${member.id}`,
            '',
            '📋 **Application Submitted**',
            '',
            'The following responses were submitted:'
          ].join('\n')
        )
      ]
    });

    for (
      let i = 0;
      i < application.q.length;
      i++
    ) {
      await submissionChannel.send({
        embeds: [
          embed(
            `Question ${i + 1} • ${application.label}`,

            [
              `**${application.q[i]}**`,
              '',
              session.answers[i] ||
                'No answer provided.'
            ].join('\n')
          )
        ]
      });
    }

    await dm.send({
      embeds: [
        embed(
          '✅ Application Submitted!',

          [
            `Your **${application.label}** has been submitted successfully.`,
            '',
            'The TVB team will review your application.',
            '',
            'Thank you for taking the time to apply! 💙'
          ].join('\n'),

          0x57f287
        )
      ]
    });

    appSessions.delete(
      session.userId
    );
  } catch (error) {
    console.error(
      'Could not finish application:',
      error
    );

    await dm.send({
      content:
        '❌ Something went wrong while submitting your application. Please contact staff.'
    }).catch(() => {});

    appSessions.delete(
      session.userId
    );
  }
}

// ============================================================
// APPLICATION DM HANDLER
// ============================================================

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
        embed(
          '❌ Application Cancelled',

          'Your application has been cancelled. You can start a new one from the server whenever you are ready.',

          0xed4245
        )
      ]
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
          `✅ **Answer ${session.questionIndex}/${APPS[session.type].q.length} saved!**`
        )
    ]
  });

  await sendNextApplicationQuestion(
    message.channel,
    session
  );
}

// ============================================================
// APPLICATION PANEL
// ============================================================

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
          'Help create amazing builds and projects.',
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
          'Select an application below to begin.'
        ].join('\n')
      )
      .setFooter({
        text:
          'TVB Assistant • Applications'
      })
      .setTimestamp();

  await interaction.channel.send({
    embeds: [
      panel
    ],

    components: [
      appMenu()
    ]
  });

  return interaction.reply({
    content:
      '✅ Application panel posted!',
    ephemeral: true
  });
}

// ============================================================
// EMOJI PARSER
// ============================================================

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
      name: match[1],
      id: match[2],
      animated:
        input.startsWith('<a:')
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

// ============================================================
// BUTTON ROLE
// ============================================================

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
        name: parsed.name,
        id: parsed.id,
        animated:
          parsed.animated
      });
    }
  }

  return button;
}

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
      ephemeral: true
    });
  }

  const rows = [];

  let row =
    new ActionRowBuilder();

  for (
    let i = 0;
    i < cfg.buttonRoles.length;
    i++
  ) {
    const item =
      cfg.buttonRoles[i];

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
      row.components.length === 5
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
      ephemeral: true
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
          '✨ You can change your roles whenever you want.'
        ].join('\n')
      )
      .setFooter({
        text:
          'TVB Assistant • Button Roles'
      });

  await interaction.channel.send({
    embeds: [
      panel
    ],
    components: rows
  });

  return interaction.reply({
    content:
      '✅ Button-role panel posted!',
    ephemeral: true
  });
}

// ============================================================
// TOGGLE BUTTON ROLE
// ============================================================

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
      ephemeral: true
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
      ephemeral: true
    });
  }

  if (
    role.managed
  ) {
    return interaction.reply({
      content:
        '❌ That role is managed by Discord/integration and cannot be assigned by the bot.',
      ephemeral: true
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
        ephemeral: true
      });
    }

    await interaction.member.roles.add(
      role
    );

    return interaction.reply({
      content:
        `➕ Added **${role.name}** to you!`,
      ephemeral: true
    });
  } catch (error) {
    console.error(
      'Button role error:',
      error
    );

    return interaction.reply({
      content:
        "❌ I couldn't change that role. Check my bot permissions and role position.",
      ephemeral: true
    });
  }
}

// ============================================================
// UPDATE EMBED
// ============================================================

function updateEmbed(
  type,
  title,
  description,
  extra
) {
  const colors = {
    info: 0x5865f2,
    success: 0x57f287,
    warning: 0xfee75c,
    danger: 0xed4245
  };

  const color =
    colors[type] ||
    colors.info;

  const parts = [];

  if (description) {
    parts.push(
      description
    );
  }

  if (extra) {
    parts.push(
      '',
      extra
    );
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(
      title || '📢 TVB Update'
    )
    .setDescription(
      parts.join('\n')
    )
    .setFooter({
      text:
        'TVB Assistant • Updates'
    })
    .setTimestamp();
}

// ============================================================
// COMMANDS
// ============================================================

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
    .setName('applicationpanel')
    .setDescription(
      'Post the TVB application panel.'
    ),

  new SlashCommandBuilder()
    .setName('buttonrole')
    .setDescription(
      'Manage button roles.'
    )

    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription(
          'Add a role to the button panel.'
        )

        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription(
              'The role to give.'
            )
            .setRequired(true)
        )

        .addStringOption(option =>
          option
            .setName('emoji')
            .setDescription(
              'Emoji to display on the button.'
            )
            .setRequired(false)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription(
          'Remove a role from the button panel.'
        )

        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription(
              'The role to remove.'
            )
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('panel')
        .setDescription(
          'Post the button-role panel.'
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription(
          'Show configured button roles.'
        )
    ),

  new SlashCommandBuilder()
    .setName('setwelcome')
    .setDescription(
      'Configure the welcome system.'
    )

    .addChannelOption(option =>
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

    .addStringOption(option =>
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

    .addRoleOption(option =>
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
      'Set the ticket staff role.'
    )

    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription(
          'Role that can see tickets.'
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('setticketcategory')
    .setDescription(
      'Set the ticket category.'
    )

    .addChannelOption(option =>
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

  new SlashCommandBuilder()
    .setName('staff')
    .setDescription(
      'Manage the staff system.'
    )

    .addSubcommand(sub =>
      sub
        .setName('application')
        .setDescription(
          'Start the staff application.'
        )
    ),

  new SlashCommandBuilder()
    .setName('builder')
    .setDescription(
      'Manage the builder system.'
    )

    .addSubcommand(sub =>
      sub
        .setName('application')
        .setDescription(
          'Start the builder application.'
        )
    ),

  new SlashCommandBuilder()
    .setName('update')
    .setDescription(
      'Post a server update.'
    )

    .addStringOption(option =>
      option
        .setName('type')
        .setDescription(
          'Update type.'
        )
        .addChoices(
          {
            name: 'Info',
            value: 'info'
          },
          {
            name: 'Success',
            value: 'success'
          },
          {
            name: 'Warning',
            value: 'warning'
          },
          {
            name: 'Danger',
            value: 'danger'
          }
        )
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('title')
        .setDescription(
          'Update title.'
        )
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('description')
        .setDescription(
          'Update description.'
        )
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('extra')
        .setDescription(
          'Optional additional information.'
        )
        .setRequired(false)
    )

].map(command =>
  command.toJSON()
);

// ============================================================
// REGISTER COMMANDS
// ============================================================

async function registerCommands(
  guildId
) {
  try {
    const rest =
      new REST({
        version: '10'
      }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(
        client.user.id,
        guildId
      ),
      {
        body: commands
      }
    );

    console.log(
      `Registered commands in ${guildId}`
    );
  } catch (error) {
    console.error(
      `Could not register commands in ${guildId}:`,
      error
    );
  }
}

// ============================================================
// READY
// ============================================================

client.once(
  'ready',
  async () => {
    console.log(
      `Logged in as ${client.user.tag}`
    );

    for (
      const guild of client.guilds.cache.values()
    ) {
      await registerCommands(
        guild.id
      );
    }

    console.log(
      `TVB Assistant is ready in ${client.guilds.cache.size} server(s).`
    );
  }
);

// ============================================================
// NEW SERVER
// ============================================================

client.on(
  'guildCreate',
  async guild => {
    await registerCommands(
      guild.id
    );
  }
);

// ============================================================
// MEMBER JOIN
// ============================================================

client.on(
  'guildMemberAdd',
  async member => {
    const cfg =
      guildConfig(
        member.guild.id
      );

    // --------------------------------------------------------
    // AUTOROLE
    // --------------------------------------------------------

    if (cfg.autorole) {
      const role =
        member.guild.roles.cache.get(
          cfg.autorole
        );

      if (
        role &&
        !role.managed
      ) {
        const botMember =
          member.guild.members.me;

        if (
          botMember &&
          role.position <
            botMember.roles.highest.position
        ) {
          try {
            await member.roles.add(
              role
            );
          } catch (error) {
            console.error(
              'Could not assign autorole:',
              error
            );
          }
        } else {
          console.error(
            `Cannot assign autorole "${role.name}" because it is above the bot's highest role.`
          );
        }
      }
    }

    // --------------------------------------------------------
    // WELCOME MESSAGE
    // --------------------------------------------------------

    if (cfg.welcomeChannel) {
      const channel =
        member.guild.channels.cache.get(
          cfg.welcomeChannel
        );

      if (
        channel &&
        channel.isTextBased()
      ) {
        const message =
          cfg.welcomeMessage
            .replace(
              /\{user\}/gi,
              `${member}`
            )
            .replace(
              /\{username\}/gi,
              member.user.username
            )
            .replace(
              /\{server\}/gi,
              member.guild.name
            );

        const welcomeEmbed =
          new EmbedBuilder()
            .setColor(0x7c5cff)
            .setTitle(
              '👋 Welcome!'
            )
            .setDescription(
              message
            )
            .setThumbnail(
              member.user.displayAvatarURL({
                size: 256
              })
            )
            .setFooter({
              text:
                `Member #${member.guild.memberCount}`
            })
            .setTimestamp();

        try {
          await channel.send({
            embeds: [
              welcomeEmbed
            ]
          });
        } catch (error) {
          console.error(
            'Could not send welcome message:',
            error
          );
        }
      }
    }
  }
);

// ============================================================
// MESSAGE CREATE
// ============================================================

client.on(
  'messageCreate',
  async message => {
    if (message.author.bot) {
      return;
    }

    if (!message.guild) {
      await handleApplicationDM(
        message
      );
    }
  }
);

// ============================================================
// INTERACTIONS
// ============================================================

client.on(
  'interactionCreate',
  async interaction => {
    try {

      // ======================================================
      // SLASH COMMANDS
      // ======================================================

      if (
        interaction.isChatInputCommand()
      ) {

        // ----------------------------------------------------
        // PING
        // ----------------------------------------------------

        if (
          interaction.commandName ===
          'ping'
        ) {
          return interaction.reply({
            content:
              '🏓 Pong! TVB Assistant is online.',
            ephemeral: true
          });
        }

        // ----------------------------------------------------
        // TICKET PANEL
        // ----------------------------------------------------

        if (
          interaction.commandName ===
          'ticketpanel'
        ) {
          if (
            !manager(interaction)
          ) {
            return interaction.reply({
              content:
                '❌ You need **Manage Server** or **Manage Roles** to use this command.',
              ephemeral: true
            });
          }

          return sendTicketPanel(
            interaction
          );
        }

        // ----------------------------------------------------
        // APPLICATION PANEL
        // ----------------------------------------------------

        if (
          interaction.commandName ===
          'applicationpanel'
        ) {
          if (
            !manager(interaction)
          ) {
            return interaction.reply({
              content:
                '❌ You need **Manage Server** or **Manage Roles** to use this command.',
              ephemeral: true
            });
          }

          return sendApplicationPanel(
            interaction
          );
        }

        // ----------------------------------------------------
        // BUTTON ROLE
        // ----------------------------------------------------

        if (
          interaction.commandName ===
          'buttonrole'
        ) {
          if (
            !manager(interaction)
          ) {
            return interaction.reply({
              content:
                '❌ You need **Manage Server** or **Manage Roles** to use this command.',
              ephemeral: true
            });
          }

          const subcommand =
            interaction.options.getSubcommand();

          const cfg =
            guildConfig(
              interaction.guild.id
            );

          // ADD
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
              ) || '🔘';

            const botMember =
              interaction.guild.members.me;

            if (
              !botMember ||
              role.position >=
                botMember.roles.highest.position
            ) {
              return interaction.reply({
                content:
                  '❌ My bot role must be above that role.',
                ephemeral: true
              });
            }

            if (role.managed) {
              return interaction.reply({
                content:
                  '❌ That role is managed by Discord/integration and cannot be assigned.',
                ephemeral: true
              });
            }

            const existing =
              cfg.buttonRoles.find(
                r =>
                  r.roleId ===
                  role.id
              );

            if (existing) {
              existing.emoji =
                emoji;
            } else {
              cfg.buttonRoles.push({
                roleId:
                  role.id,
                emoji
              });
            }

            saveConfig();

            return interaction.reply({
              content:
                `✅ **${role.name}** was added to the button-role list with ${emoji}.`,
              ephemeral: true
            });
          }

          // REMOVE
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
                r =>
                  r.roleId !==
                  role.id
              );

            saveConfig();

            return interaction.reply({
              content:
                `✅ **${role.name}** was removed from the button-role list.`,
              ephemeral: true
            });
          }

          // PANEL
          if (
            subcommand ===
            'panel'
          ) {
            return sendButtonRolePanel(
              interaction
            );
          }

          // LIST
          if (
            subcommand ===
            'list'
          ) {
            if (
              !cfg.buttonRoles.length
            ) {
              return interaction.reply({
                content:
                  'There are currently no button roles configured.',
                ephemeral: true
              });
            }

            const list =
              cfg.buttonRoles
                .map(item => {
                  const role =
                    interaction.guild.roles.cache.get(
                      item.roleId
                    );

                  return role
                    ? `${item.emoji} ${role}`
                    : null;
                })
                .filter(Boolean)
                .join('\n');

            return interaction.reply({
              content:
                `### 🔘 Button Roles\n\n${list || 'None'}`,
              ephemeral: true
            });
          }
        }

        // ----------------------------------------------------
        // SET WELCOME
        // ----------------------------------------------------

        if (
          interaction.commandName ===
          'setwelcome'
        ) {
          if (
            !manager(interaction)
          ) {
            return interaction.reply({
              content:
                '❌ You need **Manage Server** or **Manage Roles** to use this command.',
              ephemeral: true
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
            ephemeral: true
          });
        }

        // ----------------------------------------------------
        // SET AUTOROLE
        // ----------------------------------------------------

        if (
          interaction.commandName ===
          'setautorole'
        ) {
          if (
            !manager(interaction)
          ) {
            return interaction.reply({
              content:
                '❌ You need **Manage Server** or **Manage Roles** to use this command.',
              ephemeral: true
            });
          }

          const role =
            interaction.options.getRole(
              'role'
            );

          const botMember =
            interaction.guild.members.me;

          if (
            !botMember ||
            role.position >=
              botMember.roles.highest.position
          ) {
            return interaction.reply({
              content:
                '❌ My bot role must be above the autorole.',
              ephemeral: true
            });
          }

          if (role.managed) {
            return interaction.reply({
              content:
                '❌ That role is managed by Discord/integration and cannot be assigned.',
              ephemeral: true
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
              `✅ New members will now receive **${role.name}** automatically.`,
            ephemeral: true
          });
        }

        // ----------------------------------------------------
        // SET TICKET STAFF
        // ----------------------------------------------------

        if (
          interaction.commandName ===
          'setticketstaff'
        ) {
          if (
            !manager(interaction)
          ) {
            return interaction.reply({
              content:
                '❌ You need **Manage Server** or **Manage Roles** to use this command.',
              ephemeral: true
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
              `✅ Ticket staff role set to ${role}.`,
            ephemeral: true
          });
        }

        // ----------------------------------------------------
        // SET TICKET CATEGORY
        // ----------------------------------------------------

        if (
          interaction.commandName ===
          'setticketcategory'
        ) {
          if (
            !manager(interaction)
          ) {
            return interaction.reply({
              content:
                '❌ You need **Manage Server** or **Manage Roles** to use this command.',
              ephemeral: true
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
              `✅ New tickets will now be created in **${category.name}**.`,
            ephemeral: true
          });
        }

        // ----------------------------------------------------
        // STAFF APPLICATION
        // ----------------------------------------------------

        if (
          interaction.commandName ===
          'staff'
        ) {
          const subcommand =
            interaction.options.getSubcommand();

          if (
            subcommand ===
            'application'
          ) {
            return startApplication(
              interaction,
              'staff'
            );
          }
        }

        // ----------------------------------------------------
        // BUILDER APPLICATION
        // ----------------------------------------------------

        if (
          interaction.commandName ===
          'builder'
        ) {
          const subcommand =
            interaction.options.getSubcommand();

          if (
            subcommand ===
            'application'
          ) {
            return startApplication(
              interaction,
              'builder'
            );
          }
        }

        // ----------------------------------------------------
        // UPDATE
        // ----------------------------------------------------

        if (
          interaction.commandName ===
          'update'
        ) {
          if (
            !manager(interaction)
          ) {
            return interaction.reply({
              content:
                '❌ You need **Manage Server** or **Manage Roles** to use this command.',
              ephemeral: true
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

          await interaction.channel.send({
            embeds: [
              updateEmbed(
                type,
                title,
                description,
                extra
              )
            ]
          });

          return interaction.reply({
            content:
              '✅ Update posted!',
            ephemeral: true
          });
        }
      }

      // ======================================================
      // TICKET DROPDOWN
      // ======================================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          'ticket-select'
      ) {
        const type =
          interaction.values[0];

        if (!TICKETS[type]) {
          return interaction.reply({
            content:
              '❌ Invalid ticket type.',
            ephemeral: true
          });
        }

        /*
         * THIS IS THE POPUP YOU WANTED.
         *
         * User selects General/Purchase/Report/etc.
         * Discord immediately opens a modal containing
         * the five questions.
         */

        return interaction.showModal(
          ticketModal(type)
        );
      }

      // ======================================================
      // TICKET MODAL SUBMISSION
      // ======================================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'ticket-modal-'
        )
      ) {
        const type =
          interaction.customId.replace(
            'ticket-modal-',
            ''
          );

        const ticket =
          TICKETS[type];

        if (!ticket) {
          return interaction.reply({
            content:
              '❌ Invalid ticket type.',
            ephemeral: true
          });
        }

        const answers = [];

        for (
          let i = 0;
          i < ticket.q.length;
          i++
        ) {
          answers.push(
            interaction.fields.getTextInputValue(
              `ticket-answer-${i}`
            )
          );
        }

        return createTicket(
          interaction,
          type,
          answers
        );
      }

      // ======================================================
      // APPLICATION DROPDOWN
      // ======================================================

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

      // ======================================================
      // ROLE BUTTONS
      // ======================================================

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

      // ======================================================
      // CLOSE TICKET
      // ======================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'ticket-close'
      ) {
        return closeTicket(
          interaction
        );
      }

    } catch (error) {
      console.error(
        'Interaction error:',
        error
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {
        await interaction.reply({
          content:
            '❌ Something went wrong while processing that.',
          ephemeral: true
        }).catch(() => {});
      }
    }
  }
);

// ============================================================
// ERROR HANDLING
// ============================================================

process.on(
  'unhandledRejection',
  error => {
    console.error(
      'Unhandled promise rejection:',
      error
    );
  }
);

process.on(
  'uncaughtException',
  error => {
    console.error(
      'Uncaught exception:',
      error
    );
  }
);

// ============================================================
// LOGIN
// ============================================================

client.login(TOKEN);
