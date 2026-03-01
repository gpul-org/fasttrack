"use client"

import { toSlug } from "@/lib/slug"
import { createClient } from "@/lib/supabase/client"
import { useTheme } from "next-themes"
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
const TV_GRID_COLUMNS = 6
const TV_GRID_ROWS = 2
const TV_GRID_CAPACITY = TV_GRID_COLUMNS * TV_GRID_ROWS

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
  sharedQueuePreview: QueueEntryRow[]
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

export default function TvGeneralPage() {
  const supabase = useMemo(() => createClient(), [])
  const { resolvedTheme, setTheme } = useTheme()
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

        const availableWaitingEntries =
          activePoolRoomIds.length === 0
            ? []
            : sharedWaitingEntries.filter(
                (entry) => !blockedSubmissionIds.has(entry.submission_id)
              )

        const sharedQueuePreview = availableWaitingEntries.slice(0, 4)

        rows.push({
          poolKey,
          challengeTitle,
          challengeKeyword,
          rooms: poolRooms.sort((a, b) => a.name.localeCompare(b.name)),
          roomStateByRoom: stateByRoom,
          currentByRoom,
          bufferByRoom,
          sharedQueuePreview,
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

  // Pools visibles respetando el límite de 12 celdas (cada sala ocupa 1 celda)
  const visiblePools = useMemo(() => {
    const result: ChallengePoolRow[] = []
    let used = 0
    for (const pool of poolRows) {
      const span = pool.rooms.length
      if (used + span > TV_GRID_CAPACITY) break
      result.push(pool)
      used += span
    }
    return result
  }, [poolRows])

  const usedCells = useMemo(
    () => visiblePools.reduce((sum, p) => sum + p.rooms.length, 0),
    [visiblePools]
  )
  const totalRooms = useMemo(
    () => poolRows.reduce((sum, p) => sum + p.rooms.length, 0),
    [poolRows]
  )
  const hiddenRoomCount = Math.max(0, totalRooms - usedCells)
  const emptyCellCount = Math.max(0, TV_GRID_CAPACITY - usedCells)

  return (
    <main className="h-dvh overflow-hidden bg-slate-100">
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div className="flex h-[10%] items-center justify-between px-6">
        <h1 className="text-2xl font-black tracking-tight text-slate-800">
          FastTrack
        </h1>
        <div className="flex items-center gap-3">
          {hiddenRoomCount > 0 && (
            <span className="text-sm font-semibold text-amber-600">
              +{hiddenRoomCount} salas fuera de pantalla
            </span>
          )}
          <span className="text-2xl font-bold tabular-nums text-slate-500">
            {nowLabel}
          </span>
        </div>
      </div>

      {/* ── Grid 6×2 ────────────────────────────────────────────── */}
      <div
        className="grid h-[90%] gap-2 px-3 pb-3"
        style={{
          gridTemplateColumns: `repeat(${TV_GRID_COLUMNS}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${TV_GRID_ROWS}, minmax(0, 1fr))`
        }}
      >
        {visiblePools.map((pool) => {
          const isGroup = pool.rooms.length > 1
          const label = pool.challengeKeyword || pool.challengeTitle

          if (isGroup) {
            // ── Grupo multi-sala: un contenedor que abraza todas las salas ──
            return (
              <div
                key={pool.poolKey}
                className="flex min-h-0 flex-col overflow-hidden rounded-md border-2 border-slate-300 bg-white shadow-sm"
                style={{ gridColumn: `span ${pool.rooms.length}` }}
              >
                {/* Cabecera del grupo: nombre del reto */}
                <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5">
                  <span className="text-lg font-black uppercase tracking-wide text-slate-700">
                    {label}
                  </span>
                  <span className="text-base font-semibold text-slate-400">
                    · {pool.rooms.length} salas · cola compartida
                  </span>
                </div>

                {/* Fila de salas */}
                <div className="flex min-h-0 flex-1 divide-x divide-slate-100">
                  {pool.rooms.map((room) => {
                    const roomState = pool.roomStateByRoom[room.id]
                    const current = pool.currentByRoom[room.id]
                    const roomBuffer = pool.bufferByRoom[room.id] || []
                    const bufferLimit = Math.max(
                      0,
                      roomState.buffer_target ?? DEFAULT_BUFFER_TARGET
                    )

                    return (
                      <div
                        key={room.id}
                        className="flex min-w-0 flex-1 flex-col gap-1.5 p-2"
                      >
                        {/* Nombre sala + estado */}
                        <div className="flex shrink-0 items-center justify-between gap-1">
                          <Link
                            href={`/tv/${toSlug(room.name)}`}
                            className="truncate text-base font-black text-slate-800 hover:underline"
                          >
                            {room.name}
                          </Link>
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-bold ${
                              roomState.is_ready
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-red-100 text-red-600"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-sm ${roomState.is_ready ? "bg-emerald-500" : "bg-red-400"}`}
                            />
                            {roomState.is_ready ? "Lista" : "No lista"}
                          </span>
                        </div>

                        {/* NOW */}
                        <div className="shrink-0 rounded-sm bg-emerald-50 px-2 py-2 ring-1 ring-emerald-200">
                          <p className="mb-0.5 text-[11px] font-bold uppercase tracking-widest text-emerald-600">
                            Presentando
                          </p>
                          <p className="truncate text-lg font-black text-emerald-900">
                            {roomState.is_ready
                              ? current
                                ? `#${current.submissions.number} · ${current.submissions.title || "Sin título"}`
                                : "—"
                              : "—"}
                          </p>
                        </div>

                        {/* STANDBY */}
                        <div className="min-h-0 flex-1 overflow-hidden rounded-sm bg-amber-50 px-2 py-2 ring-1 ring-amber-200">
                          <p className="mb-1 text-xs font-bold uppercase tracking-widest text-amber-600">
                            Standby
                          </p>
                          {roomBuffer.length === 0 ? (
                            <p className="text-lg font-medium text-amber-400">
                              —
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {roomBuffer
                                .slice(0, bufferLimit)
                                .map((entry, idx) => (
                                  <p
                                    key={entry.id}
                                    className="truncate text-lg font-semibold text-amber-900"
                                  >
                                    <span className="mr-1 tabular-nums text-amber-400">
                                      {idx + 1}.
                                    </span>
                                    #{entry.submissions.number} ·{" "}
                                    {entry.submissions.title || "Sin título"}
                                  </p>
                                ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Barra compartida de "Siguiente en cola" */}
                {(() => {
                  const firstRoomId = pool.rooms[0]?.id ?? ""
                  const groupBufferLimit = Math.max(
                    0,
                    pool.roomStateByRoom[firstRoomId]?.buffer_target ??
                      DEFAULT_BUFFER_TARGET
                  )
                  const nextEntry = pool.sharedQueuePreview[0] ?? null
                  return (
                    <div className="shrink-0 border-t border-sky-200 bg-sky-50 px-3 py-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-sm font-bold uppercase tracking-widest text-sky-600">
                          Siguiente en cola
                        </span>
                        <span className="rounded-md bg-slate-100 px-3 py-0.5 text-sm font-bold tabular-nums text-slate-500">
                          Q&thinsp;{pool.waitingCount}
                        </span>
                      </div>
                      {nextEntry ? (
                        <p className="truncate text-lg font-bold text-sky-900">
                          <span className="mr-1 text-sky-500">
                            {groupBufferLimit + 1}.
                          </span>
                          #{nextEntry.submissions.number} ·{" "}
                          {nextEntry.submissions.title || "Sin título"}
                        </p>
                      ) : (
                        <p className="text-lg font-bold text-sky-900">—</p>
                      )}
                    </div>
                  )
                })()}
              </div>
            )
          }

          // ── Sala individual ──────────────────────────────────────
          const room = pool.rooms[0]
          const roomState = pool.roomStateByRoom[room.id]
          const current = pool.currentByRoom[room.id]
          const roomBuffer = pool.bufferByRoom[room.id] || []
          const bufferLimit = Math.max(
            0,
            roomState.buffer_target ?? DEFAULT_BUFFER_TARGET
          )

          return (
            <div
              key={pool.poolKey}
              className="flex min-h-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"
            >
              {/* Cabecera */}
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
                <div className="flex min-w-0 items-baseline gap-2">
                  <Link
                    href={`/tv/${toSlug(room.name)}`}
                    className="truncate text-xl font-black text-slate-900 hover:underline"
                  >
                    {room.name}
                  </Link>
                  <span className="inline-flex shrink-0 items-center rounded border border-slate-300 bg-slate-100 px-3 py-1.5 text-base font-bold uppercase tracking-wide text-slate-600">
                    {label}
                  </span>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded px-3 py-1 text-sm font-bold ${
                    roomState.is_ready
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-red-100 text-red-600"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-sm ${roomState.is_ready ? "bg-emerald-500" : "bg-red-400"}`}
                  />
                  {roomState.is_ready ? "Lista" : "No lista"}
                </span>
              </div>

              {/* Cuerpo */}
              <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
                {/* NOW */}
                <div className="shrink-0 rounded-sm bg-emerald-50 px-3 py-2 ring-1 ring-emerald-200">
                  <p className="mb-0.5 text-xs font-bold uppercase tracking-widest text-emerald-600">
                    Presentando
                  </p>
                  <p className="truncate text-xl font-black text-emerald-900">
                    {roomState.is_ready
                      ? current
                        ? `#${current.submissions.number} · ${current.submissions.title || "Sin título"}`
                        : "—"
                      : "—"}
                  </p>
                </div>

                {/* STANDBY */}
                <div className="min-h-0 flex-1 overflow-hidden rounded-sm bg-amber-50 px-3 py-2.5 ring-1 ring-amber-200">
                  <p className="mb-1 text-xs font-bold uppercase tracking-widest text-amber-600">
                    Standby
                  </p>
                  {roomBuffer.length === 0 ? (
                    <p className="text-lg font-medium text-amber-400">—</p>
                  ) : (
                    <div className="space-y-1">
                      {roomBuffer.slice(0, bufferLimit).map((entry, idx) => (
                        <p
                          key={entry.id}
                          className="truncate text-lg font-semibold text-amber-900"
                        >
                          <span className="mr-1.5 tabular-nums text-amber-500">
                            {idx + 1}.
                          </span>
                          #{entry.submissions.number} ·{" "}
                          {entry.submissions.title || "Sin título"}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                {/* NEXT */}
                {(() => {
                  const nextEntry = pool.sharedQueuePreview[0] ?? null
                  return (
                    <div className="shrink-0 rounded-sm bg-sky-50 px-3 py-2 ring-1 ring-sky-200">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-xs font-bold uppercase tracking-widest text-sky-600">
                          Siguiente en cola
                        </p>
                        <span className="rounded-md bg-slate-100 px-3 py-0.5 text-sm font-bold tabular-nums text-slate-500">
                          Q&thinsp;{pool.waitingCount}
                        </span>
                      </div>
                      {nextEntry ? (
                        <p className="truncate text-lg font-bold text-sky-900">
                          <span className="mr-1 text-sky-500">
                            {bufferLimit + 1}.
                          </span>
                          #{nextEntry.submissions.number} ·{" "}
                          {nextEntry.submissions.title || "Sin título"}
                        </p>
                      ) : (
                        <p className="text-lg font-bold text-sky-900">—</p>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>
          )
        })}

        {/* Celdas vacías */}
        {Array.from({ length: emptyCellCount }).map((_, index) => (
          <div
            key={`empty-cell-${index}`}
            className="h-full min-h-0 rounded-md border border-dashed border-slate-200"
            aria-hidden
          />
        ))}
      </div>
    </main>
  )
}
