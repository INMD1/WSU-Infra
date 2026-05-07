'use client';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "../ui/button";
import { Moon, Sun } from "lucide-react";

type UserProfileProps = {
  userdata: Object;
};

export function AppSidebar({ userdata }: UserProfileProps) {

  const { theme, setTheme } = useTheme();

  const isDark = theme === 'dark';
  return (
    <Sidebar>
      <SidebarHeader>
        <p className="text-xl font-semibold p-2">WSU Cloud Infra</p>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup />
        
        <SidebarGroup />
      </SidebarContent>
      <SidebarFooter className="border-t border-hairline">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-primary text-on-primary font-semibold text-sm">
                W
              </AvatarFallback>
            </Avatar>

            <div>
              {/*@ts-ignore*/}
              <p className="text-sm font-medium text-ink">{userdata.username}</p>
              <p className="text-muted-soft text-xs">
                우송대학교 클라우드 인프라
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="h-9 w-9"
          >
            {isDark ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
