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
app.get("/", (_req, res) => res.status(200).send("TVB Assistant is online."));
app.listen(PORT, "0.0.0.0", () => console.log(`Web server listening on ${PORT}`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const CONFIG_FILE = "./config.json";
let config = {};
try {
  if (fs.existsSync(CONFIG_FILE)) config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
} catch (e) {
  console.error("Could not load config.json:", e);
}

function saveConfig() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); }
  catch (e) { console.error("Could not save config:", e); }
}

function guildConfig(guildId) {
  if (!config[guildId]) {
    config[guildId] = {
      welcomeChannel: null,
      welcomeMessage: "Welcome {user} to **{server}**! We're glad to have you here. 🎉",
      autorole: null,
      ticketCategory: null,
      ticketStaffRole: null,
      buttonRoles: []
    };
  }
  if (!config[guildId].welcomeMessage) config[guildId].welcomeMessage = "Welcome {user} to **{server}**! We're glad to have you here. 🎉";
  return config[guildId];
}

function isModerator(interaction) {
  return interaction.memberPermissions?.has(PermissionsBitField.Flags.ModerateMembers) ||
         interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
}

function safeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 70) || "user";
}

function ticketEmbed(title, description, color = 0x5865F2) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "TVB Assistant • Support Center" });
}

const TICKET_TYPES = {
  general: { label: "General Support", emoji: "💬", description: "Questions, help, or anything else." },
  purchase: { label: "Purchase Support", emoji: "🛒", description: "Help with purchases, payments, or orders." },
  player: { label: "Player Report", emoji: "🚨", description: "Report a player or rule-breaking behavior." },
  staff: { label: "Staff Report", emoji: "🛡️", description: "Report a concern involving a staff member." }
};

const APPLICATIONS = {
  builder: {
    label: "Builder Application",
    emoji: "🧱",
    questions: [
      "What is your Minecraft username?",
      "How old are you?",
      "What timezone are you in?",
      "How long have you been building in Minecraft?",
      "What type of builds do you enjoy most?",
      "What building style are you best at?",
      "What are you most confident building?",
      "What are you still trying to improve?",
      "How many hours could you build each week?",
      "Why do you want to become a TVB builder?",
      "How do you handle feedback or changes to your build?",
      "Do you work better alone or with a team? Why?",
      "Do you have a build or screenshot you can show us? (Link optional)",
      "What makes a build look good to you?",
      "If another builder disagreed with your idea, what would you do?"
    ]
  },
  staff: {
    label: "Staff Application",
    emoji: "🛡️",
    questions: [
      "What is your Discord username?",
      "How old are you?",
      "What timezone are you in?",
      "How long have you been in the community?",
      "Have you been staff on another server? If yes, where?",
      "How many hours could you be active each week?",
      "Why do you want to become TVB staff?",
      "What do you think makes a good staff member?",
      "How would you handle an argument between two members?",
      "What would you do if a friend broke a server rule?",
      "What would you do if someone ignored your warning?",
      "How would you handle a player report?",
      "How do you keep private staff information confidential?",
      "What is one strength you would bring to the staff team?",
      "What is one thing you would like to improve about yourself?"
    ]
  }
};

const applicationSessions = new Map();
const warnings = new Map();

function warnKey(guildId, userId) { return `${guildId}:${userId}`; }
function getWarnings(guildId, userId) { return warnings.get(warnKey(guildId, userId)) || []; }

function buildTicketMenu() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("ticket-select")
    .setPlaceholder("🎫 Select the type of support you need...")
    .addOptions(Object.entries(TICKET_TYPES).map(([value, t]) =>
      new StringSelectMenuOptionBuilder().setLabel(t.label).setValue(value).setEmoji(t.emoji).setDescription(t.description)
    ));
  return new ActionRowBuilder().addComponents(menu);
}

function buildApplicationMenu() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("application-select")
    .setPlaceholder("📋 Choose an application...")
    .addOptions(Object.entries(APPLICATIONS).map(([value, a]) =>
      new StringSelectMenuOptionBuilder().setLabel(a.label).setValue(value).setEmoji(a.emoji).setDescription(`15 easy questions • ${a.label}`)
    ));
  return new ActionRowBuilder().addComponents(menu);
}

function applicationModal(type, page) {
  const appData = APPLICATIONS[type];
  const start = page * 5;
  const modal = new ModalBuilder()
    .setCustomId(`application:${type}:${page}`)
    .setTitle(`${appData.label} • ${page + 1}/3`);

  for (let i = 0; i < 5; i++) {
    const index = start + i;
    const input = new TextInputBuilder()
      .setCustomId(`q${index}`)
      .setLabel(`${index + 1}. ${appData.questions[index]}`.slice(0, 45))
      .setStyle(index === 12 || index === 14 ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(1000);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

const commands = [
  new SlashCommandBuilder().setName("setup").setDescription("Create the basic TVB Assistant roles/channels for this server."),
  new SlashCommandBuilder().setName("setwelcome").setDescription("Set the welcome channel and custom welcome message.")
    .addChannelOption(o => o.setName("channel").setDescription("Welcome channel").setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addStringOption(o => o.setName("message").setDescription("Message. Use {user} and {server} as placeholders.").setRequired(true).setMaxLength(1000)),
  new SlashCommandBuilder().setName("setautorole").setDescription("Choose the role automatically given to new members.")
    .addRoleOption(o => o.setName("role").setDescription("Auto-role").setRequired(true)),
  new SlashCommandBuilder().setName("ticketpanel").setDescription("Post the gradient-style ticket support panel."),
  new SlashCommandBuilder().setName("setticketstaff").setDescription("Choose the role that can see/manage tickets.")
    .addRoleOption(o => o.setName("role").setDescription("Ticket staff role").setRequired(true)),
  new SlashCommandBuilder().setName("setticketcategory").setDescription("Choose the category where tickets/applications are created.")
    .addChannelOption(o => o.setName("category").setDescription("Category").setRequired(true).addChannelTypes(ChannelType.GuildCategory)),
  new SlashCommandBuilder().setName("applicationpanel").setDescription("Post the builder/staff application panel."),
  new SlashCommandBuilder().setName("buttonrole").setDescription("Manage button roles.")
    .addSubcommand(s => s.setName("add").setDescription("Add a button role.")
      .addRoleOption(o => o.setName("role").setDescription("Role to give").setRequired(true))
      .addStringOption(o => o.setName("label").setDescription("Button text").setRequired(true).setMaxLength(80))
      .addStringOption(o => o.setName("emoji").setDescription("Optional emoji").setRequired(false).setMaxLength(32)))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a button role.")
      .addRoleOption(o => o.setName("role").setDescription("Role to remove from the panel").setRequired(true)))
    .addSubcommand(s => s.setName("panel").setDescription("Post the current button-role panel.")),
  new SlashCommandBuilder().setName("ban").setDescription("Ban a member.")
    .addUserOption(o => o.setName("user").setDescription("Member to ban").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
  new SlashCommandBuilder().setName("kick").setDescription("Kick a member.")
    .addUserOption(o => o.setName("user").setDescription("Member to kick").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
  new SlashCommandBuilder().setName("timeout").setDescription("Timeout a member.")
    .addUserOption(o => o.setName("user").setDescription("Member to timeout").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("Timeout length in minutes").setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
  new SlashCommandBuilder().setName("warn").setDescription("Warn a member.")
    .addUserOption(o => o.setName("user").setDescription("Member to warn").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true)),
  new SlashCommandBuilder().setName("warnings").setDescription("Show warnings for a member.")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)),
  new SlashCommandBuilder().setName("clear").setDescription("Delete recent messages.")
    .addIntegerOption(o => o.setName("amount").setDescription("1-100 messages").setRequired(true).setMinValue(1).setMaxValue(100)),
  new SlashCommandBuilder().setName("ping").setDescription("Check if TVB Assistant is online.")
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  for (const guild of client.guilds.cache.values()) {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands });
      console.log(`Registered commands in ${guild.name}`);
    } catch (e) { console.error(`Command registration failed for ${guild.name}:`, e); }
  }
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on("guildCreate", async guild => {
  guildConfig(guild.id); saveConfig();
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands });
  } catch (e) { console.error("Guild command registration failed:", e); }
});

client.on("guildMemberAdd", async member => {
  const cfg = guildConfig(member.guild.id);
  if (cfg.autorole) {
    try {
      const role = member.guild.roles.cache.get(cfg.autorole);
      if (role && role.position < member.guild.members.me.roles.highest.position) await member.roles.add(role);
    } catch (e) { console.error("Auto-role error:", e); }
  }
  if (cfg.welcomeChannel) {
    try {
      const channel = member.guild.channels.cache.get(cfg.welcomeChannel);
      if (channel?.isTextBased()) {
        const msg = cfg.welcomeMessage
          .replaceAll("{user}", `${member}`)
          .replaceAll("{server}", member.guild.name)
          .replaceAll("{username}", member.user.username);
        const embed = new EmbedBuilder()
          .setColor(0x7C5CFF)
          .setTitle("🌅 Welcome!")
          .setDescription(msg)
          .setThumbnail(member.user.displayAvatarURL())
          .setFooter({ text: `TVB Assistant • ${member.guild.name}` });
        await channel.send({ content: `${member}`, embeds: [embed] });
      }
    } catch (e) { console.error("Welcome error:", e); }
  }
});

async function createPrivateChannel(interaction, kind, label, emoji, description) {
  const cfg = guildConfig(interaction.guild.id);
  const existing = interaction.guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.topic === `${kind}-owner:${interaction.user.id}`);
  if (existing) return { existing };

  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    { id: interaction.guild.members.me.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] }
  ];
  if (cfg.ticketStaffRole) overwrites.push({ id: cfg.ticketStaffRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });

  const channel = await interaction.guild.channels.create({
    name: `${kind}-${safeName(interaction.user.username)}`,
    type: ChannelType.GuildText,
    parent: cfg.ticketCategory || null,
    topic: `${kind}-owner:${interaction.user.id}`,
    permissionOverwrites: overwrites
  });

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket-close").setLabel("Close Ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger)
  );
  await channel.send({
    content: `${interaction.user}${cfg.ticketStaffRole ? ` • <@&${cfg.ticketStaffRole}>` : ""}`,
    embeds: [ticketEmbed(`${emoji} ${label}`, description + "\n\nA staff member will be with you soon. Please explain your issue clearly and include any useful details.", 0x7C5CFF)],
    components: [closeRow]
  });
  return { channel };
}

async function sendApplicationToChannel(channel, interaction, type, answers) {
  const data = APPLICATIONS[type];
  const embed = new EmbedBuilder()
    .setColor(0x7C5CFF)
    .setTitle(`${data.emoji} ${data.label}`)
    .setDescription(`Application submitted by ${interaction.user} (${interaction.user.tag})`)
    .setTimestamp();
  for (let i = 0; i < answers.length; i++) {
    embed.addFields({ name: `${i + 1}. ${data.questions[i]}`.slice(0, 256), value: answers[i].slice(0, 1024) || "—" });
  }
  await channel.send({ embeds: [embed] });
}

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "ticket-select") {
        const type = interaction.values[0];
        const t = TICKET_TYPES[type];
        const result = await createPrivateChannel(interaction, "ticket", t.label.toLowerCase().replace(/ /g, "-"), t.emoji, t.description);
        if (result.existing) return interaction.reply({ content: `You already have a ticket: ${result.existing}`, ephemeral: true });
        return interaction.reply({ content: `✅ Your **${t.label}** ticket is ready: ${result.channel}`, ephemeral: true });
      }

      if (interaction.customId === "application-select") {
        const type = interaction.values[0];
        applicationSessions.set(`${interaction.guild.id}:${interaction.user.id}`, { type, answers: [] });
        return interaction.showModal(applicationModal(type, 0));
      }

      if (interaction.customId === "application-cancel") {
        applicationSessions.delete(`${interaction.guild.id}:${interaction.user.id}`);
        return interaction.reply({ content: "Application cancelled.", ephemeral: true });
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("application:")) {
        const [, type, pageString] = interaction.customId.split(":");
        const page = Number(pageString);
        const key = `${interaction.guild.id}:${interaction.user.id}`;
        const session = applicationSessions.get(key) || { type, answers: [] };
        for (let i = page * 5; i < page * 5 + 5; i++) session.answers[i] = interaction.fields.getTextInputValue(`q${i}`);
        session.type = type;
        applicationSessions.set(key, session);
        if (page < 2) return interaction.showModal(applicationModal(type, page + 1));

        const cfg = guildConfig(interaction.guild.id);
        const data = APPLICATIONS[type];
        const overwrites = [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: interaction.guild.members.me.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] }
        ];
        if (cfg.ticketStaffRole) overwrites.push({ id: cfg.ticketStaffRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
        const channel = await interaction.guild.channels.create({
          name: `application-${type}-${safeName(interaction.user.username)}`,
          type: ChannelType.GuildText,
          parent: cfg.ticketCategory || null,
          topic: `application-owner:${interaction.user.id}`,
          permissionOverwrites: overwrites
        });
        await sendApplicationToChannel(channel, interaction, type, session.answers);
        await channel.send({ embeds: [ticketEmbed("📋 Application Received", "Thanks for applying! Staff can review your answers here. Please don't delete or edit your answers while they are being reviewed.", 0x57F287)] });
        const closeRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket-close").setLabel("Close Application").setEmoji("🔒").setStyle(ButtonStyle.Danger));
        await channel.send({ components: [closeRow] });
        applicationSessions.delete(key);
        return interaction.reply({ content: `✅ Application submitted! Your private application channel is ${channel}`, ephemeral: true });
      }
    }

    if (interaction.isButton()) {
      const [type, value] = interaction.customId.split(":");
      if (type === "role") {
        const role = interaction.guild.roles.cache.get(value);
        if (!role) return interaction.reply({ content: "That role no longer exists.", ephemeral: true });
        if (role.managed || role.position >= interaction.guild.members.me.roles.highest.position) return interaction.reply({ content: "I can't manage that role. Put my bot role above it.", ephemeral: true });
        if (interaction.member.roles.cache.has(role.id)) {
          await interaction.member.roles.remove(role);
          return interaction.reply({ content: `Removed ${role} from you.`, ephemeral: true });
        }
        await interaction.member.roles.add(role);
        return interaction.reply({ content: `Added ${role} to you.`, ephemeral: true });
      }
      if (interaction.customId === "ticket-close") {
        const cfg = guildConfig(interaction.guild.id);
        const isStaff = cfg.ticketStaffRole && interaction.member.roles.cache.has(cfg.ticketStaffRole);
        const topic = interaction.channel.topic || "";
        const ownerId = topic.match(/(?:ticket|application)-owner:(\d+)/)?.[1];
        if (!isStaff && ownerId !== interaction.user.id && !isModerator(interaction)) return interaction.reply({ content: "You don't have permission to close this.", ephemeral: true });
        await interaction.reply("🔒 Closing in 5 seconds...");
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
        return;
      }
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;
    if (commandName === "ping") return interaction.reply(`🏓 Pong! ${client.ws.ping}ms`);

    const adminCommands = ["setup", "setwelcome", "setautorole", "ticketpanel", "setticketstaff", "setticketcategory", "applicationpanel", "buttonrole"];
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) && adminCommands.includes(commandName)) {
      return interaction.reply({ content: "You need **Manage Server** to use this command.", ephemeral: true });
    }

    if (commandName === "setup") {
      await interaction.deferReply({ ephemeral: true });
      const cfg = guildConfig(interaction.guild.id);
      let memberRole = interaction.guild.roles.cache.find(r => r.name === "Member");
      if (!memberRole) memberRole = await interaction.guild.roles.create({ name: "Member", reason: "TVB Assistant setup" });
      let staffRole = interaction.guild.roles.cache.find(r => r.name === "Ticket Staff");
      if (!staffRole) staffRole = await interaction.guild.roles.create({ name: "Ticket Staff", reason: "TVB Assistant setup" });
      let category = interaction.guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === "Tickets");
      if (!category) category = await interaction.guild.channels.create({ name: "Tickets", type: ChannelType.GuildCategory });
      let welcome = interaction.guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === "welcome");
      if (!welcome) welcome = await interaction.guild.channels.create({ name: "welcome", type: ChannelType.GuildText });
      cfg.autorole = memberRole.id; cfg.ticketStaffRole = staffRole.id; cfg.ticketCategory = category.id; cfg.welcomeChannel = welcome.id; saveConfig();
      return interaction.editReply(`✅ Setup complete!\n**Auto-role:** ${memberRole}\n**Welcome:** ${welcome}\n**Ticket staff:** ${staffRole}\n**Ticket/Application category:** ${category}\n\nUse **/ticketpanel** and **/applicationpanel** where you want the panels.`);
    }

    if (commandName === "setwelcome") {
      const channel = interaction.options.getChannel("channel", true);
      const message = interaction.options.getString("message", true);
      const cfg = guildConfig(interaction.guild.id);
      cfg.welcomeChannel = channel.id; cfg.welcomeMessage = message; saveConfig();
      return interaction.reply({ content: `✅ Welcome message updated for ${channel}.\nUse \`{user}\` for the member and \`{server}\` for the server name.`, ephemeral: true });
    }

    if (commandName === "setautorole") {
      const role = interaction.options.getRole("role", true); guildConfig(interaction.guild.id).autorole = role.id; saveConfig();
      return interaction.reply({ content: `✅ New members will receive ${role}.`, ephemeral: true });
    }
    if (commandName === "setticketstaff") {
      const role = interaction.options.getRole("role", true); guildConfig(interaction.guild.id).ticketStaffRole = role.id; saveConfig();
      return interaction.reply({ content: `✅ Ticket/application staff is now ${role}.`, ephemeral: true });
    }
    if (commandName === "setticketcategory") {
      const category = interaction.options.getChannel("category", true); guildConfig(interaction.guild.id).ticketCategory = category.id; saveConfig();
      return interaction.reply({ content: `✅ Tickets and applications will be created in ${category}.`, ephemeral: true });
    }

    if (commandName === "ticketpanel") {
      const embed = new EmbedBuilder()
        .setColor(0x7C5CFF)
        .setTitle("🎫 TVB SUPPORT CENTER")
        .setDescription("━━━━━━━━━━━━━━━━━━━━\n**Need a hand? We're here to help.**\n\nChoose a category from the dropdown below and a private channel will be created for you. Please choose the option that best matches your issue so our team can help faster.\n\n🟪 **General Support** — Questions and general help\n🟦 **Purchase Support** — Purchases, payments, and orders\n🟥 **Player Report** — Report a player or rule breaking\n🟨 **Staff Report** — Report a concern about a staff member\n━━━━━━━━━━━━━━━━━━━━\n**Please don't open duplicate tickets.**");
      embed.setFooter({ text: "TVB Assistant • Private support • Please be respectful" });
      await interaction.channel.send({ embeds: [embed], components: [buildTicketMenu()] });
      return interaction.reply({ content: "✅ Ticket panel posted.", ephemeral: true });
    }

    if (commandName === "applicationpanel") {
      const embed = new EmbedBuilder()
        .setColor(0x7C5CFF)
        .setTitle("📋 TVB APPLICATION CENTER")
        .setDescription("━━━━━━━━━━━━━━━━━━━━\n**Want to join the team?**\n\nChoose an application below. Your answers are collected privately in a staff-only channel for review. Each application has **15 simple questions** and should only take a few minutes.\n\n🧱 **Builder Application** — Apply to help create amazing builds\n🛡️ **Staff Application** — Apply to help moderate and support the community\n━━━━━━━━━━━━━━━━━━━━\n**Please answer honestly and clearly.** Low-effort applications may be declined.");
      embed.setFooter({ text: "TVB Assistant • Applications • Good luck!" });
      await interaction.channel.send({ embeds: [embed], components: [buildApplicationMenu()] });
      return interaction.reply({ content: "✅ Application panel posted.", ephemeral: true });
    }

    if (commandName === "buttonrole") {
      const cfg = guildConfig(interaction.guild.id); const sub = interaction.options.getSubcommand();
      if (sub === "add") {
        const role = interaction.options.getRole("role", true); const label = interaction.options.getString("label", true); const emoji = interaction.options.getString("emoji", false) || null;
        if (role.managed || role.position >= interaction.guild.members.me.roles.highest.position) return interaction.reply({ content: "I can't manage that role. Put my bot role above it.", ephemeral: true });
        cfg.buttonRoles = cfg.buttonRoles.filter(x => x.roleId !== role.id); cfg.buttonRoles.push({ roleId: role.id, label, emoji }); saveConfig();
        return interaction.reply({ content: `✅ Added ${role}. Run "/buttonrole panel" to post the panel.`, ephemeral: true });
      }
      if (sub === "remove") {
        const role = interaction.options.getRole("role", true); cfg.buttonRoles = cfg.buttonRoles.filter(x => x.roleId !== role.id); saveConfig();
        return interaction.reply({ content: `✅ Removed ${role} from the panel.`, ephemeral: true });
      }
      if (sub === "panel") {
        if (!cfg.buttonRoles.length) return interaction.reply({ content: "No button roles configured yet. Use `/buttonrole add` first.", ephemeral: true });
        const rows = [];
        for (let i = 0; i < cfg.buttonRoles.length; i += 5) {
          const row = new ActionRowBuilder();
          for (const item of cfg.buttonRoles.slice(i, i + 5)) {
            const role = interaction.guild.roles.cache.get(item.roleId); if (!role) continue;
            const button = new ButtonBuilder().setCustomId(`role:${role.id}`).setLabel(item.label).setStyle(ButtonStyle.Secondary); if (item.emoji) button.setEmoji(item.emoji); row.addComponents(button);
          }
          if (row.components.length) rows.push(row);
        }
        await interaction.channel.send({ embeds: [ticketEmbed("🔘 CHOOSE YOUR ROLES", "Click a button to add or remove your selected roles. You can change them anytime.", 0x7C5CFF)], components: rows });
        return interaction.reply({ content: "✅ Button-role panel posted.", ephemeral: true });
      }
    }

    if (["ban", "kick", "timeout", "warn", "warnings", "clear"].includes(commandName) && !isModerator(interaction)) return interaction.reply({ content: "You need the appropriate moderation permission to use this command.", ephemeral: true });

    if (["ban", "kick", "timeout", "warn"].includes(commandName)) {
      const user = interaction.options.getUser("user", true); const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: "That user isn't in this server.", ephemeral: true });
      if (member.id === interaction.user.id) return interaction.reply({ content: "You can't moderate yourself.", ephemeral: true });
      if (!member.moderatable) return interaction.reply({ content: "I can't moderate that member. Check my role position and permissions.", ephemeral: true });
      if (commandName === "ban") { const reason = interaction.options.getString("reason") || "No reason provided"; await member.ban({ reason }); return interaction.reply(`🔨 Banned **${user.tag}**. Reason: ${reason}`); }
      if (commandName === "kick") { const reason = interaction.options.getString("reason") || "No reason provided"; await member.kick(reason); return interaction.reply(`👢 Kicked **${user.tag}**. Reason: ${reason}`); }
      if (commandName === "timeout") { const minutes = interaction.options.getInteger("minutes", true); const reason = interaction.options.getString("reason") || "No reason provided"; await member.timeout(minutes * 60 * 1000, reason); return interaction.reply(`⏳ Timed out **${user.tag}** for **${minutes} minutes**. Reason: ${reason}`); }
      if (commandName === "warn") { const reason = interaction.options.getString("reason", true); const key = warnKey(interaction.guild.id, user.id); const list = getWarnings(interaction.guild.id, user.id); list.push({ reason, moderator: interaction.user.id, at: new Date().toISOString() }); warnings.set(key, list); return interaction.reply(`⚠️ Warned **${user.tag}**. They now have **${list.length}** warning(s). Reason: ${reason}`); }
    }

    if (commandName === "warnings") {
      const user = interaction.options.getUser("user", true); const list = getWarnings(interaction.guild.id, user.id);
      if (!list.length) return interaction.reply({ content: `**${user.tag}** has no warnings.`, ephemeral: true });
      return interaction.reply({ content: `⚠️ Warnings for **${user.tag}**:\n${list.map((w, i) => `**${i + 1}.** ${w.reason} — <@${w.moderator}>`).join("\n")}`, ephemeral: true });
    }
    if (commandName === "clear") {
      if (!interaction.channel?.isTextBased()) return interaction.reply({ content: "This command must be used in a text channel.", ephemeral: true });
      const amount = interaction.options.getInteger("amount", true); const deleted = await interaction.channel.bulkDelete(amount, true);
      return interaction.reply({ content: `🧹 Deleted **${deleted.size}** messages.`, ephemeral: true });
    }
  } catch (error) {
    console.error(error);
    try { await interaction.reply({ content: "❌ Something went wrong. Check the bot logs.", ephemeral: true }); } catch (_) {}
  }
});

client.login(TOKEN);

