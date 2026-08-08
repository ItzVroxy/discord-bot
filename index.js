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

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN environment variable.");
  process.exit(1);
}

/* =========================================================
   WEB SERVER
========================================================= */

const app = express();
const PORT = process.env.PORT || 10000;

app.get("/", (_req, res) => {
  res.status(200).send("TVB Assistant is online.");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Web server listening on ${PORT}`);
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
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

/* =========================================================
   CONFIG
========================================================= */

const CONFIG_FILE = "./config.json";
let config = {};

try {
  if (fs.existsSync(CONFIG_FILE)) {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  }
} catch (error) {
  console.error("Could not load config:", error);
}

function saveConfig() {
  try {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(config, null, 2)
    );
  } catch (error) {
    console.error("Could not save config:", error);
  }
}

function guildConfig(id) {
  if (!config[id]) {
    config[id] = {
      welcomeChannel: null,
      welcomeMessage:
        "Welcome {user} to **{server}**! 🎉",

      autorole: null,

      ticketCategory: null,
      ticketStaffRole: null,

      buttonRoles: [],

      updatesChannel: null,

      roleNames: {
        staffTeam: "Staff Team",
        helper: "Helper",
        builder: "Builder",
        staffBlacklist: "Staff Application Blacklist",
        builderBlacklist: "Builder Application Blacklist"
      }
    };
  }

  const c = config[id];

  if (!Array.isArray(c.buttonRoles)) {
    c.buttonRoles = [];
  }

  if (!c.roleNames) {
    c.roleNames = {
      staffTeam: "Staff Team",
      helper: "Helper",
      builder: "Builder",
      staffBlacklist: "Staff Application Blacklist",
      builderBlacklist: "Builder Application Blacklist"
    };
  }

  return c;
}

/* =========================================================
   HELPERS
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

function safe(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60) || "user";
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
      channel.name.toLowerCase() === name.toLowerCase()
  );
}

function findRole(guild, name) {
  return guild.roles.cache.find(
    role =>
      role.name.toLowerCase() === name.toLowerCase()
  );
}

function replaceVariables(text, user, server) {
  return String(text)
    .replace(/\{user\}/gi, `${user}`)
    .replace(/\{username\}/gi, user.username)
    .replace(/\{server\}/gi, server.name);
}

/* =========================================================
   TICKETS
========================================================= */

const TICKETS = {
  general: {
    label: "General Support",
    emoji: "💬",
    desc: "Questions, help, bugs, or anything else.",
    questions: [
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
    desc: "Purchases, payments, orders, or missing items.",
    questions: [
      "What did you purchase?",
      "When did you purchase it?",
      "What went wrong?",
      "Do you have an order or transaction ID?",
      "What would you like us to do?"
    ]
  },

  player: {
    label: "Player Report",
    emoji: "🚨",
    desc: "Report cheating, rule breaking, or another player.",
    questions: [
      "What is the player's username?",
      "What happened?",
      "When and where did it happen?",
      "Do you have proof, screenshots, or video?",
      "Anything else staff should know?"
    ]
  },

  staff: {
    label: "Staff Report",
    emoji: "🛡️",
    desc: "Report a concern involving a staff member.",
    questions: [
      "Which staff member is this about?",
      "Please describe exactly what happened.",
      "When and where did this happen?",
      "Do you have screenshots, video, or other evidence?",
      "What outcome are you hoping for?"
    ]
  }
};

const ticketSessions = new Map();

function ticketMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("ticket-select")
      .setPlaceholder("🎫 Select support type...")
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

async function createTicket(interaction, type) {
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

  const existing = guild.channels.cache.find(
    channel =>
      channel.type === ChannelType.GuildText &&
      channel.topic === `TVB-TICKET:${member.id}`
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
    console.error("Could not create ticket:", error);

    return interaction.reply({
      content:
        "❌ I couldn't create the ticket. Make sure I have **Manage Channels** and **Manage Roles**.",
      ephemeral: true
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`ticket-modal-${type}-${channel.id}`)
    .setTitle(ticket.label);

  const inputs = [];

  for (let i = 0; i < ticket.questions.length; i++) {
    inputs.push(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(`question-${i}`)
          .setLabel(
            ticket.questions[i].slice(0, 45)
          )
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      )
    );
  }

  modal.addComponents(inputs);

  ticketSessions.set(channel.id, {
    userId: member.id,
    type
  });

  await interaction.showModal(modal);
}

/* =========================================================
   APPLICATIONS
========================================================= */

const APPS = {
  builder: {
    label: "Builder Application",
    emoji: "🧱",
    channel: "#📋・builder-submissions",

    questions: [
      "Minecraft username?",
      "Age?",
      "Timezone?",
      "What role are you applying for?",
      "How long have you been building in Minecraft?",
      "Which building styles are you most experienced with?",
      "What types of projects do you feel you contribute to best?",
      "What is a build you are particularly proud of, and why?",
      "How do you approach planning a large project before beginning construction?",
      "How do you respond when someone gives you critical feedback on your work?",
      "How comfortable are you working as part of a larger build team?",
      "How many hours per week can you realistically dedicate to TVB?",
      "What do you believe separates an average build from an exceptional one?",
      "How would you handle a disagreement with another builder about the direction of a project?",
      "Why do you believe you would be a valuable addition to the TVB building team?"
    ]
  },

  staff: {
    label: "Staff Application",
    emoji: "🛡️",
    channel: "#📋・staff-submissions",

    questions: [
      "Discord username?",
      "Age?",
      "Timezone?",
      "What role are you applying for?",
      "How long have you been part of the TVB community?",
      "Have you held a moderation or staff position before? If so, describe your responsibilities.",
      "What qualities do you believe define an effective and trustworthy staff member?",
      "How would you handle a disagreement between two members without allowing personal bias to influence your decision?",
      "A close friend of yours breaks a rule. How would you handle the situation?",
      "How would you respond to a member who repeatedly ignores reasonable warnings?",
      "How would you investigate a player report before making a disciplinary decision?",
      "How would you handle a situation where you believe another staff member made an incorrect decision?",
      "What steps would you take to protect confidential staff information?",
      "What strengths would you bring to the TVB staff team, and how would those strengths benefit the community?",
      "What is one area of your communication, leadership, or moderation ability that you are actively trying to improve?"
    ]
  }
};

const appSessions = new Map();

/* =========================================================
   APPLICATION MENU
========================================================= */

function appMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("application-select")
      .setPlaceholder("📋 Choose an application...")
      .addOptions(
        Object.entries(APPS).map(
          ([value, application]) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(application.label)
              .setValue(value)
              .setEmoji(application.emoji)
              .setDescription(
                "Complete 15 questions privately in DMs."
              )
        )
      )
  );
}

/* =========================================================
   APPLICATION START
========================================================= */

async function startApplication(interaction, type) {
  const application = APPS[type];

  if (!application) {
    return interaction.reply({
      content: "❌ Invalid application type.",
      ephemeral: true
    });
  }

  if (appSessions.has(interaction.user.id)) {
    return interaction.reply({
      content:
        "❌ You already have an application in progress. Check your DMs.",
      ephemeral: true
    });
  }

  try {
    const dm = await interaction.user.createDM();

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
        `📋 **${application.label} started!**\n\n` +
        "I've sent you a DM with your questions.\n\n" +
        "⚠️ Make sure your Discord DMs are enabled.",
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
      await interaction.reply({
        content:
          "❌ I couldn't DM you. Please enable your Discord DMs and try again.",
        ephemeral: true
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
    application.questions.length
  ) {
    return finishApplication(
      dm,
      session
    );
  }

  const question =
    application.questions[
      session.questionIndex
    ];

  await dm.send({
    embeds: [
      embed(
        `${application.emoji} ${application.label}`,
        [
          `### Question ${
            session.questionIndex + 1
          } of ${application.questions.length}`,
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

/* =========================================================
   APPLICATION SUBMISSION
========================================================= */

function applicationButtons(type, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `app-accept-${type}-${userId}`
      )
      .setLabel("Accept")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(
        `app-deny-${type}-${userId}`
      )
      .setLabel("Deny")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId(
        `app-blacklist-${type}-${userId}`
      )
      .setLabel("Blacklist")
      .setEmoji("🚫")
      .setStyle(ButtonStyle.Secondary)
  );
}

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
              `but I couldn't find **${application.channel}**.`,
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

    const roleAnswer =
      session.answers[3] ||
      "Not specified";

    const header = embed(
      `${application.emoji} New ${application.label}`,
      [
        `**Applicant:** ${member}`,
        `**Username:** ${member.user.tag}`,
        `**User ID:** ${member.id}`,
        `**Requested Role:** ${roleAnswer}`,
        "",
        "📋 **Application Answers**",
        "",
        "Review the answers below and choose an action."
      ].join("\n")
    );

    await submissionChannel.send({
      embeds: [header],
      components: [
        applicationButtons(
          session.type,
          member.id
        )
      ]
    });

    for (
      let i = 0;
      i < application.questions.length;
      i++
    ) {
      await submissionChannel.send({
        embeds: [
          embed(
            `Question ${i + 1} • ${application.label}`,
            [
              `**${application.questions[i]}**`,
              "",
              session.answers[i] ||
                "No answer provided."
            ].join("\n")
          )
        ]
      });
    }

    await dm.send({
      embeds: [
        embed(
          "✅ Application Submitted!",
          [
            `Your **${application.label}** has been submitted successfully.`,
            "",
            "Staff will review your application.",
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

    await dm.send({
      content:
        "❌ Something went wrong while submitting your application. Please contact staff."
    }).catch(() => {});

    appSessions.delete(
      session.userId
    );
  }
}

/* =========================================================
   APPLICATION DM HANDLER
========================================================= */

async function handleApplicationDM(message) {
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

/* =========================================================
   APPLICATION PANEL
========================================================= */

async function sendApplicationPanel(interaction) {
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
      text: "TVB Assistant • Applications"
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

/* =========================================================
   APPLICATION REVIEW
========================================================= */

async function reviewApplication(
  interaction,
  action,
  type,
  userId
) {
  if (!manager(interaction)) {
    return interaction.reply({
      content:
        "❌ You need Manage Server or Manage Roles to review applications.",
      ephemeral: true
    });
  }

  const guild =
    interaction.guild;

  let member;

  try {
    member =
      await guild.members.fetch(
        userId
      );
  } catch {
    return interaction.reply({
      content:
        "❌ I couldn't find that member. They may have left the server.",
      ephemeral: true
    });
  }

  const cfg =
    guildConfig(guild.id);

  const roles = cfg.roleNames;

  let roleNames = [];

  if (type === "staff") {
    if (action === "accept") {
      roleNames = [
        roles.staffTeam,
        roles.helper
      ];
    }

    if (action === "blacklist") {
      roleNames = [
        roles.staffBlacklist
      ];
    }
  }

  if (type === "builder") {
    if (action === "accept") {
      roleNames = [
        roles.builder
      ];
    }

    if (action === "blacklist") {
      roleNames = [
        roles.builderBlacklist
      ];
    }
  }

  try {
    for (const roleName of roleNames) {
      const role =
        findRole(
          guild,
          roleName
        );

      if (!role) {
        return interaction.reply({
          content:
            `❌ I couldn't find the role **${roleName}**. Create it first or rename it in the bot configuration.`,
          ephemeral: true
        });
      }

      if (
        role.position >=
        guild.members.me.roles.highest.position
      ) {
        return interaction.reply({
          content:
            `❌ My bot role must be above **${role.name}**.`,
          ephemeral: true
        });
      }

      await member.roles.add(
        role,
        `TVB Assistant application ${action}`
      );
    }

    const actionText =
      action === "accept"
        ? "Accepted"
        : action === "deny"
          ? "Denied"
          : "Blacklisted";

    const actionEmoji =
      action === "accept"
        ? "✅"
        : action === "deny"
          ? "❌"
          : "🚫";

    await interaction.update({
      embeds: [
        embed(
          `${actionEmoji} Application ${actionText}`,
          [
            `**Applicant:** ${member}`,
            `**Application:** ${APPS[type].label}`,
            `**Reviewed by:** ${interaction.user}`,
            "",
            `This application has been **${actionText.toLowerCase()}**.`
          ].join("\n"),
          action === "accept"
            ? 0x57f287
            : action === "deny"
              ? 0xed4245
              : 0x2b2d31
        )
      ],
      components: []
    });

    return;
  } catch (error) {
    console.error(
      "Application review error:",
      error
    );

    return interaction.reply({
      content:
        "❌ I couldn't update the applicant's roles. Check my permissions and make sure my bot role is above the roles.",
      ephemeral: true
    });
  }
}

/* =========================================================
   ROLE BUTTONS
========================================================= */

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
  const cfg =
    guildConfig(
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

  const panel =
    new EmbedBuilder()
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

/* =========================================================
   TICKET PANEL
========================================================= */

async function sendTicketPanel(interaction) {
  const panel =
    new EmbedBuilder()
      .setColor(0x7c5cff)
      .setTitle(
        "🎫 TVB Support Center"
      )
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
          "Select an option below to get started."
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

/* =========================================================
   TICKET MODAL SUBMISSION
========================================================= */

async function handleTicketModal(
  interaction
) {
  const parts =
    interaction.customId.split("-");

  const type =
    parts[2];

  const channelId =
    parts[3];

  const session =
    ticketSessions.get(
      channelId
    );

  if (!session) {
    return interaction.reply({
      content:
        "❌ This ticket session has expired.",
      ephemeral: true
    });
  }

  const channel =
    interaction.guild.channels.cache.get(
      channelId
    );

  if (!channel) {
    return interaction.reply({
      content:
        "❌ The ticket channel no longer exists.",
      ephemeral: true
    });
  }

  const ticket =
    TICKETS[type];

  const answers = [];

  for (
    let i = 0;
    i < ticket.questions.length;
    i++
  ) {
    answers.push(
      interaction.fields.getTextInputValue(
        `question-${i}`
      )
    );
  }

  ticketSessions.set(
    channelId,
    {
      ...session,
      answers
    }
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

  const lines = [];

  for (
    let i = 0;
    i < ticket.questions.length;
    i++
  ) {
    lines.push(
      `**${i + 1}. ${ticket.questions[i]}**`,
      `> ${answers[i]}`,
      ""
    );
  }

  await channel.send({
    content:
      `${interaction.member}${staffRole ? ` ${staffRole}` : ""}`,
    embeds: [
      embed(
        `${ticket.emoji} ${ticket.label}`,
        [
          `**Ticket created by:** ${interaction.member}`,
          "",
          ...lines,
          "━━━━━━━━━━━━━━━━━━━━",
          "A staff member can now assist you."
        ].join("\n")
      )
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(
            "ticket-close"
          )
          .setLabel(
            "Close Ticket"
          )
          .setEmoji("🔒")
          .setStyle(
            ButtonStyle.Danger
          )
      )
    ]
  });

  return interaction.reply({
    content:
      `✅ Your ticket has been created: ${channel}`,
    ephemeral: true
  });
}

/* =========================================================
   CLOSE TICKET
========================================================= */

async function closeTicket(interaction) {
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
      ephemeral: true
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
        "❌ Only the ticket creator or ticket staff can close this ticket.",
      ephemeral: true
    });
  }

  await interaction.reply({
    content:
      "🔒 Closing this ticket in 5 seconds..."
  });

  ticketSessions.delete(
    channel.id
  );

  setTimeout(
    async () => {
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
    },
    5000
  );
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
  const typeText =
    type
      ? type.toUpperCase()
      : "UPDATE";

  return new EmbedBuilder()
    .setColor(0x7c5cff)
    .setDescription(
      [
        `**${typeText}** • **${title}**`,
        "",
        description,
        extra
          ? `\n${extra}`
          : ""
      ].join("\n")
    )
    .setFooter({
      text:
        "TVB • Updates"
    })
    .setTimestamp();
}

async function sendUpdate(
  interaction
) {
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

  const extra =
    interaction.options.getString(
      "extra"
    );

  const cfg =
    guildConfig(
      interaction.guild.id
    );

  const updatesRole =
    interaction.guild.roles.cache.find(
      role =>
        role.name.toLowerCase() ===
        "updates"
    );

  const ping =
    updatesRole
      ? `${updatesRole}`
      : "@updates";

  const hiddenPing =
    `||${ping}||`;

  await interaction.channel.send({
    content:
      hiddenPing,
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
      "✅ Update posted!",
    ephemeral: true
  });
}

/* =========================================================
   STAFF / BUILDER MANAGEMENT
========================================================= */

async function performStaffAction(
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

  const target =
    interaction.options.getUser(
      "user"
    );

  const message =
    interaction.options.getString(
      "message"
    );

  if (!target) {
    return interaction.reply({
      content:
        "❌ Please provide a user.",
      ephemeral: true
    });
  }

  let member;

  try {
    member =
      await interaction.guild.members.fetch(
        target.id
      );
  } catch {
    return interaction.reply({
      content:
        "❌ That user isn't in the server.",
      ephemeral: true
    });
  }

  const cfg =
    guildConfig(
      interaction.guild.id
    );

  const roleNames =
    cfg.roleNames;

  let roleName;

  if (action === "hire") {
    roleName =
      roleNames.staffTeam;
  }

  if (action === "fire") {
    roleName =
      roleNames.staffTeam;
  }

  if (action === "promote") {
    roleName =
      roleNames.staffTeam;
  }

  if (action === "demote") {
    roleName =
      roleNames.helper;
  }

  const role =
    findRole(
      interaction.guild,
      roleName
    );

  if (!role) {
    return interaction.reply({
      content:
        `❌ I couldn't find the role **${roleName}**.`,
      ephemeral: true
    });
  }

  try {
    if (
      action === "hire" ||
      action === "promote"
    ) {
      await member.roles.add(
        role,
        `TVB Assistant ${action}`
      );
    }

    if (
      action === "fire" ||
      action === "demote"
    ) {
      await member.roles.remove(
        role,
        `TVB Assistant ${action}`
      );
    }

    const status =
      action === "hire"
        ? "Hired"
        : action === "fire"
          ? "Fired"
          : action === "promote"
            ? "Promoted"
            : "Demoted";

    const fromRole =
      action === "promote"
        ? "Helper"
        : action === "demote"
          ? "Staff"
          : "Member";

    const toRole =
      action === "fire"
        ? "Member"
        : action === "demote"
          ? "Helper"
          : role.name;

    const customMessage =
      replaceVariables(
        message ||
          "Welcome to the team!",
        target,
        interaction.guild
      );

    await interaction.channel.send({
      content:
        `${status === "Hired" || status === "Promoted" ? "🟢" : "🔴"} \`[${status}]\` - ${target}  ${fromRole} --> @${toRole}\n\n-# ${customMessage}`
    });

    return interaction.reply({
      content:
        `✅ ${status} ${target}.`,
      ephemeral: true
    });
  } catch (error) {
    console.error(
      "Staff action error:",
      error
    );

    return interaction.reply({
      content:
        "❌ I couldn't update that user's roles. Check my bot permissions and role hierarchy.",
      ephemeral: true
    });
  }
}

async function performBuilderAction(
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

  const target =
    interaction.options.getUser(
      "user"
    );

  const message =
    interaction.options.getString(
      "message"
    );

  let member;

  try {
    member =
      await interaction.guild.members.fetch(
        target.id
      );
  } catch {
    return interaction.reply({
      content:
        "❌ That user isn't in the server.",
      ephemeral: true
    });
  }

  const cfg =
    guildConfig(
      interaction.guild.id
    );

  const role =
    findRole(
      interaction.guild,
      cfg.roleNames.builder
    );

  if (!role) {
    return interaction.reply({
      content:
        `❌ I couldn't find the role **${cfg.roleNames.builder}**.`,
      ephemeral: true
    });
  }

  try {
    if (action === "hire") {
      await member.roles.add(
        role,
        "TVB Assistant builder hire"
      );
    } else {
      await member.roles.remove(
        role,
        "TVB Assistant builder fire"
      );
    }

    const status =
      action === "hire"
        ? "Hired"
        : "Fired";

    const customMessage =
      replaceVariables(
        message ||
          "Welcome to the building team!",
        target,
        interaction.guild
      );

    await interaction.channel.send({
      content:
        `${action === "hire" ? "🟢" : "🔴"} \`[${status}]\` - ${target}  Member --> @${role.name}\n\n-# ${customMessage}`
    });

    return interaction.reply({
      content:
        `✅ ${status} ${target} as a builder.`,
      ephemeral: true
    });
  } catch (error) {
    console.error(
      "Builder action error:",
      error
    );

    return interaction.reply({
      content:
        "❌ I couldn't update that user's builder role.",
      ephemeral: true
    });
  }
}

/* =========================================================
   SLASH COMMANDS
========================================================= */

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
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("remove")
        .setDescription(
          "Remove a role from the panel."
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
          "List configured button roles."
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("panel")
        .setDescription(
          "Post the button-role panel."
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
              "Custom message. Supports {user} and {server}."
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("fire")
        .setDescription(
          "Fire a staff member."
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
              "Custom message."
            )
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
              "Custom message."
            )
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
              "Custom message."
            )
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
              "Custom message."
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("fire")
        .setDescription(
          "Fire a builder."
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
              "Custom message."
            )
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
          "Update category."
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("title")
        .setDescription(
          "Update title."
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
        .setName("extra")
        .setDescription(
          "Additional information."
        )
    )
].map(command =>
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
      `Registered commands in ${guildId}`
    );
  } catch (error) {
    console.error(
      `Could not register commands in ${guildId}:`,
      error
    );
  }
}

/* =========================================================
   READY
========================================================= */

client.once(
  "ready",
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

client.on(
  "guildCreate",
  async guild => {
    await registerCommands(
      guild.id
    );
  }
);

/* =========================================================
   MEMBER JOIN
========================================================= */

client.on(
  "guildMemberAdd",
  async member => {
    const cfg =
      guildConfig(
        member.guild.id
      );

    /* AUTOROLE */

    if (cfg.autorole) {
      const role =
        member.guild.roles.cache.get(
          cfg.autorole
        );

      if (role) {
        try {
          await member.roles.add(
            role
          );
        } catch (error) {
          console.error(
            "Could not assign autorole:",
            error
          );
        }
      }
    }

    /* WELCOME */

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
            "Could not send welcome message:",
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
  "messageCreate",
  async message => {
    if (message.author.bot)
      return;

    if (!message.guild) {
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
  "interactionCreate",
  async interaction => {
    try {
      /* =====================================================
         MODALS
      ===================================================== */

      if (
        interaction.isModalSubmit()
      ) {
        if (
          interaction.customId.startsWith(
            "ticket-modal-"
          )
        ) {
          return handleTicketModal(
            interaction
          );
        }
      }

      /* =====================================================
         SLASH COMMANDS
      ===================================================== */

      if (
        interaction.isChatInputCommand()
      ) {
        /* PING */

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

        /* TICKET PANEL */

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

        /* APPLICATION PANEL */

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

        /* BUTTON ROLE */

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
            subcommand ===
            "panel"
          ) {
            return sendButtonRolePanel(
              interaction
            );
          }

          if (
            subcommand ===
            "add"
          ) {
            const role =
              interaction.options.getRole(
                "role"
              );

            const emoji =
              interaction.options.getString(
                "emoji"
              ) || "🔘";

            const botMember =
              interaction.guild.members.me;

            if (
              !botMember ||
              role.position >=
                botMember.roles.highest.position
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
            subcommand ===
            "list"
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
                `### 🔘 Button Roles\n\n${list || "None"}`,
              ephemeral: true
            });
          }
        }

        /* WELCOME */

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

        /* AUTOROLE */

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

          const botMember =
            interaction.guild.members.me;

          if (
            !botMember ||
            role.position >=
              botMember.roles.highest.position
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

        /* TICKET STAFF */

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

        /* TICKET CATEGORY */

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

        /* STAFF COMMAND */

        if (
          interaction.commandName ===
          "staff"
        ) {
          const subcommand =
            interaction.options.getSubcommand();

          return performStaffAction(
            interaction,
            subcommand
          );
        }

        /* BUILDER COMMAND */

        if (
          interaction.commandName ===
          "builder"
        ) {
          const subcommand =
            interaction.options.getSubcommand();

          return performBuilderAction(
            interaction,
            subcommand
          );
        }

        /* UPDATE */

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

          return sendUpdate(
            interaction
          );
        }
      }

      /* =====================================================
         TICKET SELECT
      ===================================================== */

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          "ticket-select"
      ) {
        const type =
          interaction.values[0];

        return createTicket(
          interaction,
          type
        );
      }

      /* =====================================================
         APPLICATION SELECT
      ===================================================== */

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

      /* =====================================================
         ROLE BUTTON
      ===================================================== */

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

      /* =====================================================
         TICKET CLOSE
      ===================================================== */

      if (
        interaction.isButton() &&
        interaction.customId ===
          "ticket-close"
      ) {
        return closeTicket(
          interaction
        );
      }

      /* =====================================================
         APPLICATION REVIEW BUTTONS
      ===================================================== */

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          "app-"
        )
      ) {
        const parts =
          interaction.customId.split("-");

        const action =
          parts[1];

        const type =
          parts[2];

        const userId =
          parts[3];

        if (
          ["accept", "deny", "blacklist"].includes(
            action
          )
        ) {
          return reviewApplication(
            interaction,
            action,
            type,
            userId
          );
        }
      }
    } catch (error) {
      console.error(
        "Interaction error:",
        error
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {
        await interaction.reply({
          content:
            "❌ Something went wrong while processing that.",
          ephemeral: true
        }).catch(() => {});
      }
    }
  }
);

/* =========================================================
   ERROR HANDLING
========================================================= */

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "Unhandled promise rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "Uncaught exception:",
      error
    );
  }
);

/* =========================================================
   LOGIN
========================================================= */

client.login(TOKEN);
