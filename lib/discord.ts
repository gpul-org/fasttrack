"use server"

import { REST } from "@discordjs/rest"
import { APIGuildMember, Routes } from "discord-api-types/v10"

const rest = new REST({
  version: "10"
}).setToken(process.env.DISCORD_BOT_TOKEN!)

interface DiscordEmbedField {
  name: string
  value: string
  inline?: boolean
}

interface DiscordEmbedPayload {
  title?: string
  description?: string
  color?: number
  fields?: DiscordEmbedField[]
  footer?: {
    text?: string
  }
}

export async function getMembers(): Promise<Map<string, string>> {
  const members = (await rest.get(
    Routes.guildMembers(process.env.DISCORD_GUILD_ID!),
    {
      query: new URLSearchParams("limit=1000")
    }
  )) as APIGuildMember[]

  return new Map(
    members.map((member) => [member.user.username, member.user.id])
  )
}

let memberMap: Map<string, string> | null
export async function sendMessage(
  message: string,
  participants: string[],
  embed?: DiscordEmbedPayload
) {
  if (!memberMap) {
    memberMap = await getMembers()
  }

  const memberIds = participants
    .map((participant) => participant.trim())
    .filter(Boolean)
    .map((participant) => memberMap!.get(participant))
    .filter((memberId): memberId is string => Boolean(memberId))

  const uniqueMemberIds = Array.from(new Set(memberIds))
  const mention = uniqueMemberIds.map((memberId) => `<@${memberId}>`)

  if (mention.length === 0) {
    return
  }

  const embedPayload = {
    title:
      typeof embed?.title === "string" && embed.title.trim().length > 0
        ? embed.title.trim()
        : "FastTrack",
    description:
      typeof embed?.description === "string" &&
      embed.description.trim().length > 0
        ? embed.description.trim()
        : message,
    color:
      typeof embed?.color === "number" && Number.isInteger(embed.color)
        ? embed.color
        : 0x5865f2,
    fields:
      Array.isArray(embed?.fields) && embed!.fields.length > 0
        ? embed!.fields
            .filter(
              (field) =>
                field &&
                typeof field.name === "string" &&
                field.name.trim().length > 0 &&
                typeof field.value === "string" &&
                field.value.trim().length > 0
            )
            .slice(0, 25)
            .map((field) => ({
              name: field.name.trim().slice(0, 256),
              value: field.value.trim().slice(0, 1024),
              inline: Boolean(field.inline)
            }))
        : [
            {
              name: "Alert for",
              value: mention.join(" "),
              inline: false
            }
          ],
    footer:
      typeof embed?.footer?.text === "string" &&
      embed.footer.text.trim().length > 0
        ? { text: embed.footer.text.trim().slice(0, 2048) }
        : undefined
  }

  await rest.post(Routes.channelMessages(process.env.DISCORD_CHANNEL!), {
    body: {
      content: `Alert for: ${mention.join(" ")}`,
      embeds: [embedPayload],
      allowed_mentions: {
        users: uniqueMemberIds
      }
    }
  })
}
