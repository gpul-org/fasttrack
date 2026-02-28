import { createClient } from "@/lib/supabase/server"
import { type EmailOtpType } from "@supabase/supabase-js"
import { redirect } from "next/navigation"
import { type NextRequest } from "next/server"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null

  if (token_hash && type) {
    const supabase = await createClient()

    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash
    })
    if (!error && data.user) {
      const normalizedEmail = data.user.email?.trim().toLowerCase()
      if (normalizedEmail) {
        const { data: participant } = await supabase
          .from("participants")
          .select("id, email")
          .ilike("email", normalizedEmail)
          .maybeSingle()

        if (participant) {
          redirect("/my-queues")
        }

        const { data: fuzzyMatches } = await supabase
          .from("participants")
          .select("id, email")
          .ilike("email", `%${normalizedEmail}%`)

        if (fuzzyMatches && fuzzyMatches.length > 0) {
          redirect("/my-queues")
        }
      }

      redirect("/pending")
    } else {
      redirect(`/auth/error?error=${error?.message}`)
    }
  }

  redirect(`/auth/error?error=No token hash or type`)
}
