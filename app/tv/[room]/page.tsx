"use client"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toSlug } from "@/lib/slug"
import { createClient } from "@/lib/supabase/client"
import { useTheme } from "next-themes"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react"

interface RoomRow {
  id: string
  name: string
  room_challenges: {
    challenges: {
      title: string
      keyword: string
    }
  }[]
}

interface RoomQueueStateRow {
  room_id: string
  is_ready: boolean
  is_paused: boolean
}

interface QueueEntryRow {
  id: string
  room_id: string
  submission_id: string
  status:
    | "waiting"
    | "called"
    | "in_progress"
    | "completed"
    | "skipped"
    | "cancelled"
  priority: number
  created_at: string
  called_at: string | null
  submissions: {
    number: number
    title: string | null
  }
}

interface QueueCompletionRow {
  submission_id: string
  completed_at: string | null
}

function normalizeRooms(
  rawRooms: Array<{
    id: string
    name: string
    room_challenges: Array<{
      challenges:
        | {
            title: string
            keyword: string
          }
        | {
            title: string
            keyword: string
          }[]
        | null
    }> | null
  }>
): RoomRow[] {
  return rawRooms.map((room) => ({
    id: room.id,
    name: room.name,
    room_challenges: (room.room_challenges || [])
      .map((item) => {
        const challenge = Array.isArray(item.challenges)
          ? item.challenges[0]
          : item.challenges
        if (!challenge) return null
        return { challenges: challenge }
      })
      .filter(
        (
          value
        ): value is {
          challenges: {
            title: string
            keyword: string
          }
        } => value !== null
      )
  }))
}

function normalizeQueueEntries(
  rawEntries: Array<{
    id: string
    room_id: string
    submission_id: string
    status:
      | "waiting"
      | "called"
      | "in_progress"
      | "completed"
      | "skipped"
      | "cancelled"
    priority: number
    created_at: string
    called_at: string | null
    submissions:
      | {
          number: number
          title: string | null
        }
      | {
          number: number
          title: string | null
        }[]
      | null
  }>
): QueueEntryRow[] {
  return rawEntries
    .map((entry) => {
      const submission = Array.isArray(entry.submissions)
        ? entry.submissions[0]
        : entry.submissions

      if (!submission) return null

      return {
        id: entry.id,
        room_id: entry.room_id,
        submission_id: entry.submission_id,
        status: entry.status,
        priority: entry.priority,
        created_at: entry.created_at,
        called_at: entry.called_at,
        submissions: submission
      }
    })
    .filter((value): value is QueueEntryRow => value !== null)
}

function normalizeRoomSegment(value: string): string {
  return toSlug(value).replace(/-/g, "")
}

function getRoomPoolKey(room: RoomRow): string {
  const normalizedKeywords = (room.room_challenges || [])
    .map((item) => item?.challenges?.keyword?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value))
    .sort()

  if (normalizedKeywords.length === 0) {
    return `room:${room.id}`
  }

  return `challenge:${normalizedKeywords.join("|")}`
}

function TvRoomPageContent() {
  const { resolvedTheme, setTheme } = useTheme()
  const params = useParams<{ room?: string | string[] }>()
  const roomSegmentRaw = params?.room
  const roomSegment =
    typeof roomSegmentRaw === "string"
      ? roomSegmentRaw
      : Array.isArray(roomSegmentRaw)
        ? roomSegmentRaw[0] || ""
        : ""
  const supabase = useMemo(() => createClient(), [])
  const [rooms, setRooms] = useState<RoomRow[]>([])
  const [entries, setEntries] = useState<QueueEntryRow[]>([])
  const [roomStateByRoom, setRoomStateByRoom] = useState<
    Record<string, RoomQueueStateRow>
  >({})
  const [handoffBufferMinutes, setHandoffBufferMinutes] = useState(5)
  const [latestCompletionBySubmission, setLatestCompletionBySubmission] =
    useState<Record<string, string>>({})
  const latestFetchIdRef = useRef(0)
  const [nowMs, setNowMs] = useState<number | null>(null)

  useEffect(() => {
    if (resolvedTheme === "dark") {
      setTheme("light")
    }
  }, [resolvedTheme, setTheme])

  const fetchData = useCallback(async () => {
    const fetchId = ++latestFetchIdRef.current

    try {
      const [roomsResult, entriesResult, roomStateResult, queueSettingsResult] =
        await Promise.all([
          supabase
            .from("rooms")
            .select("id, name, room_challenges(challenges(title, keyword))")
            .order("name"),
          supabase
            .from("queue_entries")
            .select(
              "id, room_id, submission_id, status, priority, created_at, called_at, submissions(number, title)"
            )
            .in("status", ["waiting", "called", "in_progress"]),
          supabase
            .from("room_queue_state")
            .select("room_id, is_ready, is_paused"),
          supabase
            .from("queue_settings")
            .select("handoff_buffer_minutes")
            .eq("id", true)
            .single()
        ])

      const rawRooms =
        (roomsResult.data as unknown as Array<{
          id: string
          name: string
          room_challenges: Array<{
            challenges:
              | {
                  title: string
                  keyword: string
                }
              | {
                  title: string
                  keyword: string
                }[]
              | null
          }> | null
        }>) || []

      const rawEntries =
        (entriesResult.data as unknown as Array<{
          id: string
          room_id: string
          submission_id: string
          status:
            | "waiting"
            | "called"
            | "in_progress"
            | "completed"
            | "skipped"
            | "cancelled"
          priority: number
          created_at: string
          called_at: string | null
          submissions:
            | {
                number: number
                title: string | null
              }
            | {
                number: number
                title: string | null
              }[]
            | null
        }>) || []

      const waitingSubmissionIds = Array.from(
        new Set(
          rawEntries
            .filter((entry) => entry.status === "waiting")
            .map((entry) => entry.submission_id)
        )
      )

      const completionBySubmission: Record<string, string> = {}

      if (waitingSubmissionIds.length > 0) {
        const completionResult = await supabase
          .from("queue_entries")
          .select("submission_id, completed_at")
          .in("submission_id", waitingSubmissionIds)
          .in("status", ["completed", "skipped", "cancelled"])
          .not("completed_at", "is", null)
          .order("completed_at", { ascending: false })

        const completionRows =
          (completionResult.data as QueueCompletionRow[] | null) || []
        completionRows.forEach((row) => {
          if (!row.completed_at) return
          if (completionBySubmission[row.submission_id]) return
          completionBySubmission[row.submission_id] = row.completed_at
        })
      }

      if (fetchId !== latestFetchIdRef.current) return

      setRooms(normalizeRooms(rawRooms))
      setEntries(normalizeQueueEntries(rawEntries))
      setLatestCompletionBySubmission(completionBySubmission)

      const stateRows =
        (roomStateResult.data as RoomQueueStateRow[] | null) || []
      const stateMap: Record<string, RoomQueueStateRow> = {}
      stateRows.forEach((row) => {
        stateMap[row.room_id] = row
      })
      setRoomStateByRoom(stateMap)

      if (queueSettingsResult.data?.handoff_buffer_minutes != null) {
        setHandoffBufferMinutes(queueSettingsResult.data.handoff_buffer_minutes)
      }
    } finally {
      if (fetchId !== latestFetchIdRef.current) return
    }
  }, [supabase])

  useEffect(() => {
    const timeout = setTimeout(() => {
      void fetchData()
    }, 0)
    const interval = setInterval(() => {
      void fetchData()
    }, 5000)
    return () => {
      clearTimeout(timeout)
      clearInterval(interval)
    }
  }, [fetchData])

  useEffect(() => {
    const channel = supabase
      .channel("tv-room-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "queue_entries" },
        () => {
          void fetchData()
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_queue_state" },
        () => {
          void fetchData()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [fetchData, supabase])

  useEffect(() => {
    const timeout = setTimeout(() => setNowMs(Date.now()), 0)
    const interval = setInterval(() => setNowMs(Date.now()), 1000)
    return () => {
      clearTimeout(timeout)
      clearInterval(interval)
    }
  }, [])

  const nowLabel = nowMs
    ? new Date(nowMs).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      })
    : "--:--"

  const room = useMemo(
    () =>
      rooms.find((item) => {
        const slug = toSlug(item.name)
        return (
          slug === roomSegment ||
          normalizeRoomSegment(slug) === normalizeRoomSegment(roomSegment)
        )
      }),
    [roomSegment, rooms]
  )

  const roomEntries = useMemo(
    () => entries.filter((entry) => room && entry.room_id === room.id),
    [entries, room]
  )

  const sharedPoolRooms = useMemo(() => {
    if (!room) return [] as RoomRow[]
    const selectedPoolKey = getRoomPoolKey(room)
    return rooms.filter(
      (candidate) => getRoomPoolKey(candidate) === selectedPoolKey
    )
  }, [room, rooms])

  const sharedPoolRoomIds = useMemo(
    () => new Set(sharedPoolRooms.map((candidate) => candidate.id)),
    [sharedPoolRooms]
  )

  const sharedPoolEntries = useMemo(
    () => entries.filter((entry) => sharedPoolRoomIds.has(entry.room_id)),
    [entries, sharedPoolRoomIds]
  )

  const roomState = room
    ? roomStateByRoom[room.id] || {
        room_id: room.id,
        is_ready: false,
        is_paused: true
      }
    : null

  const current =
    roomEntries.find((entry) => entry.status === "in_progress") || null

  const buffer = roomEntries
    .filter((entry) => entry.status === "called")
    .sort((a, b) => {
      const calledA = a.called_at
        ? new Date(a.called_at).getTime()
        : new Date(a.created_at).getTime()
      const calledB = b.called_at
        ? new Date(b.called_at).getTime()
        : new Date(b.created_at).getTime()
      return calledA - calledB
    })

  const waiting = useMemo(
    () =>
      Array.from(
        sharedPoolEntries
          .filter((entry) => entry.status === "waiting")
          .sort((a, b) => {
            if (a.priority !== b.priority) return b.priority - a.priority
            return (
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime()
            )
          })
          .reduce((map, entry) => {
            if (!map.has(entry.submission_id)) {
              map.set(entry.submission_id, entry)
            }
            return map
          }, new Map<string, QueueEntryRow>())
          .values()
      ),
    [sharedPoolEntries]
  )

  const blockedSubmissionIds = useMemo(() => {
    if (!room) return new Set<string>()

    const blocked = new Set<string>()
    const nowTimestamp = nowMs ?? 0

    entries.forEach((entry) => {
      if (entry.room_id === room.id) return
      if (entry.status === "called" || entry.status === "in_progress") {
        blocked.add(entry.submission_id)
      }
    })

    Object.entries(latestCompletionBySubmission).forEach(
      ([submissionId, completedAt]) => {
        const completedMs = new Date(completedAt).getTime()
        if (Number.isNaN(completedMs)) return
        if (completedMs + handoffBufferMinutes * 60_000 > nowTimestamp) {
          blocked.add(submissionId)
        }
      }
    )

    return blocked
  }, [entries, handoffBufferMinutes, latestCompletionBySubmission, nowMs, room])

  const nextWaitingAvailable = useMemo(
    () =>
      waiting.find((entry) => !blockedSubmissionIds.has(entry.submission_id)) ||
      null,
    [blockedSubmissionIds, waiting]
  )

  const nextEntries = [
    ...buffer.slice(0, 3),
    ...(nextWaitingAvailable ? [nextWaitingAvailable] : [])
  ]

  if (!room) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="space-y-3 text-center">
          <p className="text-3xl font-bold">Room not found</p>
          <Link
            href="/tv"
            className="text-lg text-muted-foreground hover:underline"
          >
            Back to general TV view
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background p-8 md:p-12">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-6xl font-extrabold tracking-tight">
              {room.name}
            </h1>
            {roomState && (
              <Badge
                variant={roomState.is_ready ? "default" : "destructive"}
                className="px-3 py-1 text-base"
              >
                {roomState.is_ready ? "Room ready" : "Room not ready"}
              </Badge>
            )}
            {room.room_challenges[0]?.challenges && (
              <Badge variant="secondary" className="px-4 py-1.5 text-lg">
                {room.room_challenges[0].challenges.title}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-4xl font-semibold text-muted-foreground">
            <span>{nowLabel}</span>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-4xl">Now presenting</CardTitle>
          </CardHeader>
          <CardContent>
            {!roomState?.is_ready ? (
              <p className="text-3xl text-muted-foreground">
                Room is not ready yet.
              </p>
            ) : current ? (
              <div className="space-y-3">
                <div className="text-7xl font-extrabold">
                  Team #{current.submissions.number}
                </div>
                <div className="text-4xl text-muted-foreground">
                  {current.submissions.title || "Untitled"}
                </div>
              </div>
            ) : (
              <p className="text-3xl text-muted-foreground">
                Waiting for next group...
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-4xl">Next in queue</CardTitle>
          </CardHeader>
          <CardContent>
            {nextEntries.length === 0 ? (
              <p className="text-2xl text-muted-foreground">
                No groups in queue.
              </p>
            ) : (
              <div className="space-y-3">
                {nextEntries.map((entry, index) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between rounded-md border p-5"
                  >
                    <span className="text-3xl font-bold">
                      {index + 1}. Team #{entry.submissions.number}
                    </span>
                    <span className="text-2xl text-muted-foreground">
                      {entry.status === "called" ? "Standby" : "Queue"} ·{" "}
                      {entry.submissions.title || "Untitled"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="text-lg text-muted-foreground">
          <Link href="/tv" className="hover:underline">
            ← General view
          </Link>
        </div>
      </div>
    </main>
  )
}

function TvRoomPageFallback() {
  return (
    <main className="mx-auto max-w-7xl space-y-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Loading room queue…</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Preparing TV view.
        </CardContent>
      </Card>
    </main>
  )
}

export default function TvRoomPage() {
  return (
    <Suspense fallback={<TvRoomPageFallback />}>
      <TvRoomPageContent />
    </Suspense>
  )
}
