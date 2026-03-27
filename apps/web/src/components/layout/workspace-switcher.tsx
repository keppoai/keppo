import { useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { KeppoMark } from "@/components/landing/keppo-logo";
import { useWorkspace } from "@/hooks/use-workspace-context";
import { WorkspaceCreateForm } from "@/components/workspaces/workspace-create-form";

export function WorkspaceSwitcher() {
  const { isMobile } = useSidebar();
  const { workspaces, selectedWorkspace, setSelectedWorkspaceId, createWorkspace } = useWorkspace();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
            <KeppoMark className="size-8 rounded-lg" />
            <div className="grid flex-1 text-left leading-tight">
              <span className="truncate text-base font-bold tracking-tight">Keppo</span>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="truncate text-xs text-muted-foreground">
                  {selectedWorkspace?.name ?? "Choose a workspace"}
                </span>
              </div>
            </div>
            <ChevronsUpDownIcon className="ml-auto" />
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              {workspaces.map((workspace) => (
                <DropdownMenuItem
                  key={workspace.id}
                  onClick={() => setSelectedWorkspaceId(workspace.id)}
                  className={`gap-2 p-2 ${selectedWorkspace?.id === workspace.id ? "bg-muted" : ""}`}
                >
                  <div className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary text-xs font-bold">
                    {workspace.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{workspace.name}</p>
                  </div>
                  {selectedWorkspace?.id === workspace.id ? (
                    <CheckIcon className="size-4 text-primary" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 p-2"
              onClick={(e) => {
                e.preventDefault();
                setDialogOpen(true);
              }}
            >
              <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                <PlusIcon className="size-4" />
              </div>
              <span className="font-medium text-muted-foreground">Create Workspace</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Workspace</DialogTitle>
              <DialogDescription>
                Start with safe defaults now, then adjust the advanced automation behavior later.
              </DialogDescription>
            </DialogHeader>
            <WorkspaceCreateForm
              onSubmit={async (values) => {
                await createWorkspace(values);
                setDialogOpen(false);
              }}
            />
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
