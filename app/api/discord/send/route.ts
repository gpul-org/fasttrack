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

    const fromSubmission: string[] = []
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

        const handle = extractDiscordHandle(
          participantRecord as Record<string, unknown>
        )

        if (handle) {
          fromSubmission.push(handle)
        }
      })
    }

    const participants = Array.from(
      new Set([...fromRequest, ...fromSubmission])
    )

    if (participants.length === 0) {
      return NextResponse.json({ ok: true, sent: false, reason: "no-handles" })
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
