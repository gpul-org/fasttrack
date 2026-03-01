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

// Singleton promise to avoid concurrent getMembers() calls racing and
// hammering the Discord API (which causes rate-limit drops).
let memberMapPromise: Promise<Map<string, string>> | null = null
function ensureMemberMap(): Promise<Map<string, string>> {
  if (!memberMapPromise) {
    memberMapPromise = getMembers().catch((err) => {
      // Reset so the next call retries instead of caching the failure.
      memberMapPromise = null
      throw err
    })
  }
  return memberMapPromise
}

// Sequential queue so rapid-fire calls don't run concurrently – each message
// waits for the previous one to finish (including Discord rate-limit back-off
// handled internally by @discordjs/rest).
let sendQueue: Promise<void> = Promise.resolve()

export async function sendMessage(
  message: string,
  participants: Array<string | { handle: string; name?: string }>,
  embed?: DiscordEmbedPayload
) {
  // Chain onto the queue so sends are serialized.
  const task = sendQueue.then(() => doSendMessage(message, participants, embed))
  // Keep the queue alive even if one message fails.
  sendQueue = task.catch(() => {})
  return task
}

async function doSendMessage(
  message: string,
  participants: Array<string | { handle: string; name?: string }>,
  embed?: DiscordEmbedPayload
) {
  const memberMap = await ensureMemberMap()

  const normalized = participants
    .map((p) =>
      typeof p === "string"
        ? { handle: p.trim(), name: p.trim() }
        : { handle: p.handle.trim(), name: (p.name || p.handle).trim() }
    )
    .filter((p) => p.handle || p.name)

  if (normalized.length === 0) {
    return
  }

  const mentionStrings: string[] = []
  const nameFallbacks: string[] = []
  const resolvedIds: string[] = []

  for (const p of normalized) {
    const memberId = p.handle ? memberMap.get(p.handle) : undefined
    if (memberId) {
      if (!resolvedIds.includes(memberId)) {
        resolvedIds.push(memberId)
        mentionStrings.push(`<@${memberId}>`)
      }
    } else {
      // Use the human-readable name (not the handle) as fallback text.
      const label = p.name || p.handle
      if (label && !nameFallbacks.includes(label)) {
        nameFallbacks.push(label)
      }
    }
  }

  const allAddressees = [...mentionStrings, ...nameFallbacks]

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
              value: allAddressees.join(" "),
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
      content: `Alert for: ${allAddressees.join(" ")}`,
      embeds: [embedPayload],
      allowed_mentions: {
        users: resolvedIds
      }
    }
  })
}
