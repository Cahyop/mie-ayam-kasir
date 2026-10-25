import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ShoppingCart, ReceiptText, Package, Wallet, Menu, Soup } from "lucide-react";
import { db } from "@/lib/db";
import { useLiveQuery } from "dexie-react-hooks";
import { SyncChip } from "@/components/sync-chip";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/kasir", label: "Kasir", icon: ShoppingCart },
  { to: "/riwayat", label: "Riwayat", icon: ReceiptText },
  { to: "/produk", label: "Produk", icon: Package },
  { to: "/kas", label: "Kas", icon: Wallet },
  { to: "/lainnya", label: "Lainnya", icon: Menu },
] as const;

export function AppLayout({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const settings = useLiveQuery(async () => (await db.settings.toArray())[0], []);
  const [storeName, setStoreName] = useState("Mie Ayam");

  useEffect(() => {
    if (settings?.store_name) setStoreName(settings.store_name);
  }, [settings?.store_name]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-card px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Soup className="h-5 w-5" />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-bold text-foreground">{storeName}</p>
              <p className="text-[11px] text-muted-foreground">Mode kasir</p>
            </div>
          </div>
          <SyncChip />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-4">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-3xl grid-cols-5">
          {TABS.map((tab) => {
            const active = pathname === tab.to;
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <tab.icon className={cn("h-5 w-5", active && "stroke-[2.4]")} />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
