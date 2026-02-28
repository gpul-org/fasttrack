"use client"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { toSlug } from "@/lib/slug"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

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
  buffer_target: number
}

const DEFAULT_BUFFER_TARGET = 2

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

interface ChallengePoolRow {
  poolKey: string
  challengeTitle: string
  challengeKeyword: string
  rooms: RoomRow[]
  roomStateByRoom: Record<string, RoomQueueStateRow>
  currentByRoom: Record<string, QueueEntryRow | null>
  bufferByRoom: Record<string, QueueEntryRow[]>
  sharedNextOnQueue: QueueEntryRow | null
  waitingCount: number
}

function normalizeKeyword(value: string): string {
  return value.trim().toUpperCase()
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

function getDynamicColumnCount(itemCount: number, maxColumns = 6): number {
  if (itemCount <= 1) return 1

  const screenAspectRatio = 16 / 9
  const ideal = Math.round(Math.sqrt(itemCount * screenAspectRatio))

  return Math.max(1, Math.min(itemCount, maxColumns, ideal))
}

export default function TvGeneralPage() {
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
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [contentScale, setContentScale] = useState(1)

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
            .select("room_id, is_ready, is_paused, buffer_target"),
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
      .channel("tv-general-sync")
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

  const poolRows = useMemo(() => {
    const roomsByPoolKey = new Map<string, RoomRow[]>()

    rooms.forEach((room) => {
      const challenge = room.room_challenges[0]?.challenges
      const challengeKeyword = challenge?.keyword
        ? normalizeKeyword(challenge.keyword)
        : ""
      const poolKey = challengeKeyword || `ROOM:${room.id}`

      const current = roomsByPoolKey.get(poolKey) || []
      current.push(room)
      roomsByPoolKey.set(poolKey, current)
    })

    const rows: ChallengePoolRow[] = []

    Array.from(roomsByPoolKey.entries())
      .sort((a, b) => {
        const roomA = a[1][0]
        const roomB = b[1][0]
        return roomA.name.localeCompare(roomB.name)
      })
      .forEach(([poolKey, poolRooms]) => {
        const challenge = poolRooms[0]?.room_challenges[0]?.challenges
        const challengeTitle = challenge?.title || "No challenge"
        const challengeKeyword = challenge?.keyword
          ? normalizeKeyword(challenge.keyword)
          : ""
        const roomIds = new Set(poolRooms.map((room) => room.id))

        const poolEntries = entries.filter((entry) =>
          roomIds.has(entry.room_id)
        )

        const currentByRoom: Record<string, QueueEntryRow | null> = {}
        const bufferByRoom: Record<string, QueueEntryRow[]> = {}
        const stateByRoom: Record<string, RoomQueueStateRow> = {}

        poolRooms.forEach((room) => {
          const roomEntries = poolEntries.filter(
            (entry) => entry.room_id === room.id
          )
          currentByRoom[room.id] =
            roomEntries.find((entry) => entry.status === "in_progress") || null

          bufferByRoom[room.id] = roomEntries
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

          stateByRoom[room.id] = roomStateByRoom[room.id] || {
            room_id: room.id,
            is_ready: false,
            is_paused: true,
            buffer_target: DEFAULT_BUFFER_TARGET
          }
        })

        const waiting = poolEntries
          .filter((entry) => entry.status === "waiting")
          .sort((a, b) => {
            if (a.priority !== b.priority) return b.priority - a.priority
            return (
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime()
            )
          })

        const waitingUniqueBySubmission = new Map<string, QueueEntryRow>()
        waiting.forEach((entry) => {
          if (!waitingUniqueBySubmission.has(entry.submission_id)) {
            waitingUniqueBySubmission.set(entry.submission_id, entry)
          }
        })
        const sharedWaitingEntries = Array.from(
          waitingUniqueBySubmission.values()
        )

        const activePoolRoomIds = poolRooms
          .filter((room) => {
            const state = stateByRoom[room.id]
            return state.is_ready
          })
          .map((room) => room.id)

        const blockedSubmissionIds = new Set<string>()
        const nowTimestamp = nowMs ?? 0

        poolEntries.forEach((entry) => {
          if (entry.status === "called" || entry.status === "in_progress") {
            blockedSubmissionIds.add(entry.submission_id)
          }
        })

        Object.entries(latestCompletionBySubmission).forEach(
          ([submissionId, completedAt]) => {
            const completedMs = new Date(completedAt).getTime()
            if (Number.isNaN(completedMs)) return
            if (completedMs + handoffBufferMinutes * 60_000 > nowTimestamp) {
              blockedSubmissionIds.add(submissionId)
            }
          }
        )

        const sharedNextAvailableOnQueue =
          activePoolRoomIds.length === 0
            ? null
            : sharedWaitingEntries.find(
                (entry) => !blockedSubmissionIds.has(entry.submission_id)
              ) || null

        rows.push({
          poolKey,
          challengeTitle,
          challengeKeyword,
          rooms: poolRooms.sort((a, b) => a.name.localeCompare(b.name)),
          roomStateByRoom: stateByRoom,
          currentByRoom,
          bufferByRoom,
          sharedNextOnQueue: sharedNextAvailableOnQueue,
          waitingCount: sharedWaitingEntries.length
        })
      })

    return rows
  }, [
    entries,
    handoffBufferMinutes,
    latestCompletionBySubmission,
    nowMs,
    roomStateByRoom,
    rooms
  ])

  const poolColumnCount = useMemo(
    () => getDynamicColumnCount(poolRows.length),
    [poolRows.length]
  )

  const recalculateContentScale = useCallback(() => {
    const viewport = viewportRef.current
    const content = contentRef.current

    if (!viewport || !content) return

    const previousTransform = content.style.transform
    const previousWidth = content.style.width

    content.style.transform = "scale(1)"
    content.style.width = "100%"

    const naturalWidth = content.scrollWidth
    const naturalHeight = content.scrollHeight
    const availableWidth = viewport.clientWidth
    const availableHeight = viewport.clientHeight

    content.style.transform = previousTransform
    content.style.width = previousWidth

    if (
      naturalWidth === 0 ||
      naturalHeight === 0 ||
      availableWidth === 0 ||
      availableHeight === 0
    ) {
      setContentScale(1)
      return
    }

    const nextScale = Math.min(
      1,
      availableWidth / naturalWidth,
      availableHeight / naturalHeight
    )
    setContentScale(Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1)
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current

    if (!viewport || !content) return

    const observer = new ResizeObserver(() => {
      recalculateContentScale()
    })

    observer.observe(viewport)
    observer.observe(content)

    recalculateContentScale()

    return () => {
      observer.disconnect()
    }
  }, [recalculateContentScale])

  useEffect(() => {
    recalculateContentScale()
  }, [poolRows, recalculateContentScale])

  return (
    <main className="h-dvh overflow-hidden bg-muted/40">
      <div ref={viewportRef} className="h-full w-full p-4 md:p-6">
        <div
          ref={contentRef}
          className="origin-top-left"
          style={{
            transform: `scale(${contentScale})`,
            width: contentScale < 1 ? `${100 / contentScale}%` : "100%"
          }}
        >
          <div className="mx-auto w-full space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-3xl font-bold tracking-tight">
                FastTrack · TV General
              </h1>
              <div className="flex items-center gap-2 text-lg text-muted-foreground">
                <span>{nowLabel}</span>
              </div>
            </div>

            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${poolColumnCount}, minmax(0, 1fr))`
              }}
            >
              {poolRows.map(
                ({
                  poolKey,
                  challengeTitle,
                  challengeKeyword,
                  rooms,
                  roomStateByRoom: poolState,
                  currentByRoom,
                  bufferByRoom,
                  sharedNextOnQueue,
                  waitingCount
                }) => {
                  const singleRoom = rooms.length === 1
                  const room = rooms[0]
                  const roomState = poolState[room.id]
                  const current = currentByRoom[room.id]
                  const roomBuffer = bufferByRoom[room.id] || []
                  const roomBufferLimit = Math.max(
                    0,
                    roomState.buffer_target ?? DEFAULT_BUFFER_TARGET
                  )
                  const roomGridColumns = getDynamicColumnCount(rooms.length, 4)

                  return (
                    <Card
                      key={poolKey}
                      className="flex min-h-0 flex-col border bg-background shadow-sm"
                    >
                      <CardHeader className="space-y-2 pb-2">
                        <div className="flex items-center justify-between gap-2">
                          {singleRoom ? (
                            <Link
                              href={`/tv/${toSlug(room.name)}`}
                              className="truncate text-lg font-semibold hover:underline"
                            >
                              {room.name} · {challengeTitle}
                            </Link>
                          ) : (
                            <p className="truncate text-lg font-semibold">
                              {challengeTitle}
                            </p>
                          )}
                          <span className="text-xs font-medium text-muted-foreground">
                            Queue {waitingCount}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {singleRoom ? (
                            <Badge
                              variant={
                                roomState.is_ready ? "default" : "destructive"
                              }
                              className="w-fit"
                            >
                              {roomState.is_ready ? "Ready" : "Not ready"}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="w-fit">
                              {rooms.length} rooms shared
                            </Badge>
                          )}

                          {challengeKeyword && (
                            <Badge variant="outline">{challengeKeyword}</Badge>
                          )}
                        </div>
                      </CardHeader>

                      {singleRoom ? (
                        <CardContent className="flex min-h-0 flex-1 flex-col gap-2 pt-0">
                          <div className="rounded-md border border-emerald-500/60 bg-emerald-100 px-3 py-2 text-sm dark:bg-emerald-900/40">
                            <p className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                              Now
                            </p>
                            <p className="truncate font-semibold text-emerald-900 dark:text-emerald-100">
                              {roomState.is_ready
                                ? current
                                  ? `Team #${current.submissions.number} · ${current.submissions.title || "Untitled"}`
                                  : "—"
                                : "Waiting room"}
                            </p>
                          </div>

                          <div className="rounded-md border border-amber-500/60 bg-amber-100 px-3 py-2 text-sm dark:bg-amber-900/40">
                            <p className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
                              Standby
                            </p>
                            {roomBuffer.length === 0 ? (
                              <div className="rounded-md border border-dashed border-amber-500/50 bg-white/50 px-3 py-2 text-sm text-muted-foreground dark:bg-transparent">
                                No teams in standby
                              </div>
                            ) : (
                              roomBuffer
                                .slice(0, roomBufferLimit)
                                .map((entry) => (
                                  <div
                                    key={entry.id}
                                    className="rounded-md border border-amber-500/50 bg-white/50 px-3 py-2 text-sm font-medium dark:bg-transparent"
                                  >
                                    <p className="truncate text-amber-900 dark:text-amber-100">
                                      Team #{entry.submissions.number} ·{" "}
                                      {entry.submissions.title || "Untitled"}
                                    </p>
                                  </div>
                                ))
                            )}
                          </div>

                          <div className="rounded-md border border-sky-500/60 bg-sky-100 px-3 py-2 text-sm dark:bg-sky-900/40">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                              Next on queue
                            </p>
                            {sharedNextOnQueue ? (
                              <p className="truncate font-semibold text-sky-900 dark:text-sky-100">
                                Team #{sharedNextOnQueue.submissions.number} ·{" "}
                                {sharedNextOnQueue.submissions.title ||
                                  "Untitled"}
                              </p>
                            ) : (
                              <p className="text-muted-foreground">
                                No groups waiting
                              </p>
                            )}
                          </div>
                        </CardContent>
                      ) : (
                        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 pt-0">
                          <div
                            className="grid gap-2"
                            style={{
                              gridTemplateColumns: `repeat(${roomGridColumns}, minmax(0, 1fr))`
                            }}
                          >
                            {rooms.map((poolRoom) => {
                              const state = poolState[poolRoom.id]
                              const roomCurrent = currentByRoom[poolRoom.id]
                              const roomBuffer = bufferByRoom[poolRoom.id] || []
                              const roomBufferLimit = Math.max(
                                0,
                                state.buffer_target ?? DEFAULT_BUFFER_TARGET
                              )

                              return (
                                <div
                                  key={poolRoom.id}
                                  className="rounded-md border bg-background px-3 py-2 text-sm"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                      <Link
                                        href={`/tv/${toSlug(poolRoom.name)}`}
                                        className="truncate text-sm font-semibold hover:underline"
                                      >
                                        {poolRoom.name}
                                      </Link>
                                    </div>
                                    <Badge
                                      variant={
                                        state.is_ready
                                          ? "default"
                                          : "destructive"
                                      }
                                      className="text-[10px]"
                                    >
                                      {state.is_ready ? "Ready" : "Not ready"}
                                    </Badge>
                                  </div>

                                  <div className="mt-2 rounded-md border border-emerald-500/60 bg-emerald-100 px-3 py-2 dark:bg-emerald-900/40">
                                    <p className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                                      Now
                                    </p>
                                    <p className="truncate font-semibold text-emerald-900 dark:text-emerald-100">
                                      {!state.is_ready
                                        ? "Waiting room"
                                        : roomCurrent
                                          ? `#${roomCurrent.submissions.number} · ${roomCurrent.submissions.title || "Untitled"}`
                                          : "—"}
                                    </p>
                                  </div>

                                  <div className="mt-2 rounded-md border border-amber-500/60 bg-amber-100 px-3 py-2 dark:bg-amber-900/40">
                                    <p className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
                                      Standby
                                    </p>
                                    {roomBuffer.length === 0 ? (
                                      <div className="rounded-md border border-dashed border-amber-500/50 bg-white/50 px-2 py-1 text-xs text-muted-foreground dark:bg-transparent">
                                        No teams in standby
                                      </div>
                                    ) : (
                                      <div className="space-y-1">
                                        {roomBuffer
                                          .slice(0, roomBufferLimit)
                                          .map((entry) => (
                                            <div
                                              key={entry.id}
                                              className="rounded-md border border-amber-500/50 bg-white/50 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-transparent dark:text-amber-100"
                                            >
                                              <p className="truncate">
                                                #{entry.submissions.number} ·{" "}
                                                {entry.submissions.title ||
                                                  "Untitled"}
                                              </p>
                                            </div>
                                          ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>

                          <div className="rounded-md border border-sky-500/60 bg-sky-100 px-3 py-2 text-sm dark:bg-sky-900/40">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                              Next on shared queue
                            </p>
                            {sharedNextOnQueue ? (
                              <p className="truncate font-semibold text-sky-900 dark:text-sky-100">
                                Team #{sharedNextOnQueue.submissions.number} ·{" "}
                                {sharedNextOnQueue.submissions.title ||
                                  "Untitled"}
                              </p>
                            ) : (
                              <p className="text-muted-foreground">
                                No groups waiting
                              </p>
                            )}
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  )
                }
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
