"use client"

import { AddParticipantSheet } from "@/components/add-participant-sheet"
import { Button } from "@/components/ui/button"
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
import { createClient } from "@/lib/supabase/client"
import { ChevronRight, Plus, RefreshCw, Upload } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

interface Participant {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  discord_username: string | null
}

export default function ParticipantsPage() {
  const [participants, setParticipants] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [addSheetOpen, setAddSheetOpen] = useState(false)
  const itemsPerPage = 10

  const fetchParticipants = useRef(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("participants")
      .select("id, email, first_name, last_name, discord_username")
      .order("first_name")

    if (error) {
      toast.error("Failed to fetch participants")
      console.error(error)
      return
    }

    setParticipants(data || [])
    setLoading(false)
  })

  useEffect(() => {
    fetchParticipants.current()
  }, [])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchParticipants.current()
    setIsRefreshing(false)
  }

  const filteredParticipants = participants.filter((p) => {
    const term = searchTerm.toLowerCase()
    return (
      p.email.toLowerCase().includes(term) ||
      (p.first_name || "").toLowerCase().includes(term) ||
      (p.last_name || "").toLowerCase().includes(term)
    )
  })

  const totalPages = Math.ceil(filteredParticipants.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedParticipants = filteredParticipants.slice(
    startIndex,
    startIndex + itemsPerPage
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Input
            placeholder="Search by name or email..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value)
              setCurrentPage(1)
            }}
            className="max-w-sm shadow-none"
          />
          <div className="whitespace-nowrap text-sm text-muted-foreground">
            {filteredParticipants.length}{" "}
            {filteredParticipants.length === 1 ? "participant" : "participants"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh participants"
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </Button>
          <Button
            size="icon"
            onClick={() => setAddSheetOpen(true)}
            title="Add participant"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <AddParticipantSheet
        open={addSheetOpen}
        onOpenChange={setAddSheetOpen}
        onCreated={() => fetchParticipants.current()}
      />

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[20%] pl-6">First Name</TableHead>
              <TableHead className="w-[20%]">Last Name</TableHead>
              <TableHead className="w-[35%]">Email</TableHead>
              <TableHead className="w-[15%]">Discord</TableHead>
              <TableHead className="w-[50px] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="py-3 pl-6">
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell className="py-3">
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell className="py-3">
                    <Skeleton className="h-4 w-40" />
                  </TableCell>
                  <TableCell className="py-3">
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Skeleton className="ml-auto h-8 w-8 rounded-md" />
                  </TableCell>
                </TableRow>
              ))
            ) : paginatedParticipants.length === 0 ? (
              participants.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-60">
                    <div className="flex flex-col items-center justify-center gap-3 py-8">
                      <div className="rounded-full bg-muted p-3">
                        <Upload className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div className="text-center">
                        <p className="font-medium">No participants yet</p>
                        <p className="text-sm text-muted-foreground">
                          Upload a CSV file to import participants
                        </p>
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <Link href="/dashboard/upload">Go to Upload</Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">
                    No participants found
                  </TableCell>
                </TableRow>
              )
            ) : (
              paginatedParticipants.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="py-3 pl-6 font-medium">
                    {p.first_name || "—"}
                  </TableCell>
                  <TableCell className="py-3">{p.last_name || "—"}</TableCell>
                  <TableCell className="py-3 text-muted-foreground">
                    {p.email}
                  </TableCell>
                  <TableCell className="py-3 text-muted-foreground">
                    {p.discord_username || "—"}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Link href={`/dashboard/participants/${p.id}`}>
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
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
