"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui";
import { MobileClose, Sidebar } from "./Sidebar";

const ShellContext = createContext<{ openSidebar: () => void }>({ openSidebar: () => {} });
export const useShell = () => useContext(ShellContext);

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  // In a lesson the whiteboard gets the whole width; the sidebar slides in on demand.
  const immersive = path.startsWith("/learn/");

  useEffect(() => setOpen(false), [path]);

  // The page a lesson video is recorded from is the board alone.
  if (path.startsWith("/render/")) return <>{children}</>;

  return (
    <ShellContext.Provider value={{ openSidebar: () => setOpen(true) }}>
      <div className="print-flow flex h-dvh overflow-hidden">
        <aside
          className={cn(
            "no-print fixed inset-y-0 left-0 z-40 w-[264px] shrink-0 border-r border-line bg-surface transition-transform",
            !immersive && "lg:static lg:translate-x-0",
            open ? "translate-x-0 shadow-2xl" : "-translate-x-full",
          )}
        >
          <div className={cn(!immersive && "lg:hidden")}>
            <MobileClose onClick={() => setOpen(false)} />
          </div>
          <Sidebar onNavigate={() => setOpen(false)} />
        </aside>
        {open && <div className={cn("fixed inset-0 z-30 bg-black/50 backdrop-blur-sm", !immersive && "lg:hidden")} onClick={() => setOpen(false)} />}

        <div className="print-flow flex min-w-0 flex-1 flex-col">
          <div className="no-print flex h-12 shrink-0 items-center gap-3 border-b border-line px-3 lg:hidden">
            <button aria-label="Open menu" onClick={() => setOpen(true)} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-white/5">
              <Menu size={18} />
            </button>
            <Logo size={24} />
            <span className="text-sm font-semibold">ConceptAI</span>
          </div>
          <main className="print-flow min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </ShellContext.Provider>
  );
}
