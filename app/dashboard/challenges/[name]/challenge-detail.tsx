"use client"

import {
  Challenge,
  EditChallengeSheet
} from "@/components/edit-challenge-sheet"
import { PrizeBadge } from "@/components/prize-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { createClient } from "@/lib/supabase/client"
import {
  AlignLeft,
  ChevronRight,
  FolderOpen,
  Hash,
  Pencil,
  ToggleLeft,
  Users
} from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

interface ParticipantInfo {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
}

interface Submission {
  id: string
  number: number
  title: string | null
  devpost_url: string
  repo_url: string | null
  demo_url: string | null
  prizes: string[]
  submission_participants: {
    participant_id: string
    participants: ParticipantInfo
  }[]
}

const questionTypeLabels: Record<string, string> = {
  boolean: "Boolean",
  number: "Number",
  textarea: "Textarea"
}

const questionTypeStyles: Record<string, string> = {
  boolean:
    "border-0 bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  number:
    "border-0 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  textarea:
    "border-0 bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300"
}

const questionTypeIcons: Record<string, ReturnType<typeof AlignLeft>> = {
  boolean: <ToggleLeft className="h-3.5 w-3.5" />,
  number: <Hash className="h-3.5 w-3.5" />,
  textarea: <AlignLeft className="h-3.5 w-3.5" />
}

export function ChallengeDetail({ name }: { name: string }) {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [configuredChallenge, setConfiguredChallenge] =
    useState<Challenge | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editSheetOpen, setEditSheetOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  const fetchDataRef = useRef(async () => {
    const supabase = createClient()
    const [submissionsResult, challengeResult, userResult] = await Promise.all([
      supabase
        .from("submissions")
        .select(
          "id, number, title, devpost_url, prizes, submission_participants(participant_id, participants(id, first_name, last_name, email))"
        )
        .contains("prizes", [name])
        .order("number"),
      supabase.from("challenges").select("*").eq("keyword", name).maybeSingle(),
      supabase.auth.getUser()
    ])

    if (submissionsResult.error) {
      toast.error("Failed to fetch projects")
      console.error(submissionsResult.error)
    } else {
      setSubmissions((submissionsResult.data as unknown as Submission[]) || [])
    }

    if (!challengeResult.error) {
      setConfiguredChallenge(
        (challengeResult.data as unknown as Challenge) || null
      )
    }

    if (!userResult.error && userResult.data.user) {
      const profileResult = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userResult.data.user.id)
        .single()
      if (!profileResult.error) {
        setIsAdmin(profileResult.data?.role === "admin")
      }
    }

    setLoading(false)
  })

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("breadcrumbLabel", { detail: name }))
    fetchDataRef.current()
  }, [name])

  const uniqueParticipantCount = new Set(
    submissions.flatMap((s) =>
      s.submission_participants.map((sp) => sp.participant_id)
    )
  ).size

  const filteredSubmissions = submissions.filter((s) => {
    const term = searchTerm.toLowerCase()
    return (s.title || "").toLowerCase().includes(term)
  })

  const totalPages = Math.ceil(filteredSubmissions.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedSubmissions = filteredSubmissions.slice(
    startIndex,
    startIndex + itemsPerPage
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Challenge Details</h1>
      </div>

      <Card className="shadow-none">
        <CardContent className="p-4">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-24 rounded-full" />
              <div className="flex items-center gap-4">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          ) : configuredChallenge ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <p className="font-medium">{configuredChallenge.title}</p>
                  <PrizeBadge prize={configuredChallenge.keyword} />
                </div>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    onClick={() => setEditSheetOpen(true)}
                    title="Edit challenge"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              {configuredChallenge.questions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Judge Questions
                  </p>
                  <div className="divide-y rounded-md border">
                    {configuredChallenge.questions.map((q, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 px-3 py-2.5"
                      >
                        <span className="w-4 shrink-0 font-mono text-xs text-muted-foreground">
                          {i + 1}
                        </span>
                        <span className="flex-1 text-sm">{q.label}</span>
                        <Badge
                          variant="outline"
                          className={`shrink-0 gap-1 text-xs ${questionTypeStyles[q.type] ?? ""}`}
                        >
                          {questionTypeIcons[q.type]}
                          {questionTypeLabels[q.type] ?? q.type}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <PrizeBadge prize={name} />
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <FolderOpen className="h-3.5 w-3.5" />
                  {submissions.length}{" "}
                  {submissions.length === 1 ? "project" : "projects"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {uniqueParticipantCount}{" "}
                  {uniqueParticipantCount === 1
                    ? "participant"
                    : "participants"}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Input
              placeholder="Search by title..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setCurrentPage(1)
              }}
              className="max-w-sm shadow-none"
            />
            <div className="whitespace-nowrap text-sm text-muted-foreground">
              {filteredSubmissions.length}{" "}
              {filteredSubmissions.length === 1 ? "project" : "projects"}
            </div>
          </div>
        </div>

        <TooltipProvider>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px] pl-6">#</TableHead>
                  <TableHead className="w-[35%]">Title</TableHead>
                  <TableHead className="w-[15%]">Team</TableHead>
                  <TableHead className="w-[35%]">Prizes</TableHead>
                  <TableHead className="w-[50px] text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="py-3 pl-6">
                        <Skeleton className="h-4 w-6" />
                      </TableCell>
                      <TableCell className="py-3">
                        <Skeleton className="h-4 w-40" />
                      </TableCell>
                      <TableCell className="py-3">
                        <Skeleton className="h-4 w-16" />
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
                ) : paginatedSubmissions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center">
                      No projects found
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedSubmissions.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="py-3 pl-6 font-mono text-muted-foreground">
                        {s.number}
                      </TableCell>
                      <TableCell className="max-w-0 py-3 font-medium">
                        <span className="block truncate">
                          {s.title || "Untitled"}
                        </span>
                      </TableCell>
                      <TableCell className="py-3 text-muted-foreground">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-default">
                              {s.submission_participants.length}{" "}
                              {s.submission_participants.length === 1
                                ? "member"
                                : "members"}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="space-y-1">
                              {s.submission_participants.map((sp) => (
                                <div key={sp.participant_id}>
                                  <div className="font-medium">
                                    {[
                                      sp.participants.first_name,
                                      sp.participants.last_name
                                    ]
                                      .filter(Boolean)
                                      .join(" ") || "—"}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {sp.participants.email}
                                  </div>
                                </div>
                              ))}
                              {s.submission_participants.length === 0 && (
                                <div className="text-xs text-muted-foreground">
                                  No team members
                                </div>
                              )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
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
        </TooltipProvider>

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {configuredChallenge && (
        <EditChallengeSheet
          open={editSheetOpen}
          onOpenChange={setEditSheetOpen}
          challenge={configuredChallenge}
          onUpdated={() => fetchDataRef.current()}
        />
      )}
    </div>
  )
}
