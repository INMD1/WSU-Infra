'use client';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ThemeSelector } from '@/components/ThemeSelector'

type UserProfileProps = {
  userdata: string;
};

export function AppSidebar({ userdata }: UserProfileProps) {
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center justify-between">
          <p className="text-xl font-semibold">WSU Cloud Infra</p>
          <ThemeSelector />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup />
        <SidebarGroup />
      </SidebarContent>
      <SidebarFooter className="border-t border-hairline">
        <div className="grid grid-cols-1 items-center">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-primary text-on-primary font-semibold text-sm">
                W
              </AvatarFallback>
            </Avatar>

            <div>
              <p className="text-sm font-medium text-ink">{userdata}</p>
              <p className="text-muted-soft text-xs">우송대학교 클라우드 인프라</p>
            </div>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
