import "@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Papa from "https://esm.sh/papaparse@5.4.1"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

// Fixed column indices from DevPost registrant CSV
// Headers: First Name, Last Name, Email, Portfolio Url, Submitted Project?, Project URLs,
//   City, State, Country, Project Count, College/University Name, Job Specialty,
//   Registered At, Do you have teammates?, Who told you about this hackathon?, Discord
const COL = {
  EMAIL: 2,
  DISCORD: 15,
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()

    if (profile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Only admins can import data" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const formData = await req.formData()
    const file = formData.get("file")
    if (!file || !(file instanceof File)) {
      return new Response(JSON.stringify({ error: "No CSV file provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const csvText = await file.text()

    const parsed = Papa.parse(csvText, {
      header: false,
      skipEmptyLines: true,
    })

    if (parsed.errors.length > 0) {
      return new Response(
        JSON.stringify({ error: "CSV parsing errors", details: parsed.errors.slice(0, 5) }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Skip header row
    const rows: string[][] = parsed.data.slice(1)

    // Build map of email -> discord from CSV (skip rows with no discord)
    const discordMap = new Map<string, string>()
    for (const row of rows) {
      const email = (row[COL.EMAIL] || "").trim().toLowerCase()
      let discord = (row[COL.DISCORD] || "").trim()
      if (email && discord) {
        // Strip leading ' (CSV text-force artifact), leading @, and anything after #
        if (discord.startsWith("'")) discord = discord.slice(1)
        if (discord.startsWith("@")) discord = discord.slice(1)
        const hashIndex = discord.indexOf("#")
        if (hashIndex !== -1) discord = discord.slice(0, hashIndex)
        discord = discord.trim()
        if (discord) discordMap.set(email, discord)
      }
    }

    if (discordMap.size === 0) {
      return new Response(
        JSON.stringify({ updated: 0, skipped: 0, message: "No Discord handles found in CSV" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Service role client for writes
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    // Fetch only existing participants whose email appears in the CSV
    const emails = Array.from(discordMap.keys())
    const { data: existingParticipants, error: fetchError } = await adminClient
      .from("participants")
      .select("id, email")
      .in("email", emails)

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch participants", details: fetchError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    if (!existingParticipants || existingParticipants.length === 0) {
      return new Response(
        JSON.stringify({ updated: 0, skipped: discordMap.size, message: "No matching participants found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Update discord_username for each matched participant
    const updates = existingParticipants.map((p: { id: string; email: string }) => ({
      id: p.id,
      email: p.email,
      discord_username: discordMap.get(p.email)!,
    }))

    const { error: updateError } = await adminClient
      .from("participants")
      .upsert(updates, { onConflict: "id" })

    if (updateError) {
      return new Response(
        JSON.stringify({ error: "Failed to update discord handles", details: updateError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const skipped = discordMap.size - updates.length

    return new Response(
      JSON.stringify({
        success: true,
        updated: updates.length,
        skipped,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
