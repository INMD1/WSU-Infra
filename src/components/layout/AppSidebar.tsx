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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useDashboard } from "@/app/dashboard/_hooks/useDashboard";

type UserProfileProps = {
  userdata: Object;
};

export function AppSidebar({ userdata }: UserProfileProps) {
  const dash = useDashboard();
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
      <SidebarFooter className="border-t border-hairline p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center justify-between rounded-lg px-2 py-2 transition-colors hover:bg-muted">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-primary text-on-primary text-sm font-semibold">
                    {/*@ts-ignore */}
                    {userdata?.username?.charAt(0)?.toUpperCase() || 'W'}
                  </AvatarFallback>
                </Avatar>

                <div className="text-left">
                  <p className="text-sm font-medium text-ink">
                    {/*@ts-ignore */}
                    {userdata?.username || '사용자'}
                  </p>
                  <p className="text-muted-soft text-xs">
                    우송대 인프라 플랜
                  </p>
                </div>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation()
                  setTheme(isDark ? 'light' : 'dark')
                }}
                className="h-9 w-9"
              >
                {isDark ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </Button>
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={dash.handleLogout}>로그아웃</DropdownMenuItem>
              
              <DropdownMenuItem
                onClick={() => setTheme(isDark ? 'light' : 'dark')}
              >
                {isDark ? '라이트 모드' : '다크 모드'}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
