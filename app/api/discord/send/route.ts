import { sendMessage } from "@/lib/discord"
import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

type SendDiscordRequest = {
  message?: string
  participants?: string[]
  submissionId?: string
  embed?: {
    title?: string
    description?: string
    color?: number
    fields?: Array<{
      name?: string
      value?: string
      inline?: boolean
    }>
    footer?: {
      text?: string
    }
  }
}

const DISCORD_KEYS = [
  "discord_username",
  "discord_user",
  "discord",
  "discord_handle",
  "discordUser",
  "discordUsername"
]

function extractDiscordHandle(record: Record<string, unknown>): string | null {
  for (const key of DISCORD_KEYS) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()

    if (
      profileError ||
      !profile ||
      !["admin", "judge"].includes(profile.role)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = (await request.json()) as SendDiscordRequest
    const message =
      (body.message || "FastTrack notification").trim() ||
      "FastTrack notification"

    const embed = body.embed
      ? {
          title:
            typeof body.embed.title === "string" && body.embed.title.trim()
              ? body.embed.title.trim()
              : "FastTrack",
          description:
            typeof body.embed.description === "string"
              ? body.embed.description.trim()
              : undefined,
          color:
            typeof body.embed.color === "number" &&
            Number.isInteger(body.embed.color)
              ? body.embed.color
              : undefined,
          fields: Array.isArray(body.embed.fields)
            ? body.embed.fields
                .filter(
                  (field) =>
                    field &&
                    typeof field.name === "string" &&
                    field.name.trim() &&
                    typeof field.value === "string" &&
                    field.value.trim()
                )
                .slice(0, 25)
                .map((field) => ({
                  name: (field.name as string).trim().slice(0, 256),
                  value: (field.value as string).trim().slice(0, 1024),
                  inline: Boolean(field.inline)
                }))
            : undefined,
          footer:
            body.embed.footer && typeof body.embed.footer.text === "string"
              ? {
                  text: body.embed.footer.text.trim().slice(0, 2048)
                }
              : undefined
        }
      : undefined

    const fromRequest = (body.participants || [])
      .map((participant) => participant.trim())
      .filter(Boolean)

    const fromSubmission: Array<{ handle: string; name: string }> = []
    if (body.submissionId) {
      const { data: links, error: linksError } = await supabase
        .from("submission_participants")
        .select("participants(*)")
        .eq("submission_id", body.submissionId)

      if (linksError) {
        return NextResponse.json(
          { error: "Failed to load submission participants" },
          { status: 400 }
        )
      }

      ;(links || []).forEach((row) => {
        const participant = (row as { participants?: unknown }).participants
        const participantRecord = Array.isArray(participant)
          ? participant[0]
          : participant

        if (!participantRecord || typeof participantRecord !== "object") return

        const rec = participantRecord as Record<string, unknown>
        const handle = extractDiscordHandle(rec) || ""
        const firstName =
          typeof rec.first_name === "string" ? rec.first_name.trim() : ""
        const lastName =
          typeof rec.last_name === "string" ? rec.last_name.trim() : ""
        const fullName =
          [firstName, lastName].filter(Boolean).join(" ") || handle

        // Always include every team member – if they have no discord handle
        // their name will still appear in the notification text.
        if (handle || fullName) {
          fromSubmission.push({ handle, name: fullName })
        }
      })
    }

    // Merge fromRequest (plain handles) and fromSubmission ({handle, name}),
    // deduplicating by handle when present, or by name otherwise.
    const seenKeys = new Set<string>()
    const participants: Array<string | { handle: string; name: string }> = []
    for (const handle of fromRequest) {
      if (!seenKeys.has(handle)) {
        seenKeys.add(handle)
        participants.push(handle)
      }
    }
    for (const p of fromSubmission) {
      const dedupeKey = p.handle || p.name
      if (dedupeKey && !seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey)
        participants.push(p)
      }
    }

    if (participants.length === 0) {
      return NextResponse.json({
        ok: true,
        sent: false,
        reason: "no-participants"
      })
    }

    await sendMessage(message, participants, embed)

    return NextResponse.json({
      ok: true,
      sent: true,
      participants,
      count: participants.length
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
