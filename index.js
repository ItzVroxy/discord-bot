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

/* =========================================================
   CONFIG
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error("ERROR: Missing DISCORD_TOKEN environment variable.");
  process.exit(1);
}

const PORT = Number(process.env.PORT || 10000);
const CONFIG_FILE = "./config.json";

/* =========================================================
   EXPRESS WEB SERVER
========================================================= */

const app = express();

app.get("/", (_req, res) => {
  res.status(200).send("TVB Assistant is online.");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Web server listening on port ${PORT}`);
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
   CONFIG SYSTEM
========================================================= */

let config = {};

try {
  if (fs.existsSync(CONFIG_FILE)) {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  }
} catch (error) {
  console.error("Could not load config.json:", error);
  config = {};
}

function saveConfig() {
  try {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(config, null, 2)
    );
  } catch (error) {
    console.error("Could not save config.json:", error);
  }
}

function guildConfig(guildId) {
  if (!config[guildId]) {
    config[guildId] = {
      welcomeChannel: null,
      welcomeMessage: "Welcome {user} to **{server}**! 🎉",
      autorole: null,

      ticketCategory: null,
      ticketStaffRole: null,
      builderRole: null,

      buttonRoles: [],

      giveaways: {},

      strikes: {
        staff: {},
        builder: {}
      }
    };
  }

  const cfg = config[guildId];

  if (!Array.isArray(cfg.buttonRoles)) {
    cfg.buttonRoles = [];
  }

  if (!cfg.giveaways || typeof cfg.giveaways !== "object") {
    cfg.giveaways = {};
  }

  if (!cfg.strikes) {
    cfg.strikes = {
      staff: {},
      builder: {}
    };
  }

  if (!cfg.strikes.staff) {
    cfg.strikes.staff = {};
  }

  if (!cfg.strikes.builder) {
    cfg.strikes.builder = {};
  }

  return cfg;
}

/* =========================================================
   PERMISSION HELPERS
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
   GENERAL HELPERS
========================================================= */

function safe(value) {
  return (
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60) || "user"
  );
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

function findRoleByName(guild, name) {
  return guild.roles.cache.find(
    role => role.name.toLowerCase() === name.toLowerCase()
  );
}

function findRoleByNames(guild, names) {
  const wanted = names.map(name => name.toLowerCase());

  return guild.roles.cache.find(role =>
    wanted.includes(role.name.toLowerCase())
  );
}

function getStaffRole(guild) {
  const cfg = guildConfig(guild.id);

  if (cfg.ticketStaffRole) {
    const configured = guild.roles.cache.get(cfg.ticketStaffRole);

    if (configured) {
      return configured;
    }
  }

  return findRoleByNames(guild, [
    "staff team",
    "staff",
    "moderator",
    "moderators"
  ]);
}

function getBuilderRole(guild) {
  const cfg = guildConfig(guild.id);

  if (cfg.builderRole) {
    const configured = guild.roles.cache.get(cfg.builderRole);

    if (configured) {
      return configured;
    }
  }

  return findRoleByNames(guild, [
    "builder",
    "builders"
  ]);
}

function replacePlaceholders(
  text,
  {
    user,
    server,
    fromRole = "",
    toRole = ""
  }
) {
  return String(text || "")
    .replace(/{user}/gi, `${user}`)
    .replace(
      /{username}/gi,
      user?.user?.username ||
        user?.username ||
        ""
    )
    .replace(
      /{server}/gi,
      server?.name || ""
    )
    .replace(
      /{fromrole}/gi,
      fromRole ? `${fromRole}` : ""
    )
    .replace(
      /{torole}/gi,
      toRole ? `${toRole}` : ""
    );
}

/* =========================================================
   TICKET TYPES
========================================================= */

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
      "When and where did this occur?",
      "Do you have proof/screenshots/video?",
      "What outcome are you looking for?"
    ]
  }
};

/* =========================================================
   SERVICE TYPES
========================================================= */

const SERVICES = {
  base: {
    label: "Base",
    emoji: "🏠",
    desc: "Custom Minecraft bases and structures."
  },

  farm: {
    label: "Farm",
    emoji: "🌾",
    desc: "Custom farms and functional builds."
  },

  mapart: {
    label: "Map Art",
    emoji: "🖼️",
    desc: "Custom Minecraft map art."
  }
};

/* =========================================================
   APPLICATIONS
========================================================= */

const APPS = {
  builder: {
    label: "Builder Application",
    emoji: "🧱",
    channel: "📋・builder-submissions",

    q: [
      "What is your Minecraft username?",
      "How old are you?",
      "What is your timezone?",
      "How many years of Minecraft building experience do you have?",
      "Which building styles are you strongest in?",
      "What type of projects do you consider yourself best suited for?",
      "What is the strongest build you have created and why?",
      "What aspects of your building do you believe need improvement?",
      "How many hours per week can you realistically dedicate to commissions?",
      "Why are you interested in becoming a TVB builder?",
      "How do you respond when a client or senior builder heavily critiques your work?",
      "How comfortable are you working as part of a structured build team?",
      "How would you handle a client requesting major changes late in a project?",
      "What do you believe separates a professional Minecraft build from an average one?",
      "Provide a screenshot, portfolio, or link to your strongest work."
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
      "How long have you been part of the TVB community?",
      "What previous moderation or leadership experience do you have?",
      "How many hours per week can you consistently dedicate to staff responsibilities?",
      "Why do you believe you would be a strong addition to the TVB staff team?",
      "What qualities do you believe are essential for an effective and respected moderator?",
      "How would you de-escalate a conflict between two members without unnecessarily taking sides?",
      "How would you handle a close friend violating a rule that you are responsible for enforcing?",
      "What would you do if a member repeatedly ignored increasingly serious warnings?",
      "How would you investigate a player report before deciding whether disciplinary action is justified?",
      "How would you handle confidential staff information that should not be shared with regular members?",
      "What specific strengths would you bring to the staff team?",
      "What is one area of your communication, judgment, or leadership that you are actively working to improve?"
    ]
  }
};

/* =========================================================
   SESSION STORAGE
========================================================= */

const appSessions = new Map();
const ticketSessions = new Map();

/* =========================================================
   TICKET MENU
========================================================= */

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

/* =========================================================
   SERVICE MENU
========================================================= */

function serviceMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("service-select")
      .setPlaceholder("🛠️ Select a service...")
      .addOptions(
        Object.entries(SERVICES).map(
          ([value, service]) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(service.label)
              .setValue(value)
              .setEmoji(service.emoji)
              .setDescription(service.desc)
        )
      )
  );
}

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
                "15 questions • completed privately in DMs"
              )
        )
      )
  );
}

/* =========================================================
   TICKET MODAL
========================================================= */

function ticketModal(type) {
  const ticket = TICKETS[type];

  const modal = new ModalBuilder()
    .setCustomId(`ticket-modal-${type}`)
    .setTitle(ticket.label);

  ticket.q.forEach((question, index) => {
    const input = new TextInputBuilder()
      .setCustomId(`answer-${index}`)
      .setLabel(question.slice(0, 45))
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000);

    modal.addComponents(
      new ActionRowBuilder().addComponents(input)
    );
  });

  return modal;
}

/* =========================================================
   SERVICE MODAL
========================================================= */

function serviceModal(type) {
  const service = SERVICES[type];

  const modal = new ModalBuilder()
    .setCustomId(`service-modal-${type}`)
    .setTitle(`${service.label} Service Request`);

  const lookingFor = new TextInputBuilder()
    .setCustomId("service-looking")
    .setLabel("What Are You Looking For?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  const price = new TextInputBuilder()
    .setCustomId("service-price")
    .setLabel("What Is Your Price Range?")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  const addons = new TextInputBuilder()
    .setCustomId("service-addons")
    .setLabel("Any Add Ons?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder().addComponents(lookingFor),
    new ActionRowBuilder().addComponents(price),
    new ActionRowBuilder().addComponents(addons)
  );

  return modal;
}

/* =========================================================
   CREATE REGULAR TICKET
========================================================= */

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

  const staffRole = getStaffRole(guild);

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

  /* REGULAR TICKETS:
     STAFF CAN SEE
     BUILDERS CANNOT SEE
  */

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
        "❌ I could not create the ticket. Check my permissions, category, and role settings.",
      ephemeral: true
    });
  }

  ticketSessions.set(channel.id, {
    userId: member.id,
    type,
    service: false,
    answers
  });

  const answerText = ticket.q
    .map(
      (question, index) =>
        `**${index + 1}. ${question}**\n> ${
          answers[index] || "No answer provided."
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
      answerText,
      "",
      "A staff member will review your ticket shortly."
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
    content: staffRole
      ? `${member} ${staffRole}`
      : `${member}`,

    embeds: [ticketEmbed],

    components: [buttons]
  });

  return interaction.reply({
    content:
      `✅ Your ticket has been created: ${channel}`,
    ephemeral: true
  });
}

/* =========================================================
   CREATE SERVICE TICKET
========================================================= */

async function createServiceTicket(
  interaction,
  type,
  answers
) {
  const guild = interaction.guild;
  const member = interaction.member;
  const cfg = guildConfig(guild.id);

  const service = SERVICES[type];

  if (!service) {
    return interaction.reply({
      content: "❌ Invalid service.",
      ephemeral: true
    });
  }

  const existing = guild.channels.cache.find(
    channel =>
      channel.type === ChannelType.GuildText &&
      channel.topic === `TVB-SERVICE:${member.id}`
  );

  if (existing) {
    return interaction.reply({
      content:
        `❌ You already have an open service request: ${existing}`,
      ephemeral: true
    });
  }

  const staffRole = getStaffRole(guild);
  const builderRole = getBuilderRole(guild);

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

  /* SERVICE TICKETS:
     STAFF CAN SEE
     BUILDERS CAN SEE
  */

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

  if (
    builderRole &&
    (!staffRole || builderRole.id !== staffRole.id)
  ) {
    overwrites.push({
      id: builderRole.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    });
  }

  let channel;

  try {
    channel = await guild.channels.create({
      name:
        `service-${type}-${safe(member.user.username)}`,
      type: ChannelType.GuildText,
      parent: cfg.ticketCategory || null,
      topic: `TVB-SERVICE:${member.id}`,
      permissionOverwrites: overwrites,
      reason:
        `TVB Assistant • ${service.label} service`
    });
  } catch (error) {
    console.error(
      "Could not create service ticket:",
      error
    );

    return interaction.reply({
      content:
        "❌ I could not create the service ticket. Check my permissions and category settings.",
      ephemeral: true
    });
  }

  ticketSessions.set(channel.id, {
    userId: member.id,
    type,
    service: true,
    answers
  });

  const serviceEmbed = embed(
    `${service.emoji} ${service.label} Request`,
    [
      `**Customer:** ${member}`,
      "",
      "**What Are You Looking For?**",
      `> ${answers.lookingFor}`,
      "",
      "**What Is Your Price Range?**",
      `> ${answers.price}`,
      "",
      "**Any Add Ons?**",
      `> ${answers.addons || "None specified."}`,
      "",
      "A member of the TVB team will review your request shortly."
    ].join("\n"),
    0xf5a623
  );

  const buttons =
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket-close")
        .setLabel("Close Request")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger)
    );

  const pingRoles = [];

  if (staffRole) {
    pingRoles.push(`${staffRole}`);
  }

  if (
    builderRole &&
    (!staffRole || builderRole.id !== staffRole.id)
  ) {
    pingRoles.push(`${builderRole}`);
  }

  await channel.send({
    content:
      `${member} ${pingRoles.join(" ")}`.trim(),

    embeds: [serviceEmbed],

    components: [buttons]
  });

  return interaction.reply({
    content:
      `✅ Your ${service.label} request has been created: ${channel}`,
    ephemeral: true
  });
}

/* =========================================================
   TICKET PANEL
========================================================= */

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

/* =========================================================
   SERVICE PANEL
========================================================= */

async function sendServicePanel(interaction) {
  const panel = new EmbedBuilder()
    .setColor(0xf5a623)
    .setTitle("🛠️ TVB Services")
    .setDescription(
      [
        "# Need Something Built?",
        "",
        "Looking for a custom Minecraft service?",
        "",
        "Choose what you are interested in below.",
        "",
        "🏠 **Base**",
        "Custom bases and structures.",
        "",
        "🌾 **Farm**",
        "Functional farms and resource systems.",
        "",
        "🖼️ **Map Art**",
        "Custom Minecraft map art.",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "🔒 **Service requests are private.**",
        "",
        "Select a service below to get started."
      ].join("\n")
    )
    .setFooter({
      text: "TVB Assistant • Services"
    })
    .setTimestamp();

  await interaction.channel.send({
    embeds: [panel],
    components: [serviceMenu()]
  });

  return interaction.reply({
    content: "✅ Service panel posted!",
    ephemeral: true
  });
}

/* =========================================================
   CLOSE TICKET
========================================================= */

async function closeTicket(interaction) {
  const channel = interaction.channel;
  const session = ticketSessions.get(channel.id);

  if (!session) {
    return interaction.reply({
      content: "⚠️ This isn't an active TVB ticket.",
      ephemeral: true
    });
  }

  const staffRole = getStaffRole(interaction.guild);

  const builderRole = getBuilderRole(interaction.guild);

  const isStaff =
    staffRole &&
    interaction.member.roles.cache.has(staffRole.id);

  const isBuilder =
    builderRole &&
    interaction.member.roles.cache.has(builderRole.id);

  const canClose =
    session.userId === interaction.user.id ||
    isStaff ||
    (session.service && isBuilder) ||
    moderator(interaction);

  if (!canClose) {
    return interaction.reply({
      content:
        "❌ You do not have permission to close this ticket.",
      ephemeral: true
    });
  }

  await interaction.reply({
    content: "🔒 Closing this ticket in 5 seconds..."
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
        "Help create professional builds and projects.",
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
    content: "✅ Application panel posted!",
    ephemeral: true
  });
}

/* =========================================================
   START APPLICATION
========================================================= */

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
      "Could not start application:",
      error
    );

    appSessions.delete(interaction.user.id);

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

/* =========================================================
   APPLICATION QUESTIONS
========================================================= */

async function sendNextApplicationQuestion(
  dm,
  session
) {
  const application = APPS[session.type];

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
          `### Question ${session.questionIndex + 1} of 15`,
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
   FINISH APPLICATION
========================================================= */

async function finishApplication(
  dm,
  session
) {
  const application = APPS[session.type];

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

    const applicationId =
      `${session.type}-${member.id}-${Date.now()}`;

    const answersText =
      application.q
        .map(
          (question, index) =>
            `**${index + 1}. ${question}**\n> ${
              session.answers[index] ||
              "No answer provided."
            }`
        )
        .join("\n\n");

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
            "",
            answersText
          ].join("\n")
        )
        .setFooter({
          text:
            `Application ID: ${applicationId}`
        })
        .setTimestamp();

    const buttons =
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(
            `app-accept-${session.type}-${member.id}`
          )
          .setLabel("Accept")
          .setEmoji("✅")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId(
            `app-deny-${session.type}-${member.id}`
          )
          .setLabel("Deny")
          .setEmoji("❌")
          .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
          .setCustomId(
            `app-blacklist-${session.type}-${member.id}`
          )
          .setLabel("Blacklist")
          .setEmoji("🚫")
          .setStyle(ButtonStyle.Secondary)
      );

    await submissionChannel.send({
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
   APPLICATION ACTIONS
========================================================= */

async function handleApplicationAction(
  interaction
) {
  const parts =
    interaction.customId.split("-");

  const action = parts[1];
  const type = parts[2];
  const userId = parts[3];

  if (!interaction.guild) {
    return interaction.reply({
      content:
        "❌ This can only be used inside the server.",
      ephemeral: true
    });
  }

  if (!moderator(interaction)) {
    return interaction.reply({
      content:
        "❌ You need moderation permissions to process applications.",
      ephemeral: true
    });
  }

  const member =
    await interaction.guild.members
      .fetch(userId)
      .catch(() => null);

  if (!member) {
    return interaction.reply({
      content:
        "❌ I could not find that member.",
      ephemeral: true
    });
  }

  let acceptedNames;
  let blacklistNames;

  if (type === "staff") {
    acceptedNames = [
      "staff team",
      "helper"
    ];

    blacklistNames = [
      "staff application blacklist"
    ];
  } else {
    acceptedNames = [
      "builder"
    ];

    blacklistNames = [
      "builder application blacklist"
    ];
  }

  if (action === "accept") {
    const added = [];

    for (
      const roleName of acceptedNames
    ) {
      const role =
        findRoleByName(
          interaction.guild,
          roleName
        );

      if (!role) continue;

      if (
        role.position >=
        interaction.guild.members.me.roles.highest.position
      ) {
        continue;
      }

      try {
        await member.roles.add(role);
        added.push(`${role}`);
      } catch (error) {
        console.error(
          "Could not add application role:",
          error
        );
      }
    }

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle(
            "✅ Application Accepted"
          )
          .setDescription(
            [
              `**Applicant:** ${member}`,
              "",
              `Processed by: ${interaction.user}`,
              "",
              added.length
                ? `Roles added: ${added.join(", ")}`
                : "⚠️ No matching roles were found."
            ].join("\n")
          )
          .setTimestamp()
      ],
      components: []
    });

    return;
  }

  if (action === "deny") {
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle(
            "❌ Application Denied"
          )
          .setDescription(
            [
              `**Applicant:** ${member}`,
              "",
              `Denied by: ${interaction.user}`
            ].join("\n")
          )
          .setTimestamp()
      ],
      components: []
    });

    return;
  }

  if (action === "blacklist") {
    const blacklistRole =
      findRoleByNames(
        interaction.guild,
        blacklistNames
      );

    if (
      blacklistRole &&
      blacklistRole.position <
        interaction.guild.members.me.roles.highest.position
    ) {
      try {
        await member.roles.add(
          blacklistRole
        );
      } catch (error) {
        console.error(
          "Could not add blacklist role:",
          error
        );
      }
    }

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2b2d31)
          .setTitle(
            "🚫 Application Blacklisted"
          )
          .setDescription(
            [
              `**Applicant:** ${member}`,
              "",
              `Blacklisted by: ${interaction.user}`,
              "",
              blacklistRole
                ? `Added ${blacklistRole}`
                : "⚠️ Blacklist role was not found."
            ].join("\n")
          )
          .setTimestamp()
      ],
      components: []
    });
  }
}

/* =========================================================
   EMOJI SYSTEM
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
      animated:
        input.startsWith("<a:")
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

  if (!cfg.buttonRoles.length) {
    return interaction.reply({
      content:
        "❌ No button roles have been configured yet. Use `/buttonrole add` first.",
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

  if (row.components.length) {
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

/* =========================================================
   TOGGLE BUTTON ROLE
========================================================= */

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
   STAFF / BUILDER ACTIONS
========================================================= */

async function handleTeamAction(
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

  const member =
    interaction.options.getMember(
      "member"
    );

  const fromRole =
    interaction.options.getRole(
      "fromrole"
    );

  const toRole =
    interaction.options.getRole(
      "torole"
    );

  const message =
    interaction.options.getString(
      "message"
    );

  if (!member) {
    return interaction.reply({
      content:
        "❌ I could not find that member.",
      ephemeral: true
    });
  }

  const botMember =
    interaction.guild.members.me;

  if (!botMember) {
    return interaction.reply({
      content:
        "❌ I could not find my bot member in this server.",
      ephemeral: true
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
      ephemeral: true
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
      ephemeral: true
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

    const actionLabels = {
      hire: "Hired",
      fire: "Fired",
      promote: "Promoted",
      demote: "Demoted"
    };

    const title =
      actionLabels[action] ||
      action;

    const defaultMessage =
      action === "hire"
        ? "Welcome to the team!"
        : action === "fire"
          ? "Thank you for your time with the team."
          : action === "promote"
            ? "Congratulations on your promotion!"
            : "Thank you for your continued work with the team.";

    const finalMessage =
      replacePlaceholders(
        message ||
          defaultMessage,
        {
          user: member,
          server: interaction.guild,
          fromRole,
          toRole
        }
      );

    const output = [
      `\`[${title}]\` - ${member}`,
      "",
      `${fromRole || "Member"} --> ${toRole || "Member"}`,
      "",
      `-# ${finalMessage}`
    ].join("\n");

    await interaction.channel.send({
      content: output
    });

    return interaction.reply({
      content:
        `✅ ${title} action completed for ${member}.`,
      ephemeral: true
    });
  } catch (error) {
    console.error(
      "Team action error:",
      error
    );

    return interaction.reply({
      content:
        "❌ I could not complete that action. Check my role permissions and hierarchy.",
      ephemeral: true
    });
  }
}

/* =========================================================
   UPDATE EMBED
========================================================= */

function updateEmbed(
  type,
  title,
  description,
  extra
) {
  const typeLabels = {
    feature: "✨ Feature",
    update: "🔄 Update",
    announcement: "📢 Announcement",
    important: "⚠️ Important"
  };

  return new EmbedBuilder()
    .setColor(0x7c5cff)
    .setTitle(
      `${typeLabels[type] || "📢 Update"} • ${title}`
    )
    .setDescription(
      [
        description,
        "",
        extra
          ? `||${extra}||`
          : ""
      ].join("\n")
    )
    .setFooter({
      text:
        "TVB Assistant • Updates"
    })
    .setTimestamp();
}

/* =========================================================
   GIVEAWAY HELPERS
========================================================= */

function parseDuration(input) {
  const match =
    String(input)
      .trim()
      .toLowerCase()
      .match(
        /^(\d+)\s*(s|m|h|d|w)$/
      );

  if (!match) return null;

  const amount =
    Number(match[1]);

  const unit =
    match[2];

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000
  };

  return amount * multipliers[unit];
}

function giveawayTimeLeft(endAt) {
  const difference =
    endAt - Date.now();

  if (difference <= 0) {
    return "Ended";
  }

  const seconds =
    Math.floor(
      difference / 1000
    );

  const days =
    Math.floor(
      seconds / 86400
    );

  const hours =
    Math.floor(
      (seconds % 86400) / 3600
    );

  const minutes =
    Math.floor(
      (seconds % 3600) / 60
    );

  const secs =
    seconds % 60;

  const parts = [];

  if (days) {
    parts.push(`${days}d`);
  }

  if (hours) {
    parts.push(`${hours}h`);
  }

  if (minutes) {
    parts.push(`${minutes}m`);
  }

  if (secs && parts.length < 3) {
    parts.push(`${secs}s`);
  }

  return parts.join(" ") || "less than 1s";
}

function giveawayButton(giveawayId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `giveaway-enter-${giveawayId}`
      )
      .setLabel("Enter Giveaway")
      .setEmoji("🎉")
      .setStyle(ButtonStyle.Success)
  );
}

function giveawayEmbed(
  giveaway,
  ended = false,
  winners = []
) {
  if (ended) {
    return new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("🎉 Giveaway Ended!")
      .setDescription(
        [
          `## 🎁 ${giveaway.prize}`,
          "",
          `**Winners:** ${
            winners.length
              ? winners.map(id => `<@${id}>`).join(", ")
              : "No winners"
          }`,
          "",
          `**Hosted by:** <@${giveaway.hostId}>`,
          `**Entries:** ${giveaway.entries.length}`,
          "",
          winners.length
            ? "Congratulations! 🎉"
            : "Nobody entered this giveaway."
        ].join("\n")
      )
      .setFooter({
        text:
          "TVB Assistant • Giveaway"
      })
      .setTimestamp();
  }

  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("🎉 GIVEAWAY!")
    .setDescription(
      [
        `# 🎁 ${giveaway.prize}`,
        "",
        `**Winners:** ${giveaway.winners}`,
        `**Ends:** <t:${Math.floor(giveaway.endAt / 1000)}:R>`,
        "",
        `**Entries:** ${giveaway.entries.length}`,
        "",
        "Click **Enter Giveaway** below to enter!",
        "",
        `Hosted by: <@${giveaway.hostId}>`
      ].join("\n")
    )
    .setFooter({
      text:
        "TVB Assistant • Giveaway"
    })
    .setTimestamp();
}

async function chooseGiveawayWinners(
  giveaway
) {
  const entries =
    Array.from(
      new Set(
        giveaway.entries || []
      )
    );

  const winners = [];

  const count =
    Math.min(
      giveaway.winners,
      entries.length
    );

  const pool = [...entries];

  for (
    let i = 0;
    i < count;
    i++
  ) {
    const index =
      Math.floor(
        Math.random() *
          pool.length
      );

    winners.push(
      pool[index]
    );

    pool.splice(
      index,
      1
    );
  }

  return winners;
}

async function endGiveaway(
  guildId,
  giveawayId,
  reroll = false
) {
  const cfg =
    guildConfig(guildId);

  const giveaway =
    cfg.giveaways[giveawayId];

  if (!giveaway) {
    return null;
  }

  const guild =
    client.guilds.cache.get(
      guildId
    );

  if (!guild) {
    return null;
  }

  const channel =
    guild.channels.cache.get(
      giveaway.channelId
    );

  if (!channel) {
    delete cfg.giveaways[giveawayId];
    saveConfig();
    return null;
  }

  const message =
    await channel.messages
      .fetch(giveaway.messageId)
      .catch(() => null);

  if (!message) {
    delete cfg.giveaways[giveawayId];
    saveConfig();
    return null;
  }

  const winners =
    await chooseGiveawayWinners(
      giveaway
    );

  const finalEmbed =
    giveawayEmbed(
      giveaway,
      true,
      winners
    );

  await message.edit({
    embeds: [finalEmbed],
    components: []
  });

  if (winners.length) {
    await channel.send({
      content:
        `🎉 Congratulations ${winners.map(id => `<@${id}>`).join(", ")}! You won **${giveaway.prize}**!`
    });
  } else {
    await channel.send({
      content:
        `🎉 The giveaway for **${giveaway.prize}** ended, but nobody entered.`
    });
  }

  delete cfg.giveaways[giveawayId];
  saveConfig();

  return winners;
}

async function startGiveaway(
  interaction
) {
  const durationInput =
    interaction.options.getString(
      "duration"
    );

  const winners =
    interaction.options.getInteger(
      "winners"
    );

  const prize =
    interaction.options.getString(
      "prize"
    );

  const duration =
    parseDuration(
      durationInput
    );

  if (!duration) {
    return interaction.reply({
      content:
        "❌ Invalid duration. Examples: `30s`, `10m`, `2h`, `7d`.",
      ephemeral: true
    });
  }

  if (duration < 5000) {
    return interaction.reply({
      content:
        "❌ Giveaway duration must be at least 5 seconds.",
      ephemeral: true
    });
  }

  const giveawayId =
    `${interaction.guild.id}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const giveaway = {
    id: giveawayId,
    guildId: interaction.guild.id,
    channelId: interaction.channel.id,
    messageId: null,
    hostId: interaction.user.id,
    prize,
    winners,
    entries: [],
    endAt: Date.now() + duration
  };

  const message =
    await interaction.channel.send({
      embeds: [
        giveawayEmbed(
          giveaway
        )
      ],
      components: [
        giveawayButton(
          giveawayId
        )
      ]
    });

  giveaway.messageId =
    message.id;

  const cfg =
    guildConfig(
      interaction.guild.id
    );

  cfg.giveaways[giveawayId] =
    giveaway;

  saveConfig();

  await interaction.reply({
    content:
      `✅ Giveaway started! It will end in **${giveawayTimeLeft(giveaway.endAt)}**.`,
    ephemeral: true
  });

  setTimeout(
    () =>
      endGiveaway(
        interaction.guild.id,
        giveawayId
      ).catch(error =>
        console.error(
          "Giveaway end error:",
          error
        )
      ),
    duration
  );
}

async function enterGiveaway(
  interaction
) {
  const giveawayId =
    interaction.customId.replace(
      "giveaway-enter-",
      ""
    );

  const cfg =
    guildConfig(
      interaction.guild.id
    );

  const giveaway =
    cfg.giveaways[giveawayId];

  if (!giveaway) {
    return interaction.reply({
      content:
        "❌ This giveaway has already ended.",
      ephemeral: true
    });
  }

  if (
    Date.now() >=
    giveaway.endAt
  ) {
    await endGiveaway(
      interaction.guild.id,
      giveawayId
    );

    return interaction.reply({
      content:
        "❌ This giveaway has already ended.",
      ephemeral: true
    });
  }

  if (
    giveaway.entries.includes(
      interaction.user.id
    )
  ) {
    return interaction.reply({
      content:
        "⚠️ You are already entered in this giveaway!",
      ephemeral: true
    });
  }

  giveaway.entries.push(
    interaction.user.id
  );

  saveConfig();

  const message =
    interaction.message;

  await message.edit({
    embeds: [
      giveawayEmbed(
        giveaway
      )
    ],
    components: [
      giveawayButton(
        giveawayId
      )
    ]
  }).catch(() => {});

  return interaction.reply({
    content:
      "🎉 You have entered the giveaway!",
    ephemeral: true
  });
}

/* =========================================================
   GIVEAWAY REROLL
========================================================= */

async function rerollGiveaway(
  interaction
) {
  const channel =
    interaction.options.getChannel(
      "channel"
    );

  const messageId =
    interaction.options.getString(
      "message_id"
    );

  if (
    channel.type !==
    ChannelType.GuildText
  ) {
    return interaction.reply({
      content:
        "❌ Please select a text channel.",
      ephemeral: true
    });
  }

  const message =
    await channel.messages
      .fetch(messageId)
      .catch(() => null);

  if (!message) {
    return interaction.reply({
      content:
        "❌ I couldn't find that giveaway message.",
      ephemeral: true
    });
  }

  const cfg =
    guildConfig(
      interaction.guild.id
    );

  const giveaway =
    Object.values(
      cfg.giveaways
    ).find(
      g =>
        g.messageId ===
        messageId
    );

  if (!giveaway) {
    return interaction.reply({
      content:
        "❌ I couldn't find an active giveaway connected to that message.",
      ephemeral: true
    });
  }

  const winners =
    await chooseGiveawayWinners(
      giveaway
    );

  if (!winners.length) {
    return interaction.reply({
      content:
        "❌ There are no eligible entries to reroll.",
      ephemeral: true
    });
  }

  await interaction.reply({
    content:
      `🎉 New winner: ${winners.map(id => `<@${id}>`).join(", ")}!`,
    ephemeral: false
  });
}

/* =========================================================
   COMMANDS
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
    .setName("servicepanel")
    .setDescription(
      "Post the TVB services panel."
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
      "Set the staff role that can see regular and service tickets."
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription(
          "Staff Team role."
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setbuilderrole")
    .setDescription(
      "Set the Builder role that can see service tickets."
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription(
          "Builder role."
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setticketcategory")
    .setDescription(
      "Set the category where tickets are created."
    )
    .addChannelOption(option =>
      option
        .setName("category")
        .setDescription(
          "Ticket category."
        )
        .addChannelTypes(
          ChannelType.GuildCategory
        )
        .setRequired(true)
    ),

  /* =====================================================
     STAFF COMMANDS
  ===================================================== */

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
            .setName("member")
            .setDescription(
              "Member."
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("fromrole")
            .setDescription(
              "Current role."
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("torole")
            .setDescription(
              "New role."
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription(
              "Message."
            )
            .setRequired(true)
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
            .setName("member")
            .setDescription(
              "Member."
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("fromrole")
            .setDescription(
              "Current role."
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("torole")
            .setDescription(
              "Role to move them to."
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription(
              "Message."
            )
            .setRequired(true)
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
            .setName("member")
            .setDescription(
              "Member."
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("fromrole")
            .setDescription(
              "Current role."
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("torole")
            .setDescription(
              "New role."
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription(
              "Message."
            )
            .setRequired(true)
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
            .setName("member")
            .setDescription(
              "Member."
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("fromrole")
            .setDescription(
              "Current role."
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("torole")
            .setDescription(
              "New role."
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription(
              "Message."
            )
            .setRequired(true)
        )
    ),

  /* =====================================================
     BUILDER COMMANDS
  ===================================================== */

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
            .setName("member")
            .setDescription(
              "Member."
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("fromrole")
            .setDescription(
              "Current role."
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("torole")
            .setDescription(
              "New role."
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription(
              "Message."
            )
            .setRequired(true)
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
            .setName("member")
            .setDescription(
              "Member."
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("fromrole")
            .setDescription(
              "Current role."
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("torole")
            .setDescription(
              "Role to move them to."
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription(
              "Message."
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("promote")
        .setDescription(
          "Promote a builder."
        )
        .addUserOption(option =>
          option
            .setName("member")
            .setDescription(
              "Member."
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("fromrole")
            .setDescription(
              "Current role."
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("torole")
            .setDescription(
              "New role."
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription(
              "Message."
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("demote")
        .setDescription(
          "Demote a builder."
        )
        .addUserOption(option =>
          option
            .setName("member")
            .setDescription(
              "Member."
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("fromrole")
            .setDescription(
              "Current role."
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("torole")
            .setDescription(
              "New role."
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription(
              "Message."
            )
            .setRequired(true)
        )
    ),

  /* =====================================================
     UPDATE
  ===================================================== */

  new SlashCommandBuilder()
    .setName("update")
    .setDescription(
      "Post a detailed TVB update."
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
            name: "Feature",
            value: "feature"
          },
          {
            name: "Update",
            value: "update"
          },
          {
            name: "Announcement",
            value: "announcement"
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
          "Main update text."
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("extra")
        .setDescription(
          "Extra details."
        )
        .setRequired(false)
    ),

  /* =====================================================
     GIVEAWAY
  ===================================================== */

  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription(
      "Manage TVB giveaways."
    )
    .addSubcommand(sub =>
      sub
        .setName("start")
        .setDescription(
          "Start a giveaway."
        )
        .addStringOption(option =>
          option
            .setName("duration")
            .setDescription(
              "Examples: 10m, 2h, 7d."
            )
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option
            .setName("winners")
            .setDescription(
              "Number of winners."
            )
            .setMinValue(1)
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("prize")
            .setDescription(
              "Giveaway prize."
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("reroll")
        .setDescription(
          "Reroll an active giveaway."
        )
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription(
              "Giveaway channel."
            )
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message_id")
            .setDescription(
              "Giveaway message ID."
            )
            .setRequired(true)
        )
    )
];

/* =========================================================
   COMMAND REGISTRATION
========================================================= */

const commandData =
  commands.map(command =>
    command.toJSON()
  );

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
        body: commandData
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
   RESTORE GIVEAWAYS AFTER RESTART
========================================================= */

async function restoreGiveaways() {
  for (
    const guild of
    client.guilds.cache.values()
  ) {
    const cfg =
      guildConfig(guild.id);

    for (
      const [giveawayId, giveaway] of
      Object.entries(cfg.giveaways)
    ) {
      const remaining =
        giveaway.endAt -
        Date.now();

      if (remaining <= 0) {
        await endGiveaway(
          guild.id,
          giveawayId
        ).catch(error =>
          console.error(
            "Could not restore ended giveaway:",
            error
          )
        );
      } else {
        setTimeout(
          () =>
            endGiveaway(
              guild.id,
              giveawayId
            ).catch(error =>
              console.error(
                "Restored giveaway error:",
                error
              )
            ),
          remaining
        );
      }
    }
  }
}

/* =========================================================
   READY
========================================================= */

let heartbeatTimer = null;

client.once(
  "ready",
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

    await restoreGiveaways();

    console.log(
      `TVB Assistant is ready in ${client.guilds.cache.size} server(s).`
    );

    /*
      ======================================================
      PERMANENT 5-MINUTE HEARTBEAT

      This timer is created ONCE when the bot starts.

      If Discord reconnects, this code does not create
      another timer because "ready" is registered with
      client.once().

      Every 5 minutes it searches for #bot-activity
      and sends "a".
      ======================================================
    */

    if (heartbeatTimer) {
      clearInterval(
        heartbeatTimer
      );
    }

    heartbeatTimer =
      setInterval(
        async () => {
          try {
            for (
              const guild of
              client.guilds.cache.values()
            ) {
              const channel =
                findText(
                  guild,
                  "bot-activity"
                );

              if (!channel) {
                console.log(
                  `#bot-activity not found in ${guild.name}`
                );
                continue;
              }

              try {
                await channel.send(
                  "a"
                );

                console.log(
                  `Heartbeat sent in #bot-activity (${guild.name})`
                );
              } catch (error) {
                console.error(
                  `Could not send heartbeat in ${guild.name}:`,
                  error
                );
              }
            }
          } catch (error) {
            console.error(
              "Heartbeat loop error:",
              error
            );
          }
        },
        5 * 60 * 1000
      );

    console.log(
      "5-minute #bot-activity heartbeat is running."
    );
  }
);

/* =========================================================
   NEW SERVER
========================================================= */

client.on(
  "guildCreate",
  async guild => {
    guildConfig(guild.id);
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

      const botMember =
        member.guild.members.me;

      if (
        role &&
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
          replacePlaceholders(
            cfg.welcomeMessage,
            {
              user: member,
              server: member.guild
            }
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
    if (message.author.bot) return;

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
      /* ===================================================
         SLASH COMMANDS
      =================================================== */

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

        /* SERVICE PANEL */

        if (
          interaction.commandName ===
          "servicepanel"
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

          return sendServicePanel(
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

        /* BUTTON ROLES */

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

        /* SET WELCOME */

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

        /* SET AUTOROLE */

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

        /* SET STAFF ROLE */

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
              `✅ Ticket Staff role set to ${role}. This role can see both regular and service tickets.`,
            ephemeral: true
          });
        }

        /* SET BUILDER ROLE */

        if (
          interaction.commandName ===
          "setbuilderrole"
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

          cfg.builderRole =
            role.id;

          saveConfig();

          return interaction.reply({
            content:
              `✅ Builder role set to ${role}. Builders can now see service tickets but not regular tickets.`,
            ephemeral: true
          });
        }

        /* SET CATEGORY */

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

        /* STAFF */

        if (
          interaction.commandName ===
          "staff"
        ) {
          return handleTeamAction(
            interaction,
            interaction.options.getSubcommand()
          );
        }

        /* BUILDER */

        if (
          interaction.commandName ===
          "builder"
        ) {
          return handleTeamAction(
            interaction,
            interaction.options.getSubcommand()
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

          const updatesRole =
            interaction.guild.roles.cache.find(
              role =>
                role.name.toLowerCase() ===
                "updates"
            );

          await interaction.channel.send({
            content:
              updatesRole
                ? `${updatesRole}`
                : "",

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

        /* GIVEAWAY */

        if (
          interaction.commandName ===
          "giveaway"
        ) {
          if (
            !manager(interaction)
          ) {
            return interaction.reply({
              content:
                "❌ You need Manage Server to use giveaways.",
              ephemeral: true
            });
          }

          const subcommand =
            interaction.options.getSubcommand();

          if (
            subcommand ===
            "start"
          ) {
            return startGiveaway(
              interaction
            );
          }

          if (
            subcommand ===
            "reroll"
          ) {
            return rerollGiveaway(
              interaction
            );
          }
        }
      }

      /* ===================================================
         TICKET SELECT
      =================================================== */

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          "ticket-select"
      ) {
        const type =
          interaction.values[0];

        return interaction.showModal(
          ticketModal(type)
        );
      }

      /* ===================================================
         SERVICE SELECT
      =================================================== */

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          "service-select"
      ) {
        const type =
          interaction.values[0];

        return interaction.showModal(
          serviceModal(type)
        );
      }

      /* ===================================================
         APPLICATION SELECT
      =================================================== */

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

      /* ===================================================
         TICKET MODAL
      =================================================== */

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

        const ticket =
          TICKETS[type];

        if (!ticket) {
          return interaction.reply({
            content:
              "❌ Invalid ticket type.",
            ephemeral: true
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
          "service-modal-"
        )
      ) {
        const type =
          interaction.customId.replace(
            "service-modal-",
            ""
          );

        if (!SERVICES[type]) {
          return interaction.reply({
            content:
              "❌ Invalid service type.",
            ephemeral: true
          });
        }

        const answers = {
          lookingFor:
            interaction.fields.getTextInputValue(
              "service-looking"
            ),

          price:
            interaction.fields.getTextInputValue(
              "service-price"
            ),

          addons:
            interaction.fields.getTextInputValue(
              "service-addons"
            )
        };

        return createServiceTicket(
          interaction,
          type,
          answers
        );
      }

      /* ===================================================
         ROLE BUTTON
      =================================================== */

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

      /* ===================================================
         CLOSE TICKET
      =================================================== */

      if (
        interaction.isButton() &&
        interaction.customId ===
          "ticket-close"
      ) {
        return closeTicket(
          interaction
        );
      }

      /* ===================================================
         GIVEAWAY BUTTON
      =================================================== */

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          "giveaway-enter-"
        )
      ) {
        return enterGiveaway(
          interaction
        );
      }

      /* ===================================================
         APPLICATION ACTION
      =================================================== */

      if (
        interaction.isButton() &&
        (
          interaction.customId.startsWith(
            "app-accept-"
          ) ||
          interaction.customId.startsWith(
            "app-deny-"
          ) ||
          interaction.customId.startsWith(
            "app-blacklist-"
          )
        )
      ) {
        return handleApplicationAction(
          interaction
        );
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
   PROCESS ERROR HANDLING
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
