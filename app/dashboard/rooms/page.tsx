"use client"

import { AddRoomSheet } from "@/components/add-room-sheet"
import { EditRoomSheet, Room } from "@/components/edit-room-sheet"
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
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import { Pencil, Plus, RefreshCw, Trash2, Users } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

function extractErrorMessage(error: unknown): string {
  if (!error) return "Unknown error"
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "object") {
    const candidate = error as {
      message?: unknown
      details?: unknown
      hint?: unknown
      code?: unknown
      error_description?: unknown
      error?: unknown
    }

    const parts = [
      candidate.message,
      candidate.details,
      candidate.hint,
      candidate.error_description,
      candidate.error,
      candidate.code
    ]
      .map((value) =>
        typeof value === "string" ? value.trim() : String(value || "").trim()
      )
      .filter(Boolean)

    if (parts.length > 0) return parts.join(" | ")
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export default function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [addSheetOpen, setAddSheetOpen] = useState(false)
  const [editingRoom, setEditingRoom] = useState<Room | null>(null)
  const [deletingRoom, setDeletingRoom] = useState<Room | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const fetchAll = useRef(async () => {
    const supabase = createClient()
    const [roomsResult, userResult] = await Promise.all([
      supabase
        .from("rooms")
        .select(
          `id, name,
           room_judges(judge_id, profiles(id, first_name, last_name, email)),
           room_challenges(challenge_id, challenges(id, title, keyword))`
        )
        .order("name"),
      supabase.auth.getUser()
    ])

    if (roomsResult.error) {
      const message = extractErrorMessage(roomsResult.error)
      const fallbackResult = await supabase
        .from("rooms")
        .select("id, name")
        .order("name")

      if (fallbackResult.error) {
        toast.error(`Failed to fetch rooms: ${message}`)
      } else {
        const fallbackRooms = (fallbackResult.data || []).map((room) => ({
          id: room.id,
          name: room.name,
          judges: [],
          challenges: []
        })) as Room[]
        setRooms(fallbackRooms)
        toast.warning(`Loaded basic rooms only (relations failed): ${message}`)
      }

      console.error("Failed to fetch rooms:", message, roomsResult.error)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any[] = roomsResult.data || []
      const normalized: Room[] = raw.map((r) => ({
        id: r.id,
        name: r.name,
        judges: (r.room_judges || []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (rj: any) => rj.profiles
        ),
        challenges: (r.room_challenges || []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (rc: any) => rc.challenges
        )
      }))
      setRooms(normalized)
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
    fetchAll.current()
  }, [])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchAll.current()
    setIsRefreshing(false)
  }

  const handleDelete = async () => {
    if (!deletingRoom) return
    setIsDeleting(true)
    const supabase = createClient()
    const { error } = await supabase
      .from("rooms")
      .delete()
      .eq("id", deletingRoom.id)
    setIsDeleting(false)

    if (error) {
      const message = extractErrorMessage(error)
      toast.error(`Failed to delete room: ${message}`)
      console.error("Failed to delete room:", message, error)
      return
    }

    toast.success("Room deleted")
    setDeletingRoom(null)
    await fetchAll.current()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="whitespace-nowrap text-sm text-muted-foreground">
          {rooms.length} {rooms.length === 1 ? "room" : "rooms"}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh rooms"
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => setAddSheetOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Add Room
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="shadow-none">
              <CardContent className="p-4">
                <div className="space-y-3">
                  <Skeleton className="h-5 w-24" />
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-20" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : rooms.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          No rooms found
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rooms.map((room) => (
            <Card key={room.id} className="shadow-none">
              <CardContent className="p-4">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{room.name}</p>
                    {isAdmin && (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground"
                          onClick={() => setEditingRoom(room)}
                          title="Edit room"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeletingRoom(room)}
                          title="Delete room"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {room.challenges.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {room.challenges.map((c) => (
                        <PrizeBadge key={c.id} prize={c.keyword} />
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    <span>
                      {room.judges.length}{" "}
                      {room.judges.length === 1 ? "judge" : "judges"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AddRoomSheet
        open={addSheetOpen}
        onOpenChange={setAddSheetOpen}
        onCreated={handleRefresh}
      />

      {editingRoom && (
        <EditRoomSheet
          key={editingRoom.id}
          open={!!editingRoom}
          onOpenChange={(open) => {
            if (!open) setEditingRoom(null)
          }}
          room={editingRoom}
          onUpdated={handleRefresh}
        />
      )}

      <AlertDialog
        open={!!deletingRoom}
        onOpenChange={(open) => {
          if (!open) setDeletingRoom(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete room</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deletingRoom?.name}&quot;?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
