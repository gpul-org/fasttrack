import { DashboardBreadcrumb } from "@/components/dashboard-breadcrumb"
import { DashboardNav } from "@/components/dashboard-nav"
import { SidebarUser } from "@/components/sidebar-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider
} from "@/components/ui/sidebar"
import { FastForward } from "lucide-react"
import { Suspense } from "react"

export default function DashboardLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense>
      <SidebarProvider>
        <div className="dashboard-dark-gradient min-h-screen w-full">
          <Sidebar
            collapsible="none"
            className="fixed inset-y-0 left-0 z-30 w-48 border-r"
          >
            <SidebarHeader className="flex flex-row items-center justify-center gap-2 border-b p-4">
              <FastForward className="h-6 w-6" />
              <span className="text-lg font-semibold">FastTrack</span>
            </SidebarHeader>
            <SidebarContent>
              <Suspense>
                <DashboardNav />
              </Suspense>
            </SidebarContent>
            <SidebarFooter className="border-t p-4">
              <SidebarUser />
            </SidebarFooter>
          </Sidebar>
          <main className="min-h-screen overflow-auto pl-48">
            <div className="p-6">
              <Suspense>
                <DashboardBreadcrumb />
              </Suspense>
              <div className="mt-6">{children}</div>
            </div>
          </main>
        </div>
      </SidebarProvider>
    </Suspense>
  )
}
