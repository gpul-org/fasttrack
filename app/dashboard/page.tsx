"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { Clock3, Download, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

type Role = "judge" | "admin" | null

const DEFAULT_BUFFER_TARGET = 2
const DEFAULT_DESIRED_MINUTES_PER_TEAM = 8

interface RoomSummary {
  id: string
  name: string
  challengeKeywords: string[]
  challengeLabel: string
}

interface RoomQueueState {
  room_id: string
  is_ready: boolean
  is_paused: boolean
  started_at: string | null
  buffer_target: number
  desired_minutes_per_team: number
}

interface QueueEntryAggregate {
  room_id: string
  submission_id: string
  status:
    | "waiting"
    | "called"
    | "in_progress"
    | "completed"
    | "skipped"
    | "cancelled"
  started_at: string | null
  completed_at: string | null
}

interface QueueOverviewRow {
  poolKey: string
  challengeLabel: string
  rooms: RoomSummary[]
  roomStatuses: Array<{
    roomId: string
    roomName: string
    isReady: boolean
  }>
  dominantRoom: RoomSummary
  parallelRooms: number
  standbyTarget: number
  isReady: boolean
  completed: number
  total: number
  waiting: number
  called: number
  inProgress: number
  remainingMinutes: number
  progressPercent: number
}

interface QueueSettings {
  schedule_start_at?: string | null
  schedule_end_at?: string | null
}

interface SubmissionSummary {
  id: string
  prizes: string[]
}

interface QueueExportRow {
  room_id: string
  status: QueueEntryAggregate["status"]
  priority: number
  created_at: string
  submissions: {
    number: number
    title: string | null
  }
}

function formatMinutesToHm(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`
}

function toLocalDatetimeInputValue(value: string | null): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function fromLocalDatetimeInputValue(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function normalizeKeyword(value: string | null | undefined): string {
  return (value || "").trim().toUpperCase()
}

function isSubmissionEligibleForRoom(
  submission: SubmissionSummary,
  room: RoomSummary
): boolean {
  if (room.challengeKeywords.length === 0) return true
  if (room.challengeKeywords.includes("GENERAL")) return true

  const submissionPrizes = submission.prizes.map(normalizeKeyword)
  return room.challengeKeywords.some((keyword) =>
    submissionPrizes.includes(keyword)
  )
}

function toCsvValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  return `"${String(value).replaceAll('"', '""')}"`
}

function downloadCsv(filename: string, csvContent: string) {
  if (typeof window === "undefined") return
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

function rankQueueStatus(status: QueueEntryAggregate["status"]): number {
  if (status === "in_progress") return 0
  if (status === "called") return 1
  if (status === "waiting") return 2
  if (status === "completed") return 3
  return 4
}

function roomPoolKey(room: RoomSummary): string {
  if (room.challengeKeywords.length === 0) return `room:${room.id}`
  const nonGeneralKeyword = room.challengeKeywords.find(
    (keyword) => keyword !== "GENERAL"
  )
  return `challenge:${nonGeneralKeyword || room.challengeKeywords[0]}`
}

function formatTimeNoSeconds(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  })
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      message?: unknown
      details?: unknown
      hint?: unknown
      error_description?: unknown
      code?: unknown
    }

    if (
      typeof candidate.message === "string" &&
      candidate.message.trim().length > 0
    ) {
      return candidate.message
    }

    if (
      typeof candidate.details === "string" &&
      candidate.details.trim().length > 0
    ) {
      return candidate.details
    }

    if (
      typeof candidate.hint === "string" &&
      candidate.hint.trim().length > 0
    ) {
      return candidate.hint
    }

    if (
      typeof candidate.error_description === "string" &&
      candidate.error_description.trim().length > 0
    ) {
      return candidate.error_description
    }

    if (
      typeof candidate.code === "string" &&
      candidate.code.trim().length > 0
    ) {
      return candidate.code
    }
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error
  }

  return "Unknown error"
}

export default function DashboardPage() {
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [role, setRole] = useState<Role>(null)
  const [rooms, setRooms] = useState<RoomSummary[]>([])
  const [roomQueueStateByRoom, setRoomQueueStateByRoom] = useState<
    Record<string, RoomQueueState>
  >({})
  const [queueEntries, setQueueEntries] = useState<QueueEntryAggregate[]>([])
  const [globalScheduleStartAt, setGlobalScheduleStartAt] = useState<
    string | null
  >(null)
  const [globalScheduleEndAt, setGlobalScheduleEndAt] = useState<string | null>(
    null
  )
  const [globalScheduleStartInput, setGlobalScheduleStartInput] = useState("")
  const [globalScheduleEndInput, setGlobalScheduleEndInput] = useState("")
  const [standbyTargetDraftByPool, setStandbyTargetDraftByPool] = useState<
    Record<string, string>
  >({})

  const fetchData = useCallback(async () => {
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user) {
      setLoading(false)
      return
    }

    const [
      profileResult,
      roomsResult,
      roomQueueStateResult,
      queueEntriesResult,
      queueSettingsResult
    ] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
      supabase
        .from("rooms")
        .select("id, name, room_challenges(challenges(title, keyword))")
        .order("name"),
      supabase
        .from("room_queue_state")
        .select(
          "room_id, is_ready, is_paused, started_at, buffer_target, desired_minutes_per_team"
        ),
      supabase
        .from("queue_entries")
        .select("room_id, submission_id, status, started_at, completed_at")
        .neq("status", "cancelled"),
      supabase
        .from("queue_settings")
        .select("schedule_start_at, schedule_end_at")
        .eq("id", true)
        .maybeSingle()
    ])

    const currentRole = (profileResult.data?.role as Role) ?? null
    setRole(currentRole)
    const rawRooms =
      (roomsResult.data as Array<{
        id: string
        name: string
        room_challenges: Array<{
          challenges:
            | {
                title: string | null
                keyword: string | null
              }
            | {
                title: string | null
                keyword: string | null
              }[]
            | null
        }> | null
      }> | null) || []

    const mappedRooms: RoomSummary[] = rawRooms.map((room) => {
      const challengeRows = room.room_challenges || []
      const flattened = challengeRows
        .map((row) =>
          Array.isArray(row.challenges) ? row.challenges[0] : row.challenges
        )
        .filter(
          (
            challenge
          ): challenge is {
            title: string | null
            keyword: string | null
          } => Boolean(challenge)
        )

      const challengeKeywords = Array.from(
        new Set(
          flattened
            .map((challenge) => normalizeKeyword(challenge.keyword))
            .filter(Boolean)
        )
      )

      const challengeTitles = Array.from(
        new Set(
          flattened
            .map((challenge) => (challenge.title || "").trim())
            .filter(Boolean)
        )
      )

      return {
        id: room.id,
        name: room.name,
        challengeKeywords,
        challengeLabel:
          challengeTitles.length > 0
            ? challengeTitles.join(" · ")
            : challengeKeywords.length > 0
              ? challengeKeywords.join(" · ")
              : "General"
      }
    })

    setRooms(mappedRooms)

    const stateRows =
      (roomQueueStateResult.data as RoomQueueState[] | null) || []
    const stateMap: Record<string, RoomQueueState> = {}
    stateRows.forEach((row) => {
      stateMap[row.room_id] = {
        room_id: row.room_id,
        is_ready: row.is_ready,
        is_paused: row.is_paused,
        started_at: row.started_at,
        buffer_target: row.buffer_target ?? DEFAULT_BUFFER_TARGET,
        desired_minutes_per_team:
          row.desired_minutes_per_team ?? DEFAULT_DESIRED_MINUTES_PER_TEAM
      }
    })
    setRoomQueueStateByRoom(stateMap)
    setQueueEntries(
      (queueEntriesResult.data as QueueEntryAggregate[] | null) || []
    )

    const settings = (queueSettingsResult.data as QueueSettings | null) || null
    setGlobalScheduleStartAt(settings?.schedule_start_at ?? null)
    setGlobalScheduleEndAt(settings?.schedule_end_at ?? null)

    setLoading(false)
  }, [supabase])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  useEffect(() => {
    setGlobalScheduleStartInput(
      toLocalDatetimeInputValue(globalScheduleStartAt)
    )
    setGlobalScheduleEndInput(toLocalDatetimeInputValue(globalScheduleEndAt))
  }, [globalScheduleEndAt, globalScheduleStartAt])

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }

  const upsertRoomsState = async (
    roomIds: string[],
    updater: (
      current: RoomQueueState | undefined,
      roomId: string
    ) => Partial<RoomQueueState>
  ) => {
    if (role !== "admin") return

    const payload = roomIds.map((roomId) => {
      const current = roomQueueStateByRoom[roomId]
      const patch = updater(current, roomId)

      return {
        room_id: roomId,
        is_ready: patch.is_ready ?? current?.is_ready ?? false,
        is_paused: patch.is_paused ?? current?.is_paused ?? true,
        started_at: patch.started_at ?? current?.started_at ?? null,
        buffer_target:
          patch.buffer_target ??
          current?.buffer_target ??
          DEFAULT_BUFFER_TARGET,
        desired_minutes_per_team:
          patch.desired_minutes_per_team ??
          current?.desired_minutes_per_team ??
          DEFAULT_DESIRED_MINUTES_PER_TEAM
      }
    })

    const { error } = await supabase
      .from("room_queue_state")
      .upsert(payload, { onConflict: "room_id" })

    if (error) throw error
  }

  const upsertAllRoomsState = async (
    updater: (
      current: RoomQueueState | undefined,
      roomId: string
    ) => Partial<RoomQueueState>
  ) => {
    await upsertRoomsState(
      rooms.map((room) => room.id),
      updater
    )
  }

  const handleStartAllRooms = async () => {
    if (role !== "admin") return
    setSaving(true)
    try {
      await upsertAllRoomsState(() => ({ is_ready: true, is_paused: false }))
      toast.success("All rooms marked as ready")
      await fetchData()
    } catch (error) {
      console.error(error)
      toast.error("Failed to start all rooms")
    } finally {
      setSaving(false)
    }
  }

  const handleStopAllRooms = async () => {
    if (role !== "admin") return
    setSaving(true)
    try {
      await upsertAllRoomsState(() => ({
        is_ready: false,
        is_paused: true,
        started_at: null
      }))
      toast.success("All rooms marked as not ready")
      await fetchData()
    } catch (error) {
      console.error(error)
      toast.error("Failed to stop all rooms")
    } finally {
      setSaving(false)
    }
  }

  const queueOverviewRows = useMemo(() => {
    const roomsByPool = new Map<string, RoomSummary[]>()

    rooms.forEach((room) => {
      const key = roomPoolKey(room)
      const list = roomsByPool.get(key) || []
      list.push(room)
      roomsByPool.set(key, list)
    })

    const rows: QueueOverviewRow[] = []

    roomsByPool.forEach((poolRooms, poolKey) => {
      const sortedRooms = [...poolRooms].sort((a, b) =>
        a.name.localeCompare(b.name)
      )
      const roomIds = new Set(sortedRooms.map((room) => room.id))
      const poolEntries = queueEntries.filter((entry) =>
        roomIds.has(entry.room_id)
      )
      const waitingByRoom = new Map<string, number>()

      sortedRooms.forEach((room) => {
        waitingByRoom.set(room.id, 0)
      })

      poolEntries.forEach((entry) => {
        if (entry.status !== "waiting") return
        waitingByRoom.set(
          entry.room_id,
          (waitingByRoom.get(entry.room_id) || 0) + 1
        )
      })

      const dominantRoom = [...sortedRooms].sort((a, b) => {
        const waitingDiff =
          (waitingByRoom.get(b.id) || 0) - (waitingByRoom.get(a.id) || 0)
        if (waitingDiff !== 0) return waitingDiff
        return a.name.localeCompare(b.name)
      })[0]

      if (!dominantRoom) return

      const uniqueSubmissionIds = new Set(
        poolEntries.map((entry) => entry.submission_id)
      )
      const completedIds = new Set(
        poolEntries
          .filter((entry) => entry.status === "completed")
          .map((entry) => entry.submission_id)
      )
      const waitingIds = new Set(
        poolEntries
          .filter((entry) => entry.status === "waiting")
          .map((entry) => entry.submission_id)
      )
      const calledIds = new Set(
        poolEntries
          .filter((entry) => entry.status === "called")
          .map((entry) => entry.submission_id)
      )
      const inProgressIds = new Set(
        poolEntries
          .filter((entry) => entry.status === "in_progress")
          .map((entry) => entry.submission_id)
      )

      const durations = poolEntries
        .map((entry) => {
          if (!entry.started_at || !entry.completed_at) return null
          const ms =
            new Date(entry.completed_at).getTime() -
            new Date(entry.started_at).getTime()
          if (ms <= 0) return null
          return ms / 60000
        })
        .filter((value): value is number => value !== null)

      const fallbackMinutes =
        roomQueueStateByRoom[dominantRoom.id]?.desired_minutes_per_team ||
        DEFAULT_DESIRED_MINUTES_PER_TEAM

      const avgMinutes =
        durations.length > 0
          ? durations.reduce((sum, value) => sum + value, 0) / durations.length
          : fallbackMinutes

      const roomStatuses = sortedRooms.map((room) => ({
        roomId: room.id,
        roomName: room.name,
        isReady: Boolean(roomQueueStateByRoom[room.id]?.is_ready)
      }))
      const readyRoomCount = roomStatuses.filter((room) => room.isReady).length
      const parallelRooms = Math.max(
        1,
        readyRoomCount > 0 ? readyRoomCount : sortedRooms.length
      )
      const remainingCount =
        waitingIds.size + calledIds.size + inProgressIds.size
      const remainingMinutes = (remainingCount * avgMinutes) / parallelRooms
      const total = uniqueSubmissionIds.size
      const completed = completedIds.size

      rows.push({
        poolKey,
        challengeLabel: dominantRoom.challengeLabel,
        rooms: sortedRooms,
        roomStatuses,
        dominantRoom,
        parallelRooms,
        standbyTarget:
          roomQueueStateByRoom[dominantRoom.id]?.buffer_target ??
          DEFAULT_BUFFER_TARGET,
        isReady: roomStatuses.every((room) => room.isReady),
        completed,
        total,
        waiting: waitingIds.size,
        called: calledIds.size,
        inProgress: inProgressIds.size,
        remainingMinutes,
        progressPercent: total > 0 ? Math.round((completed / total) * 100) : 0
      })
    })

    return rows.sort((a, b) => a.challengeLabel.localeCompare(b.challengeLabel))
  }, [queueEntries, roomQueueStateByRoom, rooms])

  useEffect(() => {
    setStandbyTargetDraftByPool((previous) => {
      const next: Record<string, string> = { ...previous }

      queueOverviewRows.forEach((row) => {
        if (!next[row.poolKey]) {
          next[row.poolKey] = String(row.standbyTarget)
        }
      })

      Object.keys(next).forEach((poolKey) => {
        if (!queueOverviewRows.some((row) => row.poolKey === poolKey)) {
          delete next[poolKey]
        }
      })

      return next
    })
  }, [queueOverviewRows])

  const handleSaveStandbyForPool = async (poolKey: string) => {
    if (role !== "admin") return

    const row = queueOverviewRows.find((item) => item.poolKey === poolKey)
    if (!row) return

    const draftRaw =
      standbyTargetDraftByPool[poolKey] || String(row.standbyTarget)
    const parsed = Number(draftRaw)
    const target = Number.isNaN(parsed)
      ? DEFAULT_BUFFER_TARGET
      : Math.max(0, Math.floor(parsed))

    setSaving(true)
    try {
      await upsertRoomsState(
        row.rooms.map((room) => room.id),
        () => ({ buffer_target: target })
      )
      toast.success(
        row.rooms.length > 1
          ? `Standby updated to ${target} for ${row.rooms.length} rooms`
          : `Standby updated to ${target}`
      )
      await fetchData()
    } catch (error) {
      console.error(error)
      toast.error("Failed to update standby")
    } finally {
      setSaving(false)
    }
  }

  const handleSaveGlobalScheduleWindow = async () => {
    if (role !== "admin") return

    const scheduleStartAt = fromLocalDatetimeInputValue(
      globalScheduleStartInput
    )
    const scheduleEndAt = fromLocalDatetimeInputValue(globalScheduleEndInput)

    if (globalScheduleStartInput && !scheduleStartAt) {
      toast.error("Invalid start date/time")
      return
    }

    if (globalScheduleEndInput && !scheduleEndAt) {
      toast.error("Invalid end date/time")
      return
    }

    if (scheduleStartAt && scheduleEndAt) {
      const startMs = new Date(scheduleStartAt).getTime()
      const endMs = new Date(scheduleEndAt).getTime()
      if (endMs <= startMs) {
        toast.error("End time must be after start time")
        return
      }
    }

    setSaving(true)
    const { error } = await supabase
      .from("queue_settings")
      .update({
        schedule_start_at: scheduleStartAt,
        schedule_end_at: scheduleEndAt
      })
      .eq("id", true)

    if (error) {
      toast.error("Failed to update global schedule window")
      setSaving(false)
      return
    }

    toast.success("Global schedule window updated")
    await fetchData()
    setSaving(false)
  }

  const handleGenerateAllQueues = async () => {
    if (role !== "admin") return

    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user) {
      toast.error("You must be logged in")
      return
    }

    setSaving(true)
    try {
      const [
        { data: submissionsData, error: submissionsError },
        { data: queueData, error: queueError }
      ] = await Promise.all([
        supabase.from("submissions").select("id, prizes"),
        supabase
          .from("queue_entries")
          .select("room_id, submission_id, status")
          .neq("status", "cancelled")
      ])

      if (submissionsError) throw submissionsError
      if (queueError) throw queueError

      const submissions: SubmissionSummary[] = (
        (submissionsData as Array<{
          id: string
          prizes: string[] | null
        }> | null) || []
      ).map((row) => ({
        id: row.id,
        prizes: row.prizes || []
      }))

      if (rooms.length === 0) {
        toast.info("No rooms available")
        return
      }

      if (submissions.length === 0) {
        toast.info("No submissions available")
        return
      }

      const roomById = new Map(rooms.map((room) => [room.id, room]))
      const roomsByPool = new Map<string, RoomSummary[]>()
      rooms.forEach((room) => {
        const key = roomPoolKey(room)
        const list = roomsByPool.get(key) || []
        list.push(room)
        roomsByPool.set(key, list)
      })

      const activeSubmissionIdsByPool = new Map<string, Set<string>>()
      ;(
        (queueData as Array<{
          room_id: string
          submission_id: string
        }> | null) || []
      ).forEach((entry) => {
        const room = roomById.get(entry.room_id)
        if (!room) return
        const key = roomPoolKey(room)
        if (!activeSubmissionIdsByPool.has(key)) {
          activeSubmissionIdsByPool.set(key, new Set<string>())
        }
        activeSubmissionIdsByPool.get(key)?.add(entry.submission_id)
      })

      const payload: Array<{
        room_id: string
        submission_id: string
        status: "waiting"
        priority: number
        created_by: string
      }> = []

      roomsByPool.forEach((poolRooms) => {
        const sortedPoolRooms = [...poolRooms].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
        const anchorRoom = sortedPoolRooms[0]
        const poolKey = roomPoolKey(anchorRoom)
        const existingSubmissionIds =
          activeSubmissionIdsByPool.get(poolKey) || new Set<string>()
        const scheduledInThisRun = new Set<string>()

        submissions.forEach((submission) => {
          const isEligibleInPool = sortedPoolRooms.some((room) =>
            isSubmissionEligibleForRoom(submission, room)
          )

          if (!isEligibleInPool) return
          if (existingSubmissionIds.has(submission.id)) return
          if (scheduledInThisRun.has(submission.id)) return

          scheduledInThisRun.add(submission.id)
          payload.push({
            room_id: anchorRoom.id,
            submission_id: submission.id,
            status: "waiting",
            priority: 0,
            created_by: user.id
          })
        })
      })

      if (payload.length === 0) {
        toast.info("All queues are already generated")
        return
      }

      const CHUNK_SIZE = 200
      for (let offset = 0; offset < payload.length; offset += CHUNK_SIZE) {
        const chunk = payload.slice(offset, offset + CHUNK_SIZE)
        const withCreatorResult = await supabase
          .from("queue_entries")
          .insert(chunk)

        if (!withCreatorResult.error) continue

        const errorMessage = extractErrorMessage(
          withCreatorResult.error
        ).toLowerCase()
        const shouldRetryWithoutCreator =
          errorMessage.includes("created_by") ||
          errorMessage.includes("column") ||
          errorMessage.includes("schema cache")

        if (!shouldRetryWithoutCreator) {
          throw withCreatorResult.error
        }

        const fallbackChunk = chunk.map((item) => ({
          room_id: item.room_id,
          submission_id: item.submission_id,
          status: item.status,
          priority: item.priority
        }))
        const fallbackResult = await supabase
          .from("queue_entries")
          .insert(fallbackChunk)
        if (fallbackResult.error) throw fallbackResult.error
      }

      toast.success(
        `Generated ${payload.length} queue entries across all rooms`
      )
      await fetchData()
    } catch (error) {
      const message = extractErrorMessage(error)
      console.error("Failed to generate all queues:", message, error)
      toast.error(`Failed to generate all queues: ${message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleExportAllRoomsCsv = async () => {
    if (role !== "admin") return

    const { data, error } = await supabase
      .from("queue_entries")
      .select(
        "room_id, status, priority, created_at, submissions(number, title)"
      )
      .in(
        "room_id",
        rooms.map((room) => room.id)
      )
      .neq("status", "cancelled")

    if (error) {
      toast.error("Failed to export rooms CSV")
      return
    }

    const rowsByRoom: Record<string, QueueExportRow[]> = {}
    ;((data as unknown as QueueExportRow[] | null) || []).forEach((entry) => {
      if (!rowsByRoom[entry.room_id]) rowsByRoom[entry.room_id] = []

      const submissionRelation = Array.isArray(entry.submissions)
        ? entry.submissions[0]
        : entry.submissions

      rowsByRoom[entry.room_id].push({
        ...entry,
        submissions: {
          number: Number(submissionRelation?.number || 0),
          title: submissionRelation?.title || null
        }
      })
    })

    const csvHeader = [
      "sala",
      "reto",
      "orden_cola",
      "equipo",
      "estado",
      "tiempo_estimado_min",
      "inicio_estimado",
      "fin_estimado"
    ]

    const csvRows = [csvHeader.map((value) => toCsvValue(value)).join(",")]

    rooms.forEach((room) => {
      const roomRows = (rowsByRoom[room.id] || []).sort((a, b) => {
        const rankDiff = rankQueueStatus(a.status) - rankQueueStatus(b.status)
        if (rankDiff !== 0) return rankDiff
        if (a.priority !== b.priority) return b.priority - a.priority
        return (
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
      })

      if (roomRows.length === 0) return

      const roomScheduleStartMs = globalScheduleStartAt
        ? new Date(globalScheduleStartAt).getTime()
        : Date.now()
      const roomScheduleEndMs = globalScheduleEndAt
        ? new Date(globalScheduleEndAt).getTime()
        : null

      const fallbackMinutes =
        roomQueueStateByRoom[room.id]?.desired_minutes_per_team ||
        DEFAULT_DESIRED_MINUTES_PER_TEAM

      const estimatedMinutesPerTeam =
        roomScheduleEndMs && roomScheduleEndMs > roomScheduleStartMs
          ? Math.max(
              1,
              (roomScheduleEndMs - roomScheduleStartMs) /
                60000 /
                roomRows.length
            )
          : fallbackMinutes

      let cursorMs = roomScheduleStartMs
      roomRows.forEach((entry, index) => {
        const start = new Date(cursorMs)
        const end = new Date(cursorMs + estimatedMinutesPerTeam * 60_000)
        cursorMs = end.getTime()

        csvRows.push(
          [
            room.name,
            room.challengeLabel,
            index + 1,
            `#${entry.submissions.number} ${entry.submissions.title || "Untitled"}`,
            entry.status,
            estimatedMinutesPerTeam.toFixed(1),
            formatTimeNoSeconds(start),
            formatTimeNoSeconds(end)
          ]
            .map((value) => toCsvValue(value))
            .join(",")
        )
      })
    })

    const stamp = new Date().toISOString().slice(0, 16).replaceAll(":", "-")
    downloadCsv(`salas-colas-${stamp}.csv`, csvRows.join("\n"))
    toast.success("CSV exported for all rooms")
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <Button
          variant="outline"
          size="icon"
          onClick={handleRefresh}
          disabled={refreshing || loading}
        >
          <RefreshCw
            className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
          />
        </Button>
      </div>

      {role === "admin" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock3 className="h-5 w-5" />
              Global Queue Controls
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={handleStartAllRooms}
                disabled={saving || loading}
              >
                Start all rooms
              </Button>
              <Button
                variant="destructive"
                onClick={handleStopAllRooms}
                disabled={saving || loading}
              >
                Stop all rooms
              </Button>
              <Button
                variant="outline"
                onClick={handleGenerateAllQueues}
                disabled={saving || loading}
              >
                Generate all queues
              </Button>
              <Button
                variant="outline"
                onClick={handleExportAllRoomsCsv}
                disabled={saving || loading}
              >
                <Download className="mr-2 h-4 w-4" />
                Export rooms CSV
              </Button>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Global schedule window
                </p>
                <p className="text-sm font-medium">
                  Admin-managed start/end used to calculate max time per team
                  for all rooms
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="dashboard-global-schedule-start">Start</Label>
                  <Input
                    id="dashboard-global-schedule-start"
                    type="datetime-local"
                    value={globalScheduleStartInput}
                    onChange={(event) =>
                      setGlobalScheduleStartInput(event.target.value)
                    }
                    disabled={saving || loading}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="dashboard-global-schedule-end">End</Label>
                  <Input
                    id="dashboard-global-schedule-end"
                    type="datetime-local"
                    value={globalScheduleEndInput}
                    onChange={(event) =>
                      setGlobalScheduleEndInput(event.target.value)
                    }
                    disabled={saving || loading}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={handleSaveGlobalScheduleWindow}
                  disabled={saving || loading}
                >
                  Save global window
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {role === "admin" && (
        <Card>
          <CardHeader>
            <CardTitle>Global queue overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {queueOverviewRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rooms found.</p>
            ) : (
              queueOverviewRows.map((item) => (
                <div
                  key={item.poolKey}
                  className="space-y-2 rounded-md border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {item.rooms.length > 1
                          ? `${item.challengeLabel} · Global queue`
                          : item.dominantRoom.name}
                      </p>
                      <Badge variant={item.isReady ? "default" : "destructive"}>
                        {item.isReady ? "Ready" : "Not ready"}
                      </Badge>
                      {item.rooms.length > 1 && (
                        <Badge variant="secondary">
                          {item.rooms.length} rooms shared
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {item.completed}/{Math.max(item.total, 1)} · ~
                      {formatMinutesToHm(item.remainingMinutes)} left ·{" "}
                      {item.parallelRooms} rooms for ETA
                    </p>
                  </div>

                  {item.rooms.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                      {item.roomStatuses.map((roomStatus) => (
                        <Badge
                          key={roomStatus.roomId}
                          variant={
                            roomStatus.isReady ? "default" : "destructive"
                          }
                        >
                          {roomStatus.roomName}:{" "}
                          {roomStatus.isReady ? "Ready" : "Not ready"}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{
                        width: `${Math.max(0, Math.min(item.progressPercent, 100))}%`
                      }}
                    />
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Waiting: {item.waiting} · Standby: {item.called}/
                    {item.standbyTarget} · Presenting: {item.inProgress}
                  </p>

                  <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_auto]">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        {item.rooms.length > 1
                          ? `Dominant room (waiting): ${item.dominantRoom.name}`
                          : "Standby target"}
                      </p>
                      <p className="text-sm font-medium">
                        {item.rooms.length > 1
                          ? "This standby value is applied to all rooms in this shared queue"
                          : "People waiting in standby before presenting"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        className="w-24"
                        value={
                          standbyTargetDraftByPool[item.poolKey] ??
                          String(item.standbyTarget)
                        }
                        onChange={(event) =>
                          setStandbyTargetDraftByPool((previous) => ({
                            ...previous,
                            [item.poolKey]: event.target.value
                          }))
                        }
                        disabled={saving || loading}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSaveStandbyForPool(item.poolKey)}
                        disabled={saving || loading}
                      >
                        Save standby
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
