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

interface Participant {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  discord_username: string | null
}

interface EditParticipantSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  participant: Participant
  onUpdated: () => void
}

export function EditParticipantSheet({
  open,
  onOpenChange,
  participant,
  onUpdated
}: EditParticipantSheetProps) {
  const [email, setEmail] = useState(participant.email)
  const [firstName, setFirstName] = useState(participant.first_name || "")
  const [lastName, setLastName] = useState(participant.last_name || "")
  const [discordUsername, setDiscordUsername] = useState(
    participant.discord_username || ""
  )
  const [saving, setSaving] = useState(false)
  const [showDiscardDialog, setShowDiscardDialog] = useState(false)

  const isDirty =
    email !== participant.email ||
    firstName !== (participant.first_name || "") ||
    lastName !== (participant.last_name || "") ||
    discordUsername !== (participant.discord_username || "")

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isDirty) {
      setShowDiscardDialog(true)
      return
    }
    onOpenChange(nextOpen)
  }

  const handleDiscard = () => {
    setShowDiscardDialog(false)
    setEmail(participant.email)
    setFirstName(participant.first_name || "")
    setLastName(participant.last_name || "")
    setDiscordUsername(participant.discord_username || "")
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
    const { error } = await supabase
      .from("participants")
      .update({
        email: trimmedEmail,
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        discord_username: discordUsername.trim() || null
      })
      .eq("id", participant.id)
    setSaving(false)

    if (error) {
      if (error.code === "23505") {
        toast.error("A participant with this email already exists")
      } else {
        toast.error("Failed to update participant")
      }
      return
    }

    toast.success("Participant updated")
    onOpenChange(false)
    onUpdated()
  }

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit Participant</SheetTitle>
            <SheetDescription>
              Update the participant details below.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4">
            <div className="space-y-2">
              <Label htmlFor="edit-participant-email">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="edit-participant-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-participant-first-name">First Name</Label>
              <Input
                id="edit-participant-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-participant-last-name">Last Name</Label>
              <Input
                id="edit-participant-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-participant-discord">Discord</Label>
              <Input
                id="edit-participant-discord"
                value={discordUsername}
                onChange={(e) => setDiscordUsername(e.target.value)}
                placeholder="username"
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
