import { AuthButton } from "@/components/auth-button"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { Button } from "@/components/ui/button"
import { FastForward } from "lucide-react"
import Link from "next/link"

export default function Home() {
  return (
    <main className="landing-gradient flex min-h-screen flex-col items-center">
      <div className="flex w-full flex-1 flex-col items-center">
        <nav className="flex h-16 w-full justify-center border-b border-b-foreground/10">
          <div className="flex w-full max-w-5xl items-center justify-between p-3 px-5 text-sm">
            <div className="flex items-center gap-5 font-semibold">
              <div className="flex items-center gap-2 text-xl">
                <FastForward className="h-5 w-5" />
                <span>FastTrack</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <ThemeSwitcher />
              <AuthButton />
            </div>
          </div>
        </nav>
        <div className="flex max-w-5xl flex-1 flex-col items-center justify-center p-5">
          <div className="w-full space-y-8 py-6 md:py-10">
            <div className="mx-auto max-w-2xl space-y-3 text-center">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                HackUDC 2026
              </p>
              <h1 className="text-4xl font-extrabold tracking-tight md:text-6xl">
                FastTrack
              </h1>
              <p className="text-lg font-semibold tracking-tight text-foreground/90 md:text-2xl">
                Queueing for Hackathon Judging
              </p>
              <p className="text-sm text-muted-foreground md:text-base">
                Consulta tu estado en cola con tu email. Jueces y admins acceden
                con login.
              </p>

              <div className="pt-2">
                <form
                  action="/my-queues"
                  method="get"
                  className="mx-auto flex w-full max-w-xl flex-col gap-2 sm:flex-row"
                >
                  <input
                    type="email"
                    name="email"
                    placeholder="Introduce tu email para ver tu cola"
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                  />
                  <Button type="submit">Ver mi cola</Button>
                </form>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                <Button asChild variant="ghost">
                  <Link
                    href="https://hackudc.gpul.org"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Event website
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
