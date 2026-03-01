import { createClient } from "jsr:@supabase/supabase-js@2"
import webpush from "npm:web-push"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

interface WebhookPayload {
  notification_type?: "called" | "near_buffer"
  queue_position?: number
  type: "INSERT" | "UPDATE" | "DELETE"
  table: string
  record: {
    id: string
    submission_id: string
    status: string
    called_at: string | null
    room_id: string
  }
  old_record: {
    status: string
  } | null
}

interface SubmissionParticipantLink {
  participants:
    | {
        email: string | null
        first_name: string | null
        last_name: string | null
      }
    | {
        email: string | null
        first_name: string | null
        last_name: string | null
      }[]
    | null
}

interface ProfileRecipient {
  id: string
  email: string | null
}

interface PushSubscriptionRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const webhookPayload: WebhookPayload = await req.json()
    const notificationType = webhookPayload.notification_type || "called"

    // Default behavior: send only on transition to "called"
    if (
      notificationType === "called" &&
      (webhookPayload.record.status !== "called" || webhookPayload.old_record?.status === "called")
    ) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      })
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    // Get submission with participant emails
    const { data: submission, error: submissionError } = await supabase
      .from("submissions")
      .select(
        "id, number, title, submission_participants(participants(email, first_name, last_name))"
      )
      .eq("id", webhookPayload.record.submission_id)
      .single()

    if (submissionError || !submission) {
      console.error("Failed to fetch submission:", submissionError)
      return new Response(
        JSON.stringify({ error: "Submission not found" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      )
    }

    // Get room info
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("name")
      .eq("id", webhookPayload.record.room_id)
      .single()

    if (roomError || !room) {
      console.error("Failed to fetch room:", roomError)
      return new Response(
        JSON.stringify({ error: "Room not found" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      )
    }

    // Extract participant emails from team members
    const participants = submission.submission_participants || []
    const emails: string[] = []

    participants.forEach((p: SubmissionParticipantLink) => {
      if (p.participants) {
        const participant = Array.isArray(p.participants)
          ? p.participants[0]
          : p.participants

        if (participant && participant.email) {
          emails.push(participant.email)
        }
      }
    })

    if (emails.length === 0) {
      console.log(
        "No participant emails found for submission:",
        webhookPayload.record.submission_id
      )
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      })
    }

    const uniqueEmails = Array.from(new Set(emails.map((email) => email.trim().toLowerCase())))

    const { data: recipients, error: recipientsError } = await supabase
      .from("profiles")
      .select("id, email")
      .in("email", uniqueEmails)

    if (recipientsError) {
      console.error("Failed to resolve registered recipients:", recipientsError)
      return new Response(
        JSON.stringify({ error: "Failed to resolve recipients" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      )
    }

    const registeredRecipients = ((recipients || []) as ProfileRecipient[])
      .filter((profile) => profile.email)

    if (registeredRecipients.length === 0) {
      console.log(
        `No registered users found for submission #${submission.number} (${notificationType})`
      )
      return new Response(
        JSON.stringify({ ok: true, sent: 0, total: 0 }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      )
    }

    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") || ""
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") || ""
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || ""

    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      console.log("Missing VAPID configuration; skipping web push")
      return new Response(
        JSON.stringify({ ok: true, sent: 0, total: registeredRecipients.length }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      )
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

    const { data: subscriptions, error: subscriptionsError } = await supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", registeredRecipients.map((profile) => profile.id))

    if (subscriptionsError) {
      console.error("Failed to fetch push subscriptions:", subscriptionsError)
      return new Response(
        JSON.stringify({ error: "Failed to fetch push subscriptions" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      )
    }

    const queuePosition = typeof webhookPayload.queue_position === "number" ? webhookPayload.queue_position : null

    const nearBufferTitle = queuePosition === 1
      ? `You're next – get ready at ${room.name}`
      : `Heads up – you're #${queuePosition ?? "?"} in queue at ${room.name}`
    const nearBufferBody = queuePosition === 1
      ? `Team #${submission.number}: move to the door of room ${room.name} now.`
      : `Team #${submission.number}: start heading to floor 3, you're #${queuePosition ?? "?"} in queue.`

    const pushPayload = JSON.stringify({
      title:
        notificationType === "near_buffer"
          ? nearBufferTitle
          : `Your team has been called to ${room.name}`,
      body:
        notificationType === "near_buffer"
          ? nearBufferBody
          : `Team #${submission.number}: go to room ${room.name} and wait at the door.`,
      data: {
        roomId: webhookPayload.record.room_id,
        submissionId: webhookPayload.record.submission_id,
        notificationType,
        queuePosition
      }
    })

    const staleSubscriptionIds: string[] = []
    const sendResults = await Promise.allSettled(
      ((subscriptions || []) as PushSubscriptionRow[]).map((subscription) => {
        return webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth
            }
          },
          pushPayload
        ).catch((error: { statusCode?: number }) => {
          if (error?.statusCode === 404 || error?.statusCode === 410) {
            staleSubscriptionIds.push(subscription.id)
          }
          throw error
        })
      })
    )

    if (staleSubscriptionIds.length > 0) {
      await supabase.from("push_subscriptions").delete().in("id", staleSubscriptionIds)
    }

    const sentCount = sendResults.filter((result) => result.status === "fulfilled").length

    console.log(
      `Web push (${notificationType}) sent for submission #${submission.number} in ${room.name}`,
      {
        recipientCount: registeredRecipients.length,
        subscriptionCount: (subscriptions || []).length,
        sentCount
      }
    )

    return new Response(
      JSON.stringify({
        ok: true,
        sent: sentCount,
        total: (subscriptions || []).length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    )
  } catch (error) {
    console.error("Webhook error:", error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    )
  }
})
