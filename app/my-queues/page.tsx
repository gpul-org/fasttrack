import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Suspense } from "react"
import MyQueuesClient from "./my-queues-client"

function MyQueuesFallback() {
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle>Your queue status</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Loading queue status...
        </CardContent>
      </Card>
    </main>
  )
}

export default function MyQueuesPage() {
  return (
    <Suspense fallback={<MyQueuesFallback />}>
      <MyQueuesClient />
    </Suspense>
  )
}
