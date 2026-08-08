const express = require("express");

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
} = require("discord.js");

const fs = require("fs");

// ============================================================
// CONFIG
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error("❌ Missing DISCORD_TOKEN environment variable.");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 10000;

app.get("/", (_req, res) => {
  res.status(200).send("TVB Assistant is online.");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server listening on ${PORT}`);
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
  partials: [Partials.Channel]
});

// ============================================================
// FILE CONFIG
// ============================================================

const CONFIG_FILE = "./config.json";

let config = {};

try {
  if (fs.existsSync(CONFIG_FILE)) {
    config = JSON.parse(
      fs.readFileSync(CONFIG_FILE, "utf8")
    );
  }
} catch (error) {
  console.error("❌ Could not load config:", error);
  config = {};
}

function saveConfig() {
  try {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(config, null, 2)
    );
  } catch (error) {
    console.error("❌ Could not save config:", error);
  }
}

function guildConfig(guildId) {
  if (!config[guildId]) {
    config[guildId] = {};
  }

  const cfg = config[guildId];

  if (!("welcomeChannel" in cfg)) {
    cfg.welcomeChannel = null;
  }

  if (!("welcomeMessage" in cfg)) {
    cfg.welcomeMessage =
      "Welcome {user} to **{server}**! 🎉";
  }

  if (!("autorole" in cfg)) {
    cfg.autorole = null;
  }

  if (!("ticketCategory" in cfg)) {
    cfg.ticketCategory = null;
  }

  if (!("ticketStaffRole" in cfg)) {
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

  return cfg;
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
// HELPERS
// ============================================================

function safe(value) {
  return (
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60) || "user"
  );
}

function replaceVariables(text, user, guild) {
  return String(text)
    .replace(/\{user\}/gi, `${user}`)
    .replace(/\{username\}/gi, user.username)
    .replace(/\{server\}/gi, guild.name);
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
      text: "TVB Assistant"
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

function findRole(guild, names) {
  const wanted = Array.isArray(names)
    ? names
    : [names];

  return guild.roles.cache.find(role =>
    wanted.some(
      name =>
        role.name.toLowerCase() ===
        name.toLowerCase()
    )
  );
}

async function getOrCreateRole(guild, name) {
  const existing = findRole(guild, name);

  if (existing) {
    return existing;
  }

  try {
    return await guild.roles.create({
      name,
      reason: "TVB Assistant role system"
    });
  } catch (error) {
    console.error(
      `Could not create role ${name}:`,
      error
    );

    return null;
  }
}

function canManageRole(guild, role) {
  const botMember = guild.members.me;

  if (!botMember || !role) {
    return false;
  }

  return (
    role.position <
    botMember.roles.highest.position
  );
}

// ============================================================
// TICKETS
// ============================================================

const TICKETS = {
  general: {
    label: "General Support",
    emoji: "💬",
    desc:
      "Questions, help, bugs, or anything else.",
    q: [
      "What do you need help with?",
      "What happened?",
      "Which server/channel is this about?",
      "What have you tried already?",
      "Anything else we should know?"
    ]
  },

  purchase: {
    label: "Purchase Support",
    emoji: "🛒",
    desc:
      "Purchases, payments, orders, or missing items.",
    q: [
      "What did you purchase?",
      "When did you purchase it?",
      "What went wrong?",
      "Do you have an order/transaction ID?",
      "What would you like us to do?"
    ]
  },

  player: {
    label: "Player Report",
    emoji: "🚨",
    desc:
      "Report cheating, rule breaking, or another player.",
    q: [
      "What is the player username?",
      "What happened?",
      "When and where did it happen?",
      "Do you have proof/screenshots/video?",
      "Anything else staff should know?"
    ]
  },

  staff: {
    label: "Staff Report",
    emoji: "🛡️",
    desc:
      "Report a concern involving a staff member.",
    q: [
      "Which staff member?",
      "What happened?",
      "When and where did it happen?",
      "Do you have proof/screenshots/video?",
      "What outcome do you want?"
    ]
  }
};

// ============================================================
// APPLICATIONS
// ============================================================

const APPS = {
  builder: {
    label: "Builder Application",
    emoji: "🧱",
    channel: "📋・builder-submissions",

    q: [
      "What is your Minecraft username?",
      "How old are you?",
      "What is your timezone?",
      "How long have you been actively building in Minecraft?",
      "Which building styles are you most experienced with?",
      "Which project or build are you most proud of, and why?",
      "How would you approach building something when the requirements are unclear?",
      "How do you maintain consistency when working on a large project?",
      "How many hours per week can you realistically contribute?",
      "Why are you interested in joining the TVB building team?",
      "How do you respond when a senior builder gives you critical feedback?",
      "Describe a situation where you had to work effectively as part of a team.",
      "What do you believe separates an average Minecraft build from an exceptional one?",
      "What is one area of your building ability that you are actively trying to improve?",
      "Please provide screenshots, a portfolio, or links to examples of your previous work."
    ]
  },

  staff: {
    label: "Staff Application",
    emoji: "🛡️",
    channel: "📋・staff-submissions",

    q: [
      "What is your Discord username?",
      "How old are you?",
      "What is your timezone?",
      "How long have you been an active member of the TVB community?",
      "Have you previously held a moderation or administrative position? If so, briefly describe your responsibilities.",
      "How many hours per week can you consistently dedicate to the community?",
      "Why do you want to join the TVB staff team, and what do you believe you can contribute?",
      "What qualities do you believe are essential for someone in a position of authority within a community?",
      "Two members begin arguing publicly and the situation is escalating. Explain how you would assess and handle the situation.",
      "A close friend of yours violates an important server rule. How would you handle the situation while remaining impartial?",
      "A player repeatedly ignores warnings from staff. What factors would you consider before deciding on further action?",
      "A player submits a report containing conflicting information from both sides. How would you investigate the situation before making a decision?",
      "Staff-only information is accidentally shared with you by another staff member. What would you do?",
      "What personal strengths would make you an effective member of the TVB staff team?",
      "What is one area of your communication, leadership, or moderation ability that you would like to improve?"
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
      .setCustomId("ticket-select")
      .setPlaceholder(
        "🎫 Select support type..."
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
      .setCustomId("application-select")
      .setPlaceholder(
        "📋 Choose an application..."
      )
      .addOptions(
        Object.entries(APPS).map(
          ([value, application]) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(application.label)
              .setValue(value)
              .setEmoji(application.emoji)
              .setDescription(
                "15 questions • completed privately in DMs"
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

  const inputs = ticket.q.slice(0, 5).map(
    (question, index) => {
      const input =
        new TextInputBuilder()
          .setCustomId(
            `ticket-answer-${index}`
          )
          .setLabel(
            question.slice(0, 45)
          )
          .setStyle(
            TextInputStyle.Paragraph
          )
          .setRequired(true)
          .setMaxLength(1000);

      return input;
    }
  );

  for (const input of inputs) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        input
      )
    );
  }

  return modal;
}

// ============================================================
// CREATE TICKET
// ============================================================

async function createTicket(
  interaction,
  type,
  answers = []
) {
  const guild = interaction.guild;
  const member = interaction.member;
  const cfg = guildConfig(guild.id);
  const ticket = TICKETS[type];

  if (!ticket) {
    return interaction.reply({
      content: "❌ Invalid ticket type.",
      ephemeral: true
    });
  }

  const existing =
    guild.channels.cache.find(
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
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles
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
        PermissionsBitField.Flags.ManageMessages,
        PermissionsBitField.Flags.AttachFiles
      ]
    });
  }

  let channel;

  try {
    channel = await guild.channels.create({
      name: `${type}-${safe(
        member.user.username
      )}`,
      type: ChannelType.GuildText,
      parent: cfg.ticketCategory || null,
      topic: `TVB-TICKET:${member.id}`,
      permissionOverwrites: overwrites,
      reason:
        `TVB Assistant • ${ticket.label}`
    });
  } catch (error) {
    console.error(
      "Could not create ticket:",
      error
    );

    return interaction.reply({
      content:
        "❌ I couldn't create the ticket. Make sure I have Manage Channels and Manage Roles where necessary.",
      ephemeral: true
    });
  }

  ticketSessions.set(channel.id, {
    userId: member.id,
    type,
    answers
  });

  const answerText =
    ticket.q
      .map(
        (question, index) =>
          `**${index + 1}. ${question}**\n> ${
            answers[index] ||
            "No answer provided."
          }`
      )
      .join("\n\n");

  const ticketEmbed = embed(
    `${ticket.emoji} ${ticket.label}`,
    [
      `Welcome ${member}!`,
      "",
      `**${ticket.desc}**`,
      "",
      "Your information has been collected.",
      "A staff member will review your ticket shortly.",
      "",
      answerText
    ].join("\n")
  );

  const buttons =
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket-close")
        .setLabel("Close Ticket")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger)
    );

  try {
    await channel.send({
      content: `${member}${
        staffRole
          ? ` ${staffRole}`
          : ""
      }`,
      embeds: [ticketEmbed],
      components: [buttons]
    });
  } catch (error) {
    console.error(
      "Could not send ticket message:",
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
        "❌ Only the ticket creator or ticket staff can close this ticket.",
      ephemeral: true
    });
  }

  await interaction.reply({
    content:
      "🔒 Closing this ticket in 5 seconds..."
  });

  ticketSessions.delete(channel.id);

  setTimeout(async () => {
    try {
      await channel.delete(
        "TVB Assistant ticket closed"
      );
    } catch (error) {
      console.error(
        "Could not delete ticket:",
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
    .setTitle("🎫 TVB Support Center")
    .setDescription(
      [
        "# Need some help?",
        "",
        "Welcome to the **TVB Support Center**!",
        "",
        "Select the category below that best matches your issue.",
        "",
        "💬 **General Support**",
        "Questions, bugs, help, or anything else.",
        "",
        "🛒 **Purchase Support**",
        "Purchases, payments, orders, or missing items.",
        "",
        "🚨 **Player Report**",
        "Report cheating or rule breaking.",
        "",
        "🛡️ **Staff Report**",
        "Report a concern involving staff.",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "🔒 **Tickets are private.**",
        "",
        "Selecting a category will open a form where you can provide the relevant information."
      ].join("\n")
    )
    .setFooter({
      text:
        "TVB Assistant • Support Center"
    })
    .setTimestamp();

  await interaction.channel.send({
    embeds: [panel],
    components: [ticketMenu()]
  });

  return interaction.reply({
    content:
      "✅ Ticket panel posted!",
    ephemeral: true
  });
}

// ============================================================
// APPLICATION SYSTEM
// ============================================================

async function startApplication(
  interaction,
  type
) {
  const application = APPS[type];

  if (!application) {
    return interaction.reply({
      content:
        "❌ Invalid application type.",
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
        "❌ You already have an application in progress. Check your DMs.",
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
            "",
            "You will answer **15 questions**, one at a time.",
            "",
            "📝 Answer each question honestly.",
            "💬 Type your answer normally.",
            "❌ Type `cancel` at any time to stop.",
            "",
            "Let's get started!"
          ].join("\n")
        )
      ]
    });

    await sendNextApplicationQuestion(
      dm,
      session
    );
  } catch (error) {
    console.error(
      "Could not start application:",
      error
    );

    appSessions.delete(
      interaction.user.id
    );

    if (
      !interaction.replied &&
      !interaction.deferred
    ) {
      await interaction
        .reply({
          content:
            "❌ I couldn't DM you. Please enable your Discord DMs and try again.",
          ephemeral: true
        })
        .catch(() => {});
    }
  }
}

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
          "",
          question,
          "",
          "💡 Take your time and give your best answer.",
          "❌ Type `cancel` to stop."
        ].join("\n")
      )
    ]
  });
}

// ============================================================
// APPLICATION SUBMISSION
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
            "❌ Application Finished",
            [
              "Your application was completed,",
              `but I couldn't find **#${application.channel}**.`,
              "",
              "Please contact a server administrator."
            ].join("\n"),
            0xed4245
          )
        ]
      });

      appSessions.delete(
        session.userId
      );

      return;
    }

    const applicationId =
      `${session.type}-${session.userId}-${Date.now()}`;

    const answersText =
      application.q
        .map(
          (question, index) =>
            `### ${index + 1}. ${question}\n> ${
              session.answers[index] ||
              "No answer provided."
            }`
        )
        .join("\n\n");

    const submissionEmbed =
      new EmbedBuilder()
        .setColor(0x7c5cff)
        .setTitle(
          `${application.emoji} ${application.label}`
        )
        .setDescription(
          [
            `**Applicant:** ${member}`,
            `**Username:** ${member.user.username}`,
            `**User ID:** \`${member.id}\``,
            "",
            "━━━━━━━━━━━━━━━━━━━━",
            "",
            answersText
          ].join("\n")
        )
        .setThumbnail(
          member.user.displayAvatarURL({
            size: 256
          })
        )
        .setFooter({
          text:
            `TVB Assistant • Application ID: ${applicationId}`
        })
        .setTimestamp();

    const buttons =
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(
            `app-accept-${session.type}-${session.userId}`
          )
          .setLabel("Accept")
          .setEmoji("✅")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId(
            `app-deny-${session.type}-${session.userId}`
          )
          .setLabel("Deny")
          .setEmoji("❌")
          .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
          .setCustomId(
            `app-blacklist-${session.type}-${session.userId}`
          )
          .setLabel("Blacklist")
          .setEmoji("🚫")
          .setStyle(ButtonStyle.Secondary)
      );

    await submissionChannel.send({
      content: `${member}`,
      embeds: [submissionEmbed],
      components: [buttons]
    });

    await dm.send({
      embeds: [
        embed(
          "✅ Application Submitted!",
          [
            `Your **${application.label}** has been submitted successfully.`,
            "",
            "Staff will review your application.",
            "",
            "You will be contacted if a decision is made.",
            "",
            "Thank you for applying to TVB! 💙"
          ].join("\n"),
          0x57f287
        )
      ]
    });

    appSessions.delete(
      session.userId
    );
  } catch (error) {
    console.error(
      "Could not finish application:",
      error
    );

    await dm
      .send({
        content:
          "❌ Something went wrong while submitting your application. Please contact staff."
      })
      .catch(() => {});

    appSessions.delete(
      session.userId
    );
  }
}

// ============================================================
// APPLICATION DMs
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
    "cancel"
  ) {
    appSessions.delete(
      message.author.id
    );

    await message.channel.send({
      embeds: [
        embed(
          "❌ Application Cancelled",
          "Your application has been cancelled. You can start a new one from the server whenever you are ready.",
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
          `✅ **Answer ${session.questionIndex}/15 saved!**`
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
    .setTitle("📋 TVB Applications")
    .setDescription(
      [
        "# Join the Team!",
        "",
        "Want to become part of the TVB team?",
        "",
        "Choose the application that matches the position you want.",
        "",
        "🧱 **Builder Application**",
        "Help create amazing builds and projects.",
        "",
        "🛡️ **Staff Application**",
        "Help moderate and support the community.",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "📨 **How it works**",
        "",
        "After selecting an application, I will DM you **15 questions**, one at a time.",
        "",
        "⚠️ Make sure your Discord DMs are enabled.",
        "",
        "Select an application below to begin."
      ].join("\n")
    )
    .setFooter({
      text:
        "TVB Assistant • Applications"
    })
    .setTimestamp();

  await interaction.channel.send({
    embeds: [panel],
    components: [appMenu()]
  });

  return interaction.reply({
    content:
      "✅ Application panel posted!",
    ephemeral: true
  });
}

// ============================================================
// APPLICATION DECISIONS
// ============================================================

async function handleApplicationDecision(
  interaction,
  action,
  type,
  userId
) {
  if (!moderator(interaction)) {
    return interaction.reply({
      content:
        "❌ You need moderation permissions to review applications.",
      ephemeral: true
    });
  }

  const guild = interaction.guild;

  let member;

  try {
    member =
      await guild.members.fetch(userId);
  } catch {
    member = null;
  }

  const application =
    APPS[type];

  if (!application) {
    return interaction.reply({
      content:
        "❌ Invalid application type.",
      ephemeral: true
    });
  }

  if (action === "accept") {
    if (!member) {
      return interaction.reply({
        content:
          "❌ That applicant is no longer in the server.",
        ephemeral: true
      });
    }

    if (type === "staff") {
      const staffTeam =
        await getOrCreateRole(
          guild,
          "staff team"
        );

      const helper =
        await getOrCreateRole(
          guild,
          "helper"
        );

      if (!staffTeam || !helper) {
        return interaction.reply({
          content:
            "❌ I couldn't find/create the required staff roles.",
          ephemeral: true
        });
      }

      if (
        !canManageRole(
          guild,
          staffTeam
        ) ||
        !canManageRole(
          guild,
          helper
        )
      ) {
        return interaction.reply({
          content:
            "❌ My bot role must be above both **staff team** and **helper**.",
          ephemeral: true
        });
      }

      await member.roles.add(
        staffTeam,
        "TVB Assistant • Staff application accepted"
      );

      await member.roles.add(
        helper,
        "TVB Assistant • Staff application accepted"
      );

      await interaction.reply({
        content:
          `✅ ${member} has been accepted and given ${staffTeam} + ${helper}.`
      });
    } else {
      const builder =
        await getOrCreateRole(
          guild,
          "biluder"
        );

      if (!builder) {
        return interaction.reply({
          content:
            "❌ I couldn't find/create the **biluder** role.",
          ephemeral: true
        });
      }

      if (
        !canManageRole(
          guild,
          builder
        )
      ) {
        return interaction.reply({
          content:
            "❌ My bot role must be above the **biluder** role.",
          ephemeral: true
        });
      }

      await member.roles.add(
        builder,
        "TVB Assistant • Builder application accepted"
      );

      await interaction.reply({
        content:
          `✅ ${member} has been accepted and given ${builder}.`
      });
    }

    await disableApplicationButtons(
      interaction
    );

    return;
  }

  if (action === "deny") {
    if (member) {
      try {
        await member.send(
          `❌ Your **${application.label}** has been denied by the TVB staff team.`
        );
      } catch {}
    }

    await interaction.reply({
      content:
        `❌ ${member || `Applicant \`${userId}\``}'s application has been denied.`
    });

    await disableApplicationButtons(
      interaction
    );

    return;
  }

  if (action === "blacklist") {
    if (!member) {
      return interaction.reply({
        content:
          "❌ That applicant is no longer in the server.",
        ephemeral: true
      });
    }

    const blacklistRoleName =
      type === "staff"
        ? "staff application blacklist"
        : "builder application blacklist";

    const blacklistRole =
      await getOrCreateRole(
        guild,
        blacklistRoleName
      );

    if (!blacklistRole) {
      return interaction.reply({
        content:
          "❌ I couldn't find/create the blacklist role.",
        ephemeral: true
      });
    }

    if (
      !canManageRole(
        guild,
        blacklistRole
      )
    ) {
      return interaction.reply({
        content:
          `❌ My bot role must be above **${blacklistRole.name}**.`,
        ephemeral: true
      });
    }

    await member.roles.add(
      blacklistRole,
      `TVB Assistant • ${type} application blacklisted`
    );

    try {
      await member.send(
        `🚫 Your **${application.label}** application has been blacklisted from future consideration.`
      );
    } catch {}

    await interaction.reply({
      content:
        `🚫 ${member} has been added to ${blacklistRole}.`
    });

    await disableApplicationButtons(
      interaction
    );
  }
}

async function disableApplicationButtons(
  interaction
) {
  if (
    !interaction.message ||
    !interaction.message.components
  ) {
    return;
  }

  const disabledRows =
    interaction.message.components.map(
      row => {
        const newRow =
          new ActionRowBuilder();

        for (const component of row.components) {
          if (
            component.type === 2
          ) {
            newRow.addComponents(
              ButtonBuilder.from(
                component
              ).setDisabled(true)
            );
          }
        }

        return newRow;
      }
    );

  try {
    await interaction.message.edit({
      components: disabledRows
    });
  } catch (error) {
    console.error(
      "Could not disable application buttons:",
      error
    );
  }
}

// ============================================================
// EMOJI / BUTTON ROLES
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
      animated: input.startsWith("<a:")
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
        role.name.slice(0, 80)
      )
      .setStyle(
        ButtonStyle.Secondary
      );

  const parsed =
    parseEmoji(emoji);

  if (parsed) {
    if (
      typeof parsed === "string"
    ) {
      button.setEmoji(parsed);
    } else {
      button.setEmoji({
        name: parsed.name,
        id: parsed.id,
        animated: parsed.animated
      });
    }
  }

  return button;
}

async function sendButtonRolePanel(
  interaction
) {
  const cfg = guildConfig(
    interaction.guild.id
  );

  if (!cfg.buttonRoles.length) {
    return interaction.reply({
      content:
        "❌ No button roles have been configured yet.\n\nUse `/buttonrole add` first.",
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

  if (row.components.length) {
    rows.push(row);
  }

  if (!rows.length) {
    return interaction.reply({
      content:
        "❌ None of the configured roles still exist.",
      ephemeral: true
    });
  }

  const panel = new EmbedBuilder()
    .setColor(0x7c5cff)
    .setTitle(
      "🔘 TVB Role Selection"
    )
    .setDescription(
      [
        "Choose the roles you want.",
        "",
        "Click a button to **add or remove** a role.",
        "",
        "✨ You can change your roles whenever you want."
      ].join("\n")
    )
    .setFooter({
      text:
        "TVB Assistant • Button Roles"
    });

  await interaction.channel.send({
    embeds: [panel],
    components: rows
  });

  return interaction.reply({
    content:
      "✅ Button-role panel posted!",
    ephemeral: true
  });
}

async function toggleButtonRole(
  interaction
) {
  const roleId =
    interaction.customId.replace(
      "role-",
      ""
    );

  const role =
    interaction.guild.roles.cache.get(
      roleId
    );

  if (!role) {
    return interaction.reply({
      content:
        "❌ That role no longer exists.",
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
      "Button role error:",
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
// UPDATE SYSTEM
// ============================================================

function updateEmbed(
  type,
  title,
  description,
  extra
) {
  const typeText =
    type
      ? `**${type.toUpperCase()}**`
      : "**UPDATE**";

  const text = [
    `# ${title}`,
    "",
    `${typeText}`,
    "",
    description,
    extra
      ? `\n${extra}`
      : "",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "TVB • Community Update"
  ].join("\n");

  return new EmbedBuilder()
    .setColor(0x7c5cff)
    .setDescription(text)
    .setTimestamp();
}

// ============================================================
// STAFF / BUILDER MANAGEMENT
// ============================================================

async function staffManagement(
  interaction,
  action
) {
  if (!manager(interaction)) {
    return interaction.reply({
      content:
        "❌ You need Manage Server or Manage Roles to use this command.",
      ephemeral: true
    });
  }

  const user =
    interaction.options.getUser(
      "user"
    );

  const message =
    interaction.options.getString(
      "message"
    );

  if (!user) {
    return interaction.reply({
      content:
        "❌ You must specify a user.",
      ephemeral: true
    });
  }

  const member =
    await interaction.guild.members
      .fetch(user.id)
      .catch(() => null);

  if (!member) {
    return interaction.reply({
      content:
        "❌ That user is not in the server.",
      ephemeral: true
    });
  }

  let roleNames = [];

  if (action === "hire") {
    roleNames = [
      "staff team",
      "helper"
    ];
  }

  if (action === "fire") {
    roleNames = [
      "staff team",
      "helper"
    ];
  }

  if (action === "promote") {
    roleNames = ["staff team"];
  }

  if (action === "demote") {
    roleNames = ["helper"];
  }

  for (const roleName of roleNames) {
    const role =
      findRole(
        interaction.guild,
        roleName
      );

    if (!role) continue;

    if (
      !canManageRole(
        interaction.guild,
        role
      )
    ) {
      return interaction.reply({
        content:
          `❌ My bot role must be above **${role.name}**.`,
        ephemeral: true
      });
    }
  }

  if (
    action === "hire"
  ) {
    const staffTeam =
      await getOrCreateRole(
        interaction.guild,
        "staff team"
      );

    const helper =
      await getOrCreateRole(
        interaction.guild,
        "helper"
      );

    if (!staffTeam || !helper) {
      return interaction.reply({
        content:
          "❌ Required staff roles could not be found or created.",
        ephemeral: true
      });
    }

    if (
      !canManageRole(
        interaction.guild,
        staffTeam
      ) ||
      !canManageRole(
        interaction.guild,
        helper
      )
    ) {
      return interaction.reply({
        content:
          "❌ My bot role must be above the staff team and helper roles.",
        ephemeral: true
      });
    }

    await member.roles.add(
      staffTeam,
      "TVB Assistant • Staff hired"
    );

    await member.roles.add(
      helper,
      "TVB Assistant • Staff hired"
    );
  }

  if (
    action === "fire"
  ) {
    const staffTeam =
      findRole(
        interaction.guild,
        "staff team"
      );

    const helper =
      findRole(
        interaction.guild,
        "helper"
      );

    if (staffTeam) {
      await member.roles.remove(
        staffTeam,
        "TVB Assistant • Staff fired"
      );
    }

    if (helper) {
      await member.roles.remove(
        helper,
        "TVB Assistant • Staff fired"
      );
    }
  }

  if (
    action === "promote"
  ) {
    const staffTeam =
      await getOrCreateRole(
        interaction.guild,
        "staff team"
      );

    if (!staffTeam) {
      return interaction.reply({
        content:
          "❌ The staff team role could not be found or created.",
        ephemeral: true
      });
    }

    if (
      !canManageRole(
        interaction.guild,
        staffTeam
      )
    ) {
      return interaction.reply({
        content:
          "❌ My bot role must be above the staff team role.",
        ephemeral: true
      });
    }

    await member.roles.add(
      staffTeam,
      "TVB Assistant • Staff promoted"
    );
  }

  if (
    action === "demote"
  ) {
    const staffTeam =
      findRole(
        interaction.guild,
        "staff team"
      );

    const helper =
      findRole(
        interaction.guild,
        "helper"
      );

    if (staffTeam) {
      await member.roles.remove(
        staffTeam,
        "TVB Assistant • Staff demoted"
      );
    }

    if (helper) {
      await member.roles.add(
        helper,
        "TVB Assistant • Staff demoted"
      );
    }
  }

  const defaultMessages = {
    hire:
      "You have been hired to the TVB staff team! Welcome aboard. 🎉",
    fire:
      "Your TVB staff position has been removed.",
    promote:
      "You have been promoted within the TVB staff team! 🎉",
    demote:
      "Your TVB staff position has been adjusted."
  };

  const finalMessage =
    replaceVariables(
      message ||
        defaultMessages[action],
      user,
      interaction.guild
    );

  try {
    await user.send(finalMessage);
  } catch {}

  return interaction.reply({
    content:
      `✅ **${user.username}** has been ${action}ed.\n\nMessage sent:\n> ${finalMessage}`,
    ephemeral: true
  });
}

async function builderManagement(
  interaction,
  action
) {
  if (!manager(interaction)) {
    return interaction.reply({
      content:
        "❌ You need Manage Server or Manage Roles to use this command.",
      ephemeral: true
    });
  }

  const user =
    interaction.options.getUser(
      "user"
    );

  const message =
    interaction.options.getString(
      "message"
    );

  if (!user) {
    return interaction.reply({
      content:
        "❌ You must specify a user.",
      ephemeral: true
    });
  }

  const member =
    await interaction.guild.members
      .fetch(user.id)
      .catch(() => null);

  if (!member) {
    return interaction.reply({
      content:
        "❌ That user is not in the server.",
      ephemeral: true
    });
  }

  const builder =
    await getOrCreateRole(
      interaction.guild,
      "biluder"
    );

  if (!builder) {
    return interaction.reply({
      content:
        "❌ The **biluder** role could not be found or created.",
      ephemeral: true
    });
  }

  if (
    !canManageRole(
      interaction.guild,
      builder
    )
  ) {
    return interaction.reply({
      content:
        "❌ My bot role must be above the **biluder** role.",
      ephemeral: true
    });
  }

  if (action === "hire") {
    await member.roles.add(
      builder,
      "TVB Assistant • Builder hired"
    );
  }

  if (action === "fire") {
    await member.roles.remove(
      builder,
      "TVB Assistant • Builder fired"
    );
  }

  const defaultMessages = {
    hire:
      "You have been hired as a TVB builder! 🧱🎉",
    fire:
      "Your TVB builder position has been removed."
  };

  const finalMessage =
    replaceVariables(
      message ||
        defaultMessages[action],
      user,
      interaction.guild
    );

  try {
    await user.send(finalMessage);
  } catch {}

  return interaction.reply({
    content:
      `✅ **${user.username}** has been ${action}ed.\n\nMessage sent:\n> ${finalMessage}`,
    ephemeral: true
  });
}

// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription(
      "Check if TVB Assistant is online."
    ),

  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription(
      "Post the TVB ticket panel."
    ),

  new SlashCommandBuilder()
    .setName("applicationpanel")
    .setDescription(
      "Post the TVB application panel."
    ),

  new SlashCommandBuilder()
    .setName("buttonrole")
    .setDescription(
      "Manage button roles."
    )
    .addSubcommand(sub =>
      sub
        .setName("add")
        .setDescription(
          "Add a role to the button panel."
        )
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription(
              "The role to give."
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("emoji")
            .setDescription(
              "Emoji to display."
            )
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("remove")
        .setDescription(
          "Remove a role from the button panel."
        )
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription(
              "The role to remove."
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("list")
        .setDescription(
          "Show configured button roles."
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("panel")
        .setDescription(
          "Post the button role panel."
        )
    ),

  new SlashCommandBuilder()
    .setName("setwelcome")
    .setDescription(
      "Configure the welcome system."
    )
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription(
          "Welcome channel."
        )
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("message")
        .setDescription(
          "Use {user}, {username}, and {server}."
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setautorole")
    .setDescription(
      "Set the automatic member role."
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription(
          "Role new members receive."
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setticketstaff")
    .setDescription(
      "Set the ticket staff role."
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription(
          "Role that can see tickets."
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setticketcategory")
    .setDescription(
      "Set the ticket category."
    )
    .addChannelOption(option =>
      option
        .setName("category")
        .setDescription(
          "Category where tickets are created."
        )
        .addChannelTypes(
          ChannelType.GuildCategory
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("staff")
    .setDescription(
      "Manage TVB staff."
    )
    .addSubcommand(sub =>
      sub
        .setName("hire")
        .setDescription(
          "Hire a staff member."
        )
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription(
              "User to hire."
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription(
              "Custom DM. Supports {user} and {server}."
            )
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("fire")
        .setDescription(
          "Remove someone from staff."
        )
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription(
              "User to fire."
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription(
              "Custom DM. Supports {user} and {server}."
            )
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("promote")
        .setDescription(
          "Promote a staff member."
        )
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription(
              "User to promote."
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription(
              "Custom DM. Supports {user} and {server}."
            )
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("demote")
        .setDescription(
          "Demote a staff member."
        )
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription(
              "User to demote."
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription(
              "Custom DM. Supports {user} and {server}."
            )
            .setRequired(false)
        )
    ),

  new SlashCommandBuilder()
    .setName("builder")
    .setDescription(
      "Manage TVB builders."
    )
    .addSubcommand(sub =>
      sub
        .setName("hire")
        .setDescription(
          "Hire a builder."
        )
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription(
              "User to hire."
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription(
              "Custom DM. Supports {user} and {server}."
            )
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("fire")
        .setDescription(
          "Remove someone from builders."
        )
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription(
              "User to fire."
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription(
              "Custom DM. Supports {user} and {server}."
            )
            .setRequired(false)
        )
    ),

  new SlashCommandBuilder()
    .setName("update")
    .setDescription(
      "Post a detailed TVB update."
    )
    .addStringOption(option =>
      option
        .setName("type")
        .setDescription(
          "Type of update."
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("title")
        .setDescription(
          "Title of the update."
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("description")
        .setDescription(
          "Main update text."
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("details")
        .setDescription(
          "Additional detailed information."
        )
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("nextsteps")
        .setDescription(
          "What members should know/do next."
        )
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("footer")
        .setDescription(
          "Optional closing message."
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
    const rest = new REST({
      version: "10"
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
      `✅ Registered commands in ${guildId}`
    );
  } catch (error) {
    console.error(
      `❌ Could not register commands in ${guildId}:`,
      error
    );
  }
}

// ============================================================
// READY
// ============================================================

client.once(
  "ready",
  async () => {
    console.log(
      `✅ Logged in as ${client.user.tag}`
    );

    for (const guild of client.guilds.cache.values()) {
      await registerCommands(
        guild.id
      );
    }

    console.log(
      `🚀 TVB Assistant is ready in ${client.guilds.cache.size} server(s).`
    );
  }
);

// ============================================================
// NEW SERVER
// ============================================================

client.on(
  "guildCreate",
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
  "guildMemberAdd",
  async member => {
    const cfg = guildConfig(
      member.guild.id
    );

    // -------------------------
    // AUTOROLE
    // -------------------------

    if (cfg.autorole) {
      const role =
        member.guild.roles.cache.get(
          cfg.autorole
        );

      if (role) {
        if (
          canManageRole(
            member.guild,
            role
          )
        ) {
          try {
            await member.roles.add(
              role,
              "TVB Assistant • Autorole"
            );
          } catch (error) {
            console.error(
              "❌ Could not assign autorole:",
              error
            );
          }
        } else {
          console.error(
            `❌ Cannot assign autorole ${role.name}: bot role is not high enough.`
          );
        }
      }
    }

    // -------------------------
    // WELCOME
    // -------------------------

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
          replaceVariables(
            cfg.welcomeMessage,
            member.user,
            member.guild
          );

        const welcomeEmbed =
          new EmbedBuilder()
            .setColor(0x7c5cff)
            .setTitle(
              "👋 Welcome!"
            )
            .setDescription(
              message
            )
            .setThumbnail(
              member.user.displayAvatarURL(
                {
                  size: 256
                }
              )
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
            "❌ Could not send welcome message:",
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
  "messageCreate",
  async message => {
    if (message.author.bot) return;

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
  "interactionCreate",
  async interaction => {
    try {
      // ======================================================
      // SLASH COMMANDS
      // ======================================================

      if (
        interaction.isChatInputCommand()
      ) {
        // -------------------------------
        // PING
        // -------------------------------

        if (
          interaction.commandName ===
          "ping"
        ) {
          return interaction.reply({
            content:
              "🏓 Pong! TVB Assistant is online.",
            ephemeral: true
          });
        }

        // -------------------------------
        // TICKET PANEL
        // -------------------------------

        if (
          interaction.commandName ===
          "ticketpanel"
        ) {
          if (
            !manager(interaction)
          ) {
            return interaction.reply({
              content:
                "❌ You need Manage Server to use this command.",
              ephemeral: true
            });
          }

          return sendTicketPanel(
            interaction
          );
        }

        // -------------------------------
        // APPLICATION PANEL
        // -------------------------------

        if (
          interaction.commandName ===
          "applicationpanel"
        ) {
          if (
            !manager(interaction)
          ) {
            return interaction.reply({
              content:
                "❌ You need Manage Server to use this command.",
              ephemeral: true
            });
          }

          return sendApplicationPanel(
            interaction
          );
        }

        // -------------------------------
        // BUTTON ROLES
        // -------------------------------

        if (
          interaction.commandName ===
          "buttonrole"
        ) {
          if (
            !manager(interaction)
          ) {
            return interaction.reply({
              content:
                "❌ You need Manage Server to use this command.",
              ephemeral: true
            });
          }

          const subcommand =
            interaction.options.getSubcommand();

          const cfg =
            guildConfig(
              interaction.guild.id
            );

          if (
            subcommand === "panel"
          ) {
            return sendButtonRolePanel(
              interaction
            );
          }

          if (
            subcommand === "add"
          ) {
            const role =
              interaction.options.getRole(
                "role"
              );

            const emoji =
              interaction.options.getString(
                "emoji"
              ) || "🔘";

            if (
              !canManageRole(
                interaction.guild,
                role
              )
            ) {
              return interaction.reply({
                content:
                  "❌ My bot role must be above that role.",
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

          if (
            subcommand ===
            "remove"
          ) {
            const role =
              interaction.options.getRole(
                "role"
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

          if (
            subcommand === "list"
          ) {
            if (
              !cfg.buttonRoles.length
            ) {
              return interaction.reply({
                content:
                  "There are currently no button roles configured.",
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
                .join("\n");

            return interaction.reply({
              content:
                `### 🔘 Button Roles\n\n${
                  list || "None"
                }`,
              ephemeral: true
            });
          }
        }

        // -------------------------------
        // SET WELCOME
        // -------------------------------

        if (
          interaction.commandName ===
          "setwelcome"
        ) {
          if (
            !manager(interaction)
          ) {
            return interaction.reply({
              content:
                "❌ You need Manage Server to use this command.",
              ephemeral: true
            });
          }

          const channel =
            interaction.options.getChannel(
              "channel"
            );

          const message =
            interaction.options.getString(
              "message"
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
              "✅ Welcome system updated!",
            ephemeral: true
          });
        }

        // -------------------------------
        // SET AUTOROLE
        // -------------------------------

        if (
          interaction.commandName ===
          "setautorole"
        ) {
          if (
            !manager(interaction)
          ) {
            return interaction.reply({
              content:
                "❌ You need Manage Server to use this command.",
              ephemeral: true
            });
          }

          const role =
            interaction.options.getRole(
              "role"
            );

          if (
            !canManageRole(
              interaction.guild,
              role
            )
          ) {
            return interaction.reply({
              content:
                "❌ My bot role must be above the autorole.",
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

        // -------------------------------
        // SET TICKET STAFF
        // -------------------------------

        if (
          interaction.commandName ===
          "setticketstaff"
        ) {
          if (
            !manager(interaction)
          ) {
            return interaction.reply({
              content:
                "❌ You need Manage Server to use this command.",
              ephemeral: true
            });
          }

          const role =
            interaction.options.getRole(
              "role"
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

        // -------------------------------
        // SET TICKET CATEGORY
        // -------------------------------

        if (
          interaction.commandName ===
          "setticketcategory"
        ) {
          if (
            !manager(interaction)
          ) {
            return interaction.reply({
              content:
                "❌ You need Manage Server to use this command.",
              ephemeral: true
            });
          }

          const category =
            interaction.options.getChannel(
              "category"
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

        // -------------------------------
        // STAFF COMMANDS
        // -------------------------------

        if (
          interaction.commandName ===
          "staff"
        ) {
          return staffManagement(
            interaction,
            interaction.options.getSubcommand()
          );
        }

        // -------------------------------
        // BUILDER COMMANDS
        // -------------------------------

        if (
          interaction.commandName ===
          "builder"
        ) {
          return builderManagement(
            interaction,
            interaction.options.getSubcommand()
          );
        }

        // -------------------------------
        // UPDATE
        // -------------------------------

        if (
          interaction.commandName ===
          "update"
        ) {
          if (
            !manager(interaction)
          ) {
            return interaction.reply({
              content:
                "❌ You need Manage Server to use this command.",
              ephemeral: true
            });
          }

          const type =
            interaction.options.getString(
              "type"
            );

          const title =
            interaction.options.getString(
              "title"
            );

          const description =
            interaction.options.getString(
              "description"
            );

          const details =
            interaction.options.getString(
              "details"
            );

          const nextsteps =
            interaction.options.getString(
              "nextsteps"
            );

          const footer =
            interaction.options.getString(
              "footer"
            );

          const updateLines = [
            `# ${title}`,
            "",
            `**${type}**`,
            "",
            description
          ];

          if (details) {
            updateLines.push(
              "",
              "**Details**",
              details
            );
          }

          if (nextsteps) {
            updateLines.push(
              "",
              "**What's next?**",
              nextsteps
            );
          }

          if (footer) {
            updateLines.push(
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              footer
            );
          }

          updateLines.push(
            "",
            "— TVB Team"
          );

          const updatesRole =
            findRole(
              interaction.guild,
              "updates"
            );

          const ping =
            updatesRole
              ? `||${updatesRole}||`
              : "||@updates||";

          await interaction.channel.send({
            content: ping,
            embeds: [
              new EmbedBuilder()
                .setColor(0x7c5cff)
                .setDescription(
                  updateLines.join(
                    "\n"
                  )
                )
                .setTimestamp()
            ]
          });

          return interaction.reply({
            content:
              "✅ Detailed update posted!",
            ephemeral: true
          });
        }
      }

      // ======================================================
      // TICKET SELECT MENU
      // ======================================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          "ticket-select"
      ) {
        const type =
          interaction.values[0];

        if (!TICKETS[type]) {
          return interaction.reply({
            content:
              "❌ Invalid ticket type.",
            ephemeral: true
          });
        }

        // REAL DISCORD POPUP
        return interaction.showModal(
          ticketModal(type)
        );
      }

      // ======================================================
      // TICKET MODAL SUBMIT
      // ======================================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          "ticket-modal-"
        )
      ) {
        const type =
          interaction.customId.replace(
            "ticket-modal-",
            ""
          );

        const answers = [];

        for (
          let i = 0;
          i < 5;
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
      // APPLICATION SELECT
      // ======================================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          "application-select"
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
          "role-"
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
          "ticket-close"
      ) {
        return closeTicket(
          interaction
        );
      }

      // ======================================================
      // APPLICATION BUTTONS
      // ======================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          "app-"
        )
      ) {
        const parts =
          interaction.customId.split(
            "-"
          );

        const action =
          parts[1];

        const type =
          parts[2];

        const userId =
          parts.slice(3).join("-");

        if (
          [
            "accept",
            "deny",
            "blacklist"
          ].includes(action)
        ) {
          return handleApplicationDecision(
            interaction,
            action,
            type,
            userId
          );
        }
      }
    } catch (error) {
      console.error(
        "❌ Interaction error:",
        error
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {
        await interaction
          .reply({
            content:
              "❌ Something went wrong while processing that.",
            ephemeral: true
          })
          .catch(() => {});
      }
    }
  }
);

// ============================================================
// ERROR HANDLING
// ============================================================

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "❌ Unhandled promise rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "❌ Uncaught exception:",
      error
    );
  }
);

// ============================================================
// LOGIN
// ============================================================

client
  .login(TOKEN)
  .then(() => {
    console.log(
      "🔐 Discord login successful."
    );
  })
  .catch(error => {
    console.error(
      "❌ Discord login failed:",
      error
    );
  });
