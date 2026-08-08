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
// ENVIRONMENT
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error('Missing DISCORD_TOKEN environment variable.');
  process.exit(1);
}

const PORT = process.env.PORT || 10000;

// ============================================================
// EXPRESS KEEP-ALIVE
// ============================================================

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
// CONFIG
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
  config = {};
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

function guildConfig(guildId) {
  if (!config[guildId]) {
    config[guildId] = {};
  }

  const cfg = config[guildId];

  if (!('welcomeChannel' in cfg)) {
    cfg.welcomeChannel = null;
  }

  if (!('welcomeMessage' in cfg)) {
    cfg.welcomeMessage =
      'Welcome {user} to **{server}**! 🎉';
  }

  if (!('autorole' in cfg)) {
    cfg.autorole = null;
  }

  if (!('ticketCategory' in cfg)) {
    cfg.ticketCategory = null;
  }

  if (!('ticketStaffRole' in cfg)) {
    cfg.ticketStaffRole = null;
  }

  if (!Array.isArray(cfg.buttonRoles)) {
    cfg.buttonRoles = [];
  }

  if (!cfg.strikes) {
    cfg.strikes = {};
  }

  if (!cfg.strikes.staff) {
    cfg.strikes.staff = {};
  }

  if (!cfg.strikes.builder) {
    cfg.strikes.builder = {};
  }

  saveConfig();

  return cfg;
}

// ============================================================
// ROLE NAMES
// ============================================================

const ROLE_NAMES = {
  updates: 'updates',

  staffTeam: 'staff team',
  helper: 'helper',
  staffBlacklist: 'staff application blacklist',

  builder: 'builder',
  builderBlacklist: 'builder application blacklist'
};

// ============================================================
// HELPERS
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

function findRole(guild, name) {
  if (!name) return null;

  const normalized = name
    .toLowerCase()
    .replace(/^@/, '')
    .trim();

  return guild.roles.cache.find(
    role =>
      role.name.toLowerCase() === normalized
  ) || null;
}

function findRoleByNames(guild, names) {
  for (const name of names) {
    const role = findRole(guild, name);

    if (role) {
      return role;
    }
  }

  return null;
}

async function getOrCreateRole(guild, name) {
  const existing = findRole(guild, name);

  if (existing) {
    return existing;
  }

  try {
    return await guild.roles.create({
      name,
      reason: 'TVB Assistant team system'
    });
  } catch (error) {
    console.error(
      `Could not create role ${name}:`,
      error
    );

    return null;
  }
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
      'What happened?',
      'Which server/channel is this about?',
      'What have you tried already?',
      'Anything else we should know?'
    ]
  },

  purchase: {
    label: 'Purchase Support',
    emoji: '🛒',
    desc: 'Purchases, payments, orders, or missing items.',

    q: [
      'What did you purchase?',
      'When did you purchase it?',
      'What went wrong?',
      'Do you have an order or transaction ID?',
      'What would you like us to do?'
    ]
  },

  player: {
    label: 'Player Report',
    emoji: '🚨',
    desc: 'Report cheating, rule breaking, or another player.',

    q: [
      'What is the player username?',
      'What happened?',
      'When and where did it happen?',
      'Do you have proof, screenshots, or video?',
      'Anything else staff should know?'
    ]
  },

  staff: {
    label: 'Staff Report',
    emoji: '🛡️',
    desc: 'Report a concern involving a staff member.',

    q: [
      'Which staff member?',
      'What happened?',
      'When and where did this occur?',
      'Do you have proof, screenshots, or video?',
      'What outcome are you hoping for?'
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
      'What timezone are you normally active in?',
      'How long have you been seriously building in Minecraft?',
      'Which building styles are you most experienced with?',
      'Which building style would you consider your strongest?',
      'What types of projects do you enjoy working on most?',
      'What aspect of your building are you currently trying to improve?',
      'Approximately how many hours per week can you consistently contribute?',
      'Why are you interested in becoming a TVB builder?',
      'How do you respond when another builder gives you critical feedback?',
      'Do you work more effectively independently or as part of a team, and why?',
      'Please provide screenshots, a portfolio, or links to examples of your work.',
      'What separates an average Minecraft build from a genuinely polished build?',
      'If another builder strongly disagreed with one of your design decisions, how would you handle the situation?'
    ]
  },

  staff: {
    label: 'Staff Application',
    emoji: '🛡️',
    channel: '📋・staff-submissions',

    q: [
      'What is your Discord username?',
      'How old are you?',
      'What timezone are you normally active in?',
      'How long have you been an active member of the TVB community?',
      'Have you previously held a moderation or staff position? If so, briefly explain your responsibilities.',
      'How many hours per week can you realistically and consistently dedicate to staff duties?',
      'Why do you believe you would be a valuable addition to the TVB staff team?',
      'In your opinion, what qualities separate an excellent staff member from an average one?',
      'How would you professionally de-escalate a disagreement between two members?',
      'If a close friend violated the rules, how would you handle the situation?',
      'How would you respond if a player repeatedly ignored warnings from staff?',
      'Walk us through how you would investigate and handle a serious player report.',
      'How would you protect confidential staff information and private discussions?',
      'What personal strengths would you bring to the staff team?',
      'What is one area of your communication, judgment, or leadership that you would like to improve?'
    ]
  }
};

// ============================================================
// SESSION STORAGE
// ============================================================

const appSessions = new Map();
const ticketSessions = new Map();

// ============================================================
// TICKET MENU
// ============================================================

function ticketMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket-select')
      .setPlaceholder('🎫 Select support type...')
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
      .setPlaceholder('📋 Choose an application...')
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

  const inputs = [];

  ticket.q.forEach((question, index) => {
    const input = new TextInputBuilder()
      .setCustomId(`ticket-answer-${index}`)
      .setLabel(
        question.length > 45
          ? question.slice(0, 42) + '...'
          : question
      )
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000)
      .setPlaceholder('Type your answer here...');

    inputs.push(input);
  });

  modal.addComponents(
    inputs.map(
      input =>
        new ActionRowBuilder().addComponents(input)
    )
  );

  return modal;
}

// ============================================================
// CREATE TICKET
// ============================================================

async function createTicket(
  interaction,
  type,
  answers = null
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
    ? guild.roles.cache.get(cfg.ticketStaffRole)
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

  let channel;

  try {
    channel = await guild.channels.create({
      name: `${type}-${safe(member.user.username)}`,
      type: ChannelType.GuildText,
      parent: cfg.ticketCategory || null,
      topic: `TVB-TICKET:${member.id}`,
      permissionOverwrites: overwrites,
      reason: `TVB Assistant • ${ticket.label}`
    });
  } catch (error) {
    console.error('Could not create ticket:', error);

    return interaction.reply({
      content:
        '❌ I could not create the ticket. Check my permissions and category settings.',
      ephemeral: true
    });
  }

  const session = {
    userId: member.id,
    type,
    currentQuestion: 0,
    answers: answers || []
  };

  ticketSessions.set(
    channel.id,
    session
  );

  const answerText = answers
    ? ticket.q
        .map(
          (question, index) =>
            `**${index + 1}. ${question}**\n> ${
              answers[index] || 'No answer provided.'
            }`
        )
        .join('\n\n')
    : 'Please answer the questions below.';

  const ticketEmbed = embed(
    `${ticket.emoji} ${ticket.label}`,
    [
      `Welcome ${member}!`,
      '',
      `**${ticket.desc}**`,
      '',
      answerText,
      '',
      'A staff member will review your ticket shortly.'
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
        `${member}${staffRole ? ` ${staffRole}` : ''}`,

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

  if (answers) {
    ticketSessions.delete(channel.id);
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
  const channel = interaction.channel;

  const session =
    ticketSessions.get(channel.id);

  if (!session) {
    return interaction.reply({
      content:
        "⚠️ This isn't an active TVB ticket.",
      ephemeral: true
    });
  }

  const cfg = guildConfig(
    interaction.guild.id
  );

  const staffRole = cfg.ticketStaffRole
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
    session.userId !== interaction.user.id &&
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
      '🔒 Closing this ticket in 5 seconds...'
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
  const panel = new EmbedBuilder()
    .setColor(0x7c5cff)
    .setTitle('🎫 TVB Support Center')
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
        'Selecting a category will open a short form.'
      ].join('\n')
    )
    .setFooter({
      text: 'TVB Assistant • Support Center'
    })
    .setTimestamp();

  await interaction.channel.send({
    embeds: [panel],
    components: [ticketMenu()]
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
  const application = APPS[type];

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

  const blacklistName =
    type === 'staff'
      ? ROLE_NAMES.staffBlacklist
      : ROLE_NAMES.builderBlacklist;

  const blacklistRole =
    findRoleByNames(
      interaction.guild,
      [
        blacklistName
      ]
    );

  if (
    blacklistRole &&
    interaction.member.roles.cache.has(
      blacklistRole.id
    )
  ) {
    return interaction.reply({
      content:
        `❌ You are currently blacklisted from ${application.label.toLowerCase()}s.`,
      ephemeral: true
    });
  }

  try {
    const dm =
      await interaction.user.createDM();

    const session = {
      userId: interaction.user.id,
      guildId: interaction.guild.id,
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
            '📝 Answer each question honestly.',
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
          "❌ I couldn't DM you. Please enable your Discord DMs and try again.",
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
          '💡 Take your time and give your best answer.',
          '❌ Type `cancel` to stop.'
        ].join('\n')
      )
    ]
  });
}

// ============================================================
// APPLICATION BUTTONS
// ============================================================

function applicationButtons(
  type,
  userId
) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `app-accept-${type}-${userId}`
      )
      .setLabel('Accept')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(
        `app-deny-${type}-${userId}`
      )
      .setLabel('Deny')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId(
        `app-blacklist-${type}-${userId}`
      )
      .setLabel('Blacklist')
      .setEmoji('🚫')
      .setStyle(ButtonStyle.Secondary)
  );
}

// ============================================================
// APPLICATION FINISH
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

    const header = new EmbedBuilder()
      .setColor(
        session.type === 'staff'
          ? 0x5865f2
          : 0xf1c40f
      )
      .setTitle(
        `${application.emoji} ${application.label}`
      )
      .setDescription(
        [
          `**Applicant:** ${member}`,
          `**Username:** ${member.user.tag}`,
          `**User ID:** ${member.id}`,
          '',
          '## 📋 Application Answers',
          '',
          'Review the complete application below.',
          '',
          'Use the buttons underneath to accept, deny, or blacklist this applicant.'
        ].join('\n')
      )
      .setTimestamp();

    const answerEmbed = new EmbedBuilder()
      .setColor(0x7c5cff)
      .setTitle('📝 Complete Application')
      .setDescription(
        session.answers
          .map(
            (answer, index) =>
              `**${index + 1}. ${application.q[index]}**\n> ${
                answer || 'No answer provided.'
              }`
          )
          .join('\n\n')
      )
      .setFooter({
        text:
          `${application.label} • TVB Assistant`
      });

    await submissionChannel.send({
      content: `${member}`,

      embeds: [
        header,
        answerEmbed
      ],

      components: [
        applicationButtons(
          session.type,
          member.id
        )
      ]
    });

    await dm.send({
      embeds: [
        embed(
          '✅ Application Submitted!',
          [
            `Your **${application.label}** has been submitted successfully.`,
            '',
            'Staff will review your application.',
            '',
            'Thank you for applying to TVB! 💙'
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
  if (message.author.bot) return;

  const session =
    appSessions.get(
      message.author.id
    );

  if (!session) return;

  const answer =
    message.content.trim();

  if (!answer) return;

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

  session.answers.push(answer);

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
  const panel = new EmbedBuilder()
    .setColor(0x7c5cff)
    .setTitle('📋 TVB Applications')
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
      text: 'TVB Assistant • Applications'
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
// EMOJI
// ============================================================

function parseEmoji(input) {
  if (!input) return null;

  const match = input.match(
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
// BUTTON ROLES
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
      .setLabel(role.name)
      .setStyle(
        ButtonStyle.Secondary
      );

  const parsed =
    parseEmoji(emoji);

  if (parsed) {
    if (
      typeof parsed === 'string'
    ) {
      button.setEmoji(parsed);
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

  if (!cfg.buttonRoles.length) {
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
    const item of cfg.buttonRoles
  ) {
    const role =
      interaction.guild.roles.cache.get(
        item.roleId
      );

    if (!role) continue;

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

  const panel = new EmbedBuilder()
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

    components:
      rows
  });

  return interaction.reply({
    content:
      '✅ Button-role panel posted!',
    ephemeral: true
  });
}

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
// TEAM ACTION SYSTEM
// ============================================================

function teamActionTitle(
  team,
  action
) {
  const titles = {
    hire: 'Hired',
    fire: 'Fired',
    promote: 'Promoted',
    demote: 'Demoted'
  };

  const title =
    titles[action] || action;

  return team === 'staff'
    ? `🛡️ [${title}]`
    : `🧱 [${title}]`;
}

async function executeTeamAction(
  interaction,
  team,
  action
) {
  if (!manager(interaction)) {
    return interaction.reply({
      content:
        '❌ You need Manage Server or Manage Roles to use this command.',
      ephemeral: true
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
      ephemeral: true
    });
  }

  if (!fromRole || !toRole) {
    return interaction.reply({
      content:
        '❌ Both the current role and new role are required.',
      ephemeral: true
    });
  }

  if (
    member.user.bot
  ) {
    return interaction.reply({
      content:
        '❌ You cannot use team actions on bots.',
      ephemeral: true
    });
  }

  const botMember =
    interaction.guild.members.me;

  if (!botMember) {
    return interaction.reply({
      content:
        '❌ I could not determine my bot member.',
      ephemeral: true
    });
  }

  if (
    toRole.position >=
    botMember.roles.highest.position
  ) {
    return interaction.reply({
      content:
        '❌ My bot role must be above the new role.',
      ephemeral: true
    });
  }

  if (
    fromRole.position >=
    interaction.member.roles.highest.position &&
    !interaction.member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  ) {
    return interaction.reply({
      content:
        '❌ You cannot manage the current role because it is equal to or above your highest role.',
      ephemeral: true
    });
  }

  try {
    if (
      member.roles.cache.has(
        fromRole.id
      )
    ) {
      await member.roles.remove(
        fromRole
      );
    }

    await member.roles.add(
      toRole
    );

    const formattedMessage =
      message
        .replace(
          /\{user\}/gi,
          `${member}`
        )
        .replace(
          /\{server\}/gi,
          interaction.guild.name
        )
        .replace(
          /\{username\}/gi,
          member.user.username
        )
        .replace(
          /\{from\}/gi,
          `${fromRole}`
        )
        .replace(
          /\{to\}/gi,
          `${toRole}`
        );

    const output = [
      `${teamActionTitle(
        team,
        action
      )} - ${member} ${fromRole} --> ${toRole}`,
      '',
      `-# ${formattedMessage || 'Welcome to your new position!'}`
    ].join('\n');

    await interaction.channel.send({
      content: output
    });

    return interaction.reply({
      content:
        `✅ ${action} action completed for ${member}.`,
      ephemeral: true
    });

  } catch (error) {
    console.error(
      `${team} ${action} error:`,
      error
    );

    return interaction.reply({
      content:
        '❌ I could not complete that action. Check my role hierarchy and permissions.',
      ephemeral: true
    });
  }
}

// ============================================================
// UPDATE SYSTEM
// ============================================================

async function updateEmbed(
  type,
  title,
  description,
  extra
) {
  return [
    `## ${title}`,
    '',
    `**${type}**`,
    '',
    description,
    '',
    extra
      ? `-# ${extra}`
      : ''
  ]
    .filter(Boolean)
    .join('\n');
}

async function sendUpdate(
  interaction
) {
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

  const updatesRole =
    findRoleByNames(
      interaction.guild,
      [
        ROLE_NAMES.updates
      ]
    );

  const rolePing =
    updatesRole
      ? `${updatesRole}`
      : '@updates';

  const text =
    await updateEmbed(
      type,
      title,
      description,
      extra
    );

  await interaction.channel.send({
    content:
      `||${rolePing} ${text}||`
  });

  return interaction.reply({
    content:
      '✅ Update posted!',
    ephemeral: true
  });
}

// ============================================================
// APPLICATION DECISION HANDLER
// ============================================================

async function handleApplicationDecision(
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

  if (
    !['accept', 'deny', 'blacklist'].includes(
      action
    )
  ) {
    return;
  }

  if (!manager(interaction)) {
    return interaction.reply({
      content:
        '❌ You need Manage Server or Manage Roles to review applications.',
      ephemeral: true
    });
  }

  let member;

  try {
    member =
      await interaction.guild.members.fetch(
        userId
      );
  } catch {
    return interaction.reply({
      content:
        '❌ That applicant is no longer in the server.',
      ephemeral: true
    });
  }

  const botMember =
    interaction.guild.members.me;

  if (!botMember) {
    return interaction.reply({
      content:
        '❌ Could not find the bot member.',
      ephemeral: true
    });
  }

  let rolesToAdd = [];

  if (action === 'accept') {
    if (type === 'staff') {
      const staffTeam =
        findRoleByNames(
          interaction.guild,
          [
            ROLE_NAMES.staffTeam
          ]
        );

      const helper =
        findRoleByNames(
          interaction.guild,
          [
            ROLE_NAMES.helper
          ]
        );

      if (staffTeam) {
        rolesToAdd.push(
          staffTeam
        );
      }

      if (helper) {
        rolesToAdd.push(
          helper
        );
      }
    }

    if (type === 'builder') {
      const builder =
        findRoleByNames(
          interaction.guild,
          [
            ROLE_NAMES.builder,
            'biluder'
          ]
        );

      if (builder) {
        rolesToAdd.push(
          builder
        );
      }
    }
  }

  if (action === 'blacklist') {
    const blacklist =
      type === 'staff'
        ? findRoleByNames(
            interaction.guild,
            [
              ROLE_NAMES.staffBlacklist
            ]
          )
        : findRoleByNames(
            interaction.guild,
            [
              ROLE_NAMES.builderBlacklist
            ]
          );

    if (blacklist) {
      rolesToAdd.push(
        blacklist
      );
    }
  }

  for (const role of rolesToAdd) {
    if (
      role.position >=
      botMember.roles.highest.position
    ) {
      return interaction.reply({
        content:
          `❌ I cannot manage **${role.name}** because my bot role must be above it.`,
        ephemeral: true
      });
    }
  }

  try {
    if (
      action === 'deny'
    ) {
      await interaction.update({
        content:
          `❌ Application denied for ${member}.`,

        components: [],

        embeds:
          interaction.message.embeds
      });

      return;
    }

    if (
      action === 'blacklist'
    ) {
      await member.roles.add(
        rolesToAdd
      );

      await interaction.update({
        content:
          `🚫 ${member} has been blacklisted from the ${type} application process.`,

        components: [],

        embeds:
          interaction.message.embeds
      });

      return;
    }

    if (
      action === 'accept'
    ) {
      await member.roles.add(
        rolesToAdd
      );

      await interaction.update({
        content:
          `✅ ${member} has been accepted for the ${type} team.`,

        components: [],

        embeds:
          interaction.message.embeds
      });

      return;
    }

  } catch (error) {
    console.error(
      'Application decision error:',
      error
    );

    return interaction.reply({
      content:
        '❌ I could not update the applicant roles. Check my permissions and role hierarchy.',
      ephemeral: true
    });
  }
}

// ============================================================
// COMMAND DEFINITIONS
// ============================================================

const commands = [

  // ----------------------------------------------------------
  // PING
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription(
      'Check if TVB Assistant is online.'
    ),

  // ----------------------------------------------------------
  // TICKET PANEL
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription(
      'Post the TVB ticket panel.'
    ),

  // ----------------------------------------------------------
  // APPLICATION PANEL
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName('applicationpanel')
    .setDescription(
      'Post the TVB application panel.'
    ),

  // ----------------------------------------------------------
  // BUTTON ROLES
  // ----------------------------------------------------------

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
              'Emoji to display.'
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
        .setName('list')
        .setDescription(
          'Show configured button roles.'
        )
    ),

  // ----------------------------------------------------------
  // WELCOME
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // AUTOROLE
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // TICKET STAFF
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // TICKET CATEGORY
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // STAFF COMMAND GROUP
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName('staff')
    .setDescription(
      'Manage the TVB staff team.'
    )

    .addSubcommand(sub =>
      sub
        .setName('hire')
        .setDescription(
          'Hire a member.'
        )

        .addUserOption(option =>
          option
            .setName('member')
            .setDescription(
              'Member to hire.'
            )
            .setRequired(true)
        )

        .addRoleOption(option =>
          option
            .setName('fromrole')
            .setDescription(
              'Current role.'
            )
            .setRequired(true)
        )

        .addRoleOption(option =>
          option
            .setName('torole')
            .setDescription(
              'New role.'
            )
            .setRequired(true)
        )

        .addStringOption(option =>
          option
            .setName('message')
            .setDescription(
              'Use {user}, {server}, {username}, {from}, {to}.'
            )
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('fire')
        .setDescription(
          'Remove a member from a staff position.'
        )

        .addUserOption(option =>
          option
            .setName('member')
            .setDescription(
              'Member to fire.'
            )
            .setRequired(true)
        )

        .addRoleOption(option =>
          option
            .setName('fromrole')
            .setDescription(
              'Current role.'
            )
            .setRequired(true)
        )

        .addRoleOption(option =>
          option
            .setName('torole')
            .setDescription(
              'Role they will receive.'
            )
            .setRequired(true)
        )

        .addStringOption(option =>
          option
            .setName('message')
            .setDescription(
              'Use {user}, {server}, {username}, {from}, {to}.'
            )
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('promote')
        .setDescription(
          'Promote a staff member.'
        )

        .addUserOption(option =>
          option
            .setName('member')
            .setDescription(
              'Member to promote.'
            )
            .setRequired(true)
        )

        .addRoleOption(option =>
          option
            .setName('fromrole')
            .setDescription(
              'Current role.'
            )
            .setRequired(true)
        )

        .addRoleOption(option =>
          option
            .setName('torole')
            .setDescription(
              'New role.'
            )
            .setRequired(true)
        )

        .addStringOption(option =>
          option
            .setName('message')
            .setDescription(
              'Use {user}, {server}, {username}, {from}, {to}.'
            )
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('demote')
        .setDescription(
          'Demote a staff member.'
        )

        .addUserOption(option =>
          option
            .setName('member')
            .setDescription(
              'Member to demote.'
            )
            .setRequired(true)
        )

        .addRoleOption(option =>
          option
            .setName('fromrole')
            .setDescription(
              'Current role.'
            )
            .setRequired(true)
        )

        .addRoleOption(option =>
          option
            .setName('torole')
            .setDescription(
              'New role.'
            )
            .setRequired(true)
        )

        .addStringOption(option =>
          option
            .setName('message')
            .setDescription(
              'Use {user}, {server}, {username}, {from}, {to}.'
            )
            .setRequired(true)
        )
    ),

  // ----------------------------------------------------------
  // BUILDER COMMAND GROUP
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName('builder')
    .setDescription(
      'Manage the TVB builder team.'
    )

    .addSubcommand(sub =>
      sub
        .setName('hire')
        .setDescription(
          'Hire a builder.'
        )

        .addUserOption(option =>
          option
            .setName('member')
            .setDescription(
              'Member to hire.'
            )
            .setRequired(true)
        )

        .addRoleOption(option =>
          option
            .setName('fromrole')
            .setDescription(
              'Current role.'
            )
            .setRequired(true)
        )

        .addRoleOption(option =>
          option
            .setName('torole')
            .setDescription(
              'New role.'
            )
            .setRequired(true)
        )

        .addStringOption(option =>
          option
            .setName('message')
            .setDescription(
              'Use {user}, {server}, {username}, {from}, {to}.'
            )
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('fire')
        .setDescription(
          'Remove a builder from their position.'
        )

        .addUserOption(option =>
          option
            .setName('member')
            .setDescription(
              'Member to fire.'
            )
            .setRequired(true)
        )

        .addRoleOption(option =>
          option
            .setName('fromrole')
            .setDescription(
              'Current role.'
            )
            .setRequired(true)
        )

        .addRoleOption(option =>
          option
            .setName('torole')
            .setDescription(
              'Role they will receive.'
            )
            .setRequired(true)
        )

        .addStringOption(option =>
          option
            .setName('message')
            .setDescription(
              'Use {user}, {server}, {username}, {from}, {to}.'
            )
            .setRequired(true)
        )
    ),

  // ----------------------------------------------------------
  // UPDATE
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName('update')
    .setDescription(
      'Post a detailed TVB update.'
    )

    .addStringOption(option =>
      option
        .setName('type')
        .setDescription(
          'Update type.'
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
          'Main update text.'
        )
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('extra')
        .setDescription(
          'Optional extra information.'
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
      const guild of
      client.guilds.cache.values()
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
    try {
      await registerCommands(
        guild.id
      );
    } catch (error) {
      console.error(
        `Could not register commands in ${guild.id}:`,
        error
      );
    }
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

    // ----------------------------
    // AUTOROLE
    // ----------------------------

    if (cfg.autorole) {
      const role =
        member.guild.roles.cache.get(
          cfg.autorole
        );

      if (role) {
        try {
          const botMember =
            member.guild.members.me;

          if (
            botMember &&
            role.position <
              botMember.roles.highest.position
          ) {
            await member.roles.add(
              role
            );
          }

        } catch (error) {
          console.error(
            'Could not assign autorole:',
            error
          );
        }
      }
    }

    // ----------------------------
    // WELCOME
    // ----------------------------

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
          if (!manager(interaction)) {
            return interaction.reply({
              content:
                '❌ You need Manage Server or Manage Roles to use this command.',
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
          if (!manager(interaction)) {
            return interaction.reply({
              content:
                '❌ You need Manage Server or Manage Roles to use this command.',
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
          if (!manager(interaction)) {
            return interaction.reply({
              content:
                '❌ You need Manage Server or Manage Roles to use this command.',
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
            subcommand === 'add'
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
              botMember &&
              role.position >=
                botMember.roles.highest.position
            ) {
              return interaction.reply({
                content:
                  '❌ My bot role must be above that role.',
                ephemeral: true
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
                roleId: role.id,
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
            subcommand === 'remove'
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
                `✅ **${role.name}** was removed from the button-role list.`,
              ephemeral: true
            });
          }

          // LIST

          if (
            subcommand === 'list'
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
        // WELCOME
        // ----------------------------------------------------

        if (
          interaction.commandName ===
          'setwelcome'
        ) {
          if (!manager(interaction)) {
            return interaction.reply({
              content:
                '❌ You need Manage Server or Manage Roles to use this command.',
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
        // AUTOROLE
        // ----------------------------------------------------

        if (
          interaction.commandName ===
          'setautorole'
        ) {
          if (!manager(interaction)) {
            return interaction.reply({
              content:
                '❌ You need Manage Server or Manage Roles to use this command.',
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
            botMember &&
            role.position >=
              botMember.roles.highest.position
          ) {
            return interaction.reply({
              content:
                '❌ My bot role must be above the autorole.',
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
        // TICKET STAFF
        // ----------------------------------------------------

        if (
          interaction.commandName ===
          'setticketstaff'
        ) {
          if (!manager(interaction)) {
            return interaction.reply({
              content:
                '❌ You need Manage Server or Manage Roles to use this command.',
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
        // TICKET CATEGORY
        // ----------------------------------------------------

        if (
          interaction.commandName ===
          'setticketcategory'
        ) {
          if (!manager(interaction)) {
            return interaction.reply({
              content:
                '❌ You need Manage Server or Manage Roles to use this command.',
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
        // STAFF
        // ----------------------------------------------------

        if (
          interaction.commandName ===
          'staff'
        ) {
          const subcommand =
            interaction.options.getSubcommand();

          return executeTeamAction(
            interaction,
            'staff',
            subcommand
          );
        }

        // ----------------------------------------------------
        // BUILDER
        // ----------------------------------------------------

        if (
          interaction.commandName ===
          'builder'
        ) {
          const subcommand =
            interaction.options.getSubcommand();

          return executeTeamAction(
            interaction,
            'builder',
            subcommand
          );
        }

        // ----------------------------------------------------
        // UPDATE
        // ----------------------------------------------------

        if (
          interaction.commandName ===
          'update'
        ) {
          if (!manager(interaction)) {
            return interaction.reply({
              content:
                '❌ You need Manage Server or Manage Roles to use this command.',
              ephemeral: true
            });
          }

          return sendUpdate(
            interaction
          );
        }
      }

      // ======================================================
      // TICKET SELECT
      // ======================================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          'ticket-select'
      ) {
        const type =
          interaction.values[0];

        const ticket =
          TICKETS[type];

        if (!ticket) {
          return interaction.reply({
            content:
              '❌ Invalid ticket type.',
            ephemeral: true
          });
        }

        return interaction.showModal(
          ticketModal(type)
        );
      }

      // ======================================================
      // TICKET MODAL
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

        const answers =
          ticket.q.map(
            (_question, index) =>
              interaction.fields.getTextInputValue(
                `ticket-answer-${index}`
              )
          );

        return createTicket(
          interaction,
          type,
          answers
        );
      }

      // ======================================================
      // APPLICATION SELECT
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
      // APPLICATION DECISIONS
      // ======================================================

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
        return handleApplicationDecision(
          interaction
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
