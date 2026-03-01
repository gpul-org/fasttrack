"use client"

import { EditParticipantSheet } from "@/components/edit-participant-sheet"
import { PrizeBadge } from "@/components/prize-badge"
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
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import { createClient } from "@/lib/supabase/client"
import { ChevronRight, Pencil, Trash2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

interface Participant {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  discord_username: string | null
}

interface Submission {
  id: string
  number: number
  title: string | null
  devpost_url: string
  prizes: string[]
}

export function ParticipantDetail({ id }: { id: string }) {
  const router = useRouter()
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [editSheetOpen, setEditSheetOpen] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const fetchData = async () => {
    const supabase = createClient()

    const { data: participantData, error: participantError } = await supabase
      .from("participants")
      .select("id, email, first_name, last_name, discord_username")
      .eq("id", id)
      .single()

    if (participantError) {
      toast.error("Failed to fetch participant")
      console.error(participantError)
      setLoading(false)
      return
    }

    setParticipant(participantData)
    window.dispatchEvent(
      new CustomEvent("breadcrumbLabel", { detail: participantData.email })
    )

    const { data: submissionData, error: submissionError } = await supabase
      .from("submission_participants")
      .select("submissions(id, number, title, devpost_url, prizes)")
      .eq("participant_id", id)

    if (submissionError) {
      toast.error("Failed to fetch projects")
      console.error(submissionError)
      setLoading(false)
      return
    }

    const projects = (submissionData || [])
      .map((sp: Record<string, unknown>) => sp.submissions as Submission | null)
      .filter(Boolean) as Submission[]

    projects.sort((a, b) => a.number - b.number)
    setSubmissions(projects)
    setLoading(false)
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const handleDelete = async () => {
    setDeleting(true)
    const supabase = createClient()
    const { error } = await supabase.from("participants").delete().eq("id", id)
    setDeleting(false)

    if (error) {
      toast.error("Failed to delete participant")
      console.error(error)
      return
    }

    toast.success("Participant deleted")
    router.push("/dashboard/participants")
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Participant Details</h1>
        {!loading && participant && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditSheetOpen(true)}
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        )}
      </div>

      <Card className="shadow-none">
        <CardContent className="p-0">
          <div className="flex items-center justify-between p-4">
            <Label className="w-28 shrink-0 text-sm font-medium text-muted-foreground">
              First Name
            </Label>
            <div className="flex-1 text-sm">
              {loading ? (
                <Skeleton className="h-4 w-32" />
              ) : (
                participant?.first_name || "—"
              )}
            </div>
          </div>

          <div className="border-t" />

          <div className="flex items-center justify-between p-4">
            <Label className="w-28 shrink-0 text-sm font-medium text-muted-foreground">
              Last Name
            </Label>
            <div className="flex-1 text-sm">
              {loading ? (
                <Skeleton className="h-4 w-32" />
              ) : (
                participant?.last_name || "—"
              )}
            </div>
          </div>

          <div className="border-t" />

          <div className="flex items-center justify-between p-4">
            <Label className="w-28 shrink-0 text-sm font-medium text-muted-foreground">
              Email
            </Label>
            <div className="flex-1 text-sm">
              {loading ? (
                <Skeleton className="h-4 w-48" />
              ) : (
                participant?.email || "—"
              )}
            </div>
          </div>

          <div className="border-t" />

          <div className="flex items-center justify-between p-4">
            <Label className="w-28 shrink-0 text-sm font-medium text-muted-foreground">
              Discord
            </Label>
            <div className="flex-1 text-sm">
              {loading ? (
                <Skeleton className="h-4 w-32" />
              ) : (
                participant?.discord_username || "—"
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Projects</h2>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px] pl-6">#</TableHead>
                <TableHead className="w-[40%]">Title</TableHead>
                <TableHead className="w-[40%]">Prizes</TableHead>
                <TableHead className="w-[50px] text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="py-3 pl-6">
                      <Skeleton className="h-4 w-6" />
                    </TableCell>
                    <TableCell className="py-3">
                      <Skeleton className="h-4 w-40" />
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex gap-1">
                        <Skeleton className="h-5 w-16 rounded-full" />
                        <Skeleton className="h-5 w-20 rounded-full" />
                      </div>
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Skeleton className="ml-auto h-8 w-8 rounded-md" />
                    </TableCell>
                  </TableRow>
                ))
              ) : submissions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center">
                    No projects found
                  </TableCell>
                </TableRow>
              ) : (
                submissions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="py-3 pl-6 font-mono text-muted-foreground">
                      {s.number}
                    </TableCell>
                    <TableCell className="py-3 font-medium">
                      {s.title || "Untitled"}
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex flex-wrap gap-1">
                        {s.prizes.map((prize) => (
                          <PrizeBadge key={prize} prize={prize} />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Link href={`/dashboard/projects/${s.id}`}>
                        <Button variant="ghost" size="icon">
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {participant && (
        <EditParticipantSheet
          key={`${participant.id}-${participant.email}-${participant.first_name}-${participant.last_name}-${participant.discord_username}`}
          open={editSheetOpen}
          onOpenChange={setEditSheetOpen}
          participant={participant}
          onUpdated={fetchData}
        />
      )}

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete participant</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this participant and remove them from
              all projects. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
