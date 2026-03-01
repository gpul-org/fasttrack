"use client"

import { PushSubscriptionManager } from "@/components/push-subscription"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"
import {
  ArrowUpToLine,
  Clock3,
  Download,
  FastForward,
  Loader2,
  Plus,
  RefreshCw,
  SkipForward
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

const LAST_SELECTED_ROOM_KEY = "fasttrack:queue:last-room"
const REVIEW_DRAFTS_KEY = "fasttrack:queue:review-drafts:v1"
const DEFAULT_BUFFER_TARGET = 2
const DEFAULT_DESIRED_MINUTES_PER_TEAM = 8
const NOTIFICATION_TOP_QUEUE_THRESHOLD = 3

type Role = "judge" | "admin" | null

type QuestionType = "boolean" | "number" | "textarea"

interface ChallengeQuestion {
  label: string
  type: QuestionType
}

interface ReviewAnswer {
  label: string
  type: QuestionType
  value: boolean | number | string | null
}

interface SubmissionParticipant {
  participant_id: string
  participants: {
    id: string
    first_name: string | null
    last_name: string | null
    email: string
    discord_username?: string | null
    discord_user?: string | null
    discord?: string | null
  }
}

interface Submission {
  id: string
  number: number
  title: string | null
  devpost_url: string
  repo_url: string | null
  demo_url: string | null
  video_url: string | null
  prizes: string[]
  submission_participants: SubmissionParticipant[]
}

interface QueueReview {
  id: string
  queue_entry_id: string
  score: number
  notes: string | null
  judge_id: string
  answers: ReviewAnswer[]
}

interface ReviewDraftSyncPayload {
  queueEntryId: string
  roomId: string
  scoreInput: string
  reviewNotes: string
  reviewAnswers: ReviewAnswer[]
  updatedAt: number
  userId: string
}

interface QueueEntry {
  id: string
  ticket_number: number
  room_id: string
  submission_id: string
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
  started_at: string | null
  completed_at: string | null
  submissions: Submission
  queue_reviews: QueueReview[]
}

interface RoomOption {
  id: string
  name: string
  room_judges: { judge_id: string }[]
  room_challenges: {
    challenge_id: string
    challenges: {
      id: string
      title: string
      keyword: string
      questions: ChallengeQuestion[]
    }
  }[]
}

interface RoomQueueState {
  room_id: string
  is_ready: boolean
  is_paused: boolean
  started_at: string | null
  buffer_target: number
  desired_minutes_per_team: number
}

type QueueBlockReasonType =
  | "presenting"
  | "buffered"
  | "member_busy"
  | "cooldown"

interface QueueBlockReason {
  type: QueueBlockReasonType
  message: string
  roomName: string | null
  remainingSeconds: number | null
}

interface PendingBufferCall {
  entryId: string
  reason: QueueBlockReason
}

interface PendingDisqualification {
  entryId: string
  teamNumber: number
  teamTitle: string
}

interface QueueSettings {
  handoff_buffer_minutes: number
  schedule_start_at: string | null
  schedule_end_at: string | null
}

interface SharedPoolQueueEntry {
  id: string
  ticket_number: number
  room_id: string
  submission_id: string
  status: QueueEntry["status"]
  call_attempts: number
  priority: number
  created_at: string
  called_at: string | null
  started_at: string | null
  completed_at: string | null
  submissions: Submission
  queue_reviews: QueueReview[]
}

interface ReviewDraft {
  scoreInput: string
  reviewNotes: string
  reviewAnswers: ReviewAnswer[]
  updatedAt: number
}

interface DiscordEmbedField {
  name: string
  value: string
  inline?: boolean
}

interface DiscordEmbedPayload {
  title: string
  description?: string
  color?: number
  fields?: DiscordEmbedField[]
  footer?: {
    text: string
  }
}

function formatTimeNoSeconds(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  })
}

function formatMinutesToHm(totalMinutes: number): string {
  if (totalMinutes > 0 && totalMinutes < 1) return "< 1 min"
  const minutes = Math.max(0, Math.round(totalMinutes))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`
}

function calculateMaxMinutesPerTeam(
  availableMinutes: number | null,
  teamsCount: number,
  parallelRooms: number
): number | null {
  if (availableMinutes === null || teamsCount <= 0) return null
  if (!Number.isFinite(availableMinutes) || availableMinutes <= 0) return null

  const safeParallelRooms = Math.max(1, Math.floor(parallelRooms))
  return (availableMinutes * safeParallelRooms) / teamsCount
}

function formatDigitalDurationFromSeconds(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

function normalizeKeyword(value: string): string {
  return value.trim().toUpperCase()
}

function getRoomChallengeKeywords(room: RoomOption | undefined): string[] {
  if (!room) return []

  const keywords = room.room_challenges
    .map((item) => normalizeKeyword(item.challenges.keyword))
    .filter(Boolean)

  return Array.from(new Set(keywords))
}

function roomsShareQueuePool(
  a: RoomOption | undefined,
  b: RoomOption | undefined
): boolean {
  if (!a || !b) return false
  if (a.id === b.id) return true

  const aKeywords = getRoomChallengeKeywords(a)
  const bKeywords = getRoomChallengeKeywords(b)

  if (aKeywords.length === 0 || bKeywords.length === 0) return false

  return aKeywords.some((keyword) => bKeywords.includes(keyword))
}

function isSubmissionEligibleForRoom(
  submission: Submission,
  room: RoomOption | undefined
): boolean {
  if (!room) return false

  const roomKeywords = room.room_challenges
    .map((item) => normalizeKeyword(item.challenges.keyword))
    .filter(Boolean)

  if (roomKeywords.length === 0) return true
  if (roomKeywords.includes("GENERAL")) return true

  const submissionPrizes = submission.prizes.map(normalizeKeyword)
  return roomKeywords.some((keyword) => submissionPrizes.includes(keyword))
}

function normalizeSubmission(raw: {
  id: string
  number: number
  title: string | null
  devpost_url: string
  repo_url: string | null
  demo_url: string | null
  video_url: string | null
  prizes: string[] | null
  submission_participants: Array<{
    participant_id: string
    participants:
      | {
          id: string
          first_name: string | null
          last_name: string | null
          email: string
        }
      | {
          id: string
          first_name: string | null
          last_name: string | null
          email: string
        }[]
      | null
  }> | null
}): Submission {
  return {
    id: raw.id,
    number: raw.number,
    title: raw.title,
    devpost_url: raw.devpost_url,
    repo_url: raw.repo_url,
    demo_url: raw.demo_url,
    video_url: raw.video_url,
    prizes: raw.prizes || [],
    submission_participants: (raw.submission_participants || [])
      .map((participantRow) => {
        const participant = Array.isArray(participantRow.participants)
          ? participantRow.participants[0]
          : participantRow.participants

        if (!participant) return null

        return {
          participant_id: participantRow.participant_id,
          participants: participant
        }
      })
      .filter((value): value is SubmissionParticipant => value !== null)
  }
}

function normalizeReviewAnswers(raw: unknown): ReviewAnswer[] {
  if (Array.isArray(raw)) return raw as ReviewAnswer[]
  if (!raw) return []
  return [raw as ReviewAnswer]
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
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error
  }

  return "Unknown error"
}

function extractErrorDebugPayload(error: unknown): string {
  if (error === null || error === undefined) return ""

  if (typeof error === "object") {
    try {
      const serializable = Object.getOwnPropertyNames(error as object).reduce<
        Record<string, unknown>
      >((accumulator, key) => {
        accumulator[key] = (error as Record<string, unknown>)[key]
        return accumulator
      }, {})
      const asJson = JSON.stringify(serializable)
      return asJson === "{}" ? "" : asJson
    } catch {
      return ""
    }
  }

  return String(error)
}

function normalizeQueueReviews(raw: unknown): QueueReview[] {
  const reviews = Array.isArray(raw) ? raw : raw ? [raw] : []

  return reviews.map((rawReview) => {
    const review = rawReview as QueueReview
    return {
      ...review,
      answers: normalizeReviewAnswers(review.answers)
    }
  })
}

function _getDiscordHandleFromParticipant(
  participant: SubmissionParticipant["participants"]
): string | null {
  const value =
    participant.discord_username ||
    participant.discord_user ||
    participant.discord ||
    null

  if (!value) return null

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export default function QueuesPage() {
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [nowMs, setNowMs] = useState<number | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [role, setRole] = useState<Role>(null)
  const [allRooms, setAllRooms] = useState<RoomOption[]>([])
  const [rooms, setRooms] = useState<RoomOption[]>([])
  const [selectedRoomId, setSelectedRoomId] = useState<string>("")
  const [entries, setEntries] = useState<QueueEntry[]>([])
  const [sharedPoolEntries, setSharedPoolEntries] = useState<
    SharedPoolQueueEntry[]
  >([])
  const [roomQueueStateByRoom, setRoomQueueStateByRoom] = useState<
    Record<string, RoomQueueState>
  >({})
  const [allSubmissions, setAllSubmissions] = useState<Submission[]>([])
  const [handoffBufferMinutes, setHandoffBufferMinutes] = useState(5)

  const [showCallGroupDialog, setShowCallGroupDialog] = useState(false)
  const [showReviewedDialog, setShowReviewedDialog] = useState(false)
  const [_reviewedEditMode, setReviewedEditMode] = useState(false)
  const [reviewedEditScore, _setReviewedEditScore] = useState("0")
  const [reviewedEditNotes, _setReviewedEditNotes] = useState("")
  const [reviewedEditAnswers, _setReviewedEditAnswers] = useState<
    ReviewAnswer[]
  >([])
  const [_isSavingReviewedEdit, setIsSavingReviewedEdit] = useState(false)
  const [isExportingReviews, setIsExportingReviews] = useState(false)
  const [groupSearch, setGroupSearch] = useState("")
  const [reviewedSearch, setReviewedSearch] = useState("")
  const [reviewedScope, setReviewedScope] = useState<"room" | "challenge">(
    "room"
  )
  const [reviewedSort, setReviewedSort] = useState<
    "recent" | "score_desc" | "score_asc" | "team_asc"
  >("recent")
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string>("")
  const [priorityInput, setPriorityInput] = useState("5")
  const [actionBusy, setActionBusy] = useState(false)

  const [scoreInput, setScoreInput] = useState("0")
  const [reviewNotes, setReviewNotes] = useState("")
  const [reviewAnswers, setReviewAnswers] = useState<ReviewAnswer[]>([])
  const [reviewDraftsByEntry, setReviewDraftsByEntry] = useState<
    Record<string, ReviewDraft>
  >({})
  const [minReviewedScore, setMinReviewedScore] = useState("0")
  const [selectedReviewedEntryId, setSelectedReviewedEntryId] = useState("")
  const [pendingBufferCall, setPendingBufferCall] =
    useState<PendingBufferCall | null>(null)
  const [forceBufferConfirmed, setForceBufferConfirmed] = useState(false)
  const [pendingDisqualification, setPendingDisqualification] =
    useState<PendingDisqualification | null>(null)
  const [desiredMinutesInput, setDesiredMinutesInput] = useState(
    String(DEFAULT_DESIRED_MINUTES_PER_TEAM)
  )
  const [globalScheduleStartAt, setGlobalScheduleStartAt] = useState<
    string | null
  >(null)
  const [globalScheduleEndAt, setGlobalScheduleEndAt] = useState<string | null>(
    null
  )
  const [showProjectDialog, setShowProjectDialog] = useState(false)
  const [projectDialogSubmission, setProjectDialogSubmission] =
    useState<Submission | null>(null)
  const [waitingBlockersByEntryId, setWaitingBlockersByEntryId] = useState<
    Record<string, QueueBlockReason>
  >({})

  const autoBufferSyncRef = useRef(false)
  const queueGenerationRef = useRef(false)
  const activeReviewEntryRef = useRef<QueueEntry | null>(null)
  const reviewDraftsRef = useRef<Record<string, ReviewDraft>>({})
  const reviewDraftSyncChannelRef = useRef<ReturnType<
    typeof supabase.channel
  > | null>(null)
  const applyingRemoteReviewDraftRef = useRef(false)
  const notifiedNearTopEntryIdsRef = useRef<Set<string>>(new Set())
  // Tracks which rooms have had their first fetch, to avoid notifying entries
  // that were already in the top N when the dashboard was opened.
  const initializedRoomsRef = useRef<Set<string>>(new Set())
  // Prevents concurrent fetchQueue calls from racing and sending duplicate notifications.
  const isFetchingQueueRef = useRef(false)

  const sendDiscordViaApi = useCallback(
    async ({
      message,
      participants,
      submissionId,
      embed
    }: {
      message: string
      participants?: string[]
      submissionId?: string
      embed?: DiscordEmbedPayload
    }) => {
      const response = await fetch("/api/discord/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message,
          participants,
          submissionId,
          embed
        })
      })

      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          typeof body?.error === "string" ? body.error : "Discord send failed"
        )
      }

      return body as { ok: boolean; sent?: boolean; count?: number }
    },
    []
  )

  const buildDiscordNotificationPayload = useCallback(
    (
      event: "queue_near_top" | "entered_buffer",
      payload: Record<string, unknown>
    ) => {
      const roomId = typeof payload.roomId === "string" ? payload.roomId : null
      const fallbackContext = {
        roomScopeLabel: "the assigned room",
        specificRoomName: "the assigned room",
        challengeLabel: "the assigned challenge",
        parallelRoomCount: 1,
        desiredMinutesPerTeam: DEFAULT_DESIRED_MINUTES_PER_TEAM
      }

      const context = (() => {
        if (!roomId) return fallbackContext

        const baseRoom = allRooms.find((room) => room.id === roomId)
        if (!baseRoom) return fallbackContext

        const poolRooms = allRooms
          .filter((room) => roomsShareQueuePool(baseRoom, room))
          .sort((a, b) => a.name.localeCompare(b.name))

        const roomNames = poolRooms.map((room) => room.name)
        const roomScopeLabel =
          roomNames.length <= 1
            ? roomNames[0] || fallbackContext.roomScopeLabel
            : roomNames.join(" / ")

        const challengeTitles = Array.from(
          new Set(
            poolRooms
              .flatMap((room) =>
                room.room_challenges
                  .map((item) => item.challenges.title?.trim() || "")
                  .filter(Boolean)
              )
              .filter(Boolean)
          )
        )

        const challengeLabel =
          challengeTitles.length > 0
            ? challengeTitles.join(" / ")
            : fallbackContext.challengeLabel

        const readyRoomCount = poolRooms.filter(
          (room) => roomQueueStateByRoom[room.id]?.is_ready
        ).length
        const parallelRoomCount = Math.max(1, readyRoomCount)
        const desiredMinutesPerTeam = Math.max(
          1,
          roomQueueStateByRoom[roomId]?.desired_minutes_per_team ??
            DEFAULT_DESIRED_MINUTES_PER_TEAM
        )

        return {
          roomScopeLabel,
          specificRoomName: baseRoom.name || fallbackContext.specificRoomName,
          challengeLabel,
          parallelRoomCount,
          desiredMinutesPerTeam
        }
      })()

      const teamNumberRaw =
        typeof payload.teamNumber === "number"
          ? payload.teamNumber
          : Number(payload.teamNumber)
      const teamNumber =
        Number.isFinite(teamNumberRaw) && teamNumberRaw > 0
          ? Math.floor(teamNumberRaw)
          : null
      const teamTitle =
        typeof payload.teamTitle === "string" && payload.teamTitle.trim().length
          ? payload.teamTitle.trim()
          : null
      const teamLabel = teamNumber
        ? `#${teamNumber}${teamTitle ? ` · ${teamTitle}` : ""}`
        : teamTitle || "sin número"
      const safeChallenge = context.challengeLabel || "Assigned challenge"
      const safeRoomScope = context.roomScopeLabel || "assigned room"

      const baseFields: DiscordEmbedField[] = [
        {
          name: "Team",
          value: `**${teamLabel}**`,
          inline: true
        },
        {
          name: "Challenge",
          value: `**${safeChallenge}**`,
          inline: true
        },
        {
          name: context.parallelRoomCount > 1 ? "Possible rooms" : "Room",
          value: `\`\`\`txt\n${safeRoomScope}\n\`\`\``,
          inline: false
        }
      ]

      if (event === "queue_near_top") {
        const queuePositionRaw =
          typeof payload.queuePosition === "number"
            ? payload.queuePosition
            : Number(payload.queuePosition)
        const queuePosition =
          Number.isFinite(queuePositionRaw) && queuePositionRaw > 0
            ? Math.floor(queuePositionRaw)
            : 1

        const etaMinutes = Math.max(
          1,
          Math.round(
            (queuePosition * context.desiredMinutesPerTeam) /
              context.parallelRoomCount
          )
        )

        return {
          message: `Queue alert for ${teamLabel}: position ${queuePosition}, ETA ${formatMinutesToHm(etaMinutes)}.`,
          embed: {
            title: "⏳ Upcoming turn",
            description: "Your team is getting close to presentation time.",
            color: 0xf59e0b,
            fields: [
              ...baseFields,
              {
                name: "Queue position",
                value: `**#${queuePosition}**`,
                inline: true
              },
              {
                name: "Estimated ETA",
                value: `**${formatMinutesToHm(etaMinutes)}**`,
                inline: true
              },
              {
                name: "Next step",
                value:
                  "```txt\nStart getting your team ready and head to floor 3.\n```",
                inline: false
              }
            ],
            footer: {
              text: "FastTrack · Automatic notification"
            }
          }
        }
      }

      // entered_buffer: show the SPECIFIC room the team is assigned to, not the pool.
      const specificRoom = context.specificRoomName || safeRoomScope
      return {
        message: `Buffer alert for ${teamLabel}: head to room ${specificRoom}.`,
        embed: {
          title: "📣 Team called to buffer",
          description: "Your team is in the final stage before presenting.",
          color: 0x2563eb,
          fields: [
            {
              name: "Team",
              value: `**${teamLabel}**`,
              inline: true
            },
            {
              name: "Challenge",
              value: `**${safeChallenge}**`,
              inline: true
            },
            {
              name: "Your room",
              value: `\`\`\`txt\n${specificRoom}\n\`\`\``,
              inline: false
            },
            {
              name: "Instruction",
              value:
                "```txt\nPlease wait at the room door until you are called in.\n```",
              inline: false
            }
          ],
          footer: {
            text: "FastTrack · Automatic notification"
          }
        }
      }
    },
    [allRooms, roomQueueStateByRoom]
  )

  const sendQueueDiscordNotification = useCallback(
    async (
      event: "queue_near_top" | "entered_buffer",
      payload: Record<string, unknown>
    ) => {
      const submissionId =
        typeof payload.submissionId === "string" ? payload.submissionId : null

      if (!submissionId) {
        console.warn(
          `[NOTIFICATION_HOOK][DISCORD][${event}] Missing submissionId`,
          payload
        )
        return
      }

      try {
        const { message, embed } = buildDiscordNotificationPayload(
          event,
          payload
        )
        const result = await sendDiscordViaApi({
          message,
          submissionId,
          embed
        })

        console.log(
          `[NOTIFICATION_HOOK][DISCORD][${event}] Mensaje enviado`,
          result
        )
      } catch (error) {
        console.error(
          `[NOTIFICATION_HOOK][DISCORD][${event}] Error enviando mensaje`,
          error
        )
      }
    },
    [buildDiscordNotificationPayload, sendDiscordViaApi]
  )

  const logNotificationHook = useCallback(
    (
      event: "queue_near_top" | "entered_buffer",
      payload: Record<string, unknown>
    ) => {
      switch (event) {
        case "queue_near_top":
          void sendQueueDiscordNotification(event, payload)
          console.log(
            "[NOTIFICATION_HOOK][EMAIL][queue_near_top] AQUÍ VA LA LLAMADA A LA FUNCIÓN DE EMAIL",
            payload
          )
          break
        case "entered_buffer":
          void sendQueueDiscordNotification(event, payload)
          console.log(
            "[NOTIFICATION_HOOK][EMAIL][entered_buffer] AQUÍ VA LA LLAMADA A LA FUNCIÓN DE EMAIL",
            payload
          )
          break
        default:
          console.log("[NOTIFICATION_HOOK] Unknown event", { event, payload })
      }
    },
    [sendQueueDiscordNotification]
  )

  const fetchBase = useCallback(async () => {
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user) {
      setLoading(false)
      return
    }

    setUserId(user.id)

    const [
      { data: profileData },
      roomsResult,
      submissionsResult,
      roomStateResult,
      queueSettingsResult
    ] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", user.id).single(),
      supabase
        .from("rooms")
        .select(
          "id, name, room_judges(judge_id), room_challenges(challenge_id, challenges(id, title, keyword, questions))"
        )
        .order("name"),
      supabase
        .from("submissions")
        .select(
          "id, number, title, devpost_url, repo_url, demo_url, video_url, prizes, submission_participants(participant_id, participants(id, first_name, last_name, email))"
        )
        .order("number"),
      supabase
        .from("room_queue_state")
        .select(
          "room_id, is_ready, is_paused, started_at, buffer_target, desired_minutes_per_team"
        ),
      supabase.from("queue_settings").select("*").eq("id", true).single()
    ])

    const currentRole = (profileData?.role as Role) ?? null
    setRole(currentRole)

    const rawRooms =
      (roomsResult.data as unknown as Array<{
        id: string
        name: string
        room_judges: Array<{ judge_id: string }>
        room_challenges: Array<{
          challenge_id: string
          challenges:
            | {
                id: string
                title: string
                keyword: string
                questions: ChallengeQuestion[] | null
              }
            | {
                id: string
                title: string
                keyword: string
                questions: ChallengeQuestion[] | null
              }[]
            | null
        }>
      }>) || []

    const fetchedRooms: RoomOption[] = rawRooms.map((room) => ({
      id: room.id,
      name: room.name,
      room_judges: room.room_judges || [],
      room_challenges: (room.room_challenges || [])
        .map((item) => {
          const challenge = Array.isArray(item.challenges)
            ? item.challenges[0]
            : item.challenges

          if (!challenge) return null

          return {
            challenge_id: item.challenge_id,
            challenges: {
              ...challenge,
              questions: challenge.questions || []
            }
          }
        })
        .filter(
          (
            value
          ): value is {
            challenge_id: string
            challenges: {
              id: string
              title: string
              keyword: string
              questions: ChallengeQuestion[]
            }
          } => value !== null
        )
    }))
    const visibleRooms =
      currentRole === "admin"
        ? fetchedRooms
        : fetchedRooms.filter((room) =>
            room.room_judges.some((judge) => judge.judge_id === user.id)
          )

    setAllRooms(fetchedRooms)

    const roomStateRows =
      (roomStateResult.data as RoomQueueState[] | null)?.filter(Boolean) || []
    const roomStateMap: Record<string, RoomQueueState> = {}
    roomStateRows.forEach((row) => {
      roomStateMap[row.room_id] = {
        ...row,
        buffer_target: row.buffer_target ?? DEFAULT_BUFFER_TARGET,
        desired_minutes_per_team:
          row.desired_minutes_per_team ?? DEFAULT_DESIRED_MINUTES_PER_TEAM
      }
    })

    visibleRooms.forEach((room) => {
      if (roomStateMap[room.id]) return
      roomStateMap[room.id] = {
        room_id: room.id,
        is_ready: false,
        is_paused: true,
        started_at: null,
        buffer_target: DEFAULT_BUFFER_TARGET,
        desired_minutes_per_team: DEFAULT_DESIRED_MINUTES_PER_TEAM
      }
    })
    setRoomQueueStateByRoom(roomStateMap)

    if (!queueSettingsResult.error && queueSettingsResult.data) {
      const queueSettings = queueSettingsResult.data as QueueSettings
      setHandoffBufferMinutes(queueSettings.handoff_buffer_minutes ?? 5)
      setGlobalScheduleStartAt(queueSettings.schedule_start_at ?? null)
      setGlobalScheduleEndAt(queueSettings.schedule_end_at ?? null)
    } else {
      setGlobalScheduleStartAt(null)
      setGlobalScheduleEndAt(null)
    }

    setRooms(visibleRooms)

    if (visibleRooms.length > 0) {
      setSelectedRoomId((prev) => {
        if (prev && visibleRooms.some((room) => room.id === prev)) return prev

        if (typeof window !== "undefined") {
          const rememberedRoomId = window.localStorage.getItem(
            LAST_SELECTED_ROOM_KEY
          )
          if (
            rememberedRoomId &&
            visibleRooms.some((room) => room.id === rememberedRoomId)
          ) {
            return rememberedRoomId
          }
        }

        return visibleRooms[0].id
      })
    }

    const rawSubmissions =
      (submissionsResult.data as unknown as Array<{
        id: string
        number: number
        title: string | null
        devpost_url: string
        repo_url: string | null
        demo_url: string | null
        video_url: string | null
        prizes: string[] | null
        submission_participants: Array<{
          participant_id: string
          participants:
            | {
                id: string
                first_name: string | null
                last_name: string | null
                email: string
              }
            | {
                id: string
                first_name: string | null
                last_name: string | null
                email: string
              }[]
            | null
        }> | null
      }>) || []

    setAllSubmissions(rawSubmissions.map(normalizeSubmission))
  }, [supabase])

  const fetchQueue = useCallback(
    async (roomId: string) => {
      if (isFetchingQueueRef.current) return
      isFetchingQueueRef.current = true
      const withAttemptsSelect =
        "id, ticket_number, room_id, submission_id, status, call_attempts, priority, created_at, called_at, started_at, completed_at, submissions(id, number, title, devpost_url, repo_url, demo_url, video_url, prizes, submission_participants(participant_id, participants(id, first_name, last_name, email))), queue_reviews(id, queue_entry_id, score, notes, judge_id, answers)"
      const legacySelect =
        "id, ticket_number, room_id, submission_id, status, priority, created_at, called_at, started_at, completed_at, submissions(id, number, title, devpost_url, repo_url, demo_url, video_url, prizes, submission_participants(participant_id, participants(id, first_name, last_name, email))), queue_reviews(id, queue_entry_id, score, notes, judge_id, answers)"

      let data: unknown[] | null = null
      let error: { message: string } | null = null
      let usedLegacySelect = false

      const withAttemptsResult = await supabase
        .from("queue_entries")
        .select(withAttemptsSelect)
        .eq("room_id", roomId)

      if (withAttemptsResult.error) {
        const maybeColumnMissing =
          withAttemptsResult.error.message
            .toLowerCase()
            .includes("call_attempts") ||
          withAttemptsResult.error.message.toLowerCase().includes("column")

        if (maybeColumnMissing) {
          const legacyResult = await supabase
            .from("queue_entries")
            .select(legacySelect)
            .eq("room_id", roomId)

          data = legacyResult.data
          error = legacyResult.error as { message: string } | null
          usedLegacySelect = true
        } else {
          data = withAttemptsResult.data
          error = withAttemptsResult.error as { message: string } | null
        }
      } else {
        data = withAttemptsResult.data
        error = null
      }

      if (error) {
        toast.error("Failed to fetch queue data")
        isFetchingQueueRef.current = false
        return
      }

      const rawQueueEntries =
        (data as unknown as Array<{
          id: string
          ticket_number: number
          room_id: string
          submission_id: string
          status:
            | "waiting"
            | "called"
            | "in_progress"
            | "completed"
            | "skipped"
            | "cancelled"
          call_attempts?: number
          priority: number
          created_at: string
          called_at: string | null
          started_at: string | null
          completed_at: string | null
          submissions: {
            id: string
            number: number
            title: string | null
            devpost_url: string
            repo_url: string | null
            demo_url: string | null
            video_url: string | null
            prizes: string[] | null
            submission_participants: Array<{
              participant_id: string
              participants:
                | {
                    id: string
                    first_name: string | null
                    last_name: string | null
                    email: string
                  }
                | {
                    id: string
                    first_name: string | null
                    last_name: string | null
                    email: string
                  }[]
                | null
            }> | null
          }
          queue_reviews: Array<{
            id: string
            queue_entry_id: string
            score: number
            notes: string | null
            judge_id: string
            answers: ReviewAnswer[] | null
          }> | null
        }>) || []

      const queueEntries: QueueEntry[] = rawQueueEntries.map((entry) => ({
        id: entry.id,
        ticket_number: entry.ticket_number,
        room_id: entry.room_id,
        submission_id: entry.submission_id,
        status: entry.status,
        call_attempts: usedLegacySelect ? 0 : entry.call_attempts || 0,
        priority: entry.priority,
        created_at: entry.created_at,
        called_at: entry.called_at,
        started_at: entry.started_at,
        completed_at: entry.completed_at,
        submissions: normalizeSubmission(entry.submissions),
        queue_reviews: normalizeQueueReviews(entry.queue_reviews)
      }))

      const sortedQueueEntries = queueEntries.sort((a, b) => {
        if (a.status === "waiting" && b.status === "waiting") {
          if (a.priority !== b.priority) return b.priority - a.priority
          return (
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          )
        }
        return (
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
      })

      const nearTopWaitingEntries = sortedQueueEntries
        .filter((entry) => entry.status === "waiting")
        .slice(0, NOTIFICATION_TOP_QUEUE_THRESHOLD)

      const nextNearTopEntryIds = new Set(
        nearTopWaitingEntries.map((entry) => entry.id)
      )

      // On the very first fetch for this room, silently populate the notified set
      // so we don't spam everyone who was already near the top when the page loaded.
      const isInitialLoad = !initializedRoomsRef.current.has(roomId)
      // Mark the room as initialized immediately (before the loop) so that a
      // concurrent fetch racing us also treats this as a subsequent fetch.
      initializedRoomsRef.current.add(roomId)

      nearTopWaitingEntries.forEach((entry, index) => {
        if (
          !isInitialLoad &&
          !notifiedNearTopEntryIdsRef.current.has(entry.id)
        ) {
          // Mark as notified immediately (before the async call) to prevent a
          // concurrent fetchQueue from sending the same notification twice.
          notifiedNearTopEntryIdsRef.current.add(entry.id)
          logNotificationHook("queue_near_top", {
            roomId,
            queueEntryId: entry.id,
            submissionId: entry.submission_id,
            teamNumber: entry.submissions.number,
            teamTitle: entry.submissions.title,
            queuePosition: index + 1,
            threshold: NOTIFICATION_TOP_QUEUE_THRESHOLD
          })
        }
      })

      notifiedNearTopEntryIdsRef.current = nextNearTopEntryIds

      setEntries(sortedQueueEntries)

      const baseRoom = allRooms.find((room) => room.id === roomId)
      const poolRoomIds = allRooms
        .filter((room) => roomsShareQueuePool(baseRoom, room))
        .map((room) => room.id)

      if (poolRoomIds.length === 0) {
        setSharedPoolEntries([])
        isFetchingQueueRef.current = false
        return
      }

      const { data: sharedData, error: sharedError } = await supabase
        .from("queue_entries")
        .select(
          "id, ticket_number, room_id, submission_id, status, priority, call_attempts, created_at, called_at, started_at, completed_at, submissions(id, number, title, devpost_url, repo_url, demo_url, video_url, prizes, submission_participants(participant_id, participants(id, first_name, last_name, email))), queue_reviews(id, queue_entry_id, score, notes, judge_id, answers)"
        )
        .in("room_id", poolRoomIds)
        .neq("status", "cancelled")

      if (sharedError || !sharedData) {
        setSharedPoolEntries([])
        isFetchingQueueRef.current = false
        return
      }

      setSharedPoolEntries(
        sharedData.map((entry) => {
          const submissionRelation = Array.isArray(entry.submissions)
            ? entry.submissions[0]
            : entry.submissions

          return {
            id: entry.id as string,
            ticket_number: Number(entry.ticket_number || 0),
            room_id: entry.room_id as string,
            submission_id: entry.submission_id as string,
            status: entry.status as QueueEntry["status"],
            call_attempts: Number(entry.call_attempts || 0),
            priority: entry.priority as number,
            created_at: entry.created_at as string,
            called_at: (entry.called_at as string | null) || null,
            started_at: (entry.started_at as string | null) || null,
            completed_at: (entry.completed_at as string | null) || null,
            submissions: normalizeSubmission(
              submissionRelation as Parameters<typeof normalizeSubmission>[0]
            ),
            queue_reviews: normalizeQueueReviews(entry.queue_reviews)
          }
        })
      )
      isFetchingQueueRef.current = false
    },
    [allRooms, logNotificationHook, supabase]
  )

  useEffect(() => {
    fetchBase().finally(() => setLoading(false))
  }, [fetchBase])

  useEffect(() => {
    if (!selectedRoomId) return
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LAST_SELECTED_ROOM_KEY, selectedRoomId)
    }
  }, [selectedRoomId])

  useEffect(() => {
    if (!selectedRoomId) return
    void fetchQueue(selectedRoomId)

    // 30 s is plenty: Supabase realtime already handles immediate updates.
    // A short interval was the main source of extra requests.
    const interval = setInterval(() => {
      void fetchQueue(selectedRoomId)
    }, 30000)

    return () => clearInterval(interval)
  }, [fetchQueue, selectedRoomId])

  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    setNowMs(Date.now())
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel("queue-dashboard-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "queue_entries" },
        () => {
          if (selectedRoomId) {
            void fetchQueue(selectedRoomId)
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_queue_state" },
        () => {
          void fetchBase()
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "queue_settings" },
        () => {
          void fetchBase()
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "submissions" },
        () => {
          void fetchBase()
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "queue_reviews" },
        () => {
          if (selectedRoomId) {
            void fetchQueue(selectedRoomId)
          }
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [fetchBase, fetchQueue, selectedRoomId, supabase])

  const selectedRoom = rooms.find((room) => room.id === selectedRoomId)
  const selectedRoomFromAll = allRooms.find(
    (room) => room.id === selectedRoomId
  )
  const sharedPoolRooms = useMemo(
    () =>
      allRooms
        .filter((room) => roomsShareQueuePool(selectedRoomFromAll, room))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allRooms, selectedRoomFromAll]
  )
  const isMultiRoomChallenge = sharedPoolRooms.length > 1
  const readySharedPoolRoomIds = useMemo(
    () =>
      sharedPoolRooms
        .filter((room) => roomQueueStateByRoom[room.id]?.is_ready)
        .map((room) => room.id),
    [roomQueueStateByRoom, sharedPoolRooms]
  )
  const activeSharedPoolRoomIds = useMemo(
    () =>
      sharedPoolRooms
        .filter((room) => {
          const state = roomQueueStateByRoom[room.id]
          return Boolean(state?.is_ready)
        })
        .map((room) => room.id),
    [roomQueueStateByRoom, sharedPoolRooms]
  )
  const parallelRoomCount = Math.max(1, readySharedPoolRoomIds.length)
  const sharedPoolRoomNamesLabel = useMemo(
    () => sharedPoolRooms.map((room) => room.name).join(" · "),
    [sharedPoolRooms]
  )
  const eligibleSubmissionsForSelectedRoom = useMemo(
    () =>
      allSubmissions.filter((submission) =>
        isSubmissionEligibleForRoom(submission, selectedRoom)
      ),
    [allSubmissions, selectedRoom]
  )
  const selectedRoomQueueState = selectedRoomId
    ? roomQueueStateByRoom[selectedRoomId] || null
    : null
  const roomIsReady = selectedRoomQueueState?.is_ready ?? false
  const roomBufferTarget =
    selectedRoomQueueState?.buffer_target ?? DEFAULT_BUFFER_TARGET
  const roomDesiredMinutesPerTeam =
    selectedRoomQueueState?.desired_minutes_per_team ??
    DEFAULT_DESIRED_MINUTES_PER_TEAM

  useEffect(() => {
    setDesiredMinutesInput(String(roomDesiredMinutesPerTeam))
  }, [roomDesiredMinutesPerTeam, selectedRoomId])

  const activeChallenge = selectedRoom?.room_challenges?.[0]?.challenges
  const activeQuestions = useMemo(
    () => activeChallenge?.questions || [],
    [activeChallenge?.questions]
  )

  useEffect(() => {
    if (!isMultiRoomChallenge && reviewedScope === "challenge") {
      setReviewedScope("room")
    }
  }, [isMultiRoomChallenge, reviewedScope])

  const currentEntry = useMemo(() => {
    return entries.find((entry) => entry.status === "in_progress") || null
  }, [entries])

  const bufferedEntries = useMemo(
    () =>
      entries
        .filter((entry) => entry.status === "called")
        .sort((a, b) => {
          const calledA = a.called_at
            ? new Date(a.called_at).getTime()
            : new Date(a.created_at).getTime()
          const calledB = b.called_at
            ? new Date(b.called_at).getTime()
            : new Date(b.created_at).getTime()
          return calledA - calledB
        }),
    [entries]
  )

  const waitingEntries = useMemo(
    () =>
      entries
        .filter((entry) => entry.status === "waiting")
        .sort((a, b) => {
          const aIsRequeued = a.call_attempts > 0
          const bIsRequeued = b.call_attempts > 0

          if (aIsRequeued !== bIsRequeued) {
            return aIsRequeued ? 1 : -1
          }

          if (!aIsRequeued && !bIsRequeued && a.priority !== b.priority) {
            return b.priority - a.priority
          }

          if (a.priority !== b.priority) return b.priority - a.priority
          return (
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          )
        }),
    [entries]
  )

  const sharedWaitingEntries = useMemo(
    () =>
      Array.from(
        sharedPoolEntries
          .filter((entry) => entry.status === "waiting")
          .sort((a, b) => {
            const aIsRequeued = a.call_attempts > 0
            const bIsRequeued = b.call_attempts > 0

            if (aIsRequeued !== bIsRequeued) {
              return aIsRequeued ? 1 : -1
            }

            if (!aIsRequeued && !bIsRequeued && a.priority !== b.priority) {
              return b.priority - a.priority
            }

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
          }, new Map<string, SharedPoolQueueEntry>())
          .values()
      ),
    [sharedPoolEntries]
  )

  const usesSharedQueue = sharedPoolRooms.length > 1
  const visibleWaitingEntries = usesSharedQueue
    ? sharedWaitingEntries
    : waitingEntries
  const sharedCalledCountByRoom = useMemo(() => {
    const map = new Map<string, number>()
    sharedPoolRooms.forEach((room) => map.set(room.id, 0))

    sharedPoolEntries.forEach((entry) => {
      if (entry.status !== "called") return
      map.set(entry.room_id, (map.get(entry.room_id) || 0) + 1)
    })

    return map
  }, [sharedPoolEntries, sharedPoolRooms])

  const followUpEntry = useMemo(
    () => bufferedEntries[0] || null,
    [bufferedEntries]
  )
  const lastInQueueEntry = useMemo(
    () =>
      visibleWaitingEntries.length > 0
        ? visibleWaitingEntries[visibleWaitingEntries.length - 1]
        : null,
    [visibleWaitingEntries]
  )

  const queueProgressEntries = useMemo(
    () => (usesSharedQueue ? sharedPoolEntries : entries),
    [entries, sharedPoolEntries, usesSharedQueue]
  )

  const completedEntries = entries.filter(
    (entry) => entry.status === "completed"
  )
  const completedSharedPoolEntries = useMemo(
    () => sharedPoolEntries.filter((entry) => entry.status === "completed"),
    [sharedPoolEntries]
  )

  const reviewedBaseEntries = useMemo(
    () =>
      reviewedScope === "challenge"
        ? completedSharedPoolEntries
        : completedEntries,
    [completedEntries, completedSharedPoolEntries, reviewedScope]
  )

  const getPreferredReview = useCallback(
    (
      entry: Pick<QueueEntry, "queue_reviews">,
      scope: "room" | "challenge" = reviewedScope
    ) => {
      if (scope === "challenge") {
        return entry.queue_reviews?.[0] || null
      }

      return (
        (role === "admin"
          ? entry.queue_reviews?.[0]
          : entry.queue_reviews?.find(
              (candidate) => candidate.judge_id === userId
            )) || null
      )
    },
    [reviewedScope, role, userId]
  )

  const reviewedEntries = useMemo(() => {
    const list = reviewedBaseEntries

    const minScore = Number(minReviewedScore)
    const scoreFiltered = Number.isNaN(minScore)
      ? list
      : list.filter((entry) => {
          const review = getPreferredReview(entry, reviewedScope)
          const reviewScore = review?.score ?? 0
          return reviewScore >= minScore
        })

    const term = reviewedSearch.trim().toLowerCase()
    const searchFiltered = !term
      ? scoreFiltered
      : scoreFiltered.filter((entry) => {
          const review = getPreferredReview(entry, reviewedScope)

          return (
            String(entry.submissions.number).includes(term) ||
            (entry.submissions.title || "").toLowerCase().includes(term) ||
            (review?.notes || "").toLowerCase().includes(term)
          )
        })

    return searchFiltered.sort((a, b) => {
      const review = getPreferredReview(a, reviewedScope)
      const compareReview = getPreferredReview(b, reviewedScope)

      if (reviewedSort === "score_desc") {
        return (compareReview?.score || 0) - (review?.score || 0)
      }

      if (reviewedSort === "score_asc") {
        return (review?.score || 0) - (compareReview?.score || 0)
      }

      if (reviewedSort === "team_asc") {
        return a.submissions.number - b.submissions.number
      }

      const aTs = a.completed_at ? new Date(a.completed_at).getTime() : 0
      const bTs = b.completed_at ? new Date(b.completed_at).getTime() : 0
      return bTs - aTs
    })
  }, [
    getPreferredReview,
    minReviewedScore,
    reviewedBaseEntries,
    reviewedScope,
    reviewedSearch,
    reviewedSort
  ])

  const selectedReviewedEntry = useMemo(() => {
    if (!selectedReviewedEntryId) return null
    return (
      reviewedEntries.find((entry) => entry.id === selectedReviewedEntryId) ||
      null
    )
  }, [reviewedEntries, selectedReviewedEntryId])

  useEffect(() => {
    setReviewedEditMode(false)
  }, [selectedReviewedEntryId])

  const activeReviewEntry = currentEntry || null
  const reviewingPastTeam = false
  const activeReviewEntryId = activeReviewEntry?.id || null
  const existingReviewOwnerId =
    activeReviewEntry?.queue_reviews?.[0]?.judge_id || null
  const reviewOwnedByAnotherJudge = Boolean(
    activeReviewEntry &&
    existingReviewOwnerId &&
    userId &&
    existingReviewOwnerId !== userId
  )
  const doneCount = useMemo(
    () =>
      new Set(
        queueProgressEntries
          .filter((entry) => entry.status === "completed")
          .map((entry) => entry.submission_id)
      ).size,
    [queueProgressEntries]
  )

  const totalCount = useMemo(
    () =>
      new Set(
        queueProgressEntries
          .filter((entry) => entry.status !== "cancelled")
          .map((entry) => entry.submission_id)
      ).size,
    [queueProgressEntries]
  )

  const activeSubmissionCount = useMemo(() => {
    const activeStatuses = new Set<QueueEntry["status"]>([
      "waiting",
      "called",
      "in_progress"
    ])
    return new Set(
      queueProgressEntries
        .filter((entry) => activeStatuses.has(entry.status))
        .map((entry) => entry.submission_id)
    ).size
  }, [queueProgressEntries])

  const scheduleWindowMinutes = useMemo(() => {
    if (!globalScheduleStartAt || !globalScheduleEndAt) return null
    const startMs = new Date(globalScheduleStartAt).getTime()
    const endMs = new Date(globalScheduleEndAt).getTime()
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs)
      return null
    return (endMs - startMs) / 60000
  }, [globalScheduleEndAt, globalScheduleStartAt])

  useEffect(() => {
    const channel = supabase
      .channel("queue-review-draft-sync")
      .on("broadcast", { event: "review-draft-sync" }, ({ payload }) => {
        const draft = payload as ReviewDraftSyncPayload
        if (!draft || typeof draft !== "object") return
        if (!draft.queueEntryId || !draft.userId) return
        if (!activeReviewEntryId || draft.queueEntryId !== activeReviewEntryId)
          return
        if (!selectedRoomId || draft.roomId !== selectedRoomId) return
        if (!userId || draft.userId === userId) return

        applyingRemoteReviewDraftRef.current = true
        setScoreInput(draft.scoreInput)
        setReviewNotes(draft.reviewNotes)
        setReviewAnswers(draft.reviewAnswers)
        setReviewDraftsByEntry((previous) => ({
          ...previous,
          [draft.queueEntryId]: {
            scoreInput: draft.scoreInput,
            reviewNotes: draft.reviewNotes,
            reviewAnswers: draft.reviewAnswers,
            updatedAt: draft.updatedAt
          }
        }))
      })
      .subscribe()

    reviewDraftSyncChannelRef.current = channel

    return () => {
      reviewDraftSyncChannelRef.current = null
      void supabase.removeChannel(channel)
    }
  }, [activeReviewEntryId, selectedRoomId, supabase, userId])
  const avgDurationMinutes = useMemo(() => {
    const durations = completedEntries
      .map((entry) => {
        if (!entry.started_at || !entry.completed_at) return null
        const ms =
          new Date(entry.completed_at).getTime() -
          new Date(entry.started_at).getTime()
        if (ms <= 0) return null
        return ms / 60000
      })
      .filter((value): value is number => value !== null)

    if (durations.length === 0) return 0
    return durations.reduce((acc, value) => acc + value, 0) / durations.length
  }, [completedEntries])

  const sharedPoolDurationsMinutes = useMemo(() => {
    const readyRoomIds = new Set(readySharedPoolRoomIds)
    if (readyRoomIds.size === 0) return [] as number[]

    return sharedPoolEntries
      .filter(
        (entry) =>
          readyRoomIds.has(entry.room_id) &&
          entry.status === "completed" &&
          entry.started_at &&
          entry.completed_at
      )
      .map((entry) => {
        const ms =
          new Date(entry.completed_at!).getTime() -
          new Date(entry.started_at!).getTime()
        if (ms <= 0) return null
        return ms / 60000
      })
      .filter((value): value is number => value !== null)
  }, [readySharedPoolRoomIds, sharedPoolEntries])

  const sharedPoolAvgDurationMinutes = useMemo(() => {
    if (sharedPoolDurationsMinutes.length === 0) return 0
    return (
      sharedPoolDurationsMinutes.reduce((acc, value) => acc + value, 0) /
      sharedPoolDurationsMinutes.length
    )
  }, [sharedPoolDurationsMinutes])

  const effectiveTeamsForSchedule = totalCount

  const initialMaxMinutesPerTeam = useMemo(() => {
    return calculateMaxMinutesPerTeam(
      scheduleWindowMinutes,
      effectiveTeamsForSchedule,
      parallelRoomCount
    )
  }, [effectiveTeamsForSchedule, parallelRoomCount, scheduleWindowMinutes])

  const remainingCount = activeSubmissionCount
  const configuredDesiredMinutesPerTeam =
    roomDesiredMinutesPerTeam > 0
      ? roomDesiredMinutesPerTeam
      : DEFAULT_DESIRED_MINUTES_PER_TEAM
  const estimatedRemainingTeams = remainingCount

  const scheduleRemainingMinutes = useMemo(() => {
    if (!globalScheduleEndAt || !nowMs) return null
    const endMs = new Date(globalScheduleEndAt).getTime()
    if (Number.isNaN(endMs)) return null

    const startMs = globalScheduleStartAt
      ? new Date(globalScheduleStartAt).getTime()
      : null

    const anchorMs =
      startMs !== null && Number.isFinite(startMs)
        ? Math.max(nowMs, startMs)
        : nowMs

    return Math.max(0, (endMs - anchorMs) / 60000)
  }, [globalScheduleEndAt, globalScheduleStartAt, nowMs])

  const dynamicMaxMinutesPerTeam = useMemo(() => {
    return calculateMaxMinutesPerTeam(
      scheduleRemainingMinutes,
      estimatedRemainingTeams,
      parallelRoomCount
    )
  }, [estimatedRemainingTeams, parallelRoomCount, scheduleRemainingMinutes])

  const maxMinutesPerTeam = dynamicMaxMinutesPerTeam ?? initialMaxMinutesPerTeam
  const maxMinutesPerTeamLabel = useMemo(() => {
    if (maxMinutesPerTeam === null || maxMinutesPerTeam === undefined)
      return null
    if (maxMinutesPerTeam <= 0) return "0 min"
    return formatMinutesToHm(maxMinutesPerTeam)
  }, [maxMinutesPerTeam])

  const estimatedMinutesPerTeam = useMemo(() => {
    const baselineMinutes =
      configuredDesiredMinutesPerTeam > 0
        ? configuredDesiredMinutesPerTeam
        : sharedPoolAvgDurationMinutes > 0
          ? sharedPoolAvgDurationMinutes
          : avgDurationMinutes > 0
            ? avgDurationMinutes
            : DEFAULT_DESIRED_MINUTES_PER_TEAM

    if (maxMinutesPerTeam && maxMinutesPerTeam > 0) {
      return Math.min(baselineMinutes, maxMinutesPerTeam)
    }

    return baselineMinutes
  }, [
    avgDurationMinutes,
    configuredDesiredMinutesPerTeam,
    maxMinutesPerTeam,
    sharedPoolAvgDurationMinutes
  ])

  const remainingMinutes =
    (estimatedMinutesPerTeam * estimatedRemainingTeams) / parallelRoomCount
  const estimatedEnd = new Date(
    (nowMs || Date.now()) + remainingMinutes * 60000
  )
  const desiredTimeConstrained =
    configuredDesiredMinutesPerTeam > estimatedMinutesPerTeam + 0.01

  const currentPresentationElapsedSeconds = useMemo(() => {
    if (!currentEntry?.started_at || !nowMs) return null
    const elapsed = Math.floor(
      (nowMs - new Date(currentEntry.started_at).getTime()) / 1000
    )
    return elapsed > 0 ? elapsed : 0
  }, [currentEntry?.started_at, nowMs])

  const currentPresentationElapsedLabel = useMemo(() => {
    if (currentPresentationElapsedSeconds === null) return "--:--"
    return formatDigitalDurationFromSeconds(currentPresentationElapsedSeconds)
  }, [currentPresentationElapsedSeconds])

  const paceWarningStatus = useMemo(() => {
    if (!currentEntry || currentPresentationElapsedSeconds === null) {
      return { level: "none" as const, message: "" }
    }

    const desiredMinutes =
      configuredDesiredMinutesPerTeam > 0
        ? configuredDesiredMinutesPerTeam
        : DEFAULT_DESIRED_MINUTES_PER_TEAM
    const desiredSeconds = desiredMinutes * 60
    const maxSeconds =
      maxMinutesPerTeam && maxMinutesPerTeam > 0 ? maxMinutesPerTeam * 60 : null
    const warningTargetSeconds =
      maxSeconds !== null && maxSeconds < desiredSeconds
        ? maxSeconds
        : desiredSeconds
    const elapsedPercent =
      (currentPresentationElapsedSeconds / warningTargetSeconds) * 100

    if (
      maxSeconds !== null &&
      currentPresentationElapsedSeconds >= maxSeconds * 1.2
    ) {
      return {
        level: "critical" as const,
        message: `OVER LIMIT: ${(currentPresentationElapsedSeconds / 60).toFixed(1)} min (${maxMinutesPerTeam!.toFixed(1)} min max). Close now.`
      }
    }

    if (
      maxSeconds !== null &&
      currentPresentationElapsedSeconds >= maxSeconds
    ) {
      return {
        level: "warning" as const,
        message: `Over limit: ${(currentPresentationElapsedSeconds / 60).toFixed(1)} min (${maxMinutesPerTeam!.toFixed(1)} min max). Wrap up now.`
      }
    }

    if (elapsedPercent >= 100) {
      return {
        level: "warning" as const,
        message: `Target reached: ${(currentPresentationElapsedSeconds / 60).toFixed(1)}/${(warningTargetSeconds / 60).toFixed(1)} min. Wrap up now.`
      }
    }

    if (elapsedPercent >= 85) {
      return {
        level: "caution" as const,
        message: `Approaching target: ${(currentPresentationElapsedSeconds / 60).toFixed(1)}/${(warningTargetSeconds / 60).toFixed(1)} min. Start wrapping up.`
      }
    }

    return { level: "none" as const, message: "" }
  }, [
    configuredDesiredMinutesPerTeam,
    currentEntry,
    currentPresentationElapsedSeconds,
    maxMinutesPerTeam
  ])

  const estimatedEndLabel =
    remainingCount > 0 ? formatTimeNoSeconds(estimatedEnd) : "Done"

  const roomNameById = useMemo(() => {
    const map: Record<string, string> = {}
    rooms.forEach((room) => {
      map[room.id] = room.name
    })
    return map
  }, [rooms])

  useEffect(() => {
    if (!reviewedEntries.length) {
      setSelectedReviewedEntryId("")
      return
    }

    if (
      selectedReviewedEntryId &&
      reviewedEntries.some((entry) => entry.id === selectedReviewedEntryId)
    ) {
      return
    }

    setSelectedReviewedEntryId(reviewedEntries[0]?.id || "")
  }, [reviewedEntries, selectedReviewedEntryId])

  useEffect(() => {
    activeReviewEntryRef.current = activeReviewEntry
  }, [activeReviewEntry])

  useEffect(() => {
    reviewDraftsRef.current = reviewDraftsByEntry
  }, [reviewDraftsByEntry])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const raw = window.localStorage.getItem(REVIEW_DRAFTS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Record<string, ReviewDraft>
      if (parsed && typeof parsed === "object") {
        setReviewDraftsByEntry(parsed)
      }
    } catch {
      setReviewDraftsByEntry({})
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(
      REVIEW_DRAFTS_KEY,
      JSON.stringify(reviewDraftsByEntry)
    )
  }, [reviewDraftsByEntry])

  useEffect(() => {
    if (!activeReviewEntryId) {
      setScoreInput("0")
      setReviewNotes("")
      setReviewAnswers([])
      return
    }

    const activeEntry = activeReviewEntryRef.current
    if (!activeEntry) return

    const draft = reviewDraftsRef.current[activeReviewEntryId]
    if (draft) {
      setScoreInput(draft.scoreInput)
      setReviewNotes(draft.reviewNotes)
      setReviewAnswers(draft.reviewAnswers)
      return
    }

    const existingReview = getPreferredReview(activeEntry)

    if (existingReview) {
      setScoreInput(String(existingReview.score))
      setReviewNotes(existingReview.notes || "")
      const answersByLabel = new Map(
        (existingReview.answers || []).map((answer) => [answer.label, answer])
      )

      setReviewAnswers(
        activeQuestions.map((question) => {
          const existing = answersByLabel.get(question.label)
          if (existing) return existing
          return {
            label: question.label,
            type: question.type,
            value: question.type === "boolean" ? false : null
          }
        })
      )
    } else {
      setScoreInput("0")
      setReviewNotes("")
      setReviewAnswers(
        activeQuestions.map((question) => ({
          label: question.label,
          type: question.type,
          value: question.type === "boolean" ? false : null
        }))
      )
    }
  }, [activeQuestions, activeReviewEntryId, getPreferredReview])

  useEffect(() => {
    if (!activeReviewEntryId) return

    if (applyingRemoteReviewDraftRef.current) {
      applyingRemoteReviewDraftRef.current = false
      return
    }

    setReviewDraftsByEntry((previous) => {
      const currentDraft = previous[activeReviewEntryId]
      const sameAnswers =
        JSON.stringify(currentDraft?.reviewAnswers || []) ===
        JSON.stringify(reviewAnswers)
      if (
        currentDraft &&
        currentDraft.scoreInput === scoreInput &&
        currentDraft.reviewNotes === reviewNotes &&
        sameAnswers
      ) {
        return previous
      }

      return {
        ...previous,
        [activeReviewEntryId]: {
          scoreInput,
          reviewNotes,
          reviewAnswers,
          updatedAt: Date.now()
        }
      }
    })

    const channel = reviewDraftSyncChannelRef.current
    if (!channel || !selectedRoomId || !userId) return

    const timeout = setTimeout(() => {
      void channel.send({
        type: "broadcast",
        event: "review-draft-sync",
        payload: {
          queueEntryId: activeReviewEntryId,
          roomId: selectedRoomId,
          scoreInput,
          reviewNotes,
          reviewAnswers,
          updatedAt: Date.now(),
          userId
        } satisfies ReviewDraftSyncPayload
      })
    }, 150)

    return () => clearTimeout(timeout)
  }, [
    activeReviewEntryId,
    reviewAnswers,
    reviewNotes,
    scoreInput,
    selectedRoomId,
    userId
  ])

  const saveQueueReview = useCallback(
    async ({
      queueEntryId,
      judgeId,
      score,
      notes,
      answers
    }: {
      queueEntryId: string
      judgeId: string
      score: number
      notes: string | null
      answers: ReviewAnswer[]
    }) => {
      const { data: existingReview, error: existingError } = await supabase
        .from("queue_reviews")
        .select("id, judge_id")
        .eq("queue_entry_id", queueEntryId)
        .maybeSingle()

      if (existingError) {
        return { error: existingError, readOnly: false }
      }

      if (existingReview && existingReview.judge_id !== judgeId) {
        return { error: null, readOnly: true }
      }

      if (existingReview) {
        const { error } = await supabase
          .from("queue_reviews")
          .update({
            score,
            notes,
            answers
          })
          .eq("id", existingReview.id)

        return { error, readOnly: false }
      }

      const { error } = await supabase.from("queue_reviews").insert({
        queue_entry_id: queueEntryId,
        judge_id: judgeId,
        score,
        notes,
        answers
      })

      return { error, readOnly: false }
    },
    [supabase]
  )

  const handleExportReviewsCSV = useCallback(async () => {
    setIsExportingReviews(true)
    try {
      const questions = activeChallenge?.questions ?? []
      const challengeName =
        activeChallenge?.keyword || activeChallenge?.title || "challenge"

      const headers = [
        "Challenge",
        "Number",
        "Title",
        "GitHub URL",
        "Demo URL",
        "Participants",
        "Score",
        "Notes",
        ...questions.map((q) => q.label)
      ]

      const escapeCell = (cell: string) => {
        if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
          return `"${cell.replace(/"/g, '""')}"`
        }
        return cell
      }

      const rows: string[][] = [headers]

      for (const entry of reviewedBaseEntries) {
        const review =
          reviewedScope === "challenge"
            ? entry.queue_reviews?.[0]
            : (entry.queue_reviews?.find((r) => r.judge_id === userId) ??
              entry.queue_reviews?.[0])

        const participantsStr = entry.submissions.submission_participants
          .map((sp) => {
            const p = sp.participants
            const fullName =
              [p.first_name, p.last_name].filter(Boolean).join(" ") || "\u2014"
            return `${fullName} <${p.email}>`
          })
          .join("; ")

        const answers = Array.isArray(review?.answers) ? review.answers : []

        rows.push([
          challengeName,
          String(entry.submissions.number),
          entry.submissions.title ?? "Untitled",
          entry.submissions.repo_url ?? "",
          entry.submissions.demo_url ?? "",
          participantsStr,
          review ? String(review.score) : "",
          review?.notes ?? "",
          ...questions.map((q) => {
            const ans = answers.find((a) => a.label === q.label)
            return ans ? String(ans.value ?? "") : ""
          })
        ])
      }

      const csvContent = rows
        .map((row) => row.map(escapeCell).join(","))
        .join("\n")

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${challengeName}-reviews.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success("CSV exported")
    } catch (err) {
      toast.error("Failed to export CSV")
      console.error(err)
    }
    setIsExportingReviews(false)
  }, [activeChallenge, reviewedBaseEntries, reviewedScope, userId])

  const _handleSaveReviewedEdit = useCallback(async () => {
    if (!selectedReviewedEntry || !userId) return
    setIsSavingReviewedEdit(true)
    try {
      const score = Number(reviewedEditScore)
      if (Number.isNaN(score) || score < 0 || score > 10) {
        toast.error("Score must be between 0 and 10")
        setIsSavingReviewedEdit(false)
        return
      }
      const { error, readOnly } = await saveQueueReview({
        queueEntryId: selectedReviewedEntry.id,
        judgeId: userId,
        score,
        notes: reviewedEditNotes.trim() || null,
        answers: reviewedEditAnswers
      })
      if (readOnly) {
        toast.error("This review belongs to a different judge.")
        setIsSavingReviewedEdit(false)
        return
      }
      if (error) {
        toast.error("Failed to save review")
        console.error(error)
        setIsSavingReviewedEdit(false)
        return
      }
      toast.success("Review saved")
      setReviewedEditMode(false)
    } catch (err) {
      toast.error("Failed to save review")
      console.error(err)
    }
    setIsSavingReviewedEdit(false)
  }, [
    selectedReviewedEntry,
    userId,
    reviewedEditScore,
    reviewedEditNotes,
    reviewedEditAnswers,
    saveQueueReview
  ])

  useEffect(() => {
    if (
      !activeReviewEntry ||
      !userId ||
      !scoreInput ||
      (role !== "judge" && role !== "admin")
    )
      return

    const reviewOwnedByAnother = activeReviewEntry.queue_reviews?.find(
      (review) => review.judge_id !== userId
    )
    if (reviewOwnedByAnother) return

    const timeout = setTimeout(async () => {
      const score = Number(scoreInput)
      if (Number.isNaN(score) || score < 0 || score > 10) return

      try {
        const { error, readOnly } = await saveQueueReview({
          queueEntryId: activeReviewEntry.id,
          judgeId: userId,
          score,
          notes: reviewNotes.trim() || null,
          answers: reviewAnswers
        })

        if (readOnly) return

        if (error) {
          const errorMessage = extractErrorMessage(error)
          const errorDebugPayload = extractErrorDebugPayload(error)
          console.warn(
            "Review draft autosave skipped:",
            errorMessage,
            errorDebugPayload
          )
        }
      } catch (error) {
        const errorMessage = extractErrorMessage(error)
        const errorDebugPayload = extractErrorDebugPayload(error)
        console.warn(
          "Review draft autosave error:",
          errorMessage,
          errorDebugPayload
        )
      }
    }, 3000)

    return () => clearTimeout(timeout)
  }, [
    activeReviewEntry,
    reviewAnswers,
    reviewNotes,
    role,
    saveQueueReview,
    scoreInput,
    userId
  ])

  const updateAnswer = (
    questionLabel: string,
    value: boolean | number | string | null
  ) => {
    setReviewAnswers((previous) =>
      previous.map((answer) =>
        answer.label === questionLabel ? { ...answer, value } : answer
      )
    )
  }

  const handleRefresh = async () => {
    if (!selectedRoomId) return
    setRefreshing(true)
    await fetchQueue(selectedRoomId)
    setRefreshing(false)
  }

  const upsertRoomQueueState = async (
    roomId: string,
    patch: Partial<
      Pick<
        RoomQueueState,
        "is_ready" | "is_paused" | "buffer_target" | "desired_minutes_per_team"
      >
    >
  ) => {
    const current = roomQueueStateByRoom[roomId] || {
      room_id: roomId,
      is_ready: false,
      is_paused: true,
      started_at: null,
      buffer_target: DEFAULT_BUFFER_TARGET,
      desired_minutes_per_team: DEFAULT_DESIRED_MINUTES_PER_TEAM
    }

    const nextPayload = {
      room_id: roomId,
      is_ready: patch.is_ready ?? current.is_ready,
      is_paused: patch.is_paused ?? current.is_paused,
      buffer_target:
        typeof patch.buffer_target === "number"
          ? Math.max(0, Math.floor(patch.buffer_target))
          : current.buffer_target,
      desired_minutes_per_team:
        typeof patch.desired_minutes_per_team === "number"
          ? Math.max(1, Math.floor(patch.desired_minutes_per_team))
          : current.desired_minutes_per_team
    }

    const { error } = await supabase
      .from("room_queue_state")
      .upsert(nextPayload, { onConflict: "room_id" })

    if (error) throw error

    setRoomQueueStateByRoom((previous) => ({
      ...previous,
      [roomId]: {
        room_id: roomId,
        is_ready: nextPayload.is_ready,
        is_paused: nextPayload.is_paused,
        started_at:
          previous[roomId]?.started_at ||
          (nextPayload.is_ready ? new Date().toISOString() : null),
        buffer_target: nextPayload.buffer_target,
        desired_minutes_per_team: nextPayload.desired_minutes_per_team
      }
    }))
  }

  const handleSetRoomReady = async (isReady: boolean) => {
    if (!selectedRoomId) return

    setActionBusy(true)
    try {
      await upsertRoomQueueState(selectedRoomId, {
        is_ready: isReady,
        is_paused: false
      })
      toast.success(
        isReady ? "Room marked as ready" : "Room marked as not ready"
      )
      await fetchBase()
    } catch (error) {
      console.error(error)
      toast.error("Failed to update room state")
    } finally {
      setActionBusy(false)
    }
  }

  const handleUpdateDesiredMinutes = async (nextDesiredRaw: string) => {
    if (!selectedRoomId) return

    const parsed = Number(nextDesiredRaw)
    const desiredMinutes = Number.isNaN(parsed)
      ? DEFAULT_DESIRED_MINUTES_PER_TEAM
      : Math.max(1, Math.floor(parsed))

    if (maxMinutesPerTeam && desiredMinutes > maxMinutesPerTeam) {
      const maxLabel =
        maxMinutesPerTeam <= 0
          ? "0 min/team"
          : maxMinutesPerTeam < 1
            ? "menos de 1 min/team"
            : `${formatMinutesToHm(maxMinutesPerTeam)} / team`
      toast.error(`Desired time cannot exceed current max (${maxLabel})`)
      return
    }

    setActionBusy(true)
    try {
      const targetRoomIds = Array.from(
        new Set(
          sharedPoolRooms.length > 0
            ? sharedPoolRooms.map((room) => room.id)
            : [selectedRoomId]
        )
      )

      await Promise.all(
        targetRoomIds.map((roomId) =>
          upsertRoomQueueState(roomId, {
            desired_minutes_per_team: desiredMinutes
          })
        )
      )

      toast.success(
        targetRoomIds.length > 1
          ? `Desired time updated to ${desiredMinutes} min/team in ${targetRoomIds.length} rooms`
          : `Desired time updated to ${desiredMinutes} min/team`
      )
      await fetchBase()
    } catch (error) {
      console.error(error)
      toast.error("Failed to update desired time")
    } finally {
      setActionBusy(false)
    }
  }

  const openProjectDetails = (submission: Submission) => {
    setProjectDialogSubmission(submission)
    setShowProjectDialog(true)
  }

  const getQueueBlockersBySubmission = useCallback(
    async (submissionIds: string[]) => {
      const blockers = new Map<string, QueueBlockReason>()
      if (!selectedRoomId || submissionIds.length === 0) return blockers

      const uniqueSubmissionIds = Array.from(new Set(submissionIds))

      const { data, error } = await supabase
        .from("queue_entries")
        .select("submission_id, room_id, status, completed_at")
        .in("submission_id", uniqueSubmissionIds)
        .in("status", [
          "called",
          "in_progress",
          "completed",
          "skipped",
          "cancelled"
        ])

      if (error || !data) return blockers

      data.forEach((row) => {
        const submissionId = row.submission_id as string
        const rowRoomId = row.room_id as string
        const roomName = roomNameById[rowRoomId] || null
        const status = row.status as QueueEntry["status"]

        const existing = blockers.get(submissionId)
        if (existing?.type === "presenting") return

        if (rowRoomId !== selectedRoomId && status === "in_progress") {
          blockers.set(submissionId, {
            type: "presenting",
            message: "This team is currently presenting in another room",
            roomName,
            remainingSeconds: null
          })
          return
        }

        if (existing?.type === "buffered") return
        if (rowRoomId !== selectedRoomId && status === "called") {
          blockers.set(submissionId, {
            type: "buffered",
            message: "This team is already in the buffer of another room",
            roomName,
            remainingSeconds: null
          })
          return
        }

        if (existing) return

        if (!["completed", "skipped", "cancelled"].includes(status)) return
        if (!row.completed_at) return

        const completedMs = new Date(row.completed_at).getTime()
        if (Number.isNaN(completedMs)) return
        const cooldownUntil = completedMs + handoffBufferMinutes * 60_000
        const remainingMs = cooldownUntil - Date.now()

        if (remainingMs > 0) {
          blockers.set(submissionId, {
            type: "cooldown",
            message: "This team recently presented and is still in cooldown",
            roomName,
            remainingSeconds: Math.ceil(remainingMs / 1000)
          })
        }
      })

      const { data: participantLinks, error: participantLinksError } =
        await supabase
          .from("submission_participants")
          .select("submission_id, participant_id")
          .in("submission_id", uniqueSubmissionIds)

      if (
        !participantLinksError &&
        participantLinks &&
        participantLinks.length > 0
      ) {
        const participantIds = Array.from(
          new Set(
            participantLinks
              .map((row) => row.participant_id as string)
              .filter(Boolean)
          )
        )

        if (participantIds.length > 0) {
          const {
            data: sharedParticipantLinks,
            error: sharedParticipantLinksError
          } = await supabase
            .from("submission_participants")
            .select("submission_id, participant_id")
            .in("participant_id", participantIds)

          if (!sharedParticipantLinksError && sharedParticipantLinks) {
            const participantIdsBySubmission = new Map<string, Set<string>>()
            participantLinks.forEach((row) => {
              const submissionId = row.submission_id as string
              const participantId = row.participant_id as string
              if (!submissionId || !participantId) return

              if (!participantIdsBySubmission.has(submissionId)) {
                participantIdsBySubmission.set(submissionId, new Set())
              }
              participantIdsBySubmission.get(submissionId)?.add(participantId)
            })

            const submissionIdsByParticipant = new Map<string, Set<string>>()
            sharedParticipantLinks.forEach((row) => {
              const submissionId = row.submission_id as string
              const participantId = row.participant_id as string
              if (!submissionId || !participantId) return

              if (!submissionIdsByParticipant.has(participantId)) {
                submissionIdsByParticipant.set(participantId, new Set())
              }
              submissionIdsByParticipant.get(participantId)?.add(submissionId)
            })

            const relatedSubmissionIdsBySubmission = new Map<
              string,
              Set<string>
            >()
            uniqueSubmissionIds.forEach((submissionId) => {
              const related = new Set<string>()
              const currentParticipantIds =
                participantIdsBySubmission.get(submissionId)
              if (!currentParticipantIds) {
                relatedSubmissionIdsBySubmission.set(submissionId, related)
                return
              }

              currentParticipantIds.forEach((participantId) => {
                const submissionIdsForParticipant =
                  submissionIdsByParticipant.get(participantId)
                if (!submissionIdsForParticipant) return

                submissionIdsForParticipant.forEach((relatedSubmissionId) => {
                  if (relatedSubmissionId !== submissionId) {
                    related.add(relatedSubmissionId)
                  }
                })
              })

              relatedSubmissionIdsBySubmission.set(submissionId, related)
            })

            const relatedSubmissionIds = Array.from(
              new Set(
                Array.from(relatedSubmissionIdsBySubmission.values()).flatMap(
                  (ids) => Array.from(ids)
                )
              )
            )

            if (relatedSubmissionIds.length > 0) {
              const {
                data: relatedActiveEntries,
                error: relatedActiveEntriesError
              } = await supabase
                .from("queue_entries")
                .select("submission_id, room_id, status")
                .in("submission_id", relatedSubmissionIds)
                .in("status", ["called", "in_progress"])

              if (!relatedActiveEntriesError && relatedActiveEntries) {
                const activeEntriesBySubmission = new Map<
                  string,
                  Array<{
                    submission_id: string
                    room_id: string
                    status: QueueEntry["status"]
                  }>
                >()

                relatedActiveEntries.forEach((row) => {
                  const submissionId = row.submission_id as string
                  const roomId = row.room_id as string
                  const status = row.status as QueueEntry["status"]
                  if (!submissionId || !roomId) return

                  if (!activeEntriesBySubmission.has(submissionId)) {
                    activeEntriesBySubmission.set(submissionId, [])
                  }

                  activeEntriesBySubmission.get(submissionId)?.push({
                    submission_id: submissionId,
                    room_id: roomId,
                    status
                  })
                })

                uniqueSubmissionIds.forEach((submissionId) => {
                  if (blockers.has(submissionId)) return

                  const relatedIds =
                    relatedSubmissionIdsBySubmission.get(submissionId)
                  if (!relatedIds || relatedIds.size === 0) return

                  const conflict = Array.from(relatedIds)
                    .flatMap(
                      (relatedId) =>
                        activeEntriesBySubmission.get(relatedId) || []
                    )
                    .find((entry) => entry.room_id !== selectedRoomId)

                  if (!conflict) return

                  blockers.set(submissionId, {
                    type: "member_busy",
                    message:
                      "A member of this team is already in buffer or presenting in another room",
                    roomName: roomNameById[conflict.room_id] || null,
                    remainingSeconds: null
                  })
                })
              }
            }
          }
        }
      }

      return blockers
    },
    [handoffBufferMinutes, roomNameById, selectedRoomId, supabase]
  )

  const callEntryToBuffer = useCallback(
    async (
      entry: Pick<QueueEntry, "id" | "call_attempts"> & {
        submission_id?: string
      },
      options?: { allowCooldownOverride?: boolean; targetRoomId?: string }
    ) => {
      const allowCooldownOverride = options?.allowCooldownOverride === true
      const requestedTargetRoomId = options?.targetRoomId
      let submissionId = entry.submission_id

      if (!submissionId) {
        const lookupResult = await supabase
          .from("queue_entries")
          .select("submission_id")
          .eq("id", entry.id)
          .single()

        if (lookupResult.error || !lookupResult.data?.submission_id) {
          throw lookupResult.error || new Error("Unable to verify queue entry")
        }

        submissionId = lookupResult.data.submission_id
      }

      if (!submissionId) {
        throw new Error("Unable to resolve submission for queue entry")
      }

      const submissionMeta =
        allSubmissions.find((submission) => submission.id === submissionId) ||
        null

      const blockers = await getQueueBlockersBySubmission([submissionId])
      const blocker = blockers.get(submissionId)
      if (blocker) {
        const isCooldownOverridden =
          blocker.type === "cooldown" && allowCooldownOverride
        if (!isCooldownOverridden) {
          throw new Error(
            blocker.roomName
              ? `${blocker.message} (${blocker.roomName})`
              : blocker.message
          )
        }
      }

      const resolvedTargetRoomId =
        usesSharedQueue && activeSharedPoolRoomIds.length > 0
          ? requestedTargetRoomId &&
            activeSharedPoolRoomIds.includes(requestedTargetRoomId)
            ? requestedTargetRoomId
            : (() => {
                const roomIds = activeSharedPoolRoomIds
                const ranked = roomIds
                  .map((roomId) => {
                    const state = roomQueueStateByRoom[roomId]
                    const target = Math.max(
                      0,
                      state?.buffer_target ?? DEFAULT_BUFFER_TARGET
                    )
                    const called = sharedCalledCountByRoom.get(roomId) || 0
                    return {
                      roomId,
                      deficit: target - called,
                      called
                    }
                  })
                  .sort((a, b) => {
                    if (a.deficit !== b.deficit) return b.deficit - a.deficit
                    if (a.called !== b.called) return a.called - b.called
                    return a.roomId.localeCompare(b.roomId)
                  })

                return ranked[0]?.roomId || selectedRoomId
              })()
          : selectedRoomId

      const withAttemptsResult = await supabase
        .from("queue_entries")
        .update({
          status: "called",
          call_attempts: (entry.call_attempts || 0) + 1,
          ...(resolvedTargetRoomId ? { room_id: resolvedTargetRoomId } : {})
        })
        .eq("id", entry.id)

      if (!withAttemptsResult.error) {
        logNotificationHook("entered_buffer", {
          roomId: resolvedTargetRoomId || selectedRoomId,
          queueEntryId: entry.id,
          submissionId,
          teamNumber: submissionMeta?.number,
          teamTitle: submissionMeta?.title,
          source: "callEntryToBuffer"
        })
        return
      }

      const maybeColumnMissing =
        withAttemptsResult.error.message
          .toLowerCase()
          .includes("call_attempts") ||
        withAttemptsResult.error.message.toLowerCase().includes("column")

      if (!maybeColumnMissing) {
        throw withAttemptsResult.error
      }

      const fallbackResult = await supabase
        .from("queue_entries")
        .update({
          status: "called",
          ...(resolvedTargetRoomId ? { room_id: resolvedTargetRoomId } : {})
        })
        .eq("id", entry.id)

      if (fallbackResult.error) throw fallbackResult.error

      logNotificationHook("entered_buffer", {
        roomId: resolvedTargetRoomId || selectedRoomId,
        queueEntryId: entry.id,
        submissionId,
        teamNumber: submissionMeta?.number,
        teamTitle: submissionMeta?.title,
        source: "callEntryToBuffer:fallback"
      })
    },
    [
      activeSharedPoolRoomIds,
      allSubmissions,
      getQueueBlockersBySubmission,
      logNotificationHook,
      roomQueueStateByRoom,
      selectedRoomId,
      sharedCalledCountByRoom,
      supabase,
      usesSharedQueue
    ]
  )

  const generateQueueForCurrentRoom = useCallback(
    async (silent = false) => {
      if (!selectedRoomId || !userId) return
      if (queueGenerationRef.current) return

      queueGenerationRef.current = true

      try {
        const activeSubmissionIds = new Set(
          (usesSharedQueue ? sharedPoolEntries : entries)
            .filter((entry) => entry.status !== "cancelled")
            .map((entry) => entry.submission_id)
        )

        const eligibleSubmissions = allSubmissions.filter((submission) =>
          isSubmissionEligibleForRoom(submission, selectedRoom)
        )

        const candidates = eligibleSubmissions.filter(
          (submission) => !activeSubmissionIds.has(submission.id)
        )

        const eligibleCountByRoomId = new Map<string, number>()
        const eligibleRoomIdsBySubmission = new Map<string, string[]>()

        rooms.forEach((room) => {
          const eligibleForRoom = allSubmissions.filter((submission) =>
            isSubmissionEligibleForRoom(submission, room)
          )

          eligibleCountByRoomId.set(room.id, eligibleForRoom.length)

          eligibleForRoom.forEach((submission) => {
            const existing = eligibleRoomIdsBySubmission.get(submission.id)
            if (existing) {
              existing.push(room.id)
            } else {
              eligibleRoomIdsBySubmission.set(submission.id, [room.id])
            }
          })
        })

        const selectedRoomEligibleCount =
          eligibleCountByRoomId.get(selectedRoomId) || 0

        const getScarcityAdjustment = (submissionId: string): number => {
          const eligibleRoomIds = Array.from(
            new Set(
              eligibleRoomIdsBySubmission.get(submissionId) || [selectedRoomId]
            )
          )

          if (eligibleRoomIds.length === 0) return 0

          const eligibleCounts = eligibleRoomIds.map(
            (roomId) =>
              eligibleCountByRoomId.get(roomId) ?? Number.MAX_SAFE_INTEGER
          )

          const scarcestEligibleCount = Math.min(...eligibleCounts)
          const isSelectedRoomScarcest =
            selectedRoomEligibleCount === scarcestEligibleCount

          let adjustment = 0

          if (eligibleRoomIds.length === 1) {
            adjustment += 300
          } else {
            adjustment -= (eligibleRoomIds.length - 1) * 40
          }

          if (isSelectedRoomScarcest) {
            adjustment += 220
          } else {
            const scarcityGap = Math.max(
              1,
              selectedRoomEligibleCount - scarcestEligibleCount
            )
            adjustment -= 180 + scarcityGap * 60
          }

          return adjustment
        }

        if (candidates.length === 0) {
          if (!silent) toast.info("Queue is already generated")
          return
        }

        const candidateIds = candidates.map((submission) => submission.id)
        const { data: crossRoomFlow, error: crossRoomFlowError } =
          await supabase
            .from("queue_entries")
            .select("submission_id, room_id, status")
            .in("submission_id", candidateIds)
            .in("status", ["waiting", "called", "in_progress"])

        if (crossRoomFlowError) {
          if (!silent) toast.error("Failed to generate room-aware priorities")
          return
        }

        const penaltiesBySubmission = new Map<string, number>()
        ;(crossRoomFlow || []).forEach((row) => {
          if (row.room_id === selectedRoomId) return

          const currentPenalty =
            penaltiesBySubmission.get(row.submission_id as string) || 0
          let nextPenalty = currentPenalty

          if (row.status === "in_progress") nextPenalty -= 1000
          else if (row.status === "called") nextPenalty -= 500
          else if (row.status === "waiting") nextPenalty -= 50

          penaltiesBySubmission.set(row.submission_id as string, nextPenalty)
        })

        const payload = candidates.map((submission) => ({
          room_id: selectedRoomId,
          submission_id: submission.id,
          status: "waiting" as const,
          priority:
            (penaltiesBySubmission.get(submission.id) || 0) +
            getScarcityAdjustment(submission.id),
          created_by: userId
        }))

        const { error } = await supabase.from("queue_entries").insert(payload)

        if (error) {
          if (!silent) toast.error(error.message)
          return
        }

        if (!silent) {
          toast.success(`Generated queue with ${payload.length} teams`)
        }
        await fetchQueue(selectedRoomId)
      } finally {
        queueGenerationRef.current = false
      }
    },
    [
      allSubmissions,
      entries,
      fetchQueue,
      rooms,
      selectedRoom,
      selectedRoomId,
      sharedPoolEntries,
      supabase,
      userId,
      usesSharedQueue
    ]
  )

  const fillBufferUpToTarget = useCallback(async () => {
    if (!selectedRoomId || !roomIsReady) return
    if (autoBufferSyncRef.current) return

    const needed = usesSharedQueue
      ? activeSharedPoolRoomIds.reduce((sum, roomId) => {
          const state = roomQueueStateByRoom[roomId]
          const target = Math.max(
            0,
            state?.buffer_target ?? DEFAULT_BUFFER_TARGET
          )
          const called = sharedCalledCountByRoom.get(roomId) || 0
          return sum + Math.max(0, target - called)
        }, 0)
      : Math.max(0, roomBufferTarget) - bufferedEntries.length

    if (needed <= 0) return
    if (visibleWaitingEntries.length === 0) return

    autoBufferSyncRef.current = true
    try {
      const blockers = await getQueueBlockersBySubmission(
        visibleWaitingEntries.map((entry) => entry.submission_id)
      )

      const callableEntries = visibleWaitingEntries
        .filter((entry) => !blockers.get(entry.submission_id))
        .slice(0, needed)

      if (callableEntries.length === 0) return

      const mutableCalledByRoom = new Map(sharedCalledCountByRoom)

      const pickSharedTargetRoomId = () => {
        if (!usesSharedQueue || activeSharedPoolRoomIds.length === 0)
          return selectedRoomId

        const ranked = activeSharedPoolRoomIds
          .map((roomId) => {
            const state = roomQueueStateByRoom[roomId]
            const target = Math.max(
              0,
              state?.buffer_target ?? DEFAULT_BUFFER_TARGET
            )
            const called = mutableCalledByRoom.get(roomId) || 0
            return { roomId, deficit: target - called, called }
          })
          .sort((a, b) => {
            if (a.deficit !== b.deficit) return b.deficit - a.deficit
            if (a.called !== b.called) return a.called - b.called
            return a.roomId.localeCompare(b.roomId)
          })

        return ranked[0]?.roomId || selectedRoomId
      }

      for (const entry of callableEntries) {
        try {
          const targetRoomId = pickSharedTargetRoomId()
          await callEntryToBuffer(entry, {
            targetRoomId: targetRoomId || undefined
          })

          if (targetRoomId) {
            mutableCalledByRoom.set(
              targetRoomId,
              (mutableCalledByRoom.get(targetRoomId) || 0) + 1
            )
          }
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "Auto-buffer call failed"

          console.warn("Auto-buffer skipped one entry:", message)
        }
      }

      await fetchQueue(selectedRoomId)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Auto-buffer sync failed"

      console.warn("Auto-buffer sync warning:", message)
    } finally {
      autoBufferSyncRef.current = false
    }
  }, [
    activeSharedPoolRoomIds,
    bufferedEntries.length,
    callEntryToBuffer,
    fetchQueue,
    getQueueBlockersBySubmission,
    roomBufferTarget,
    roomIsReady,
    roomQueueStateByRoom,
    selectedRoomId,
    sharedCalledCountByRoom,
    usesSharedQueue,
    visibleWaitingEntries
  ])

  const completeCurrent = async () => {
    if (!selectedRoomId || !currentEntry) return

    setActionBusy(true)
    try {
      const existingReview = currentEntry.queue_reviews?.find(
        (r) => r.judge_id === userId
      )

      if (userId) {
        const score = Number(scoreInput)
        const hasValidScore = !Number.isNaN(score) && score >= 0 && score <= 10
        const shouldUseDraft = activeReviewEntry?.id === currentEntry.id

        if (!reviewOwnedByAnotherJudge) {
          const { error: reviewError } = await saveQueueReview({
            queueEntryId: currentEntry.id,
            judgeId: userId,
            score: hasValidScore ? score : (existingReview?.score ?? 0),
            notes: shouldUseDraft
              ? reviewNotes.trim() || null
              : existingReview?.notes || null,
            answers: shouldUseDraft
              ? reviewAnswers
              : existingReview?.answers || []
          })

          if (reviewError) {
            console.warn(
              "Failed to auto-save review before completion:",
              reviewError
            )
          }
        }
      }

      const { error } = await supabase
        .from("queue_entries")
        .update({ status: "completed" })
        .eq("id", currentEntry.id)

      if (error) throw error

      toast.success("Presentation completed")
      await fetchQueue(selectedRoomId)
    } catch (error) {
      console.error(error)
      toast.error("Failed to complete current presentation")
    } finally {
      setActionBusy(false)
    }
  }

  const getPresentingConflict = useCallback(
    async (submissionId: string) => {
      if (!selectedRoomId) return null

      const { data, error } = await supabase
        .from("queue_entries")
        .select("room_id")
        .eq("submission_id", submissionId)
        .eq("status", "in_progress")

      if (error || !data) return null

      const conflict = data.find((row) => row.room_id !== selectedRoomId)
      if (!conflict) return null

      return {
        roomId: conflict.room_id,
        roomName: roomNameById[conflict.room_id] || null
      }
    },
    [roomNameById, selectedRoomId, supabase]
  )

  const startPresentation = async (entryId?: string) => {
    if (!selectedRoomId) return
    if (!roomIsReady) {
      toast.error("Room is not ready yet")
      return
    }

    const targetEntry = entryId
      ? bufferedEntries.find((entry) => entry.id === entryId)
      : bufferedEntries[0]

    if (!targetEntry) {
      toast.info("No teams in the call buffer")
      return
    }

    if (currentEntry) {
      toast.error(
        "Complete the current presentation before starting the next one"
      )
      return
    }

    const presentingConflict = await getPresentingConflict(
      targetEntry.submission_id
    )
    if (presentingConflict) {
      toast.error(
        `This team is already presenting in ${presentingConflict.roomName || "another room"}`
      )
      return
    }

    setActionBusy(true)
    try {
      const { error } = await supabase
        .from("queue_entries")
        .update({ status: "in_progress" })
        .eq("id", targetEntry.id)

      if (error) throw error

      toast.success(
        `Presentation started for group #${targetEntry.submissions.number}`
      )
      if (bufferedEntries.length > 1) {
        toast.info("Push heads-up sent to the remaining called teams")
      }
      await fetchQueue(selectedRoomId)
    } catch (error) {
      console.error(error)
      toast.error("Failed to start presentation")
    } finally {
      setActionBusy(false)
    }
  }

  const requestBufferCallConfirmation = (
    entry: QueueEntry,
    reason: QueueBlockReason
  ) => {
    setForceBufferConfirmed(false)
    setPendingBufferCall({ entryId: entry.id, reason })
  }

  const getEntryBlockReason = async (entry: QueueEntry) => {
    const blockers = await getQueueBlockersBySubmission([entry.submission_id])
    return blockers.get(entry.submission_id) || null
  }

  const forceBufferCall = async (entryId: string) => {
    if (!selectedRoomId) return
    if (!roomIsReady) {
      toast.error("Room is not ready yet")
      return
    }

    const entry = visibleWaitingEntries.find(
      (candidate) => candidate.id === entryId
    )
    if (!entry) return

    const latestBlockReason = await getEntryBlockReason(entry)
    if (latestBlockReason && latestBlockReason.type !== "cooldown") {
      toast.error(
        latestBlockReason.roomName
          ? `${latestBlockReason.message} (${latestBlockReason.roomName})`
          : latestBlockReason.message
      )
      setPendingBufferCall(null)
      setForceBufferConfirmed(false)
      return
    }

    setActionBusy(true)
    try {
      await callEntryToBuffer(entry, {
        allowCooldownOverride: true,
        targetRoomId: selectedRoomId
      })
      toast.success("Group forced to buffer")
      await fetchQueue(selectedRoomId)
    } catch (error) {
      console.error(error)
      toast.error("Failed to force group to buffer")
    } finally {
      setActionBusy(false)
      setPendingBufferCall(null)
      setForceBufferConfirmed(false)
    }
  }

  const handleSkipEntry = async (entryId: string) => {
    if (!selectedRoomId) return
    setActionBusy(true)
    const { error } = await supabase
      .from("queue_entries")
      .update({
        status: "waiting",
        created_at: new Date().toISOString(),
        called_at: null,
        started_at: null,
        completed_at: null
      })
      .eq("id", entryId)

    if (error) {
      toast.error(
        error.message.includes("cooldown")
          ? error.message
          : "Failed to requeue group"
      )
      setActionBusy(false)
      return
    }

    toast.success("Group moved to the end of queue")
    await fetchQueue(selectedRoomId)
    setActionBusy(false)
  }

  const handleMarkNotHere = async (entryId: string) => {
    if (!selectedRoomId) return
    setActionBusy(true)

    const { error } = await supabase
      .from("queue_entries")
      .update({
        status: "waiting",
        created_at: new Date().toISOString(),
        called_at: null,
        started_at: null,
        completed_at: null
      })
      .eq("id", entryId)

    if (error) {
      toast.error(
        error.message.includes("cooldown")
          ? error.message
          : "Failed to requeue team"
      )
      setActionBusy(false)
      return
    }

    toast.success("Team requeued at the end")
    await fetchQueue(selectedRoomId)
    setActionBusy(false)
  }

  const handleDisqualifyNoShow = async (entryId: string) => {
    if (!selectedRoomId) return

    setActionBusy(true)
    const { error } = await supabase
      .from("queue_entries")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString()
      })
      .eq("id", entryId)

    if (error) {
      toast.error("Failed to disqualify team")
      setActionBusy(false)
      return
    }

    toast.success("Team disqualified as no-show")
    await fetchQueue(selectedRoomId)
    setActionBusy(false)
  }

  const requestDisqualifyNoShow = (
    entry: Pick<QueueEntry | SharedPoolQueueEntry, "id" | "submissions">
  ) => {
    setPendingDisqualification({
      entryId: entry.id,
      teamNumber: entry.submissions.number,
      teamTitle: entry.submissions.title || "Untitled"
    })
  }

  const handleMoveToTop = async (entryId: string) => {
    if (!selectedRoomId) return

    const topPriority = visibleWaitingEntries
      .filter((entry) => entry.call_attempts === 0)
      .reduce((maximum, entry) => Math.max(maximum, entry.priority), 0)

    setActionBusy(true)
    const { error } = await supabase
      .from("queue_entries")
      .update({
        priority: topPriority + 1,
        call_attempts: 0
      })
      .eq("id", entryId)

    if (error) {
      toast.error("Failed to move team to top of queue")
      setActionBusy(false)
      return
    }

    toast.success("Team moved to top of queue")
    await fetchQueue(selectedRoomId)
    setActionBusy(false)
  }

  const handleMoveBufferToTop = async (entryId: string) => {
    if (!selectedRoomId) return

    const topBufferedEntry = bufferedEntries[0]
    if (!topBufferedEntry || topBufferedEntry.id === entryId) return

    const topTimestamp = new Date(
      topBufferedEntry.called_at || topBufferedEntry.created_at
    ).getTime()
    const nextTimestamp = Number.isNaN(topTimestamp)
      ? Date.now() - 1000
      : topTimestamp - 1000

    setActionBusy(true)
    const { error } = await supabase
      .from("queue_entries")
      .update({ called_at: new Date(nextTimestamp).toISOString() })
      .eq("id", entryId)

    if (error) {
      toast.error("Failed to move team to top of buffer")
      setActionBusy(false)
      return
    }

    toast.success("Team moved to top of buffer")
    await fetchQueue(selectedRoomId)
    setActionBusy(false)
  }

  const handleCallSpecific = async (entryId: string) => {
    if (!selectedRoomId) return
    if (!roomIsReady) {
      toast.error("Room is not ready yet")
      return
    }
    setActionBusy(true)

    try {
      const targetEntry = visibleWaitingEntries.find(
        (entry) => entry.id === entryId
      )
      if (!targetEntry) {
        toast.error("Selected group is not waiting anymore")
        return
      }

      const blockReason = await getEntryBlockReason(targetEntry)
      if (blockReason) {
        if (blockReason.type !== "cooldown") {
          toast.error(
            blockReason.roomName
              ? `${blockReason.message} (${blockReason.roomName})`
              : blockReason.message
          )
          return
        }
        requestBufferCallConfirmation(targetEntry, blockReason)
        return
      }

      await callEntryToBuffer(targetEntry)

      toast.success("Group moved to call buffer")
      await fetchQueue(selectedRoomId)
    } catch (error) {
      const errorMessage = extractErrorMessage(error)
      const errorDebugPayload = extractErrorDebugPayload(error)
      console.error("Failed to call selected group", error, errorDebugPayload)
      toast.error(
        errorMessage === "Unknown error"
          ? "Failed to call selected group"
          : `Failed to call selected group: ${errorMessage}`
      )
    } finally {
      setActionBusy(false)
    }
  }

  const handleAddWithPriority = async () => {
    if (!selectedRoomId || !selectedSubmissionId || !userId) return

    const selectedSubmission = eligibleSubmissionsForSelectedRoom.find(
      (submission) => submission.id === selectedSubmissionId
    )
    if (!selectedSubmission) {
      toast.error("This team is not eligible for the selected room challenge")
      return
    }

    const existingAnyInScope = (
      usesSharedQueue ? sharedPoolEntries : entries
    ).find(
      (entry) =>
        entry.submission_id === selectedSubmissionId &&
        entry.status !== "cancelled"
    )
    if (existingAnyInScope) {
      toast.info(
        usesSharedQueue
          ? "This group already has a queue entry in this shared challenge queue"
          : "This group already has a queue entry in this room"
      )
      return
    }

    setActionBusy(true)
    const priority = Number(priorityInput)

    const { error } = await supabase.from("queue_entries").insert({
      room_id: selectedRoomId,
      submission_id: selectedSubmissionId,
      status: "waiting",
      priority: Number.isNaN(priority) ? 0 : priority,
      created_by: userId
    })

    if (error) {
      toast.error(error.message)
      setActionBusy(false)
      return
    }

    toast.success("Group added to queue")
    setShowCallGroupDialog(false)
    setSelectedSubmissionId("")
    await fetchQueue(selectedRoomId)
    setActionBusy(false)
  }

  const handleCallGroupNow = async () => {
    if (!selectedRoomId || !selectedSubmissionId || !userId) return
    if (!roomIsReady) {
      toast.error("Room is not ready yet")
      return
    }

    setActionBusy(true)

    try {
      const selectedSubmission = eligibleSubmissionsForSelectedRoom.find(
        (submission) => submission.id === selectedSubmissionId
      )
      if (!selectedSubmission) {
        toast.error("This team is not eligible for the selected room challenge")
        return
      }

      const existingInScope = (
        usesSharedQueue ? sharedPoolEntries : entries
      ).find(
        (entry) =>
          entry.submission_id === selectedSubmissionId &&
          ["waiting", "called", "in_progress"].includes(entry.status)
      )
      const existingAnyInScope = (
        usesSharedQueue ? sharedPoolEntries : entries
      ).find(
        (entry) =>
          entry.submission_id === selectedSubmissionId &&
          entry.status !== "cancelled"
      )

      if (existingInScope?.status === "in_progress") {
        toast.info("This group is already presenting")
      } else if (existingInScope?.status === "called") {
        toast.info("This group is already in the call buffer")
      } else if (existingInScope?.status === "waiting") {
        const blockReason = await getEntryBlockReason(
          existingInScope as QueueEntry
        )
        if (blockReason) {
          if (blockReason.type !== "cooldown") {
            toast.error(
              blockReason.roomName
                ? `${blockReason.message} (${blockReason.roomName})`
                : blockReason.message
            )
            return
          }
          requestBufferCallConfirmation(
            existingInScope as QueueEntry,
            blockReason
          )
          return
        }
        await callEntryToBuffer(existingInScope as QueueEntry)
      } else if (existingAnyInScope) {
        toast.info(
          usesSharedQueue
            ? "This group already has a queue entry in this shared challenge queue"
            : "This group already has a queue entry in this room"
        )
      } else {
        const createdWaitingResult = await supabase
          .from("queue_entries")
          .insert({
            room_id: selectedRoomId,
            submission_id: selectedSubmissionId,
            status: "waiting",
            priority: 100,
            created_by: userId
          })

        if (createdWaitingResult.error) throw createdWaitingResult.error

        const freshEntryResult = await supabase
          .from("queue_entries")
          .select("id, call_attempts, submission_id")
          .eq("room_id", selectedRoomId)
          .eq("submission_id", selectedSubmissionId)
          .eq("status", "waiting")
          .order("created_at", { ascending: false })
          .limit(1)
          .single()

        if (freshEntryResult.error || !freshEntryResult.data) {
          throw (
            freshEntryResult.error ||
            new Error("Failed to find created queue entry")
          )
        }

        const blockReason = await getQueueBlockersBySubmission([
          selectedSubmissionId
        ]).then((blockers) => blockers.get(selectedSubmissionId) || null)
        if (blockReason) {
          if (blockReason.type !== "cooldown") {
            toast.error(
              blockReason.roomName
                ? `${blockReason.message} (${blockReason.roomName})`
                : blockReason.message
            )
            return
          }
          setForceBufferConfirmed(false)
          setPendingBufferCall({
            entryId: freshEntryResult.data.id,
            reason: blockReason
          })
          return
        }

        await callEntryToBuffer({
          id: freshEntryResult.data.id,
          call_attempts: freshEntryResult.data.call_attempts || 0
        })
      }

      toast.success("Group called to buffer")
      setShowCallGroupDialog(false)
      setSelectedSubmissionId("")
      await fetchQueue(selectedRoomId)
    } catch (error) {
      console.error(error)
      toast.error("Failed to call group")
    } finally {
      setActionBusy(false)
    }
  }

  useEffect(() => {
    if (!selectedRoomId || !roomIsReady) return
    void generateQueueForCurrentRoom(true)
  }, [allSubmissions, generateQueueForCurrentRoom, roomIsReady, selectedRoomId])

  useEffect(() => {
    if (!selectedRoomId || !roomIsReady) return
    void fillBufferUpToTarget()
  }, [
    bufferedEntries.length,
    fillBufferUpToTarget,
    roomBufferTarget,
    roomIsReady,
    selectedRoomId,
    visibleWaitingEntries.length
  ])

  useEffect(() => {
    let cancelled = false

    const syncWaitingBlockers = async () => {
      if (!selectedRoomId || visibleWaitingEntries.length === 0) {
        if (!cancelled) setWaitingBlockersByEntryId({})
        return
      }

      const blockers = await getQueueBlockersBySubmission(
        visibleWaitingEntries.map((entry) => entry.submission_id)
      )

      if (cancelled) return

      const next: Record<string, QueueBlockReason> = {}
      visibleWaitingEntries.forEach((entry) => {
        const blocker = blockers.get(entry.submission_id)
        if (blocker) {
          next[entry.id] = blocker
        }
      })

      setWaitingBlockersByEntryId(next)
    }

    void syncWaitingBlockers()

    return () => {
      cancelled = true
    }
  }, [getQueueBlockersBySubmission, selectedRoomId, visibleWaitingEntries])

  const filteredSubmissions = eligibleSubmissionsForSelectedRoom.filter(
    (submission) => {
      const term = groupSearch.toLowerCase().trim()
      if (!term) return true
      return (
        String(submission.number).includes(term) ||
        (submission.title || "").toLowerCase().includes(term)
      )
    }
  )

  const canPresentNext = Boolean(
    roomIsReady && !actionBusy && !currentEntry && followUpEntry
  )

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground">
        Loading queue console...
      </div>
    )
  }

  if (role !== "judge" && role !== "admin") {
    return (
      <div className="rounded-md border p-6">
        <p className="font-medium">No access</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Queue console is only available for judges and admins.
        </p>
      </div>
    )
  }

  if (rooms.length === 0) {
    return (
      <div className="rounded-md border p-6">
        <p className="font-medium">No rooms assigned</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask an admin to assign you to a room first.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PushSubscriptionManager userId={userId} role={role} />
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={selectedRoomId} onValueChange={setSelectedRoomId}>
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder="Select room" />
            </SelectTrigger>
            <SelectContent>
              {rooms.map((room) => (
                <SelectItem key={room.id} value={room.id}>
                  {room.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="icon"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
          </Button>

          <Button
            variant="outline"
            onClick={() => handleSetRoomReady(!roomIsReady)}
            disabled={actionBusy}
          >
            {roomIsReady ? "Stop room" : "Start room"}
          </Button>

          <Button
            variant="outline"
            className="ml-auto"
            onClick={() => setShowReviewedDialog(true)}
          >
            Open reviews
          </Button>

          <Badge
            variant="outline"
            className="px-4 py-2 text-sm font-semibold md:text-base"
          >
            Challenge: {activeChallenge?.title || "No challenge assigned"}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={roomIsReady ? "default" : "destructive"}>
            {roomIsReady ? "Room ready" : "Room not ready"}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.38fr_0.62fr]">
        <div className="space-y-6 xl:order-2">
          <Card>
            <CardContent className="grid gap-3 p-5 md:grid-cols-2 md:p-6 lg:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">
                  Project slot (done/total)
                </p>
                <p className="text-lg font-semibold">
                  {doneCount} / {Math.max(totalCount, 1)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Left: {remainingCount}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Average per team
                </p>
                <p className="text-lg font-semibold">
                  {(sharedPoolAvgDurationMinutes || avgDurationMinutes).toFixed(
                    1
                  )}
                  m
                </p>
                {sharedPoolRooms.length > 1 && (
                  <p className="text-xs text-muted-foreground">
                    Shared-pool average
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Estimated finish
                </p>
                <p className="text-lg font-semibold">{estimatedEndLabel}</p>
                <p className="text-xs text-muted-foreground">
                  {remainingCount > 0
                    ? `${remainingMinutes.toFixed(0)} min left`
                    : "No pending queue"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pacing target</p>
                <p
                  className={`text-lg font-semibold ${
                    desiredTimeConstrained ? "text-amber-600" : ""
                  }`}
                >
                  {formatMinutesToHm(estimatedMinutesPerTeam)}
                </p>
                {maxMinutesPerTeamLabel !== null && (
                  <p
                    className="truncate text-xs text-muted-foreground"
                    title={sharedPoolRoomNamesLabel}
                  >
                    Max: {maxMinutesPerTeamLabel}
                  </p>
                )}
                {desiredTimeConstrained && (
                  <p className="text-xs font-medium text-amber-600">
                    Target reduced to fit remaining window.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Queue flow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowCallGroupDialog(true)}
                  disabled={actionBusy || !roomIsReady}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add to queue
                </Button>
                <Button
                  onClick={() => {
                    if (!followUpEntry) return
                    startPresentation(followUpEntry.id)
                  }}
                  variant={canPresentNext ? "default" : "outline"}
                  className={canPresentNext ? "font-semibold" : undefined}
                  disabled={
                    actionBusy ||
                    !roomIsReady ||
                    !!currentEntry ||
                    !followUpEntry
                  }
                >
                  <FastForward className="mr-2 h-4 w-4" />
                  {followUpEntry
                    ? `Team #${followUpEntry.submissions.number} · Present next`
                    : "No team in buffer"}
                </Button>
              </div>

              <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Now presenting
                  </p>
                  <p className="text-sm font-medium">
                    {currentEntry
                      ? `#${currentEntry.submissions.number} · ${currentEntry.submissions.title || "Untitled"}`
                      : "No team presenting"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Next from buffer
                  </p>
                  <p className="text-sm font-medium">
                    {followUpEntry
                      ? `#${followUpEntry.submissions.number} · ${followUpEntry.submissions.title || "Untitled"}`
                      : "No team in buffer"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Last in waiting queue
                  </p>
                  <p className="text-sm font-medium">
                    {lastInQueueEntry
                      ? `#${lastInQueueEntry.submissions.number} · ${lastInQueueEntry.submissions.title || "Untitled"}`
                      : "Queue is empty"}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">
                  Room standby ({bufferedEntries.length})
                </p>
                {bufferedEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No teams have been called yet.
                  </p>
                ) : (
                  <div className="max-h-[30vh] space-y-2 overflow-y-auto pr-1">
                    {bufferedEntries.map((entry, index) => (
                      <div
                        key={entry.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="font-medium">
                            Team #{entry.submissions.number} ·{" "}
                            {entry.submissions.title || "Untitled"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {index > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleMoveBufferToTop(entry.id)}
                              disabled={actionBusy}
                            >
                              <ArrowUpToLine className="mr-1 h-4 w-4" />
                              Present next
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleMarkNotHere(entry.id)}
                            disabled={actionBusy || !roomIsReady}
                          >
                            <SkipForward className="mr-1 h-4 w-4" />
                            Not here → Requeue
                          </Button>
                          {entry.call_attempts >= 1 && (
                            <Button
                              className="ml-auto"
                              size="sm"
                              variant="destructive"
                              onClick={() => requestDisqualifyNoShow(entry)}
                              disabled={actionBusy || !roomIsReady}
                            >
                              Disqualify
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Upcoming queue (later)</p>
                {visibleWaitingEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No groups waiting.
                  </p>
                ) : (
                  <div className="max-h-[34vh] space-y-2 overflow-y-auto pr-1">
                    {visibleWaitingEntries.map((entry) => {
                      const blocker = waitingBlockersByEntryId[entry.id]
                      const hardBlocked = blocker && blocker.type !== "cooldown"

                      return (
                        <div
                          key={entry.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                        >
                          <div className="min-w-0 space-y-1">
                            <p className="font-medium">
                              Team #{entry.submissions.number} ·{" "}
                              {entry.submissions.title || "Untitled"}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span>Priority: {entry.priority}</span>
                              <span>Calls: {entry.call_attempts}</span>
                              {entry.call_attempts >= 3 && (
                                <Badge variant="destructive">
                                  No-show risk
                                </Badge>
                              )}
                            </div>
                            {blocker && (
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <Badge
                                  variant={
                                    hardBlocked ? "destructive" : "outline"
                                  }
                                >
                                  {blocker.type === "presenting"
                                    ? "Presenting in another room"
                                    : blocker.type === "buffered"
                                      ? "Buffered in another room"
                                      : blocker.type === "member_busy"
                                        ? "Member busy in another room"
                                        : "Cooldown"}
                                </Badge>
                                {blocker.roomName && (
                                  <span className="text-xs text-muted-foreground">
                                    Room: {blocker.roomName}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleSkipEntry(entry.id)}
                              disabled={actionBusy}
                            >
                              <SkipForward className="mr-1 h-4 w-4" />
                              Requeue
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleMoveToTop(entry.id)}
                              disabled={actionBusy}
                            >
                              <ArrowUpToLine className="mr-1 h-4 w-4" />
                              Queue top
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleCallSpecific(entry.id)}
                              disabled={
                                actionBusy || !roomIsReady || !!hardBlocked
                              }
                            >
                              <ArrowUpToLine className="mr-1 h-4 w-4" />
                              Present next
                            </Button>
                            {entry.call_attempts >= 3 && (
                              <Button
                                className="ml-auto"
                                size="sm"
                                variant="destructive"
                                onClick={() => requestDisqualifyNoShow(entry)}
                                disabled={actionBusy}
                              >
                                Disqualify no-show
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 xl:order-1">
          <Card>
            <CardContent className="pt-6">
              {!currentEntry ? (
                <p className="pt-1 text-sm text-muted-foreground">
                  {bufferedEntries.length > 0
                    ? "No team in presentation yet. Use the queue flow action 'Present next' to start."
                    : "No team is currently being evaluated."}
                </p>
              ) : (
                <div className="space-y-4 text-sm">
                  <div className="space-y-4 md:flex md:items-start md:justify-between md:gap-4">
                    <div className="space-y-1 md:min-w-0 md:flex-1">
                      <p className="text-xs text-muted-foreground">&nbsp;</p>
                      <p className="break-words pr-1 text-xl font-bold md:text-2xl">
                        #{currentEntry.submissions.number} ·{" "}
                        {currentEntry.submissions.title || "Untitled"}
                      </p>
                    </div>

                    <div className="space-y-2 md:w-fit md:shrink-0">
                      <div className="ml-auto w-fit space-y-2">
                        {paceWarningStatus.level !== "none" && (
                          <p
                            className={`w-full text-center text-[11px] font-semibold ${
                              paceWarningStatus.level === "critical" ||
                              paceWarningStatus.level === "warning"
                                ? "text-red-700"
                                : "text-orange-700"
                            } m-0 p-0 leading-none`}
                          >
                            {paceWarningStatus.level === "caution"
                              ? "Approaching time limit"
                              : "Time limit overstepped"}
                          </p>
                        )}
                        <div className="inline-flex w-fit items-center justify-start gap-2 rounded-md border p-2">
                          <Button
                            onClick={completeCurrent}
                            disabled={actionBusy}
                            size="sm"
                            className="px-4"
                          >
                            <Clock3 className="mr-2 h-4 w-4" />
                            Complete
                          </Button>
                          <div className="inline-flex h-9 items-center justify-center rounded-md border px-3">
                            <p
                              className={`text-base font-semibold leading-none ${
                                paceWarningStatus.level === "critical"
                                  ? "text-red-600"
                                  : paceWarningStatus.level === "caution"
                                    ? "text-orange-600"
                                    : paceWarningStatus.level === "warning"
                                      ? "text-red-600"
                                      : ""
                              } tabular-nums`}
                            >
                              {currentPresentationElapsedLabel}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            openProjectDetails(currentEntry.submissions)
                          }
                        >
                          Open full project
                        </Button>
                        {currentEntry.submissions.repo_url && (
                          <Button variant="outline" size="sm" asChild>
                            <a
                              href={currentEntry.submissions.repo_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              GitHub
                            </a>
                          </Button>
                        )}
                        <Button variant="outline" size="sm" asChild>
                          <a
                            href={currentEntry.submissions.devpost_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            DevPost
                          </a>
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground">
                      Participants
                    </p>
                    <ul className="space-y-1">
                      {currentEntry.submissions.submission_participants.map(
                        (sp) => (
                          <li key={sp.participant_id}>
                            {[
                              sp.participants.first_name,
                              sp.participants.last_name
                            ]
                              .filter(Boolean)
                              .join(" ") || sp.participants.email}
                          </li>
                        )
                      )}
                    </ul>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {!reviewingPastTeam && (
            <Card>
              <CardHeader>
                <CardTitle>Scoring form</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {reviewingPastTeam
                    ? "You are editing a past review. This will not change queue progression."
                    : "Score and notes are auto-saved while you type. Complete presentation to close this team."}
                </p>

                {reviewingPastTeam && (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-orange-300 bg-orange-50 p-3 text-sm">
                    <div>
                      <p className="font-medium text-orange-700">
                        Past review mode
                      </p>
                      <p className="text-xs text-orange-700/90">
                        You are reviewing a completed team, not the team
                        currently presenting.
                      </p>
                    </div>
                    <Badge variant="outline">Past team</Badge>
                  </div>
                )}

                {!activeReviewEntry && (
                  <p className="text-sm text-muted-foreground">
                    No team is currently in presentation.
                  </p>
                )}

                {activeQuestions.length > 0 && (
                  <div className="space-y-3 rounded-md border p-3">
                    <p className="text-sm font-medium">Challenge questions</p>
                    {activeQuestions.map((question) => {
                      const currentAnswer = reviewAnswers.find(
                        (answer) => answer.label === question.label
                      )

                      return (
                        <div key={question.label} className="space-y-1.5">
                          <Label>{question.label}</Label>
                          {question.type === "boolean" ? (
                            <Select
                              value={
                                currentAnswer?.value === true
                                  ? "yes"
                                  : currentAnswer?.value === false
                                    ? "no"
                                    : "no"
                              }
                              onValueChange={(value) =>
                                updateAnswer(question.label, value === "yes")
                              }
                              disabled={
                                actionBusy ||
                                !activeReviewEntry ||
                                reviewOwnedByAnotherJudge
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="yes">Yes</SelectItem>
                                <SelectItem value="no">No</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : question.type === "number" ? (
                            <Input
                              type="number"
                              value={
                                typeof currentAnswer?.value === "number"
                                  ? String(currentAnswer.value)
                                  : ""
                              }
                              onChange={(event) => {
                                const next = event.target.value
                                updateAnswer(
                                  question.label,
                                  next === "" ? null : Number(next)
                                )
                              }}
                              disabled={
                                actionBusy ||
                                !activeReviewEntry ||
                                reviewOwnedByAnotherJudge
                              }
                            />
                          ) : (
                            <textarea
                              value={
                                typeof currentAnswer?.value === "string"
                                  ? currentAnswer.value
                                  : ""
                              }
                              onChange={(event) =>
                                updateAnswer(question.label, event.target.value)
                              }
                              disabled={
                                actionBusy ||
                                !activeReviewEntry ||
                                reviewOwnedByAnotherJudge
                              }
                              rows={3}
                              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              placeholder="Write answer..."
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="score">Score (0-10)</Label>
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: 11 }, (_, index) => {
                      const selected = scoreInput === String(index)
                      return (
                        <Button
                          key={index}
                          id={index === 0 ? "score" : undefined}
                          type="button"
                          size="sm"
                          variant={selected ? "default" : "outline"}
                          className="h-9 w-9 p-0"
                          disabled={
                            actionBusy ||
                            !activeReviewEntry ||
                            reviewOwnedByAnotherJudge
                          }
                          onClick={() => setScoreInput(String(index))}
                        >
                          {index}
                        </Button>
                      )
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <textarea
                    id="notes"
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    disabled={
                      actionBusy ||
                      !activeReviewEntry ||
                      reviewOwnedByAnotherJudge
                    }
                    rows={6}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder="Write a quick review..."
                  />
                  {reviewOwnedByAnotherJudge ? (
                    <p className="text-xs text-muted-foreground">
                      Read-only review submitted by another judge.
                    </p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          )}

          {role === "admin" && (
            <Card>
              <CardHeader>
                <CardTitle>Room planning</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_auto]">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Desired minutes per team
                    </p>
                    <p className="text-sm font-medium">
                      Room-level goal used for ETA and CSV export
                    </p>
                    {maxMinutesPerTeamLabel !== null && (
                      <p className="text-xs text-muted-foreground">
                        Max now: {maxMinutesPerTeamLabel} / team
                      </p>
                    )}
                    {desiredTimeConstrained && (
                      <p className="text-xs font-medium text-amber-600">
                        Desired target is currently constrained by remaining
                        window.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={desiredMinutesInput}
                      type="number"
                      min={1}
                      className={`w-24 ${desiredTimeConstrained ? "border-amber-400" : ""}`}
                      onChange={(event) =>
                        setDesiredMinutesInput(event.target.value)
                      }
                      disabled={actionBusy}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleUpdateDesiredMinutes(desiredMinutesInput)
                      }
                      disabled={actionBusy}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={showCallGroupDialog} onOpenChange={setShowCallGroupDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Force group to buffer</DialogTitle>
            <DialogDescription>
              Select a team and either force it into buffer now, or add it to
              the later queue with priority.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="group-search">Search team</Label>
              <Input
                id="group-search"
                value={groupSearch}
                onChange={(e) => setGroupSearch(e.target.value)}
                placeholder="Type number or title..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="group-select">Project team</Label>
              <Select
                value={selectedSubmissionId}
                onValueChange={setSelectedSubmissionId}
              >
                <SelectTrigger id="group-select">
                  <SelectValue placeholder="Select team" />
                </SelectTrigger>
                <SelectContent>
                  {filteredSubmissions.slice(0, 150).map((submission) => (
                    <SelectItem key={submission.id} value={submission.id}>
                      Team #{submission.number} ·{" "}
                      {submission.title || "Untitled"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Input
                id="priority"
                type="number"
                value={priorityInput}
                onChange={(e) => setPriorityInput(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleAddWithPriority}
              disabled={!selectedSubmissionId || actionBusy}
            >
              Add to later queue
            </Button>
            <Button
              onClick={handleCallGroupNow}
              disabled={!selectedSubmissionId || actionBusy || !roomIsReady}
            >
              Force to buffer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showReviewedDialog} onOpenChange={setShowReviewedDialog}>
        <DialogContent className="max-h-[88vh] overflow-hidden sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Reviewed teams</DialogTitle>
            <DialogDescription>
              Filter, sort and open previous reviews without crowding the main
              queue view.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="reviewed-search">Search reviewed teams</Label>
              <Input
                id="reviewed-search"
                value={reviewedSearch}
                onChange={(event) => setReviewedSearch(event.target.value)}
                placeholder="Team number, title or notes..."
                disabled={actionBusy}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="min-reviewed-score">Minimum score</Label>
              <Input
                id="min-reviewed-score"
                type="number"
                min={0}
                max={10}
                value={minReviewedScore}
                onChange={(event) => setMinReviewedScore(event.target.value)}
                disabled={actionBusy}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reviewed-scope">Review scope</Label>
              <Select
                value={reviewedScope}
                onValueChange={(value) =>
                  setReviewedScope(value as "room" | "challenge")
                }
              >
                <SelectTrigger id="reviewed-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="room">This room reviews</SelectItem>
                  {isMultiRoomChallenge && (
                    <SelectItem value="challenge">All</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[200px_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="reviewed-sort">Sort by</Label>
              <Select
                value={reviewedSort}
                onValueChange={(value) =>
                  setReviewedSort(
                    value as "recent" | "score_desc" | "score_asc" | "team_asc"
                  )
                }
              >
                <SelectTrigger id="reviewed-sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Most recent</SelectItem>
                  <SelectItem value="score_desc">
                    Score (high to low)
                  </SelectItem>
                  <SelectItem value="score_asc">Score (low to high)</SelectItem>
                  <SelectItem value="team_asc">Team number</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-start gap-2 sm:justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportReviewsCSV}
                disabled={
                  isExportingReviews || reviewedBaseEntries.length === 0
                }
              >
                {isExportingReviews ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                )}
                Export CSV
              </Button>
              <Badge variant="outline">{reviewedEntries.length} shown</Badge>
            </div>
          </div>

          <div className="grid min-h-0 gap-3 md:grid-cols-[280px_minmax(0,1fr)]">
            <div className="max-h-[48vh] space-y-2 overflow-y-auto pr-1">
              {reviewedEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No reviewed teams match your filters.
                </p>
              ) : (
                reviewedEntries.map((entry) => {
                  const review = getPreferredReview(entry, reviewedScope)

                  return (
                    <div
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          #{entry.submissions.number} ·{" "}
                          {entry.submissions.title || "Untitled"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Score: {review?.score ?? 0}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant={
                          selectedReviewedEntryId === entry.id
                            ? "default"
                            : "outline"
                        }
                        onClick={() => setSelectedReviewedEntryId(entry.id)}
                      >
                        {selectedReviewedEntryId === entry.id
                          ? "Selected"
                          : "Open"}
                      </Button>
                    </div>
                  )
                })
              )}
            </div>

            <div className="max-h-[48vh] space-y-3 overflow-y-auto rounded-md border p-3">
              {!selectedReviewedEntry ? (
                <p className="text-sm text-muted-foreground">
                  Select a team to open its review.
                </p>
              ) : (
                (() => {
                  const selectedReview = getPreferredReview(
                    selectedReviewedEntry,
                    reviewedScope
                  )

                  return (
                    <div className="space-y-4 text-sm">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Team</p>
                        <p className="text-base font-semibold">
                          #{selectedReviewedEntry.submissions.number} ·{" "}
                          {selectedReviewedEntry.submissions.title ||
                            "Untitled"}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Links</p>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" asChild>
                            <a
                              href={
                                selectedReviewedEntry.submissions.devpost_url
                              }
                              target="_blank"
                              rel="noreferrer"
                            >
                              DevPost
                            </a>
                          </Button>
                          {selectedReviewedEntry.submissions.repo_url && (
                            <Button variant="outline" size="sm" asChild>
                              <a
                                href={
                                  selectedReviewedEntry.submissions.repo_url
                                }
                                target="_blank"
                                rel="noreferrer"
                              >
                                Repository
                              </a>
                            </Button>
                          )}
                          {selectedReviewedEntry.submissions.demo_url && (
                            <Button variant="outline" size="sm" asChild>
                              <a
                                href={
                                  selectedReviewedEntry.submissions.demo_url
                                }
                                target="_blank"
                                rel="noreferrer"
                              >
                                Demo
                              </a>
                            </Button>
                          )}
                          {selectedReviewedEntry.submissions.video_url && (
                            <Button variant="outline" size="sm" asChild>
                              <a
                                href={
                                  selectedReviewedEntry.submissions.video_url
                                }
                                target="_blank"
                                rel="noreferrer"
                              >
                                Video
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1 rounded-md border p-2">
                          <p className="text-xs text-muted-foreground">Grade</p>
                          <p className="text-lg font-semibold">
                            {selectedReview?.score ?? 0}
                          </p>
                        </div>
                        <div className="space-y-1 rounded-md border p-2">
                          <p className="text-xs text-muted-foreground">
                            Challenge keywords
                          </p>
                          <p>
                            {selectedReviewedEntry.submissions.prizes.length > 0
                              ? selectedReviewedEntry.submissions.prizes.join(
                                  " · "
                                )
                              : "No challenge keywords"}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Notes</p>
                        <p className="rounded-md border p-2 text-sm">
                          {selectedReview?.notes?.trim() || "No notes"}
                        </p>
                      </div>

                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          Challenge answers
                        </p>
                        {selectedReview?.answers?.length ? (
                          <div className="space-y-2">
                            {selectedReview.answers.map((answer) => (
                              <div
                                key={answer.label}
                                className="rounded-md border p-2"
                              >
                                <p className="text-xs text-muted-foreground">
                                  {answer.label}
                                </p>
                                <p>
                                  {typeof answer.value === "boolean"
                                    ? answer.value
                                      ? "Yes"
                                      : "No"
                                    : answer.value === null ||
                                        answer.value === ""
                                      ? "—"
                                      : String(answer.value)}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No answers recorded.
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })()
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showProjectDialog} onOpenChange={setShowProjectDialog}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {projectDialogSubmission
                ? `Project #${projectDialogSubmission.number} · ${projectDialogSubmission.title || "Untitled"}`
                : "Project details"}
            </DialogTitle>
            <DialogDescription>
              Full project view for judges without leaving the queue screen.
            </DialogDescription>
          </DialogHeader>

          {projectDialogSubmission && (
            <div className="space-y-4 text-sm">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Links</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={projectDialogSubmission.devpost_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      DevPost
                    </a>
                  </Button>
                  {projectDialogSubmission.repo_url && (
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={projectDialogSubmission.repo_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Repository
                      </a>
                    </Button>
                  )}
                  {projectDialogSubmission.demo_url && (
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={projectDialogSubmission.demo_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Demo
                      </a>
                    </Button>
                  )}
                  {projectDialogSubmission.video_url && (
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={projectDialogSubmission.video_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Video
                      </a>
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Challenges</p>
                <div className="flex flex-wrap gap-2">
                  {projectDialogSubmission.prizes.length > 0 ? (
                    projectDialogSubmission.prizes.map((keyword, index) => (
                      <Badge key={`${keyword}-${index}`} variant="secondary">
                        {keyword}
                      </Badge>
                    ))
                  ) : (
                    <Badge variant="outline">No challenge keywords</Badge>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Participants</p>
                {projectDialogSubmission.submission_participants.length ===
                0 ? (
                  <p className="text-muted-foreground">
                    No participants linked
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {projectDialogSubmission.submission_participants.map(
                      (participant) => {
                        const fullName = [
                          participant.participants.first_name,
                          participant.participants.last_name
                        ]
                          .filter(Boolean)
                          .join(" ")

                        return (
                          <li key={participant.participant_id}>
                            {fullName || participant.participants.email}
                            {fullName
                              ? ` · ${participant.participants.email}`
                              : ""}
                          </li>
                        )
                      }
                    )}
                  </ul>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!pendingDisqualification}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDisqualification(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disqualify team as no-show?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDisqualification
                ? `Team #${pendingDisqualification.teamNumber} · ${pendingDisqualification.teamTitle} will be removed from the evaluation queue.`
                : "This team will be removed from the evaluation queue."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={actionBusy || !pendingDisqualification}
              onClick={() => {
                if (!pendingDisqualification) return
                void handleDisqualifyNoShow(pendingDisqualification.entryId)
                setPendingDisqualification(null)
              }}
            >
              Yes, disqualify
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingBufferCall}
        onOpenChange={(open) => {
          if (!open) {
            setPendingBufferCall(null)
            setForceBufferConfirmed(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Team currently blocked</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingBufferCall?.reason.message}
              {pendingBufferCall?.reason.roomName
                ? ` (${pendingBufferCall.reason.roomName})`
                : ""}
              {pendingBufferCall?.reason.remainingSeconds
                ? ` · ${Math.max(1, Math.ceil(pendingBufferCall.reason.remainingSeconds / 60))} min remaining`
                : ""}
              {pendingBufferCall?.reason.type === "cooldown"
                ? ". You can override cooldown and force this team into buffer if needed."
                : ". This blocker cannot be overridden."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingBufferCall?.reason.type === "cooldown" && (
            <div className="flex items-start gap-2 rounded-md border p-3">
              <Checkbox
                id="force-buffer-confirm"
                checked={forceBufferConfirmed}
                onCheckedChange={(checked) =>
                  setForceBufferConfirmed(Boolean(checked))
                }
                disabled={actionBusy}
              />
              <Label
                htmlFor="force-buffer-confirm"
                className="text-sm leading-snug"
              >
                I understand this team is in cooldown and I still want to force
                it into this room buffer.
              </Label>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel>
            {pendingBufferCall?.reason.type === "cooldown" ? (
              <AlertDialogAction
                disabled={actionBusy || !forceBufferConfirmed}
                onClick={() => {
                  if (!pendingBufferCall) return
                  void forceBufferCall(pendingBufferCall.entryId)
                }}
              >
                Force to buffer
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                onClick={() => {
                  setPendingBufferCall(null)
                  setForceBufferConfirmed(false)
                }}
              >
                Understood
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
