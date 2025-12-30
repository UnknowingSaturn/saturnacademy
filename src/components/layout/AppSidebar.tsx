import * as React from "react";
import { 
  LayoutDashboard, 
  BookOpen, 
  FileText, 
  Upload,
  TrendingUp,
  LogOut,
  Wallet,
  Activity,
  Copy,
  ChevronDown,
  Check,
  Building2
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { useAccountFilter } from "@/contexts/AccountFilterContext";
import { Button } from "@/components/ui/button";
import { useOpenTradesCount } from "@/hooks/useOpenTrades";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const mainItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Trade Journal", url: "/journal", icon: BookOpen },
  { title: "Live Trades", url: "/live-trades", icon: Activity },
  { title: "Playbooks", url: "/playbooks", icon: FileText },
];

const toolItems = [
  { title: "Trade Copier", url: "/copier", icon: Copy },
  { title: "Import Trades", url: "/import", icon: Upload },
  { title: "Accounts", url: "/accounts", icon: Wallet },
];

export const AppSidebar = React.forwardRef<HTMLDivElement, object>(
  function AppSidebar(_props, _ref) {
    const { state } = useSidebar();
    const collapsed = state === "collapsed";
    const { signOut, user } = useAuth();
    const openTradesCount = useOpenTradesCount();
    const { selectedAccountId, setSelectedAccountId, selectedAccount, accounts } = useAccountFilter();

    const getCopierRoleBadge = (role: string) => {
      switch (role) {
        case 'master':
          return <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-primary/10 text-primary border-primary/30">Master</Badge>;
        case 'receiver':
          return <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-blue-500/10 text-blue-500 border-blue-500/30">Receiver</Badge>;
        default:
          return null;
      }
    };

    return (
      <Sidebar collapsible="icon" className="border-r border-border bg-sidebar">
        <SidebarContent className="pt-4">
          {/* Logo */}
          <div className="px-4 pb-4 border-b border-sidebar-border mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-primary-foreground" />
              </div>
              {!collapsed && (
                <span className="font-semibold text-lg text-sidebar-foreground">TradeLog</span>
              )}
            </div>
          </div>

          {/* Account Selector */}
          <div className="px-3 pb-4 border-b border-sidebar-border mb-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    "w-full justify-start gap-2 px-2 h-auto py-2",
                    collapsed && "justify-center px-0"
                  )}
                >
                  <div className={cn(
                    "w-7 h-7 rounded-md flex items-center justify-center shrink-0",
                    selectedAccountId === "all" 
                      ? "bg-muted" 
                      : "bg-primary/10"
                  )}>
                    {selectedAccountId === "all" ? (
                      <Building2 className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <Wallet className="w-4 h-4 text-primary" />
                    )}
                  </div>
                  {!collapsed && (
                    <>
                      <div className="flex-1 text-left min-w-0">
                        <div className="text-sm font-medium truncate">
                          {selectedAccountId === "all" 
                            ? "All Accounts" 
                            : selectedAccount?.name || "Select Account"
                          }
                        </div>
                        {selectedAccount && (
                          <div className="text-xs text-muted-foreground truncate">
                            {selectedAccount.broker || "No broker"}
                          </div>
                        )}
                      </div>
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    </>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Select Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={() => setSelectedAccountId("all")}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-muted-foreground" />
                    <span>All Accounts</span>
                  </div>
                  {selectedAccountId === "all" && (
                    <Check className="w-4 h-4 text-primary" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {accounts.map((account) => (
                  <DropdownMenuItem
                    key={account.id}
                    onClick={() => setSelectedAccountId(account.id)}
                    className="flex items-center justify-between"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate">{account.name}</span>
                        {getCopierRoleBadge(account.copier_role)}
                      </div>
                      {account.broker && (
                        <div className="text-xs text-muted-foreground truncate">
                          {account.broker}
                        </div>
                      )}
                    </div>
                    {selectedAccountId === account.id && (
                      <Check className="w-4 h-4 text-primary shrink-0 ml-2" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Main Navigation */}
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground">
              {!collapsed && "Main"}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {mainItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild tooltip={item.title}>
                      <NavLink 
                        to={item.url} 
                        className="flex items-center gap-3 px-3 py-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                        activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                      >
                        <item.icon className="w-5 h-5 shrink-0" />
                        {!collapsed && <span className="flex-1">{item.title}</span>}
                        {item.url === '/live-trades' && openTradesCount > 0 && (
                          <Badge variant="secondary" className="ml-auto h-5 min-w-5 px-1.5 text-xs">
                            {openTradesCount}
                          </Badge>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Tools */}
          <SidebarGroup className="mt-6">
            <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground">
              {!collapsed && "Tools"}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {toolItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild tooltip={item.title}>
                      <NavLink 
                        to={item.url} 
                        className="flex items-center gap-3 px-3 py-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                        activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                      >
                        <item.icon className="w-5 h-5 shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3">
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar-foreground truncate">
                  {user?.email?.split('@')[0] || 'User'}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {user?.email || ''}
                </p>
              </div>
            )}
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={signOut}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>
    );
  }
);
