"use client"

import { createClient } from "@/lib/supabase/client"
import { useEffect, useRef } from "react"

interface PushSubscriptionManagerProps {
  userId: string | null
  role: "judge" | "admin" | null
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i)
  }

  return outputArray
}

export function PushSubscriptionManager({
  userId,
  role
}: PushSubscriptionManagerProps) {
  const registeredRef = useRef(false)

  useEffect(() => {
    if (registeredRef.current) return
    if (!userId || (role !== "judge" && role !== "admin")) return
    if (typeof window === "undefined") return
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return

    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!publicKey) return

    registeredRef.current = true

    const register = async () => {
      try {
        const permission = await Notification.requestPermission()
        if (permission !== "granted") return

        const registration = await navigator.serviceWorker.register(
          "/fasttrack-push-sw.js"
        )
        const existing = await registration.pushManager.getSubscription()
        const subscription =
          existing ||
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
          }))

        const subscriptionJson = subscription.toJSON()
        const endpoint = subscription.endpoint
        const p256dh = subscriptionJson.keys?.p256dh
        const auth = subscriptionJson.keys?.auth

        if (!endpoint || !p256dh || !auth) return

        const supabase = createClient()
        await supabase.from("push_subscriptions").upsert(
          {
            user_id: userId,
            endpoint,
            p256dh,
            auth
          },
          { onConflict: "user_id,endpoint" }
        )
      } catch (error) {
        console.error("Failed to register push subscription", error)
      }
    }

    void register()
  }, [role, userId])

  return null
}
