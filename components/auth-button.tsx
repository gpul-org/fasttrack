"use client"

import { createClient } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"
import { Gavel, LogOut } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "./ui/button"

export function AuthButton() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [loggingOut, setLoggingOut] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const isOnDashboard = pathname.startsWith("/dashboard")

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signOut()
      if (error) throw error

      setUser(null)
      router.replace("/")
      router.refresh()
    } catch {
      toast.error("Could not sign out. Please try again.")
    } finally {
      setLoggingOut(false)
    }
  }

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setLoading(false)
    })

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return null
  }

  return user ? (
    <div className="flex items-center gap-2">
      {!isOnDashboard && (
        <Button asChild size="sm" variant={"default"}>
          <Link href="/dashboard" className="flex items-center gap-2">
            <Gavel className="h-4 w-4" />
            Judging Area
          </Link>
        </Button>
      )}
      {!isOnDashboard && (
        <Button
          size="sm"
          variant="ghost"
          onClick={handleLogout}
          disabled={loggingOut}
        >
          <LogOut className="mr-2 h-4 w-4" />
          {loggingOut ? "Signing out..." : "Sign out"}
        </Button>
      )}
    </div>
  ) : (
    <Button asChild size="sm" variant={"default"}>
      <Link href="/auth/login" className="flex items-center gap-2">
        <Gavel className="h-4 w-4" />
        Sign in
      </Link>
    </Button>
  )
}
