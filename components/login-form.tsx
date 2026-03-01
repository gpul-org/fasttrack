"use client"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import type { User } from "@supabase/supabase-js"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

const OTP_COOLDOWN_SECONDS = 60

function getCooldownStorageKey(email: string) {
  return `fasttrack:otp:cooldown:${email}`
}

function readCooldownRemainingSeconds(email: string): number {
  if (typeof window === "undefined") return 0
  const key = getCooldownStorageKey(email)
  const storedUntil = Number(window.localStorage.getItem(key) || "0")
  if (!storedUntil || Number.isNaN(storedUntil)) return 0
  const remaining = Math.ceil((storedUntil - Date.now()) / 1000)
  return remaining > 0 ? remaining : 0
}

function writeCooldown(email: string, seconds: number) {
  if (typeof window === "undefined") return
  const key = getCooldownStorageKey(email)
  const until = Date.now() + seconds * 1000
  window.localStorage.setItem(key, String(until))
}

function formatOtpError(error: unknown) {
  if (!(error instanceof Error)) return "An error occurred"
  const message = error.message.toLowerCase()
  if (
    message.includes("rate") ||
    message.includes("security purposes") ||
    message.includes("too many")
  ) {
    return "Too many email attempts. Please wait a minute before trying again."
  }
  return error.message
}

async function resolvePostLoginRoute(
  supabase: ReturnType<typeof createClient>,
  user: User,
  rawEmail?: string
) {
  const email = (rawEmail || user.email || "").trim().toLowerCase()

  // Check if user has an assigned role (admin/judge) → go to dashboard
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  if (profile?.role !== null && profile?.role !== undefined) {
    return "/dashboard"
  }

  const participant = email
    ? await findParticipantByEmail(supabase, email)
    : null

  if (participant) return "/my-queues"

  return "/pending"
}

async function findParticipantByEmail(
  supabase: ReturnType<typeof createClient>,
  rawEmail: string
) {
  const normalized = rawEmail.trim().toLowerCase()
  if (!normalized) return null

  const exactMatch = await supabase
    .from("participants")
    .select("id, email")
    .ilike("email", normalized)
    .maybeSingle()

  if (exactMatch.error) {
    throw new Error(`Participant lookup failed: ${exactMatch.error.message}`)
  }

  if (exactMatch.data) return exactMatch.data

  const { data: fuzzyMatches, error: fuzzyError } = await supabase
    .from("participants")
    .select("id, email")
    .ilike("email", `%${normalized}%`)

  if (fuzzyError) {
    throw new Error(`Participant lookup failed: ${fuzzyError.message}`)
  }

  if (!fuzzyMatches || fuzzyMatches.length === 0) return null

  if (fuzzyMatches.length === 1) return fuzzyMatches[0]

  return (
    fuzzyMatches.find((row) =>
      (row.email || "").trim().toLowerCase().includes(normalized)
    ) ||
    fuzzyMatches[0] ||
    null
  )
}

export function LoginForm({
  title,
  description,
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  title?: string
  description?: string
}) {
  const [email, setEmail] = useState("")
  const [otp, setOtp] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [otpSent, setOtpSent] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)
  const router = useRouter()

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email])

  useEffect(() => {
    if (!normalizedEmail) {
      setCooldownSeconds(0)
      return
    }

    setCooldownSeconds(readCooldownRemainingSeconds(normalizedEmail))

    const timer = setInterval(() => {
      setCooldownSeconds(readCooldownRemainingSeconds(normalizedEmail))
    }, 1000)

    return () => clearInterval(timer)
  }, [normalizedEmail])

  useEffect(() => {
    const supabase = createClient()

    const checkExistingSession = async () => {
      const {
        data: { user }
      } = await supabase.auth.getUser()

      if (user) {
        const route = await resolvePostLoginRoute(supabase, user, user.email)
        router.replace(route)
        return
      }

      setIsCheckingSession(false)
    }

    void checkExistingSession()
  }, [router])

  const sendOtpForEmail = async (rawEmail: string) => {
    const supabase = createClient()
    const normalized = rawEmail.trim().toLowerCase()

    if (!normalized) {
      throw new Error("Email is required")
    }

    const remaining = readCooldownRemainingSeconds(normalized)
    if (remaining > 0) {
      throw new Error(`Please wait ${remaining}s before requesting a new code.`)
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: normalized,
      options: {
        shouldCreateUser: true
      }
    })
    if (error) throw error

    writeCooldown(normalized, OTP_COOLDOWN_SECONDS)
    setCooldownSeconds(OTP_COOLDOWN_SECONDS)
    setEmail(normalized)
    setOtpSent(true)
  }

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      await sendOtpForEmail(email)
    } catch (error: unknown) {
      setError(formatOtpError(error))
    } finally {
      setIsLoading(false)
    }
  }

  const handleResendOtp = async () => {
    setIsLoading(true)
    setError(null)

    try {
      await sendOtpForEmail(email)
    } catch (error: unknown) {
      setError(formatOtpError(error))
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()
    setIsLoading(true)
    setError(null)

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: "email"
      })
      if (error) throw error

      if (data.user) {
        const route = await resolvePostLoginRoute(supabase, data.user, email)
        router.push(route)
      }
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  if (isCheckingSession) {
    return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Checking your session...</CardTitle>
            <CardDescription>
              Redirecting you to the right area.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (otpSent) {
    return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Enter verification code</CardTitle>
            <CardDescription>
              We sent an 8-digit code to {email}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleVerifyOtp}>
              <div className="flex flex-col gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="otp">Verification Code</Label>
                  <Input
                    id="otp"
                    type="text"
                    placeholder="00000000"
                    required
                    maxLength={8}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]{8}"
                  />
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading || otp.length !== 8}
                >
                  {isLoading ? "Verifying..." : "Verify"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    void handleResendOtp()
                  }}
                  disabled={isLoading || cooldownSeconds > 0}
                >
                  {cooldownSeconds > 0
                    ? `Resend code in ${cooldownSeconds}s`
                    : "Resend verification code"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setOtpSent(false)
                    setOtp("")
                    setError(null)
                  }}
                >
                  Use different email
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{title || "Sign in"}</CardTitle>
          <CardDescription>
            {description ||
              "Use your email and we will send you a one-time verification code."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSendOtp}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button
                type="submit"
                className="w-full"
                disabled={isLoading || cooldownSeconds > 0}
              >
                {isLoading
                  ? "Sending code..."
                  : cooldownSeconds > 0
                    ? `Wait ${cooldownSeconds}s`
                    : "Send verification code"}
              </Button>

              <div className="text-center text-sm text-muted-foreground">
                <Link href="/" className="underline underline-offset-4">
                  Back to home
                </Link>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
