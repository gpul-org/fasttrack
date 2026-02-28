"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { FileUp, Loader2, Trash2, Upload, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [confirmText, setConfirmText] = useState("")
  const [counts, setCounts] = useState({ participants: 0, projects: 0 })
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const fetchUserRole = async () => {
      const supabase = createClient()
      const {
        data: { session }
      } = await supabase.auth.getSession()

      if (!session) {
        toast.error("Your session expired. Please log in again.")
        setIsUploading(false)
        return
      }

      const { data: refreshed, error: refreshError } =
        await supabase.auth.refreshSession()
      const accessToken =
        refreshed.session?.access_token ?? session.access_token

      if (refreshError || !accessToken) {
        toast.error("Invalid session token. Please log out and log in again.")
        setIsUploading(false)
        return
      }

      const {
        data: { user }
      } = await supabase.auth.getUser()

      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single()

        setUserRole(profile?.role || null)
      }

      const [{ count: pCount }, { count: sCount }] = await Promise.all([
        supabase
          .from("participants")
          .select("*", { count: "exact", head: true }),
        supabase.from("submissions").select("*", { count: "exact", head: true })
      ])
      setCounts({
        participants: pCount ?? 0,
        projects: sCount ?? 0
      })

      setLoading(false)
    }

    fetchUserRole()
  }, [])

  const isDisabled = userRole === "judge" || loading

  const validateFile = (f: File): boolean => {
    if (!f.name.endsWith(".csv")) {
      toast.error("Only CSV files are accepted")
      return false
    }
    return true
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (!isDisabled) setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (isDisabled) return

    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && validateFile(droppedFile)) {
      setFile(droppedFile)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile && validateFile(selectedFile)) {
      setFile(selectedFile)
    }
  }

  const handleClearData = async () => {
    setIsClearing(true)
    try {
      const supabase = createClient()
      const { error: linkError } = await supabase
        .from("submission_participants")
        .delete()
        .neq("participant_id", "00000000-0000-0000-0000-000000000000")
      if (linkError) throw linkError

      const { error: subError } = await supabase
        .from("submissions")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000")
      if (subError) throw subError

      const { error: partError } = await supabase
        .from("participants")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000")
      if (partError) throw partError

      const { error: seqError } = await supabase.rpc(
        "reset_submissions_sequence"
      )
      if (seqError) throw seqError

      toast.success("All uploaded data has been cleared")
      setCounts({ participants: 0, projects: 0 })
      setFile(null)
      if (inputRef.current) inputRef.current.value = ""
    } catch {
      toast.error("Failed to clear data. Please try again.")
    } finally {
      setIsClearing(false)
      setClearDialogOpen(false)
      setConfirmText("")
    }
  }

  const handleUpload = async () => {
    if (!file) return
    setIsUploading(true)

    try {
      const supabase = createClient()

      const {
        data: { session }
      } = await supabase.auth.getSession()

      if (!session) {
        toast.error("Your session expired. Please log in again.")
        setIsUploading(false)
        return
      }

      const { data: refreshed, error: refreshError } =
        await supabase.auth.refreshSession()
      const accessToken =
        refreshed.session?.access_token ?? session.access_token

      if (refreshError || !accessToken) {
        toast.error("Invalid session token. Please log out and log in again.")
        setIsUploading(false)
        return
      }

      const {
        data: { user }
      } = await supabase.auth.getUser(accessToken)

      if (!user) {
        toast.error("You must be logged in to upload")
        setIsUploading(false)
        return
      }

      const formData = new FormData()
      formData.append("file", file)

      const { data, error } = await supabase.functions.invoke("import-csv", {
        body: formData,
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })

      if (error) {
        let message = error.message || "Upload failed"
        const context = (error as { context?: Response }).context

        if (context) {
          try {
            const payload = await context.clone().json()
            const serverMessage =
              typeof payload?.error === "string"
                ? payload.error
                : typeof payload?.message === "string"
                  ? payload.message
                  : null

            if (serverMessage) {
              message = serverMessage
            }
          } catch {
            try {
              const text = await context.text()
              if (text) message = text
            } catch {
              // Keep original message
            }
          }
        }

        if (message.toLowerCase().includes("invalid jwt")) {
          toast.error("Invalid JWT. Please refresh the page and try again.")
          return
        }

        toast.error(message)
        return
      }

      toast.success(
        `Imported ${data.participants} participants, ${data.submissions} projects, and ${data.links} links`
      )
      setFile(null)
      if (inputRef.current) inputRef.current.value = ""
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      const lower = raw.toLowerCase()

      if (
        lower.includes("jwt") ||
        lower.includes("token") ||
        lower.includes("auth")
      ) {
        toast.error("Auth error: please log out and log in again.")
      } else if (
        lower.includes("failed to send") ||
        lower.includes("network") ||
        lower.includes("fetch")
      ) {
        toast.error(
          "Network error reaching Edge Function. Check connection and project URL."
        )
      } else {
        toast.error(raw || "Upload failed")
      }

      console.error("CSV upload failed:", err)
    } finally {
      setIsUploading(false)
    }
  }

  const handleRemoveFile = () => {
    setFile(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Upload the CSV exported from DevPost to import hackathon data.
        </p>
        {userRole === "admin" && (
          <AlertDialog
            open={clearDialogOpen}
            onOpenChange={(open) => {
              setClearDialogOpen(open)
              if (!open) setConfirmText("")
            }}
          >
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={isClearing}
              >
                {isClearing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                {isClearing ? "Clearing..." : "Clear data"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3">
                    <p>
                      This will permanently delete all uploaded data. This
                      action cannot be undone.
                    </p>
                    <div className="flex gap-4 text-sm font-medium text-foreground">
                      <span>{counts.participants} participants</span>
                      <span>{counts.projects} projects</span>
                    </div>
                    <p>
                      Type{" "}
                      <span className="font-mono font-semibold text-destructive">
                        DELETE
                      </span>{" "}
                      to confirm.
                    </p>
                    <Input
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder="DELETE"
                      className="font-mono"
                    />
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleClearData}
                  disabled={confirmText !== "DELETE" || isClearing}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isClearing ? "Clearing..." : "Yes, clear all data"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {isDisabled && !loading && (
        <p className="text-sm text-muted-foreground">
          Only administrators can upload files.
        </p>
      )}

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isDisabled && inputRef.current?.click()}
        className={cn(
          "flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-md border border-dashed p-6 text-center transition-colors",
          isDragging && "border-primary bg-accent",
          isDisabled
            ? "cursor-not-allowed opacity-50"
            : "cursor-pointer hover:border-primary/50 hover:bg-accent/50"
        )}
      >
        <FileUp className="h-8 w-8 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">
            Click to browse or drag and drop
          </p>
          <p className="text-xs text-muted-foreground">CSV files only</p>
        </div>
        <Input
          ref={inputRef}
          id="file"
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          disabled={isDisabled}
          className="hidden"
        />
      </div>

      {file && (
        <div className="flex items-center justify-between rounded-md border px-4 py-3">
          <div className="flex items-center gap-3 text-sm">
            <FileUp className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{file.name}</span>
            <span className="text-muted-foreground">
              ({(file.size / 1024).toFixed(1)} KB)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleUpload}
              size="sm"
              disabled={isDisabled || isUploading}
            >
              {isUploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {isUploading ? "Importing..." : "Upload"}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRemoveFile}
              disabled={isUploading}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
