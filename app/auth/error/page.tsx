import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import { Suspense } from "react"

async function ErrorContent({
  searchParams
}: {
  searchParams: Promise<{ error: string }>
}) {
  const params = await searchParams
  const message = decodeURIComponent(params?.error || "").trim()

  return (
    <>
      {message ? (
        <p className="text-sm text-muted-foreground">{message}</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          The sign-in link or code is invalid, expired, or already used.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <Button asChild className="w-full">
          <Link href="/auth/login">Back to sign in</Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link href="/">Go to home</Link>
        </Button>
      </div>
    </>
  )
}

export default function Page({
  searchParams
}: {
  searchParams: Promise<{ error: string }>
}) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Sign-in failed</CardTitle>
            </CardHeader>
            <CardContent>
              <Suspense>
                <ErrorContent searchParams={searchParams} />
              </Suspense>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
