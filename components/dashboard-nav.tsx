"use client"

import { Separator } from "@/components/ui/separator"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from "@/components/ui/sidebar"
import {
  Clock3,
  DoorOpen,
  FileText,
  Gavel,
  Home,
  ShieldCheck,
  Trophy,
  Upload,
  UserCog,
  Users
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

const navItems = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: Home
  },
  {
    title: "Pending Users",
    href: "/dashboard/pending-users",
    icon: UserCog,
    separatorAfter: true
  },
  {
    title: "Upload",
    href: "/dashboard/upload",
    icon: Upload
  },
  {
    title: "Participants",
    href: "/dashboard/participants",
    icon: Users
  },
  {
    title: "Projects",
    href: "/dashboard/projects",
    icon: FileText,
    separatorAfter: true
  },
  {
    title: "Judges",
    href: "/dashboard/judges",
    icon: Gavel
  },
  {
    title: "Challenges",
    href: "/dashboard/challenges",
    icon: Trophy
  },
  {
    title: "Rooms",
    href: "/dashboard/rooms",
    icon: DoorOpen,
    separatorAfter: false
  },
  {
    title: "Queues",
    href: "/dashboard/queues",
    icon: Clock3,
    separatorAfter: true
  },
  {
    title: "Admins",
    href: "/dashboard/admins",
    icon: ShieldCheck
  }
]

export function DashboardNav() {
  const pathname = usePathname()

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href

            return (
              <div key={item.href}>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    className={
                      isActive
                        ? "bg-secondary transition-colors duration-200"
                        : "transition-colors duration-200 hover:bg-accent hover:text-accent-foreground"
                    }
                  >
                    <Link href={item.href}>
                      <Icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {item.separatorAfter && (
                  <Separator className="mx-auto my-2 w-3/4" />
                )}
              </div>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
