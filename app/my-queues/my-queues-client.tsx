"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

interface Submission {
  id: string
  number: number
  title: string | null
  devpost_url: string
  prizes?: string[] | null
}

interface ParticipantSubmissionRow {
  submission_id: string
  submissions: Submission | Submission[] | null
}

interface QueueEntry {
  id: string
  ticket_number: number
  submission_id: string
  room_id: string
  status:
    | "waiting"
    | "called"
    | "in_progress"
    | "completed"
    | "skipped"
    | "cancelled"
  call_attempts: number
  priority: number
  created_at: string
  called_at: string | null
}

interface RoomQueueState {
  room_id: string
  desired_minutes_per_team: number
  is_ready: boolean
}

interface RoomChallengeRow {
  room_id: string
  challenges:
    | {
        keyword: string | null
      }
    | {
        keyword: string | null
      }[]
    | null
}

interface QueueSummary {
  queueEntryId: string
  roomId: string
  roomName: string | null
  activeRoomName: string | null
  assignedRoomName: string | null
  challengeTag: string | null
  pooledRoomNames: string[]
  submission: Submission
  status: QueueEntry["status"]
  queuePosition: number | null
  aheadCount: number
  etaMinutes: number | null
  etaAt: string | null
}

const ACTIVE_STATUSES: QueueEntry["status"][] = [
  "waiting",
  "called",
  "in_progress"
]
const NEAR_TOP_THRESHOLD = 3

const QUEUE_UI_TEXT = {
  nextInLineBadge: "Next in line · be at the door",
  topOfQueueHint: "Top of queue · start moving to the door",
  nearTopHint: "Near top · start moving up",
  almostNextInLine: "Almost next in line",
  inQueue: "In queue"
} as const

function statusRank(status: QueueEntry["status"]): number {
  if (status === "in_progress") return 0
  if (status === "called") return 1
  if (status === "waiting") return 2
  if (status === "completed") return 3
  if (status === "skipped") return 4
  return 5
}

function normalizeTag(value: string | null | undefined): string {
  return (value || "").trim().toUpperCase()
}

function formatDuration(minutes: number): string {
  if (minutes > 0 && minutes < 1) return "< 1 min"
  const safe = Math.max(0, Math.round(minutes))
  const hours = Math.floor(safe / 60)
  const restMinutes = safe % 60
  const DurationFormat = (
    Intl as typeof Intl & {
      DurationFormat?: new (
        locale?: string | string[],
        options?: { style?: "long" | "short" | "narrow" | "digital" }
      ) => {
        format: (duration: string) => string
      }
    }
  ).DurationFormat

  if (DurationFormat) {
    const isoDuration = hours > 0 ? `PT${hours}H${restMinutes}M` : `PT${safe}M`
    return new DurationFormat("en-US", { style: "narrow" }).format(isoDuration)
  }

  if (safe < 60) return `${safe}m`
  return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`
}

function formatEtaClock(minutes: number): string {
  const target = new Date(Date.now() + minutes * 60_000)
  return target.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function getTicketCaption(status: QueueEntry["status"]): string {
  if (status === "in_progress") return "Already in presentation flow"
  if (status === "called") return "At the door"
  if (status === "waiting") return "In queue"
  if (status === "completed") return "Completed"
  if (status === "skipped") return "Skipped"
  return "Cancelled"
}

function uniqueSubmissionIdsOrdered(entries: QueueEntry[]): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []

  entries.forEach((entry) => {
    if (!seen.has(entry.submission_id)) {
      seen.add(entry.submission_id)
      ordered.push(entry.submission_id)
    }
  })

  return ordered
}

function compareWaitingEntries(a: QueueEntry, b: QueueEntry): number {
  const aIsRequeued = (a.call_attempts || 0) > 0
  const bIsRequeued = (b.call_attempts || 0) > 0

  if (aIsRequeued !== bIsRequeued) {
    return aIsRequeued ? 1 : -1
  }

  if (!aIsRequeued && !bIsRequeued && a.priority !== b.priority) {
    return b.priority - a.priority
  }

  if (a.priority !== b.priority) return b.priority - a.priority
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
}

function challengeGroupKeyForRoom(
  roomId: string,
  roomChallengeTagsByRoom: Record<string, string[]>
): string {
  const normalizedTags = (roomChallengeTagsByRoom[roomId] || [])
    .map((tag) => normalizeTag(tag))
    .filter((tag) => tag)

  if (normalizedTags.length === 0) {
    return `room:${roomId}`
  }

  const preferredTag =
    normalizedTags.find((tag) => tag !== "GENERAL") || normalizedTags[0]

  return `tag:${preferredTag}`
}

function compareEntriesForSummary(a: QueueEntry, b: QueueEntry): number {
  const aRank = statusRank(a.status)
  const bRank = statusRank(b.status)

  if (aRank !== bRank) return aRank - bRank

  const aRelevantMs = new Date(a.called_at || a.created_at).getTime()
  const bRelevantMs = new Date(b.called_at || b.created_at).getTime()

  if (aRelevantMs !== bRelevantMs) {
    return bRelevantMs - aRelevantMs
  }

  return b.ticket_number - a.ticket_number
}

async function findParticipantsByEmail(
  supabase: ReturnType<typeof createClient>,
  rawEmail: string
) {
  const normalized = rawEmail.trim().toLowerCase()
  if (!normalized) return []

  const { data: exactMatches } = await supabase
    .from("participants")
    .select("id, email")
    .ilike("email", normalized)

  const exact = (exactMatches || []).filter(
    (row) => (row.email || "").trim().toLowerCase() === normalized
  )

  if (exact.length > 0) return exact

  const { data: fuzzyMatches } = await supabase
    .from("participants")
    .select("id, email")
    .ilike("email", `%${normalized}%`)

  if (!fuzzyMatches || fuzzyMatches.length === 0) return []

  const matches = fuzzyMatches.filter((row) =>
    (row.email || "").trim().toLowerCase().includes(normalized)
  )

  return matches.length > 0 ? matches : [fuzzyMatches[0]]
}

export default function MyQueuesClient() {
  const searchParams = useSearchParams()
  const emailFromQuery = useMemo(
    () => (searchParams.get("email") || "").trim().toLowerCase(),
    [searchParams]
  )

  const supabase = useMemo(() => createClient(), [])

  const [emailInput, setEmailInput] = useState(emailFromQuery)
  const [resolvedEmail, setResolvedEmail] = useState(emailFromQuery)

  const [loading, setLoading] = useState(false)
  const [participantFound, setParticipantFound] = useState(true)
  const latestFetchIdRef = useRef(0)

  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [ownEntries, setOwnEntries] = useState<QueueEntry[]>([])
  const [roomEntries, setRoomEntries] = useState<QueueEntry[]>([])
  const [roomQueueStateByRoom, setRoomQueueStateByRoom] = useState<
    Record<string, RoomQueueState>
  >({})
  const [roomNameByRoom, setRoomNameByRoom] = useState<Record<string, string>>(
    {}
  )
  const [roomChallengeTagsByRoom, setRoomChallengeTagsByRoom] = useState<
    Record<string, string[]>
  >({})
  const [roomChallengeTagByRoom, setRoomChallengeTagByRoom] = useState<
    Record<string, string>
  >({})
  const [globalScheduleEndAt, setGlobalScheduleEndAt] = useState<string | null>(
    null
  )
  const [nowMs, setNowMs] = useState(0)

  useEffect(() => {
    setEmailInput(emailFromQuery)
    setResolvedEmail(emailFromQuery)
  }, [emailFromQuery])

  const fetchData = useCallback(
    async (showLoading = true) => {
      const fetchId = ++latestFetchIdRef.current

      if (!resolvedEmail) {
        if (fetchId !== latestFetchIdRef.current) return
        setSubmissions([])
        setOwnEntries([])
        setRoomEntries([])
        setParticipantFound(true)
        setRoomQueueStateByRoom({})
        setRoomNameByRoom({})
        setRoomChallengeTagsByRoom({})
        setRoomChallengeTagByRoom({})
        setGlobalScheduleEndAt(null)
        return
      }

      if (showLoading) {
        setLoading(true)
      }

      try {
        const participants = await findParticipantsByEmail(
          supabase,
          resolvedEmail
        )

        if (fetchId !== latestFetchIdRef.current) return

        if (!participants || participants.length === 0) {
          setParticipantFound(false)
          setSubmissions([])
          setOwnEntries([])
          setRoomEntries([])
          setRoomQueueStateByRoom({})
          setRoomNameByRoom({})
          setRoomChallengeTagsByRoom({})
          setRoomChallengeTagByRoom({})
          setGlobalScheduleEndAt(null)
          return
        }

        setParticipantFound(true)

        const participantIds = Array.from(
          new Set(participants.map((participant) => participant.id))
        )

        const { data: links } = await supabase
          .from("submission_participants")
          .select(
            "submission_id, submissions(id, number, title, devpost_url, prizes)"
          )
          .in("participant_id", participantIds)

        if (fetchId !== latestFetchIdRef.current) return

        const normalizedSubmissions = (
          (links as ParticipantSubmissionRow[]) || []
        )
          .map((row) => {
            if (!row.submissions) return null
            return Array.isArray(row.submissions)
              ? row.submissions[0]
              : row.submissions
          })
          .filter((value): value is Submission => value !== null)

        setSubmissions(normalizedSubmissions)

        const submissionIds = normalizedSubmissions.map((item) => item.id)
        if (submissionIds.length === 0) {
          setOwnEntries([])
          setRoomEntries([])
          setRoomQueueStateByRoom({})
          setRoomNameByRoom({})
          setRoomChallengeTagsByRoom({})
          setRoomChallengeTagByRoom({})
          setGlobalScheduleEndAt(null)
          return
        }

        const { data: own } = await supabase
          .from("queue_entries")
          .select(
            "id, ticket_number, submission_id, room_id, status, call_attempts, priority, created_at, called_at"
          )
          .in("submission_id", submissionIds)

        if (fetchId !== latestFetchIdRef.current) return

        const normalizedOwn = (own as QueueEntry[] | null) || []
        setOwnEntries(normalizedOwn)

        const ownRoomIds = Array.from(
          new Set(normalizedOwn.map((entry) => entry.room_id))
        )
        if (ownRoomIds.length === 0) {
          setRoomEntries([])
          setRoomQueueStateByRoom({})
          setRoomNameByRoom({})
          setRoomChallengeTagsByRoom({})
          setRoomChallengeTagByRoom({})
          setGlobalScheduleEndAt(null)
          return
        }

        const { data: allRoomChallenges } = await supabase
          .from("room_challenges")
          .select("room_id, challenges(keyword)")

        if (fetchId !== latestFetchIdRef.current) return

        const challengeTagsByRoom: Record<string, string[]> = {}
        ;((allRoomChallenges as RoomChallengeRow[] | null) || []).forEach(
          (row) => {
            if (!row.challenges) return

            if (!challengeTagsByRoom[row.room_id]) {
              challengeTagsByRoom[row.room_id] = []
            }

            const challenges = Array.isArray(row.challenges)
              ? row.challenges
              : [row.challenges]
            challenges.forEach((challenge) => {
              const keyword = (challenge?.keyword || "").trim()
              if (!keyword) return

              if (!challengeTagsByRoom[row.room_id].includes(keyword)) {
                challengeTagsByRoom[row.room_id].push(keyword)
              }
            })
          }
        )

        const roomsByChallengeTag = new Map<string, Set<string>>()
        Object.entries(challengeTagsByRoom).forEach(([roomId, tags]) => {
          tags.forEach((tag) => {
            const normalizedTag = normalizeTag(tag)
            if (!normalizedTag) return

            if (!roomsByChallengeTag.has(normalizedTag)) {
              roomsByChallengeTag.set(normalizedTag, new Set())
            }
            roomsByChallengeTag.get(normalizedTag)!.add(roomId)
          })
        })

        const pooledRoomIdsSet = new Set<string>(ownRoomIds)

        normalizedOwn.forEach((entry) => {
          const roomTags = (challengeTagsByRoom[entry.room_id] || [])
            .map((tag) => normalizeTag(tag))
            .filter((tag) => tag)

          roomTags.forEach((tag) => {
            Array.from(roomsByChallengeTag.get(tag) || []).forEach((roomId) => {
              pooledRoomIdsSet.add(roomId)
            })
          })
        })

        const pooledRoomIds = Array.from(pooledRoomIdsSet)

        const [
          { data: pooledQueue },
          { data: pooledRoomStates },
          { data: pooledRooms },
          { data: queueSettings }
        ] = await Promise.all([
          supabase
            .from("queue_entries")
            .select(
              "id, ticket_number, submission_id, room_id, status, call_attempts, priority, created_at, called_at"
            )
            .in("room_id", pooledRoomIds)
            .in("status", ["waiting", "called", "in_progress", "completed"]),
          supabase
            .from("room_queue_state")
            .select("room_id, desired_minutes_per_team, is_ready")
            .in("room_id", pooledRoomIds),
          supabase.from("rooms").select("id, name").in("id", pooledRoomIds),
          supabase
            .from("queue_settings")
            .select("schedule_end_at")
            .eq("id", true)
            .maybeSingle()
        ])

        if (fetchId !== latestFetchIdRef.current) return

        setRoomEntries((pooledQueue as QueueEntry[] | null) || [])

        const stateMap: Record<string, RoomQueueState> = {}
        ;((pooledRoomStates as RoomQueueState[] | null) || []).forEach(
          (row) => {
            stateMap[row.room_id] = row
          }
        )
        setRoomQueueStateByRoom(stateMap)

        const roomNameMap: Record<string, string> = {}
        ;(
          (pooledRooms as { id: string; name: string | null }[] | null) || []
        ).forEach((room) => {
          roomNameMap[room.id] = room.name || "Room"
        })
        setRoomNameByRoom(roomNameMap)

        setRoomChallengeTagsByRoom(challengeTagsByRoom)

        const preferredTagByRoom: Record<string, string> = {}
        Object.entries(challengeTagsByRoom).forEach(([roomId, tags]) => {
          const preferred =
            tags.find((tag) => normalizeTag(tag) !== "GENERAL") || tags[0]
          if (preferred) {
            preferredTagByRoom[roomId] = preferred
          }
        })
        setRoomChallengeTagByRoom(preferredTagByRoom)
        setGlobalScheduleEndAt(queueSettings?.schedule_end_at ?? null)
      } finally {
        if (fetchId !== latestFetchIdRef.current) return
        setLoading(false)
      }
    },
    [resolvedEmail, supabase]
  )

  useEffect(() => {
    void fetchData(true)
  }, [fetchData])

  useEffect(() => {
    setNowMs(Date.now())
  }, [])

  useEffect(() => {
    if (!resolvedEmail) return

    const intervalId = setInterval(() => {
      setNowMs(Date.now())
      void fetchData(false)
    }, 4000)

    return () => clearInterval(intervalId)
  }, [fetchData, resolvedEmail])

  const summaries = useMemo(() => {
    const submissionById = new Map<string, Submission>()
    submissions.forEach((submission) => {
      submissionById.set(submission.id, submission)
    })

    const roomsByChallengeTag = new Map<string, Set<string>>()
    Object.entries(roomChallengeTagsByRoom).forEach(([roomId, tags]) => {
      tags.forEach((tag) => {
        const normalized = normalizeTag(tag)
        if (!normalized) return

        if (!roomsByChallengeTag.has(normalized)) {
          roomsByChallengeTag.set(normalized, new Set())
        }
        roomsByChallengeTag.get(normalized)!.add(roomId)
      })
    })

    const dedupedOwnEntries = Array.from(
      ownEntries
        .reduce((accumulator, entry) => {
          const key = `${entry.submission_id}::${challengeGroupKeyForRoom(entry.room_id, roomChallengeTagsByRoom)}`
          const existing = accumulator.get(key)

          if (!existing || compareEntriesForSummary(entry, existing) < 0) {
            accumulator.set(key, entry)
          }

          return accumulator
        }, new Map<string, QueueEntry>())
        .values()
    )

    return dedupedOwnEntries
      .map((ownEntry) => {
        const submission = submissionById.get(ownEntry.submission_id)
        if (!submission) return null

        const ownRoomChallengeTags = (
          roomChallengeTagsByRoom[ownEntry.room_id] || []
        )
          .map(normalizeTag)
          .filter((tag) => tag)

        const pooledRoomIdsSet = new Set<string>([ownEntry.room_id])
        ownRoomChallengeTags.forEach((tag) => {
          Array.from(roomsByChallengeTag.get(tag) || []).forEach((roomId) => {
            pooledRoomIdsSet.add(roomId)
          })
        })

        const activeQueueEntries = roomEntries
          .filter(
            (entry) =>
              pooledRoomIdsSet.has(entry.room_id) &&
              ACTIVE_STATUSES.includes(entry.status)
          )
          .sort((a, b) => {
            const rankDiff = statusRank(a.status) - statusRank(b.status)
            if (rankDiff !== 0) return rankDiff
            if (a.priority !== b.priority) return b.priority - a.priority
            return (
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime()
            )
          })

        const waitingQueueEntries = activeQueueEntries
          .filter((entry) => entry.status === "waiting")
          .sort(compareWaitingEntries)

        const activeSubmissionEntries = activeQueueEntries.filter(
          (entry) => entry.submission_id === ownEntry.submission_id
        )
        const activeCurrentEntry = activeSubmissionEntries.sort((a, b) => {
          const rankDiff = statusRank(a.status) - statusRank(b.status)
          if (rankDiff !== 0) return rankDiff
          return (
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
        })[0]
        const activeRoomId = activeCurrentEntry?.room_id || ownEntry.room_id

        const assignedEntry = roomEntries
          .filter(
            (entry) =>
              entry.submission_id === ownEntry.submission_id &&
              (entry.status === "called" || entry.status === "in_progress")
          )
          .sort((a, b) => {
            const aMs = new Date(a.called_at || a.created_at).getTime()
            const bMs = new Date(b.called_at || b.created_at).getTime()
            return bMs - aMs
          })[0]
        const assignedRoomId = assignedEntry?.room_id || null
        const orderedWaitingSubmissionIds =
          uniqueSubmissionIdsOrdered(waitingQueueEntries)

        const myWaitingIndex = orderedWaitingSubmissionIds.findIndex(
          (submissionId) => submissionId === ownEntry.submission_id
        )
        const queuePosition =
          ownEntry.status === "waiting" && myWaitingIndex >= 0
            ? myWaitingIndex + 1
            : null

        const aheadCount =
          queuePosition !== null ? Math.max(0, queuePosition - 1) : 0

        const pooledRoomIds = Array.from(pooledRoomIdsSet)
        const desiredMinutesValues = pooledRoomIds
          .map(
            (roomId) => roomQueueStateByRoom[roomId]?.desired_minutes_per_team
          )
          .filter(
            (value): value is number => typeof value === "number" && value > 0
          )

        const avgMinutesPerTeam =
          desiredMinutesValues.length > 0
            ? Math.round(
                desiredMinutesValues.reduce((acc, value) => acc + value, 0) /
                  desiredMinutesValues.length
              )
            : 8

        const readyRooms = pooledRoomIds.filter(
          (roomId) => roomQueueStateByRoom[roomId]?.is_ready
        ).length
        const parallelCapacity = Math.max(1, readyRooms)

        const activeSubmissionCount = orderedWaitingSubmissionIds.length
        const scheduleRemainingMinutes =
          globalScheduleEndAt && nowMs > 0
            ? Math.max(
                0,
                (new Date(globalScheduleEndAt).getTime() - nowMs) / 60000
              )
            : null
        const dynamicMaxMinutesPerTeam =
          scheduleRemainingMinutes !== null && activeSubmissionCount > 0
            ? (scheduleRemainingMinutes * parallelCapacity) /
              activeSubmissionCount
            : null
        const effectiveMinutesPerTeam =
          dynamicMaxMinutesPerTeam && dynamicMaxMinutesPerTeam > 0
            ? Math.min(avgMinutesPerTeam, dynamicMaxMinutesPerTeam)
            : avgMinutesPerTeam

        let etaMinutes: number | null = null
        if (ownEntry.status === "called" || ownEntry.status === "in_progress") {
          etaMinutes = 0
        } else if (ownEntry.status === "waiting") {
          etaMinutes = Math.max(
            0,
            (aheadCount * effectiveMinutesPerTeam) / parallelCapacity
          )
        }

        return {
          queueEntryId: ownEntry.id,
          roomId: ownEntry.room_id,
          roomName: roomNameByRoom[ownEntry.room_id] || null,
          activeRoomName: roomNameByRoom[activeRoomId] || null,
          assignedRoomName: assignedRoomId
            ? roomNameByRoom[assignedRoomId] || null
            : null,
          challengeTag: roomChallengeTagByRoom[ownEntry.room_id] || null,
          pooledRoomNames: pooledRoomIds
            .map((roomId) => roomNameByRoom[roomId] || roomId)
            .sort((a, b) => a.localeCompare(b)),
          submission,
          status: ownEntry.status,
          queuePosition,
          aheadCount,
          etaMinutes,
          etaAt: etaMinutes !== null ? formatEtaClock(etaMinutes) : null
        }
      })
      .filter((value): value is QueueSummary => value !== null)
      .sort((a, b) => {
        if (a.submission.number !== b.submission.number) {
          return a.submission.number - b.submission.number
        }
        const rankDiff = statusRank(a.status) - statusRank(b.status)
        if (rankDiff !== 0) return rankDiff
        return (a.roomName || "").localeCompare(b.roomName || "")
      })
  }, [
    ownEntries,
    roomChallengeTagByRoom,
    roomChallengeTagsByRoom,
    roomEntries,
    globalScheduleEndAt,
    nowMs,
    roomNameByRoom,
    roomQueueStateByRoom,
    submissions
  ])

  const groupedSummaries = useMemo(() => {
    const grouped = new Map<
      string,
      { submission: Submission; queues: QueueSummary[] }
    >()

    summaries.forEach((summary) => {
      const key = summary.submission.id
      if (!grouped.has(key)) {
        grouped.set(key, {
          submission: summary.submission,
          queues: []
        })
      }
      grouped.get(key)!.queues.push(summary)
    })

    return Array.from(grouped.values()).sort(
      (a, b) => a.submission.number - b.submission.number
    )
  }, [summaries])

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault()
    setResolvedEmail(emailInput.trim().toLowerCase())
  }

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Queue status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSearch}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <Input
              type="email"
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              placeholder="Enter your email"
              required
            />
            <Button type="submit">Check</Button>
          </form>
        </CardContent>
      </Card>

      {!resolvedEmail ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Enter your email to check queue and next in line status.
          </CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Loading queue status...
          </CardContent>
        </Card>
      ) : !participantFound ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No participant found with that email.
          </CardContent>
        </Card>
      ) : groupedSummaries.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            There are no active or historical queues for this participant.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {groupedSummaries.map((group) => (
            <Card key={group.submission.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  Team #{group.submission.number} ·{" "}
                  {group.submission.title || "Untitled"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {group.queues.map((summary) => {
                  const possibleRooms =
                    summary.pooledRoomNames.length > 0
                      ? summary.pooledRoomNames
                      : [summary.roomName || summary.roomId]
                  const isMultiRoom = possibleRooms.length > 1
                  const isNextInLine = summary.status === "called"
                  const isNearTopInQueue =
                    summary.status === "waiting" &&
                    summary.queuePosition !== null &&
                    summary.queuePosition <= NEAR_TOP_THRESHOLD
                  const ticketClass = isNextInLine
                    ? "relative overflow-hidden rounded-md border-2 border-destructive/70 bg-destructive/5 p-4 text-center animate-pulse"
                    : isNearTopInQueue
                      ? "relative overflow-hidden rounded-md border-2 border-muted-foreground/60 bg-muted/30 p-4 text-center"
                      : "relative overflow-hidden rounded-md border bg-muted/20 p-4 text-center"
                  const notchBackgroundClass = isNextInLine
                    ? "bg-destructive/5"
                    : "bg-muted/20"
                  const nextInLineHeadline = summary.assignedRoomName
                    ? `NEXT IN LINE · GO TO ${summary.assignedRoomName.toUpperCase()}`
                    : "NEXT IN LINE · GO TO THE ROOM"

                  return (
                    <div
                      key={summary.queueEntryId}
                      className="flex flex-col gap-3 rounded-md border p-3 md:flex-row md:items-start md:justify-between"
                    >
                      <div className="min-w-0 md:w-1/2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <p className="font-medium text-foreground">
                              {isNextInLine
                                ? "Assigned room"
                                : isMultiRoom
                                  ? "Challenge pool"
                                  : summary.roomName || "Room"}
                            </p>
                            {summary.challengeTag ? (
                              <Badge>{summary.challengeTag}</Badge>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-3">
                          <p className="text-xs text-muted-foreground">
                            {isNextInLine
                              ? "Room assigned"
                              : isMultiRoom
                                ? "Possible rooms"
                                : "Room"}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {isNextInLine ? (
                              <Badge
                                key={summary.assignedRoomName ?? "room"}
                                variant="destructive"
                                className="font-semibold"
                              >
                                {summary.assignedRoomName ??
                                  summary.roomName ??
                                  "—"}
                              </Badge>
                            ) : (
                              possibleRooms.map((room) => (
                                <Badge
                                  key={room}
                                  variant="secondary"
                                  className="font-normal"
                                >
                                  {room}
                                </Badge>
                              ))
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="w-full md:w-2/3 md:min-w-0">
                        <div>
                          <div className={ticketClass}>
                            <span
                              className={`pointer-events-none absolute -left-4 top-1/2 z-10 h-8 w-8 -translate-y-1/2 rounded-full ${notchBackgroundClass} ring-1 ring-border`}
                            />
                            <span
                              className={`pointer-events-none absolute -right-4 top-1/2 z-10 h-8 w-8 -translate-y-1/2 rounded-full ${notchBackgroundClass} ring-1 ring-border`}
                            />
                            <span className="absolute left-3 right-3 top-8 border-t border-dashed border-border/70" />

                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              Queue ticket
                            </p>
                            {isNearTopInQueue ? (
                              <Badge className="mt-2" variant="secondary">
                                You are almost there – go to Floor 3!
                              </Badge>
                            ) : null}
                            {isNextInLine ? (
                              <>
                                <p className="mt-3 text-xl font-bold leading-tight text-destructive">
                                  {nextInLineHeadline}
                                </p>
                                <p className="mt-2 text-xs text-muted-foreground">
                                  Wait at the door until you are called in.
                                </p>
                              </>
                            ) : (
                              <p className="mt-3 text-3xl font-bold leading-none text-foreground">
                                {summary.queuePosition ?? "—"}
                              </p>
                            )}
                            {!isNextInLine ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {summary.status === "waiting" &&
                                summary.queuePosition !== null
                                  ? summary.queuePosition <= NEAR_TOP_THRESHOLD
                                    ? QUEUE_UI_TEXT.almostNextInLine
                                    : QUEUE_UI_TEXT.inQueue
                                  : getTicketCaption(summary.status)}
                              </p>
                            ) : null}

                            {summary.etaMinutes !== null ? (
                              <div className="mt-3">
                                <p className="text-xs text-muted-foreground">
                                  You’ll present in about:
                                </p>
                                <p className="mt-1 text-xl font-semibold leading-none text-foreground">
                                  {formatDuration(summary.etaMinutes)}
                                </p>
                                {summary.etaAt ? (
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    ~{summary.etaAt}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  )
}
