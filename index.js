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

const app = express();
const PORT = process.env.PORT || 10000;

app.get("/", (_req, res) =>
  res.status(200).send("TVB Assistant is online.")
);

app.listen(PORT, "0.0.0.0", () =>
  console.log(`Web server listening on ${PORT}`)
);

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

const CONFIG_FILE = "./config.json";
let config = {};

try {
  if (fs.existsSync(CONFIG_FILE)) {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  }
} catch (e) {
  console.error("Could not load config.json:", e);
}

function saveConfig() {
  try {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(config, null, 2)
    );
  } catch (e) {
    console.error("Could not save config:", e);
  }
}

function guildConfig(guildId) {
  if (!config[guildId]) {
    config[guildId] = {
      welcomeChannel: null,
      welcomeMessage:
        "Welcome {user} to **{server}**! We're glad to have you here. 🎉",
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

  const c = config[guildId];

  if (!c.welcomeMessage) {
    c.welcomeMessage =
      "Welcome {user} to **{server}**! We're glad to have you here. 🎉";
  }

  if (!Array.isArray(c.buttonRoles)) {
    c.buttonRoles = [];
  }

  if (!c.strikes) {
    c.strikes = {
      staff: {},
      builder: {}
    };
  }

  if (!c.strikes.staff) c.strikes.staff = {};
  if (!c.strikes.builder) c.strikes.builder = {};

  return c;
}

function isModerator(interaction) {
  return (
    interaction.memberPermissions?.has(
      PermissionsBitField.Flags.ModerateMembers
    ) ||
    interaction.memberPermissions?.has(
      PermissionsBitField.Flags.ManageGuild
    )
  );
}

function isManager(interaction) {
  return (
    interaction.memberPermissions?.has(
      PermissionsBitField.Flags.ManageGuild
    ) ||
    interaction.memberPermissions?.has(
      PermissionsBitField.Flags.ManageRoles
    )
  );
}

function safeName(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 65) || "user"
  );
}

function findTextChannel(guild, name) {
  return guild.channels.cache.find(
    c =>
      c.type === ChannelType.GuildText &&
      c.name.toLowerCase() === name.toLowerCase()
  );
}

function findRole(guild, names) {
  return guild.roles.cache.find(r =>
    names.some(n => r.name.toLowerCase() === n.toLowerCase())
  );
}

async function getOrCreateRole(guild, name) {
  let role = findRole(guild, [name]);

  if (!role) {
    role = await guild.roles.create({
      name,
      reason: "TVB Assistant staff system"
    });
  }

  return role;
}

function ticketEmbed(
  title,
  description,
  color = 0x7c5cff
) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({
      text: "TVB Assistant • Support Center"
    });
}

const TICKET_TYPES = {
  general: {
    label: "General Support",
    emoji: "💬",
    description:
      "Questions, help, bugs, or anything else.",
    questions: [
      "What do you need help with?",
      "What happened?",
      "Which server/channel is this about?",
      "What have you tried already?",
      "Is there anything else we should know?"
    ]
  },

  purchase: {
    label: "Purchase Support",
    emoji: "🛒",
    description:
      "Purchases, payments, orders, or missing items.",
    questions: [
      "What did you purchase?",
      "When did you make the purchase?",
      "What went wrong?",
      "Do you have an order/transaction ID?",
      "What would you like us to do?"
    ]
  },

  player: {
    label: "Player Report",
    emoji: "🚨",
    description:
      "Report cheating, rule breaking, or another player issue.",
    questions: [
      "What is the player's Minecraft/Discord username?",
      "What happened?",
      "When and where did it happen?",
      "Do you have proof/screenshots/video?",
      "Is there anything else staff should know?"
    ]
  },

  staff: {
    label: "Staff Report",
    emoji: "🛡️",
    description:
      "Report a concern involving a staff member.",
    questions: [
      "Which staff member is this about?",
      "What happened?",
      "When and where did it happen?",
      "Do you have proof/screenshots/video?",
      "What outcome are you hoping for?"
    ]
  }
};

const APPLICATIONS = {
  builder: {
    label: "Builder Application",
    emoji: "🧱",
    submissionChannel: "builder-submissions",

    questions: [
      "What is your Minecraft username?",
      "How old are you?",
      "What timezone are you in?",
      "How long have you been building in Minecraft?",
      "What kinds of builds do you like making?",
      "What building style are you best at?",
      "What is your favorite thing to build?",
      "What part of building are you still learning?",
      "How many hours can you build each week?",
      "Why do you want to be a TVB builder?",
      "How do you handle feedback on your builds?",
      "Do you prefer building alone or with a team?",
      "Can you send a link to a build or screenshot?",
      "What makes a build look good to you?",
      "What would you do if another builder disagreed with your idea?"
    ]
  },

  staff: {
    label: "Staff Application",
    emoji: "🛡️",
    submissionChannel: "staff-submissions",

    questions: [
      "What is your Discord username?",
      "How old are you?",
      "What timezone are you in?",
      "How long have you been in the community?",
      "Have you been staff anywhere before?",
      "How many hours can you be active each week?",
      "Why do you want to be TVB staff?",
      "What makes a good staff member?",
      "How would you handle an argument between members?",
      "What would you do if your friend broke a rule?",
      "What would you do if someone ignored your warning?",
      "How would you handle a player report?",
      "How would you keep staff information private?",
      "What strength would you bring to the staff team?",
      "What is one thing you want to improve about yourself?"
    ]
  }
};

const applicationSessions = new Map();
const ticketSessions = new Map();

function buildTicketMenu() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("ticket-select")
    .setPlaceholder(
      "🎫 Select the type of support you need..."
    )
    .addOptions(
      Object.entries(TICKET_TYPES).map(
        ([value, t]) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(t.label)
            .setValue(value)
            .setEmoji(t.emoji)
            .setDescription(t.description)
      )
    );

  return new ActionRowBuilder().addComponents(menu);
}

function buildApplicationMenu() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("application-select")
    .setPlaceholder(
      "📋 Choose an application..."
    )
    .addOptions(
      Object.entries(APPLICATIONS).map(
        ([value, a]) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(a.label)
            .setValue(value)
            .setEmoji(a.emoji)
            .setDescription(
              "15 easy questions • completed privately in DMs"
            )
      )
    );

  return new ActionRowBuilder().addComponents(menu);
} 
async function createTicket(interaction, type) {
  const guild = interaction.guild;
  const member = interaction.member;
  const cfg = guildConfig(guild.id);
  const ticket = TICKET_TYPES[type];

  if (!ticket) {
    return interaction.reply({
      content: "❌ Invalid ticket type.",
      ephemeral: true
    });
  }

  const existing = guild.channels.cache.find(
    c =>
      c.type === ChannelType.GuildText &&
      c.topic === `TVB-TICKET:${member.id}`
  );

  if (existing) {
    return interaction.reply({
      content: `❌ You already have an open ticket: ${existing}`,
      ephemeral: true
    });
  }

  const staffRole =
    cfg.ticketStaffRole
      ? guild.roles.cache.get(cfg.ticketStaffRole)
      : null;

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel]
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
    permissionOverwrites.push({
      id: staffRole.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageMessages
      ]
    });
  }

  const channel = await guild.channels.create({
    name: `${type}-${safeName(member.user.username)}`,
    type: ChannelType.GuildText,
    parent: cfg.ticketCategory || null,
    topic: `TVB-TICKET:${member.id}`,
    permissionOverwrites,
    reason: `TVB Assistant ${ticket.label}`
  });

  ticketSessions.set(channel.id, {
    userId: member.id,
    type,
    answers: {},
    currentQuestion: 0
  });

  const embed = ticketEmbed(
    `${ticket.emoji} ${ticket.label}`,
    [
      `Welcome ${member}!`,
      "",
      `**${ticket.description}**`,
      "",
      "Before we get started, please answer the questions below.",
      "Your answers will help our staff understand your situation.",
      "",
      "📝 **Question 1**",
      `> ${ticket.questions[0]}`
    ].join("\n")
  );

  const closeButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket-close")
      .setLabel("Close Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `${member}${staffRole ? ` ${staffRole}` : ""}`,
    embeds: [embed],
    components: [closeButton]
  });

  return interaction.reply({
    content: `✅ Your ticket has been created: ${channel}`,
    ephemeral: true
  });
}

async function advanceTicketQuestion(channel, session, answer) {
  const ticket = TICKET_TYPES[session.type];

  session.answers[session.currentQuestion] = answer;
  session.currentQuestion++;

  if (session.currentQuestion >= ticket.questions.length) {
    const embed = ticketEmbed(
      "📋 Ticket Information",
      `**${ticket.label}**\n\n` +
        ticket.questions
          .map(
            (q, i) =>
              `**${i + 1}. ${q}**\n> ${
                session.answers[i] || "No answer provided."
              }`
          )
          .join("\n\n")
    );

    const channelMessages = await channel.messages.fetch({
      limit: 10
    });

    const botMessage = channelMessages.find(
      m =>
        m.author.id === client.user.id &&
        m.components.length > 0
    );

    if (botMessage) {
      await botMessage.edit({
        embeds: [
          ticketEmbed(
            `${ticket.emoji} ${ticket.label}`,
            "Thanks! Your ticket information has been collected.\n\nA staff member will be with you shortly."
          )
        ],
        components: botMessage.components
      });
    }

    await channel.send({
      embeds: [embed]
    });

    ticketSessions.delete(channel.id);
await channel.send({
  embeds: [
    ticketEmbed(
      `${ticket.emoji} ${ticket.label}`,
      [
        `**Question ${session.currentQuestion + 1} of ${ticket.questions.length}**`,
        "",
        ticket.questions[session.currentQuestion]
      ].join("\n")
    )
  ]
});
}
  const channel = interaction.channel;

  const session = ticketSessions.get(channel.id);

  if (!session) {
    return interaction.reply({
      content:
        "⚠️ This doesn't appear to be an active TVB ticket.",
      ephemeral: true
    });
  }

  const member = interaction.member;
  const cfg = guildConfig(interaction.guild.id);

  const staffRole =
    cfg.ticketStaffRole
      ? interaction.guild.roles.cache.get(cfg.ticketStaffRole)
      : null;

  const isStaff =
    staffRole &&
    member.roles.cache.has(staffRole.id);

  if (
    session.userId !== member.id &&
    !isStaff &&
    !isModerator(interaction)
  ) {
    return interaction.reply({
      content:
        "❌ Only the ticket creator or ticket staff can close this ticket.",
      ephemeral: true
    });
  }

  await interaction.reply({
    content: "🔒 Closing this ticket in 5 seconds..."
  });

  setTimeout(async () => {
    try {
      await channel.delete(
        "TVB Assistant ticket closed"
      );
    } catch (error) {
      console.error("Could not delete ticket:", error);
    }
  }, 5000);
} 
async function startApplication(interaction, type) {
  const application = APPLICATIONS[type];

  if (!application) {
    return interaction.reply({
      content: "❌ Invalid application type.",
      ephemeral: true
    });
  }

  const existing = applicationSessions.get(interaction.user.id);

  if (existing) {
    return interaction.reply({
      content:
        "❌ You already have an application in progress. Check your DMs.",
      ephemeral: true
    });
  }

  try {
    const dm = await interaction.user.createDM();

    await interaction.reply({
      content:
        `📋 **${application.label} started!**\n` +
        "I've sent you a DM. Please answer each question there.\n\n" +
        "⚠️ If you don't receive a DM, make sure your server DMs are enabled.",
      ephemeral: true
    });

    const session = {
      userId: interaction.user.id,
      guildId: interaction.guild.id,
      type,
      questionIndex: 0,
      answers: []
    };

    applicationSessions.set(interaction.user.id, session);

    await dm.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x7c5cff)
          .setTitle(`${application.emoji} ${application.label}`)
          .setDescription(
            [
              `Welcome to the **${application.label}**!`,
              "",
              "You'll be asked **15 questions**, one at a time.",
              "",
              "📝 Please answer honestly.",
              "💬 You can type your answer normally.",
              "❌ Type `cancel` at any time to stop.",
              "",
              "Let's get started!"
            ].join("\n")
          )
          .setFooter({
            text: "TVB Assistant • Application System"
          })
      ]
    });

    await sendNextApplicationQuestion(dm, session);
  } catch (error) {
    applicationSessions.delete(interaction.user.id);

    console.error("Could not start application:", error);

    await interaction.reply({
      content:
        "❌ I couldn't DM you. Please enable Direct Messages from this server and try again.",
      ephemeral: true
    }).catch(() => {});
  }
}

async function sendNextApplicationQuestion(dm, session) {
  const application = APPLICATIONS[session.type];

  if (
    session.questionIndex >=
    application.questions.length
  ) {
    return finishApplication(dm, session);
  }

  const question =
    application.questions[session.questionIndex];

  const embed = new EmbedBuilder()
    .setColor(0x7c5cff)
    .setTitle(
      `${application.emoji} ${application.label}`
    )
    .setDescription(
      [
        `### Question ${session.questionIndex + 1} of 15`,
        "",
        question,
        "",
        "💡 Take your time and give your best answer.",
        "❌ Type `cancel` to stop the application."
      ].join("\n")
    )
    .setFooter({
      text: `TVB Assistant • ${session.questionIndex + 1}/15`
    });

  await dm.send({
    embeds: [embed]
  });
}

async function finishApplication(dm, session) {
  const application = APPLICATIONS[session.type];

  try {
    const guild =
      await client.guilds.fetch(session.guildId);

    const member =
      await guild.members.fetch(session.userId);

    const submissionChannel =
      findTextChannel(
        guild,
        application.submissionChannel
      );

    if (!submissionChannel) {
      await dm.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle("❌ Application Finished")
            .setDescription(
              `Your application was completed, but I couldn't find **#${application.submissionChannel}**.\n\nPlease contact a server administrator.`
            )
        ]
      });

      applicationSessions.delete(session.userId);
      return;
    }

    const header = new EmbedBuilder()
      .setColor(0x7c5cff)
      .setTitle(
        `${application.emoji} New ${application.label}`
      )
      .setDescription(
        [
          `**Applicant:** ${member}`,
          `**Username:** ${member.user.tag}`,
          `**User ID:** ${member.id}`,
          "",
          "📋 **Application Answers**"
        ].join("\n")
      )
      .setTimestamp();

    await submissionChannel.send({
      embeds: [header]
    });

    for (let i = 0; i < application.questions.length; i++) {
      const answer =
        session.answers[i] ||
        "No answer provided.";

      const embed = new EmbedBuilder()
        .setColor(0x7c5cff)
        .setTitle(
          `Question ${i + 1} • ${application.label}`
        )
        .setDescription(
          [
            `**${application.questions[i]}**`,
            "",
            answer
          ].join("\n")
        )
        .setFooter({
          text: `${member.user.tag} • ${i + 1}/15`
        });

      await submissionChannel.send({
        embeds: [embed]
      });
    }

    const completedEmbed =
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("✅ Application Submitted!")
        .setDescription(
          [
            `Your **${application.label}** has been submitted successfully.`,
            "",
            "Staff will review it and contact you if needed.",
            "",
            "Thank you for applying to TVB! 💙"
          ].join("\n")
        );

    await dm.send({
      embeds: [completedEmbed]
    });

    applicationSessions.delete(session.userId);
  } catch (error) {
    console.error(
      "Could not finish application:",
      error
    );

    await dm.send({
      content:
        "❌ Something went wrong while submitting your application. Please contact staff."
    }).catch(() => {});

    applicationSessions.delete(session.userId);
  }
}

async function handleApplicationDM(message) {
  if (message.author.bot) return;

  const session =
    applicationSessions.get(message.author.id);

  if (!session) return;

  const answer = message.content.trim();

  if (!answer) return;

  if (answer.toLowerCase() === "cancel") {
    applicationSessions.delete(message.author.id);

    await message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("❌ Application Cancelled")
          .setDescription(
            "Your application has been cancelled. You can start a new one from the server whenever you're ready."
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
async function sendTicketPanel(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x7c5cff)
    .setTitle("🎫 TVB Support Center")
    .setDescription(
      [
        "# Need some help?",
        "",
        "Welcome to the **TVB Support Center**!",
        "",
        "Choose the option below that best matches what you need help with. A private ticket will be created for you and our team will help you as soon as possible.",
        "",
        "💬 **General Support**",
        "Questions, problems, bugs, or anything else.",
        "",
        "🛒 **Purchase Support**",
        "Purchases, payments, orders, or missing items.",
        "",
        "🚨 **Player Report**",
        "Report cheating, rule breaking, or another player.",
        "",
        "🛡️ **Staff Report**",
        "Report a concern involving a member of staff.",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "🔒 **Your ticket is private.**",
        "Please don't open multiple tickets for the same issue.",
        "",
        "Select a category below to get started."
      ].join("\n")
    )
    .setFooter({
      text: "TVB Assistant • Support Center"
    })
    .setTimestamp();

  await interaction.channel.send({
    embeds: [embed],
    components: [buildTicketMenu()]
  });

  await interaction.reply({
    content: "✅ Ticket panel posted!",
    ephemeral: true
  });
}

async function sendApplicationPanel(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x7c5cff)
    .setTitle("📋 TVB Applications")
    .setDescription(
      [
        "# Join the Team!",
        "",
        "Want to become part of the TVB team?",
        "",
        "Choose the application that matches the position you're interested in.",
        "",
        "🧱 **Builder Application**",
        "Apply to help create amazing builds and projects.",
        "",
        "🛡️ **Staff Application**",
        "Apply to help moderate and support our community.",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "📨 **How it works**",
        "After choosing an application, I'll send you **15 questions through DMs**, one at a time.",
        "",
        "Please answer honestly and take your time.",
        "",
        "⚠️ **Make sure your Discord DMs are enabled.**",
        "",
        "Select an application below to begin."
      ].join("\n")
    )
    .setFooter({
      text: "TVB Assistant • Applications"
    })
    .setTimestamp();

  await interaction.channel.send({
    embeds: [embed],
    components: [buildApplicationMenu()]
  });

  await interaction.reply({
    content: "✅ Application panel posted!",
    ephemeral: true
  });
}

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

  if (/^\p{Extended_Pictographic}$/u.test(input)) {
    return input;
  }

  return null;
}

function buildRoleButton(role, emoji, index) {
  const button = new ButtonBuilder()
    .setCustomId(`role-${role.id}`)
    .setLabel(role.name)
    .setStyle(ButtonStyle.Secondary);

  const parsed = parseEmoji(emoji);

  if (parsed) {
    if (typeof parsed === "string") {
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

async function sendButtonRolePanel(interaction) {
  const cfg = guildConfig(interaction.guild.id);

  if (!cfg.buttonRoles.length) {
    return interaction.reply({
      content:
        "❌ No button roles have been configured yet.\n\nUse `/buttonrole add` first.",
      ephemeral: true
    });
  }

  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (let i = 0; i < cfg.buttonRoles.length; i++) {
    const item = cfg.buttonRoles[i];
    const role = interaction.guild.roles.cache.get(
      item.roleId
    );

    if (!role) continue;

    currentRow.addComponents(
      buildRoleButton(
        role,
        item.emoji,
        i
      )
    );

    if (
      currentRow.components.length === 5 ||
      i === cfg.buttonRoles.length - 1
    ) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0x7c5cff)
    .setTitle("🔘 TVB Role Selection")
    .setDescription(
      [
        "Choose the roles you'd like to receive.",
        "",
        "Click a button to **add or remove** that role.",
        "",
        "✨ You can change your roles whenever you want."
      ].join("\n")
    )
    .setFooter({
      text: "TVB Assistant • Button Roles"
    });

  await interaction.channel.send({
    embeds: [embed],
    components: rows
  });

  await interaction.reply({
    content: "✅ Button-role panel posted!",
    ephemeral: true
  });
}

async function toggleButtonRole(interaction) {
  const roleId =
    interaction.customId.replace("role-", "");

  const role =
    interaction.guild.roles.cache.get(roleId);

  if (!role) {
    return interaction.reply({
      content:
        "❌ That role no longer exists.",
      ephemeral: true
    });
  }

  if (
    role.position >=
    interaction.guild.members.me.roles.highest.position
  ) {
    return interaction.reply({
      content:
        "❌ I can't manage that role because it is above my bot role.",
      ephemeral: true
    });
  }

  try {
    if (interaction.member.roles.cache.has(role.id)) {
      await interaction.member.roles.remove(role);
      return interaction.reply({
        content: `➖ Removed **${role.name}** from you.`,
        ephemeral: true
      });
    }

    await interaction.member.roles.add(role);

    return interaction.reply({
      content: `➕ Added **${role.name}** to you!`,
      ephemeral: true
    });
  } catch (error) {
    console.error("Button role error:", error);

    return interaction.reply({
      content:
        "❌ I couldn't change that role. Check my role position and permissions.",
      ephemeral: true
    });
  }
}
const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if TVB Assistant is online."),

  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("Post the TVB ticket panel."),

  new SlashCommandBuilder()
    .setName("applicationpanel")
    .setDescription("Post the TVB application panel."),

  new SlashCommandBuilder()
    .setName("buttonrole")
    .setDescription("Manage button roles.")
    .addSubcommand(sub =>
      sub
        .setName("add")
        .setDescription("Add a role to the button-role panel.")
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription("The role to give.")
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("emoji")
            .setDescription(
              "Emoji to show on the button. Custom emojis are supported."
            )
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("remove")
        .setDescription("Remove a role from the button-role panel.")
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription("The role to remove.")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("list")
        .setDescription("Show the current button roles.")
    ),

  new SlashCommandBuilder()
    .setName("setwelcome")
    .setDescription("Configure the welcome system.")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Welcome channel.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("message")
        .setDescription(
          "Welcome message. Use {user}, {username}, and {server}."
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setautorole")
    .setDescription("Set the automatic member role.")
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("Role new members should receive.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setticketstaff")
    .setDescription("Set the role that can see and manage tickets.")
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("Ticket staff role.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setticketcategory")
    .setDescription("Set the category where tickets are created.")
    .addChannelOption(option =>
      option
        .setName("category")
        .setDescription("Ticket category.")
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("staff")
    .setDescription("Manage the staff team.")
    .addSubcommand(sub =>
      sub
        .setName("hire")
        .setDescription("Hire a member as Staff.")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("Member to hire.")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("promote")
        .setDescription("Promote Staff to Senior Staff.")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("Staff member to promote.")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("demote")
        .setDescription("Demote Senior Staff to Staff.")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("Staff member to demote.")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("strike")
        .setDescription("Give a staff member a strike.")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("Staff member.")
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("reason")
            .setDescription("Reason for the strike.")
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("builder")
    .setDescription("Manage the builder team.")
    .addSubcommand(sub =>
      sub
        .setName("hire")
        .setDescription("Hire a member as a Builder.")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("Member to hire.")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("fire")
        .setDescription("Remove a member from the Builder team.")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("Builder to fire.")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("strike")
        .setDescription("Give a builder a strike.")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("Builder.")
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("reason")
            .setDescription("Reason for the strike.")
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("update")
    .setDescription("Post a TVB-style server update.")
    .addStringOption(option =>
      option
        .setName("type")
        .setDescription("Type of update.")
        .setRequired(true)
        .addChoices(
          {
            name: "Network Update",
            value: "network"
          },
          {
            name: "Upload Update",
            value: "upload"
          },
          {
            name: "Emoji Update",
            value: "emoji"
          }
        )
    )
    .addStringOption(option =>
      option
        .setName("title")
        .setDescription("Update title.")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("description")
        .setDescription("What changed?")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("extra")
        .setDescription("Optional extra information.")
        .setRequired(false)
    )
].map(command => command.toJSON());

async function registerCommands(guildId) {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

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

function updateEmbed(type, title, description, extra) {
  const labels = {
    network: "🌐 NETWORK UPDATE",
    upload: "📤 UPLOAD UPDATE",
    emoji: "✨ EMOJI UPDATE"
  };

  return new EmbedBuilder()
    .setColor(0x7c5cff)
    .setTitle(labels[type] || "📢 TVB UPDATE")
    .setDescription(
      [
        `## ${title}`,
        "",
        description,
        extra ? `\n**More Information**\n${extra}` : "",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "**TVB • Official Update**"
      ].join("\n")
    )
    .setTimestamp()
    .setFooter({
      text: "TVB Assistant • Server Updates"
    });
}

async function handleStaffCommand(interaction) {
  if (!isManager(interaction)) {
    return interaction.reply({
      content:
        "❌ You don't have permission to manage the staff team.",
      ephemeral: true
    });
  }

  const subcommand =
    interaction.options.getSubcommand();

  const user =
    interaction.options.getUser("user");

  const member =
    await interaction.guild.members
      .fetch(user.id)
      .catch(() => null);

  if (!member) {
    return interaction.reply({
      content: "❌ I couldn't find that member.",
      ephemeral: true
    });
  }

  const staffRole =
    await getOrCreateRole(
      interaction.guild,
      "Staff"
    );

  const seniorRole =
    await getOrCreateRole(
      interaction.guild,
      "Senior Staff"
    );

  if (
    staffRole.position >=
      interaction.guild.members.me.roles.highest.position ||
    seniorRole.position >=
      interaction.guild.members.me.roles.highest.position
  ) {
    return interaction.reply({
      content:
        "❌ My bot role needs to be above the Staff and Senior Staff roles.",
      ephemeral: true
    });
  }

  if (subcommand === "hire") {
    await member.roles.add(staffRole);

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("👤 Staff Hired")
          .setDescription(
            `${member} has been hired as **Staff**.`
          )
          .setFooter({
            text: `Hired by ${interaction.user.tag}`
          })
          .setTimestamp()
      ]
    });
  }

  if (subcommand === "promote") {
    await member.roles.remove(staffRole);
    await member.roles.add(seniorRole);

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("⬆️ Staff Promoted")
          .setDescription(
            `${member} has been promoted to **Senior Staff**.`
          )
          .setFooter({
            text: `Promoted by ${interaction.user.tag}`
          })
          .setTimestamp()
      ]
    });
  }

  if (subcommand === "demote") {
    await member.roles.remove(seniorRole);
    await member.roles.add(staffRole);

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setTitle("⬇️ Staff Demoted")
          .setDescription(
            `${member} has been demoted to **Staff**.`
          )
          .setFooter({
            text: `Demoted by ${interaction.user.tag}`
          })
          .setTimestamp()
      ]
    });
  }

  if (subcommand === "strike") {
    const reason =
      interaction.options.getString("reason");

    const cfg =
      guildConfig(interaction.guild.id);

    if (!cfg.strikes.staff[user.id]) {
      cfg.strikes.staff[user.id] = [];
    }

    cfg.strikes.staff[user.id].push({
      reason,
      moderator: interaction.user.id,
      date: new Date().toISOString()
    });

    saveConfig();

    const count =
      cfg.strikes.staff[user.id].length;

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("⚠️ Staff Strike")
          .setDescription(
            [
              `**Member:** ${member}`,
              `**Strike:** #${count}`,
              `**Reason:** ${reason}`,
              "",
              `**Issued by:** ${interaction.user}`
            ].join("\n")
          )
          .setTimestamp()
      ]
    });
  }
}

async function handleBuilderCommand(interaction) {
  if (!isManager(interaction)) {
    return interaction.reply({
      content:
        "❌ You don't have permission to manage the builder team.",
      ephemeral: true
    });
  }

  const subcommand =
    interaction.options.getSubcommand();

  const user =
    interaction.options.getUser("user");

  const member =
    await interaction.guild.members
      .fetch(user.id)
      .catch(() => null);

  if (!member) {
    return interaction.reply({
      content: "❌ I couldn't find that member.",
      ephemeral: true
    });
  }

  const builderRole =
    await getOrCreateRole(
      interaction.guild,
      "Builder"
    );

  if (
    builderRole.position >=
    interaction.guild.members.me.roles.highest.position
  ) {
    return interaction.reply({
      content:
        "❌ My bot role needs to be above the Builder role.",
      ephemeral: true
    });
  }

  if (subcommand === "hire") {
    await member.roles.add(builderRole);

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("🧱 Builder Hired")
          .setDescription(
            `${member} has been hired as a **Builder**.`
          )
          .setFooter({
            text: `Hired by ${interaction.user.tag}`
          })
          .setTimestamp()
      ]
    });
  }

  if (subcommand === "fire") {
    await member.roles.remove(builderRole);

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("🧱 Builder Removed")
          .setDescription(
            `${member} has been removed from the **Builder** team.`
          )
          .setFooter({
            text: `Removed by ${interaction.user.tag}`
          })
          .setTimestamp()
      ]
    });
  }

  if (subcommand === "strike") {
    const reason =
      interaction.options.getString("reason");

    const cfg =
      guildConfig(interaction.guild.id);

    if (!cfg.strikes.builder[user.id]) {
      cfg.strikes.builder[user.id] = [];
    }

    cfg.strikes.builder[user.id].push({
      reason,
      moderator: interaction.user.id,
      date: new Date().toISOString()
    });

    saveConfig();

    const count =
      cfg.strikes.builder[user.id].length;

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("⚠️ Builder Strike")
          .setDescription(
            [
              `**Member:** ${member}`,
              `**Strike:** #${count}`,
              `**Reason:** ${reason}`,
              "",
              `**Issued by:** ${interaction.user}`
            ].join("\n")
          )
          .setTimestamp()
      ]
    });
  }
} 
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    await registerCommands(guild.id);
  }

  console.log(
    `TVB Assistant is ready in ${client.guilds.cache.size} server(s).`
  );
});

client.on("guildCreate", async guild => {
  await registerCommands(guild.id);
});

client.on("guildMemberAdd", async member => {
  const cfg = guildConfig(member.guild.id);

  // Auto-role
  if (cfg.autorole) {
    const role = member.guild.roles.cache.get(
      cfg.autorole
    );

    if (role) {
      try {
        await member.roles.add(role);
      } catch (error) {
        console.error(
          "Could not assign autorole:",
          error
        );
      }
    }
  }

  // Welcome message
  if (cfg.welcomeChannel) {
    const channel =
      member.guild.channels.cache.get(
        cfg.welcomeChannel
      );

    if (channel && channel.isTextBased()) {
      const message = cfg.welcomeMessage
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

      const embed = new EmbedBuilder()
        .setColor(0x7c5cff)
        .setTitle("👋 Welcome!")
        .setDescription(message)
        .setThumbnail(
          member.user.displayAvatarURL({
            size: 256
          })
        )
        .setFooter({
          text: `Member #${member.guild.memberCount}`
        })
        .setTimestamp();

      try {
        await channel.send({
          embeds: [embed]
        });
      } catch (error) {
        console.error(
          "Could not send welcome message:",
          error
        );
      }
    }
  }
});

client.on("messageCreate", async message => {
  if (message.author.bot) return;

  // Application DMs
  if (!message.guild) {
    await handleApplicationDM(message);
  }
});

client.on("interactionCreate", async interaction => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "ping") {
        return interaction.reply({
          content: "🏓 Pong! TVB Assistant is online.",
          ephemeral: true
        });
      }

      if (
        interaction.commandName ===
        "ticketpanel"
      ) {
        if (!isManager(interaction)) {
          return interaction.reply({
            content:
              "❌ You need Manage Server to use this command.",
            ephemeral: true
          });
        }

        return sendTicketPanel(interaction);
      }

      if (
        interaction.commandName ===
        "applicationpanel"
      ) {
        if (!isManager(interaction)) {
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

      if (
        interaction.commandName ===
        "buttonrole"
      ) {
        if (!isManager(interaction)) {
          return interaction.reply({
            content:
              "❌ You need Manage Server to use this command.",
            ephemeral: true
          });
        }

        const subcommand =
          interaction.options.getSubcommand();

        const cfg =
          guildConfig(interaction.guild.id);

        if (subcommand === "add") {
          const role =
            interaction.options.getRole(
              "role"
            );

          const emoji =
            interaction.options.getString(
              "emoji"
            ) || "🔘";

          if (
            role.position >=
            interaction.guild.members.me.roles.highest
              .position
          ) {
            return interaction.reply({
              content:
                "❌ My bot role must be above that role.",
              ephemeral: true
            });
          }

          const existing =
            cfg.buttonRoles.find(
              r => r.roleId === role.id
            );

          if (existing) {
            existing.emoji = emoji;
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

        if (subcommand === "remove") {
          const role =
            interaction.options.getRole(
              "role"
            );

          cfg.buttonRoles =
            cfg.buttonRoles.filter(
              r => r.roleId !== role.id
            );

          saveConfig();

          return interaction.reply({
            content:
              `✅ **${role.name}** was removed from the button-role list.`,
            ephemeral: true
          });
        }

        if (subcommand === "list") {
          if (!cfg.buttonRoles.length) {
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

      if (
        interaction.commandName ===
        "setwelcome"
      ) {
        if (!isManager(interaction)) {
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
          guildConfig(interaction.guild.id);

        cfg.welcomeChannel = channel.id;
        cfg.welcomeMessage = message;

        saveConfig();

        return interaction.reply({
          content:
            "✅ Welcome system updated!",
          ephemeral: true
        });
      }

      if (
        interaction.commandName ===
        "setautorole"
      ) {
        if (!isManager(interaction)) {
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
          role.position >=
          interaction.guild.members.me.roles.highest
            .position
        ) {
          return interaction.reply({
            content:
              "❌ My bot role must be above the autorole.",
            ephemeral: true
          });
        }

        const cfg =
          guildConfig(interaction.guild.id);

        cfg.autorole = role.id;

        saveConfig();

        return interaction.reply({
          content:
            `✅ New members will now receive **${role.name}** automatically.`,
          ephemeral: true
        });
      }

      if (
        interaction.commandName ===
        "setticketstaff"
      ) {
        if (!isManager(interaction)) {
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
          guildConfig(interaction.guild.id);

        cfg.ticketStaffRole = role.id;

        saveConfig();

        return interaction.reply({
          content:
            `✅ Ticket staff role set to ${role}.`,
          ephemeral: true
        });
      }

      if (
        interaction.commandName ===
        "setticketcategory"
      ) {
        if (!isManager(interaction)) {
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
          guildConfig(interaction.guild.id);

        cfg.ticketCategory = category.id;

        saveConfig();

        return interaction.reply({
          content:
            `✅ New tickets will now be created in **${category.name}**.`,
          ephemeral: true
        });
      }

      if (
        interaction.commandName === "staff"
      ) {
        return handleStaffCommand(
          interaction
        );
      }

      if (
        interaction.commandName === "builder"
      ) {
        return handleBuilderCommand(
          interaction
        );
      }

      if (
        interaction.commandName === "update"
      ) {
        if (!isManager(interaction)) {
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

    // Ticket dropdown
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

    // Application dropdown
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

    // Role buttons
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

    // Ticket close button
    if (
      interaction.isButton() &&
      interaction.customId ===
        "ticket-close"
    ) {
      return closeTicket(interaction);
    }
  } catch (error) {
    console.error(
      "Interaction error:",
      error
    );

    if (!interaction.replied &&
        !interaction.deferred) {
      await interaction.reply({
        content:
          "❌ Something went wrong while processing that.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

process.on("unhandledRejection", error => {
  console.error(
    "Unhandled promise rejection:",
    error
  );
});

process.on("uncaughtException", error => {
  console.error(
    "Uncaught exception:",
    error
  );
});

client.login(TOKEN);
