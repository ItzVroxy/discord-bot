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
  StringSelectMenuOptionBuilder
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

const PORT = process.env.PORT || 10000;

const CONFIG_FILE = "./config.json";

// ============================================================
// WEB SERVER
// ============================================================

const app = express();

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
// CONFIG SYSTEM
// ============================================================

let config = {};

try {
  if (fs.existsSync(CONFIG_FILE)) {
    config = JSON.parse(
      fs.readFileSync(CONFIG_FILE, "utf8")
    );
  }
} catch (error) {
  console.error("❌ Could not load config:", error);
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

      strikes: {
        staff: {},
        builder: {}
      }
    };
  }

  const c = config[id];

  if (!c.strikes) {
    c.strikes = {
      staff: {},
      builder: {}
    };
  }

  if (!c.strikes.staff) {
    c.strikes.staff = {};
  }

  if (!c.strikes.builder) {
    c.strikes.builder = {};
  }

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
// HELPERS
// ============================================================

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

async function role(guild, name) {
  const existing = guild.roles.cache.find(
    r => r.name.toLowerCase() === name.toLowerCase()
  );

  if (existing) {
    return existing;
  }

  return guild.roles.create({
    name,
    reason: "TVB Assistant team system"
  });
}

// ============================================================
// TICKETS
// ============================================================

const TICKETS = {
  general: {
    label: "General Support",
    emoji: "💬",
    desc: "Questions, help, bugs, or anything else.",

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
    desc: "Purchases, payments, orders, or missing items.",

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
    desc: "Report cheating, rule breaking, or another player.",

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
    desc: "Report a concern involving a staff member.",

    q: [
      "Which staff member?",
      "What happened?",
      "When and where?",
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
    channel: "builder-submissions",

    q: [
      "Minecraft username?",
      "Age?",
      "Timezone?",
      "How long have you built in Minecraft?",
      "What builds do you like?",
      "Best building style?",
      "Favorite thing to build?",
      "What are you still learning?",
      "Hours you can build each week?",
      "Why TVB?",
      "How do you handle feedback?",
      "Alone or team?",
      "Send a build screenshot/link?",
      "What makes a build look good?",
      "What if another builder disagrees?"
    ]
  },

  staff: {
    label: "Staff Application",
    emoji: "🛡️",
    channel: "staff-submissions",

    q: [
      "Discord username?",
      "Age?",
      "Timezone?",
      "How long in the community?",
      "Been staff before?",
      "Hours active each week?",
      "Why TVB staff?",
      "What makes good staff?",
      "How handle an argument?",
      "What if your friend breaks a rule?",
      "What if someone ignores a warning?",
      "How handle a player report?",
      "How keep staff info private?",
      "What strength do you bring?",
      "What do you want to improve?"
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

// ============================================================
// APPLICATION MENU
// ============================================================

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
                "15 questions • completed privately in DMs"
              )
        )
      )
  );
}

// ============================================================
// CREATE TICKET
// ============================================================

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
    console.error("❌ Could not create ticket:", error);

    return interaction.reply({
      content:
        "❌ I couldn't create the ticket. Make sure I have **Manage Channels** and **Manage Roles** permissions.",
      ephemeral: true
    });
  }

  ticketSessions.set(channel.id, {
    userId: member.id,
    type,
    currentQuestion: 0,
    answers: []
  });

  const ticketEmbed = embed(
    `${ticket.emoji} ${ticket.label}`,

    [
      `Welcome ${member}!`,
      "",
      `**${ticket.desc}**`,
      "",
      "Please answer the questions below.",
      "A staff member will review your ticket shortly.",
      "",
      `### 📝 Question 1 of ${ticket.q.length}`,
      `> ${ticket.q[0]}`
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

  await channel.send({
    content:
      `${member}${staffRole ? ` ${staffRole}` : ""}`,

    embeds: [ticketEmbed],

    components: [buttons]
  });

  return interaction.reply({
    content:
      `✅ Your ticket has been created: ${channel}`,
    ephemeral: true
  });
}

// ============================================================
// NEXT TICKET QUESTION
// ============================================================

async function nextTicketQuestion(
  channel,
  session
) {
  const ticket = TICKETS[session.type];

  if (
    session.currentQuestion >=
    ticket.q.length
  ) {
    const summary = embed(
      `📋 ${ticket.label} Information`,

      ticket.q
        .map(
          (question, index) =>
            `**${index + 1}. ${question}**\n> ${
              session.answers[index] ||
              "No answer provided."
            }`
        )
        .join("\n\n")
    );

    await channel.send({
      embeds: [
        embed(
          `${ticket.emoji} Ticket Information Collected`,

          "Thanks! Your ticket information has been collected.\n\nA staff member will be with you shortly."
        ),

        summary
      ]
    });

    ticketSessions.delete(channel.id);

    return;
  }

  await channel.send({
    embeds: [
      embed(
        `${ticket.emoji} ${ticket.label}`,

        [
          `### 📝 Question ${
            session.currentQuestion + 1
          } of ${ticket.q.length}`,

          "",

          ticket.q[
            session.currentQuestion
          ]
        ].join("\n")
      )
    ]
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

  const cfg =
    guildConfig(interaction.guild.id);

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
        "❌ Only the ticket creator or ticket staff can close this ticket.",
      ephemeral: true
    });
  }

  await interaction.reply({
    content:
      "🔒 Closing this ticket in 5 seconds..."
  });

  setTimeout(async () => {
    try {
      await channel.delete(
        "TVB Assistant ticket closed"
      );
    } catch (error) {
      console.error(
        "❌ Could not delete ticket:",
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
        "Select an option below to get started."
      ].join("\n")
    )

    .setFooter({
      text: "TVB Assistant • Support Center"
    })

    .setTimestamp();

  await interaction.channel.send({
    embeds: [panel],
    components: [ticketMenu()]
  });

  return interaction.reply({
    content: "✅ Ticket panel posted!",
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
        `📋 **${application.label} started!**\n\n` +
        `I've sent you a DM with your questions.\n\n` +
        `⚠️ Make sure your Discord DMs are enabled.`,

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
            "💬 Just type your answer normally.",
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
      "❌ Could not start application:",
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
// NEXT APPLICATION QUESTION
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

    await submissionChannel.send({
      embeds: [
        embed(
          `${application.emoji} New ${application.label}`,

          [
            `**Applicant:** ${member}`,
            `**Username:** ${member.user.tag}`,
            `**User ID:** ${member.id}`,
            "",
            "📋 **Application Answers**"
          ].join("\n")
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
      "❌ Could not finish application:",
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
          `✅ **Answer ${session.questionIndex}/${15} saved!**`
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

// ============================================================
// EMOJI PARSER
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

// ============================================================
// ROLE BUTTON
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

// ============================================================
// BUTTON ROLE PANEL
// ============================================================

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

  if (
    row.components.length
  ) {
    rows.push(row);
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

// ============================================================
// TOGGLE ROLE
// ============================================================

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
      "❌ Button role error:",
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
// STAFF / BUILDER COMMANDS
// ============================================================

async function handleStaffCommand(
  interaction
) {
  if (!moderator(interaction)) {
    return interaction.reply({
      content:
        "❌ You need moderation permissions to use this command.",
      ephemeral: true
    });
  }

  return interaction.reply({
    content:
      "🛡️ Staff command is working.",
    ephemeral: true
  });
}

async function handleBuilderCommand(
  interaction
) {
  if (!manager(interaction)) {
    return interaction.reply({
      content:
        "❌ You need Manage Server to use this command.",
      ephemeral: true
    });
  }

  return interaction.reply({
    content:
      "🧱 Builder command is working.",
    ephemeral: true
  });
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
  let emoji = "📢";

  if (type === "announcement") {
    emoji = "📢";
  }

  if (type === "update") {
    emoji = "🔔";
  }

  if (type === "event") {
    emoji = "🎉";
  }

  if (type === "important") {
    emoji = "⚠️";
  }

  return new EmbedBuilder()
    .setColor(0x7c5cff)
    .setTitle(`${emoji} ${title}`)
    .setDescription(description)
    .addFields(
      extra
        ? [
            {
              name: "Additional Information",
              value: extra
            }
          ]
        : []
    )
    .setFooter({
      text: `TVB Assistant • ${type}`
    })
    .setTimestamp();
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
              "Emoji to display on the button."
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
      "Staff management command."
    ),

  new SlashCommandBuilder()
    .setName("builder")
    .setDescription(
      "Builder management command."
    ),

  new SlashCommandBuilder()
    .setName("update")
    .setDescription(
      "Post an update."
    )

    .addStringOption(option =>
      option
        .setName("type")
        .setDescription(
          "Update type."
        )
        .setRequired(true)

        .addChoices(
          {
            name: "Announcement",
            value: "announcement"
          },

          {
            name: "Update",
            value: "update"
          },

          {
            name: "Event",
            value: "event"
          },

          {
            name: "Important",
            value: "important"
          }
        )
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
          "Update description."
        )
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName("extra")
        .setDescription(
          "Optional additional information."
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
      `🤖 Logged in as ${client.user.tag}`
    );

    for (
      const guild of client.guilds.cache.values()
    ) {
      await registerCommands(
        guild.id
      );
    }

    console.log(
      `✅ TVB Assistant is ready in ${client.guilds.cache.size} server(s).`
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
    const cfg =
      guildConfig(
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
          } else {
            console.error(
              `❌ Cannot assign autorole ${role.name}: bot role is not high enough.`
            );
          }

        } catch (error) {
          console.error(
            "❌ Could not assign autorole:",
            error
          );
        }
      }
    }

    // -------------------------
    // WELCOME MESSAGE
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
            "❌ Could not send welcome message:",
            error
          );
        }
      }
    }
  }
);

// ============================================================
// MESSAGES
// ============================================================

client.on(
  "messageCreate",
  async message => {
    if (message.author.bot) {
      return;
    }

    // -------------------------
    // APPLICATION DMs
    // -------------------------

    if (!message.guild) {
      await handleApplicationDM(
        message
      );

      return;
    }

    // -------------------------
    // TICKET ANSWERS
    // -------------------------

    const session =
      ticketSessions.get(
        message.channel.id
      );

    if (!session) {
      return;
    }

    if (
      message.author.id !==
      session.userId
    ) {
      return;
    }

    const answer =
      message.content.trim();

    if (!answer) {
      return;
    }

    if (
      answer.toLowerCase() ===
      "cancel"
    ) {
      ticketSessions.delete(
        message.channel.id
      );

      await message.channel.send({
        embeds: [
          embed(
            "❌ Ticket Questions Cancelled",
            "The ticket question process has been cancelled. Staff can still assist you."
          )
        ]
      });

      return;
    }

    session.answers.push(
      answer
    );

    session.currentQuestion++;

    await message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setDescription(
            `✅ **Answer ${session.answers.length}/${TICKETS[session.type].q.length} saved!**`
          )
      ]
    });

    await nextTicketQuestion(
      message.channel,
      session
    );
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

        // -------------------------
        // PING
        // -------------------------

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

        // -------------------------
        // TICKET PANEL
        // -------------------------

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

        // -------------------------
        // APPLICATION PANEL
        // -------------------------

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

        // -------------------------
        // BUTTON ROLE
        // -------------------------

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

          // ADD
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

            const botMember =
              interaction.guild.members.me;

            if (
              botMember &&
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
            subcommand === "remove"
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

          // LIST
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
                `### 🔘 Button Roles\n\n${list || "None"}`,
              ephemeral: true
            });
          }

          // PANEL
          if (
            subcommand === "panel"
          ) {
            return sendButtonRolePanel(
              interaction
            );
          }
        }

        // -------------------------
        // SET WELCOME
        // -------------------------

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

        // -------------------------
        // SET AUTOROLE
        // -------------------------

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
            botMember &&
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

        // -------------------------
        // SET TICKET STAFF
        // -------------------------

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

        // -------------------------
        // SET TICKET CATEGORY
        // -------------------------

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

        // -------------------------
        // STAFF
        // -------------------------

        if (
          interaction.commandName ===
          "staff"
        ) {
          return handleStaffCommand(
            interaction
          );
        }

        // -------------------------
        // BUILDER
        // -------------------------

        if (
          interaction.commandName ===
          "builder"
        ) {
          return handleBuilderCommand(
            interaction
          );
        }

        // -------------------------
        // UPDATE
        // -------------------------

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

          const extra =
            interaction.options.getString(
              "extra"
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
              "✅ Update posted!",
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
          "ticket-select"
      ) {
        const type =
          interaction.values[0];

        return createTicket(
          interaction,
          type
        );
      }

      // ======================================================
      // APPLICATION DROPDOWN
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

    } catch (error) {
      console.error(
        "❌ Interaction error:",
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

client.login(TOKEN);
