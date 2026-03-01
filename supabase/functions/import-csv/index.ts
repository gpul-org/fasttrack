import "@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Papa from "https://esm.sh/papaparse@5.4.1"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

// Fixed column indices from DevPost CSV
// Headers: Project Title, Submission Url, Project Status, Judging Status,
//   Highest Step Completed, Project Created At, About The Project, "Try it out" Links,
//   Video Demo Link, Opt-In Prizes, Built With, Submitter First Name, Submitter Last Name,
//   Submitter Email, Notes, Repo Link, Demo Link, Team Colleges/Universities,
//   Additional Team Member Count, Team Member 1 First Name, Team Member 1 Last Name, Team Member 1 Email, ...
const COL = {
  PROJECT_TITLE: 0,
  SUBMISSION_URL: 1,
  PROJECT_STATUS: 2,
  // 3: Judging Status
  // 4: Highest Step Completed
  // 5: Project Created At
  // 6: About The Project
  // 7: "Try it out" Links
  VIDEO_DEMO_LINK: 8,
  OPT_IN_PRIZE: 9,
  // 10: Built With
  SUBMITTER_FIRST_NAME: 11,
  SUBMITTER_LAST_NAME: 12,
  SUBMITTER_EMAIL: 13,
  // 14: Notes
  DEPLOY_LINK: 15,
  GIT_LINK: 16,
  // 17: Team Colleges/Universities
  ADDITIONAL_TEAM_MEMBER_COUNT: 18,
  // 19+: Team Member 1 First Name, Last Name, Email, Team Member 2 ..., etc.
  TEAM_MEMBERS_START: 19,
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

    // Papa Parse handles variable field counts and multiline fields
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

    const participantsMap = new Map<string, { first_name: string; last_name: string }>()
    const submissionsMap = new Map<string, {
      title: string
      repo_url: string
      demo_url: string
      video_url: string
      prizes: string[]
    }>()
    const linksMap = new Map<string, Set<string>>()
    let skippedDrafts = 0

    for (const row of rows) {
      const submissionUrl = (row[COL.SUBMISSION_URL] || "").trim()
      const projectTitle = (row[COL.PROJECT_TITLE] || "").trim()
      const projectStatus = (row[COL.PROJECT_STATUS] || "").trim()

      // Skip empty, untitled, and non-submitted entries
      if (!submissionUrl || projectTitle === "Untitled") continue
      if (!projectStatus.startsWith("Submitted")) {
        skippedDrafts++
        continue
      }

      const prize = (row[COL.OPT_IN_PRIZE] || "").trim()
      const repoUrl = (row[COL.GIT_LINK] || "").trim()
      const demoUrl = (row[COL.DEPLOY_LINK] || "").trim()
      const videoUrl = (row[COL.VIDEO_DEMO_LINK] || "").trim()

      if (submissionsMap.has(submissionUrl)) {
        const existing = submissionsMap.get(submissionUrl)!
        if (prize && !existing.prizes.includes(prize)) {
          existing.prizes.push(prize)
        }
      } else {
        const prizes = ["GENERAL"]
        if (prize && prize !== "GENERAL") {
          prizes.push(prize)
        }
        submissionsMap.set(submissionUrl, {
          title: projectTitle,
          repo_url: repoUrl,
          demo_url: demoUrl,
          video_url: videoUrl,
          prizes,
        })
      }

      if (!linksMap.has(submissionUrl)) {
        linksMap.set(submissionUrl, new Set())
      }
      const links = linksMap.get(submissionUrl)!

      // Submitter
      const submitterEmail = (row[COL.SUBMITTER_EMAIL] || "").trim().toLowerCase()
      const submitterFirst = (row[COL.SUBMITTER_FIRST_NAME] || "").trim()
      const submitterLast = (row[COL.SUBMITTER_LAST_NAME] || "").trim()

      if (submitterEmail) {
        if (!participantsMap.has(submitterEmail)) {
          participantsMap.set(submitterEmail, {
            first_name: submitterFirst,
            last_name: submitterLast,
          })
        }
        links.add(submitterEmail)
      }

      // Team members: read the count, then groups of 3 columns
      const teamMemberCount = parseInt(row[COL.ADDITIONAL_TEAM_MEMBER_COUNT] || "0", 10)
      for (let i = 0; i < teamMemberCount; i++) {
        const baseIdx = COL.TEAM_MEMBERS_START + i * 3
        if (baseIdx + 2 >= row.length) break

        const memberFirst = (row[baseIdx] || "").trim()
        const memberLast = (row[baseIdx + 1] || "").trim()
        const memberEmail = (row[baseIdx + 2] || "").trim().toLowerCase()

        if (!memberEmail) continue

        if (!participantsMap.has(memberEmail)) {
          participantsMap.set(memberEmail, {
            first_name: memberFirst,
            last_name: memberLast,
          })
        }
        links.add(memberEmail)
      }
    }

    // Service role client for writes
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    // Upsert participants
    const participantRows = Array.from(participantsMap.entries()).map(
      ([email, data]) => ({
        email,
        first_name: data.first_name || null,
        last_name: data.last_name || null,
      })
    )

    const { error: partError } = await adminClient
      .from("participants")
      .upsert(participantRows, { onConflict: "email" })

    if (partError) {
      return new Response(
        JSON.stringify({ error: "Failed to import participants", details: partError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Upsert submissions (number auto-increments via sequence)
    const submissionRows = Array.from(submissionsMap.entries()).map(
      ([devpost_url, data]) => ({
        devpost_url,
        title: data.title || null,
        repo_url: data.repo_url || null,
        demo_url: data.demo_url || null,
        video_url: data.video_url || null,
        prizes: data.prizes,
      })
    )

    const { error: subError } = await adminClient
      .from("submissions")
      .upsert(submissionRows, { onConflict: "devpost_url" })

    if (subError) {
      return new Response(
        JSON.stringify({ error: "Failed to import submissions", details: subError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Fetch IDs
    const { data: dbParticipants } = await adminClient
      .from("participants")
      .select("id, email")

    const { data: dbSubmissions } = await adminClient
      .from("submissions")
      .select("id, devpost_url")

    const participantIdMap = new Map(
      (dbParticipants || []).map((p: { id: string; email: string }) => [p.email, p.id])
    )
    const submissionIdMap = new Map(
      (dbSubmissions || []).map((s: { id: string; devpost_url: string }) => [s.devpost_url, s.id])
    )

    // Build junction rows
    const junctionRows: { participant_id: string; submission_id: string }[] = []
    for (const [submissionUrl, emails] of linksMap.entries()) {
      const submissionId = submissionIdMap.get(submissionUrl)
      if (!submissionId) continue

      for (const email of emails) {
        const participantId = participantIdMap.get(email)
        if (!participantId) continue

        junctionRows.push({
          participant_id: participantId,
          submission_id: submissionId,
        })
      }
    }

    const { error: juncError } = await adminClient
      .from("submission_participants")
      .upsert(junctionRows, { onConflict: "participant_id,submission_id" })

    if (juncError) {
      return new Response(
        JSON.stringify({ error: "Failed to link participants to submissions", details: juncError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        participants: participantRows.length,
        submissions: submissionRows.length,
        links: junctionRows.length,
        skippedDrafts,
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
