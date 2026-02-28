"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"
import { HelpCircle } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

type Profile = {
  first_name: string | null
  last_name: string | null
  role: "judge" | "admin" | null
}

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")

  useEffect(() => {
    const supabase = createClient()

    const fetchUserAndProfile = async () => {
      setLoading(true)
      const {
        data: { user }
      } = await supabase.auth.getUser()
      setUser(user)

      if (user) {
        const { data: profileData, error } = await supabase
          .from("profiles")
          .select("first_name, last_name, role")
          .eq("id", user.id)
          .maybeSingle()

        if (error) {
          toast.error("Failed to load profile")
        }

        setProfile(profileData)
        setFirstName(profileData?.first_name || "")
        setLastName(profileData?.last_name || "")
      }
      setLoading(false)
    }

    fetchUserAndProfile()
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return

    setSaving(true)
    const supabase = createClient()

    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: firstName,
        last_name: lastName
      })
      .eq("id", user.id)

    if (error) {
      toast.error("Failed to update profile. Please try again.")
    } else {
      toast.success("Profile updated successfully.")
      setProfile({ ...profile!, first_name: firstName, last_name: lastName })

      // Trigger event to update sidebar
      window.dispatchEvent(new CustomEvent("profileUpdated"))
    }

    setSaving(false)
  }

  const displayRole = profile?.role
    ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1)
    : profile?.role === null
      ? "Pending"
      : "User"

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Personal Information</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Update your personal details.
        </p>
      </div>

      <Card className="max-w-3xl">
        <CardContent className="p-0">
          <TooltipProvider>
            <form onSubmit={handleSave}>
              <div className="flex items-center justify-between p-4">
                <div className="flex min-w-[120px] items-center gap-2">
                  <Label htmlFor="email" className="text-sm font-medium">
                    Email
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Your email address cannot be changed</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="max-w-md flex-1">
                  <Input
                    id="email"
                    type="email"
                    value={loading ? "" : user?.email || ""}
                    disabled
                    className="bg-muted"
                  />
                </div>
              </div>

              <div className="border-t" />

              <div className="flex items-center justify-between p-4">
                <Label
                  htmlFor="firstName"
                  className="min-w-[120px] text-sm font-medium"
                >
                  First Name
                </Label>
                <div className="max-w-md flex-1">
                  <Input
                    id="firstName"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Enter your first name"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="border-t" />

              <div className="flex items-center justify-between p-4">
                <Label
                  htmlFor="lastName"
                  className="min-w-[120px] text-sm font-medium"
                >
                  Last Name
                </Label>
                <div className="max-w-md flex-1">
                  <Input
                    id="lastName"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Enter your last name"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="border-t" />

              <div className="flex items-center justify-between p-4">
                <div className="flex min-w-[120px] items-center gap-2">
                  <Label htmlFor="role" className="text-sm font-medium">
                    Role
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>If your role is incorrect, contact an organizer</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="max-w-md flex-1">
                  <Select value={loading ? "" : displayRole} disabled>
                    <SelectTrigger id="role" className="bg-muted">
                      <SelectValue placeholder={loading ? "" : displayRole} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Judge">Judge</SelectItem>
                      <SelectItem value="Admin">Admin</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="border-t" />

              <div className="flex justify-end p-4">
                <Button type="submit" disabled={saving || loading}>
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </TooltipProvider>
        </CardContent>
      </Card>
    </div>
  )
}
