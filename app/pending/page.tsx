"use client"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { FastForward, LogOut, RefreshCw } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

export default function PendingPage() {
  const router = useRouter()
  const [isChecking, setIsChecking] = useState(false)
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadProfile = async () => {
      const supabase = createClient()
      const {
        data: { user }
      } = await supabase.auth.getUser()

      if (user) {
        setEmail(user.email || "")

        const { data: profile } = await supabase
          .from("profiles")
          .select("first_name, last_name")
          .eq("id", user.id)
          .maybeSingle()

        if (profile) {
          setFirstName(profile.first_name || "")
          setLastName(profile.last_name || "")
        }
      }
      setLoading(false)
    }

    loadProfile()
  }, [])

  useEffect(() => {
    const checkApprovalStatus = async () => {
      const supabase = createClient()
      const {
        data: { user }
      } = await supabase.auth.getUser()

      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle()

        if (profile?.role !== null) {
          router.push("/dashboard")
          return
        }

        const normalizedEmail = user.email?.trim().toLowerCase()
        if (normalizedEmail) {
          const { data: participant } = await supabase
            .from("participants")
            .select("id, email")
            .ilike("email", normalizedEmail)
            .maybeSingle()

          if (participant) {
            router.push("/my-queues")
            return
          }

          const { data: fuzzyMatches } = await supabase
            .from("participants")
            .select("id, email")
            .ilike("email", `%${normalizedEmail}%`)

          if (fuzzyMatches && fuzzyMatches.length > 0) {
            router.push("/my-queues")
            return
          }
        }
      }
    }

    const interval = setInterval(checkApprovalStatus, 10000)
    return () => clearInterval(interval)
  }, [router])

  const handleCheckStatus = async () => {
    setIsChecking(true)
    const supabase = createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle()

      if (profile?.role !== null) {
        router.push("/dashboard")
      } else {
        const normalizedEmail = user.email?.trim().toLowerCase()
        if (normalizedEmail) {
          const { data: participant } = await supabase
            .from("participants")
            .select("id, email")
            .ilike("email", normalizedEmail)
            .maybeSingle()

          if (participant) {
            router.push("/my-queues")
            return
          }

          const { data: fuzzyMatches } = await supabase
            .from("participants")
            .select("id, email")
            .ilike("email", `%${normalizedEmail}%`)

          if (fuzzyMatches && fuzzyMatches.length > 0) {
            router.push("/my-queues")
            return
          }
        }

        toast.info("Still pending approval")
      }
    }
    setIsChecking(false)
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)

    const supabase = createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (user) {
      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: firstName,
          last_name: lastName
        })
        .eq("id", user.id)

      if (error) {
        toast.error("Failed to update profile")
        console.error(error)
      } else {
        toast.success("Profile updated successfully")
      }
    }

    setIsSaving(false)
  }

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/")
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="flex w-full max-w-2xl items-center justify-between">
        <div className="flex items-center gap-3">
          <FastForward className="h-10 w-10" />
          <span className="text-3xl font-bold">FastTrack</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="text-muted-foreground"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </Button>
      </div>
      <div className="w-full max-w-2xl space-y-6">
        <Card className="border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-orange-900 dark:text-orange-100">
                  Awaiting Approval
                </CardTitle>
                <CardDescription className="mt-2 text-orange-700 dark:text-orange-300">
                  Your account is being reviewed. Complete your profile below
                  while you wait.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={handleCheckStatus}
                disabled={isChecking}
                className="shrink-0"
                title="Check approval status"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isChecking ? "animate-spin" : ""}`}
                />
              </Button>
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Complete Your Profile</CardTitle>
            <CardDescription>
              Add your information while you wait for approval
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  disabled
                  className="bg-muted"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Enter your first name"
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Enter your last name"
                  disabled={loading}
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={isSaving || loading}
              >
                {isSaving ? "Saving..." : "Save Profile"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
