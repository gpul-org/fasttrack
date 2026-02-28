self.addEventListener("push", (event) => {
  if (!event.data) {
    return
  }

  let payload = null
  try {
    payload = event.data.json()
  } catch {
    payload = { body: event.data.text() }
  }

  const title = payload?.title || "Queue update"
  const options = {
    body: payload?.body || "You have a queue update.",
    icon: "/icon.png",
    badge: "/icon.png",
    data: payload?.data || {}
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            return client.focus()
          }
        }
        if (clients.openWindow) {
          return clients.openWindow("/dashboard/queues")
        }
        return null
      })
  )
})
