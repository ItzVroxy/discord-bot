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
  Routes
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
      autorole: null,
      ticketCategory: null,
      ticketStaffRole: null,
      buttonRoles: []
    };
  }
  return config[guildId];
}

function isModerator(interaction) {
  return interaction.memberPermissions?.has(PermissionsBitField.Flags.ModerateMembers) ||
         interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
}

function safeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 80) || "user";
}

const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Create the basic TVB Assistant roles/channels for this server."),

  new SlashCommandBuilder()
    .setName("setwelcome")
    .setDescription("Choose the channel where welcome messages are sent.")
    .addChannelOption(o => o.setName("channel").setDescription("Welcome channel").setRequired(true)
      .addChannelTypes(ChannelType.GuildText)),

  new SlashCommandBuilder()
    .setName("setautorole")
    .setDescription("Choose the role automatically given to new members.")
    .addRoleOption(o => o.setName("role").setDescription("Auto-role").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("Post a ticket panel in the current channel."),

  new SlashCommandBuilder()
    .setName("setticketstaff")
    .setDescription("Choose the role that can see/manage tickets.")
    .addRoleOption(o => o.setName("role").setDescription("Ticket staff role").setRequired(true)),

  new SlashCommandBuilder()
    .setName("setticketcategory")
    .setDescription("Choose the category where tickets are created.")
    .addChannelOption(o => o.setName("category").setDescription("Ticket category").setRequired(true)
      .addChannelTypes(ChannelType.GuildCategory)),

  new SlashCommandBuilder()
    .setName("buttonrole")
    .setDescription("Manage button roles.")
    .addSubcommand(s => s.setName("add").setDescription("Add a button role.")
      .addRoleOption(o => o.setName("role").setDescription("Role to give").setRequired(true))
      .addStringOption(o => o.setName("label").setDescription("Button text").setRequired(true).setMaxLength(80))
      .addStringOption(o => o.setName("emoji").setDescription("Optional emoji").setRequired(false).setMaxLength(32)))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a button role.")
      .addRoleOption(o => o.setName("role").setDescription("Role to remove from the panel").setRequired(true)))
    .addSubcommand(s => s.setName("panel").setDescription("Post the current button-role panel.")),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member.")
    .addUserOption(o => o.setName("user").setDescription("Member to ban").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member.")
    .addUserOption(o => o.setName("user").setDescription("Member to kick").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member.")
    .addUserOption(o => o.setName("user").setDescription("Member to timeout").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("Timeout length in minutes").setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member.")
    .addUserOption(o => o.setName("user").setDescription("Member to warn").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true)),

  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("Show warnings for a member.")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Delete recent messages.")
    .addIntegerOption(o => o.setName("amount").setDescription("1-100 messages").setRequired(true).setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if TVB Assistant is online.")
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const guilds = [...client.guilds.cache.values()];
  for (const guild of guilds) {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands });
      console.log(`Registered commands in ${guild.name}`);
    } catch (e) {
      console.error(`Command registration failed for ${guild.name}:`, e);
    }
  }
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on("guildCreate", async guild => {
  guildConfig(guild.id);
  saveConfig();
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
      if (role && role.position < member.guild.members.me.roles.highest.position) {
        await member.roles.add(role);
      }
    } catch (e) { console.error("Auto-role error:", e); }
  }

  if (cfg.welcomeChannel) {
    try {
      const channel = member.guild.channels.cache.get(cfg.welcomeChannel);
      if (channel?.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle("👋 Welcome to the server!")
          .setDescription(`Welcome ${member} to **${member.guild.name}**!`)
          .setThumbnail(member.user.displayAvatarURL())
          .setFooter({ text: "TVB Assistant" });
        await channel.send({ embeds: [embed] });
      }
    } catch (e) { console.error("Welcome error:", e); }
  }
});

const warnings = new Map();

function warnKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getWarnings(guildId, userId) {
  return warnings.get(warnKey(guildId, userId)) || [];
}

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isButton()) {
      const [type, value] = interaction.customId.split(":");

      if (type === "role") {
        const role = interaction.guild.roles.cache.get(value);
        if (!role) return interaction.reply({ content: "That role no longer exists.", ephemeral: true });
        if (role.managed || role.position >= interaction.guild.members.me.roles.highest.position) {
          return interaction.reply({ content: "I can't manage that role. Make sure my bot role is above it.", ephemeral: true });
        }
        if (interaction.member.roles.cache.has(role.id)) {
          await interaction.member.roles.remove(role);
          return interaction.reply({ content: `Removed ${role} from you.`, ephemeral: true });
        }
        await interaction.member.roles.add(role);
        return interaction.reply({ content: `Added ${role} to you.`, ephemeral: true });
      }

      if (type === "ticket") {
        const cfg = guildConfig(interaction.guild.id);
        const existing = interaction.guild.channels.cache.find(
          c => c.type === ChannelType.GuildText && c.topic === `ticket-owner:${interaction.user.id}`
        );
        if (existing) return interaction.reply({ content: `You already have a ticket: ${existing}`, ephemeral: true });

        const overwrites = [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]},
          { id: interaction.guild.members.me.id, allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageChannels
          ]}
        ];

        if (cfg.ticketStaffRole) {
          overwrites.push({ id: cfg.ticketStaffRole, allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]});
        }

        const channel = await interaction.guild.channels.create({
          name: `ticket-${safeName(interaction.user.username)}`,
          type: ChannelType.GuildText,
          parent: cfg.ticketCategory || null,
          topic: `ticket-owner:${interaction.user.id}`,
          permissionOverwrites: overwrites
        });

        const closeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("ticket-close").setLabel("Close Ticket").setStyle(ButtonStyle.Danger)
        );
        await channel.send({
          content: `${interaction.user}${cfg.ticketStaffRole ? ` <@&${cfg.ticketStaffRole}>` : ""}`,
          embeds: [new EmbedBuilder().setTitle("🎫 Support Ticket").setDescription("Tell us what you need help with. A staff member will be with you soon.")],
          components: [closeRow]
        });
        return interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });
      }

      if (interaction.customId === "ticket-close") {
        const cfg = guildConfig(interaction.guild.id);
        const isStaff = cfg.ticketStaffRole && interaction.member.roles.cache.has(cfg.ticketStaffRole);
        const ownerId = interaction.channel.topic?.replace("ticket-owner:", "");
        if (!isStaff && ownerId !== interaction.user.id && !isModerator(interaction)) {
          return interaction.reply({ content: "You don't have permission to close this ticket.", ephemeral: true });
        }
        await interaction.reply("🔒 Closing ticket in 5 seconds...");
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    if (commandName === "ping") return interaction.reply(`🏓 Pong! ${client.ws.ping}ms`);

    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) &&
        ["setup","setwelcome","setautorole","ticketpanel","setticketstaff","setticketcategory","buttonrole"].includes(commandName)) {
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

      cfg.autorole = memberRole.id;
      cfg.ticketStaffRole = staffRole.id;
      cfg.ticketCategory = category.id;
      cfg.welcomeChannel = welcome.id;
      saveConfig();

      return interaction.editReply(
        `✅ Setup complete!\n` +
        `**Auto-role:** ${memberRole}\n` +
        `**Welcome:** ${welcome}\n` +
        `**Ticket staff:** ${staffRole}\n` +
        `**Ticket category:** ${category}\n\n` +
        `Run **/ticketpanel** in the channel where you want the ticket button, and **/buttonrole add** to create button roles.`
      );
    }

    if (commandName === "setwelcome") {
      const channel = interaction.options.getChannel("channel", true);
      guildConfig(interaction.guild.id).welcomeChannel = channel.id;
      saveConfig();
      return interaction.reply({ content: `✅ Welcome messages will go to ${channel}.`, ephemeral: true });
    }

    if (commandName === "setautorole") {
      const role = interaction.options.getRole("role", true);
      guildConfig(interaction.guild.id).autorole = role.id;
      saveConfig();
      return interaction.reply({ content: `✅ New members will receive ${role}.`, ephemeral: true });
    }

    if (commandName === "setticketstaff") {
      const role = interaction.options.getRole("role", true);
      guildConfig(interaction.guild.id).ticketStaffRole = role.id;
      saveConfig();
      return interaction.reply({ content: `✅ Ticket staff is now ${role}.`, ephemeral: true });
    }

    if (commandName === "setticketcategory") {
      const category = interaction.options.getChannel("category", true);
      guildConfig(interaction.guild.id).ticketCategory = category.id;
      saveConfig();
      return interaction.reply({ content: `✅ Tickets will be created in ${category}.`, ephemeral: true });
    }

    if (commandName === "ticketpanel") {
      const cfg = guildConfig(interaction.guild.id);
      if (!cfg.ticketCategory) return interaction.reply({ content: "Run `/setup` first.", ephemeral: true });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket:create").setLabel("Open a Ticket").setEmoji("🎫").setStyle(ButtonStyle.Primary)
      );
      const embed = new EmbedBuilder()
        .setTitle("🎫 Need Help?")
        .setDescription("Click the button below to open a private support ticket.")
        .setFooter({ text: "TVB Assistant" });
      await interaction.channel.send({ embeds: [embed], components: [row] });
      return interaction.reply({ content: "✅ Ticket panel posted.", ephemeral: true });
    }

    if (commandName === "buttonrole") {
      const cfg = guildConfig(interaction.guild.id);
      const sub = interaction.options.getSubcommand();

      if (sub === "add") {
        const role = interaction.options.getRole("role", true);
        const label = interaction.options.getString("label", true);
        const emoji = interaction.options.getString("emoji", false) || null;
        if (role.managed || role.position >= interaction.guild.members.me.roles.highest.position) {
          return interaction.reply({ content: "I can't manage that role. Put my bot role above it.", ephemeral: true });
        }
        cfg.buttonRoles = cfg.buttonRoles.filter(x => x.roleId !== role.id);
        cfg.buttonRoles.push({ roleId: role.id, label, emoji });
        saveConfig();
        return interaction.reply({ content: `✅ Added ${role} to the button-role panel. Run \`/buttonrole panel\` to post it.`, ephemeral: true });
      }

      if (sub === "remove") {
        const role = interaction.options.getRole("role", true);
        cfg.buttonRoles = cfg.buttonRoles.filter(x => x.roleId !== role.id);
        saveConfig();
        return interaction.reply({ content: `✅ Removed ${role} from the panel.`, ephemeral: true });
      }

      if (sub === "panel") {
        if (!cfg.buttonRoles.length) return interaction.reply({ content: "No button roles configured yet. Use `/buttonrole add` first.", ephemeral: true });
        const rows = [];
        for (let i = 0; i < cfg.buttonRoles.length; i += 5) {
          const row = new ActionRowBuilder();
          for (const item of cfg.buttonRoles.slice(i, i + 5)) {
            const role = interaction.guild.roles.cache.get(item.roleId);
            if (!role) continue;
            const button = new ButtonBuilder()
              .setCustomId(`role:${role.id}`)
              .setLabel(item.label)
              .setStyle(ButtonStyle.Secondary);
            if (item.emoji) button.setEmoji(item.emoji);
            row.addComponents(button);
          }
          if (row.components.length) rows.push(row);
        }
        if (!rows.length) return interaction.reply({ content: "None of the configured roles still exist.", ephemeral: true });
        await interaction.channel.send({
          embeds: [new EmbedBuilder().setTitle("🔘 Choose Your Roles").setDescription("Click a button to add or remove a role.")],
          components: rows
        });
        return interaction.reply({ content: "✅ Button-role panel posted.", ephemeral: true });
      }
    }

    if (["ban","kick","timeout","warn","warnings","clear"].includes(commandName)) {
      if (!isModerator(interaction)) {
        return interaction.reply({ content: "You need the appropriate moderation permission to use this command.", ephemeral: true });
      }
    }

    if (commandName === "ban" || commandName === "kick" || commandName === "timeout" || commandName === "warn") {
      const user = interaction.options.getUser("user", true);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: "That user isn't in this server.", ephemeral: true });
      if (member.id === interaction.user.id) return interaction.reply({ content: "You can't moderate yourself.", ephemeral: true });
      if (!member.moderatable) return interaction.reply({ content: "I can't moderate that member. Check my role position and permissions.", ephemeral: true });

      if (commandName === "ban") {
        const reason = interaction.options.getString("reason") || "No reason provided";
        await member.ban({ reason });
        return interaction.reply(`🔨 Banned **${user.tag}**. Reason: ${reason}`);
      }
      if (commandName === "kick") {
        const reason = interaction.options.getString("reason") || "No reason provided";
        await member.kick(reason);
        return interaction.reply(`👢 Kicked **${user.tag}**. Reason: ${reason}`);
      }
      if (commandName === "timeout") {
        const minutes = interaction.options.getInteger("minutes", true);
        const reason = interaction.options.getString("reason") || "No reason provided";
        await member.timeout(minutes * 60 * 1000, reason);
        return interaction.reply(`⏳ Timed out **${user.tag}** for **${minutes} minutes**. Reason: ${reason}`);
      }
      if (commandName === "warn") {
        const reason = interaction.options.getString("reason", true);
        const key = warnKey(interaction.guild.id, user.id);
        const list = getWarnings(interaction.guild.id, user.id);
        list.push({ reason, moderator: interaction.user.id, at: new Date().toISOString() });
        warnings.set(key, list);
        return interaction.reply(`⚠️ Warned **${user.tag}**. They now have **${list.length}** warning(s). Reason: ${reason}`);
      }
    }

    if (commandName === "warnings") {
      const user = interaction.options.getUser("user", true);
      const list = getWarnings(interaction.guild.id, user.id);
      if (!list.length) return interaction.reply({ content: `**${user.tag}** has no warnings.`, ephemeral: true });
      const text = list.map((w, i) => `**${i + 1}.** ${w.reason} — <@${w.moderator}>`).join("\n");
      return interaction.reply({ content: `⚠️ Warnings for **${user.tag}**:\n${text}`, ephemeral: true });
    }

    if (commandName === "clear") {
      if (!interaction.channel?.isTextBased()) return interaction.reply({ content: "This command must be used in a text channel.", ephemeral: true });
      const amount = interaction.options.getInteger("amount", true);
      const deleted = await interaction.channel.bulkDelete(amount, true);
      return interaction.reply({ content: `🧹 Deleted **${deleted.size}** messages.`, ephemeral: true });
    }
  } catch (error) {
    console.error(error);
    const message = interaction.replied || interaction.deferred
      ? { content: "❌ Something went wrong. Check the bot logs.", ephemeral: true }
      : { content: "❌ Something went wrong. Check the bot logs.", ephemeral: true };
    try { await interaction.reply(message); } catch (_) {}
  }
});

client.login(TOKEN);
