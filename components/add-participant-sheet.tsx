"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet"
import { createClient } from "@/lib/supabase/client"
import { useState } from "react"
import { toast } from "sonner"

interface AddParticipantSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function AddParticipantSheet({
  open,
  onOpenChange,
  onCreated
}: AddParticipantSheetProps) {
  const [email, setEmail] = useState("")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [discordUsername, setDiscordUsername] = useState("")
  const [saving, setSaving] = useState(false)
  const [showDiscardDialog, setShowDiscardDialog] = useState(false)

  const isDirty =
    email !== "" ||
    firstName !== "" ||
    lastName !== "" ||
    discordUsername !== ""

  const resetForm = () => {
    setEmail("")
    setFirstName("")
    setLastName("")
    setDiscordUsername("")
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isDirty) {
      setShowDiscardDialog(true)
      return
    }
    if (!nextOpen) resetForm()
    onOpenChange(nextOpen)
  }

  const handleDiscard = () => {
    setShowDiscardDialog(false)
    resetForm()
    onOpenChange(false)
  }

  const handleSave = async () => {
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      toast.error("Email is required")
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast.error("Please enter a valid email address")
      return
    }

    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase.from("participants").insert({
      email: trimmedEmail,
      first_name: firstName.trim() || null,
      last_name: lastName.trim() || null,
      discord_username: discordUsername.trim() || null
    })
    setSaving(false)

    if (error) {
      if (error.code === "23505") {
        toast.error("A participant with this email already exists")
      } else {
        toast.error("Failed to create participant")
      }
      return
    }

    toast.success("Participant created")
    resetForm()
    onOpenChange(false)
    onCreated()
  }

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add Participant</SheetTitle>
            <SheetDescription>
              Create a new participant by entering their details below.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4">
            <div className="space-y-2">
              <Label htmlFor="participant-email">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="participant-email"
                type="email"
                placeholder="participant@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="participant-first-name">First Name</Label>
              <Input
                id="participant-first-name"
                placeholder="John"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="participant-last-name">Last Name</Label>
              <Input
                id="participant-last-name"
                placeholder="Doe"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="participant-discord">Discord</Label>
              <Input
                id="participant-discord"
                placeholder="username"
                value={discordUsername}
                onChange={(e) => setDiscordUsername(e.target.value)}
              />
            </div>
          </div>
          <SheetFooter>
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes that will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDiscard}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
