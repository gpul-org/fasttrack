import { LoginForm } from "@/components/login-form"
import { FastForward } from "lucide-react"

export default function Page() {
  return (
    <div className="landing-gradient flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <FastForward className="h-8 w-8" />
          <h1 className="text-2xl font-bold">FastTrack sign in</h1>
          <p className="text-sm text-muted-foreground">
            One login flow for participants, judges and admins.
          </p>
        </div>

        <LoginForm
          title="Sign in"
          description="Enter your email and verify with the 8-digit code from your inbox."
        />
      </div>
    </div>
  )
}
