import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { enqueueDelete, enqueueUpsert, getUserId } from "@/lib/sync";
import { uid } from "@/lib/format";
import type { Customer } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Plus, Pencil, Trash2, Phone, MessageSquare, User } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pelanggan")({
  head: () => ({
    meta: [
      { title: "Pelanggan — POS Mie Ayam" },
      { name: "description", content: "Kelola database pelanggan, kontak, dan catatan." },
    ],
  }),
  component: PelangganPage,
});

type CustomerDraft = {
  id?: string;
  name: string;
  phone: string;
  note: string;
};

const emptyDraft: CustomerDraft = {
  name: "",
  phone: "",
  note: "",
};

function PelangganPage() {
  const customers = useLiveQuery(() => db.customers.orderBy("name").toArray(), []);
  const transactions = useLiveQuery(() => db.transactions.toArray(), []);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<CustomerDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);

  const filtered = (customers ?? []).filter((c) => {
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.phone && c.phone.includes(q)) ||
      (c.note && c.note.toLowerCase().includes(q))
    );
  });

  // Calculate order count per customer
  const orderCountByCustomer = (transactions ?? []).reduce<Record<string, number>>((acc, t) => {
    if (t.customer_id) {
      acc[t.customer_id] = (acc[t.customer_id] || 0) + 1;
    }
    return acc;
  }, {});

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error("Nama pelanggan wajib diisi");
      return;
    }
    const userId = getUserId();
    if (!userId) return;
    const now = new Date().toISOString();
    const existing = draft.id ? await db.customers.get(draft.id) : undefined;
    const row: Customer = {
      id: draft.id || uid(),
      user_id: userId,
      name: draft.name.trim(),
      phone: draft.phone.trim() || null,
      note: draft.note.trim() || null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    await db.customers.put(row);
    await enqueueUpsert("customers", row);
    setDraft(null);
    toast.success(existing ? "Data pelanggan diperbarui" : "Pelanggan baru ditambahkan");
  }

  async function remove(customer: Customer) {
    await db.customers.delete(customer.id);
    await enqueueDelete("customers", customer.id);
    setDeleteTarget(null);
    toast.success("Pelanggan dihapus");
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold">Pelanggan</h1>
        <Button size="sm" onClick={() => setDraft({ ...emptyDraft })}>
          <Plus className="mr-1 h-4 w-4" /> Tambah
        </Button>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama atau no. telepon…"
          className="pl-9"
        />
      </div>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            {search ? "Tidak ada pelanggan yang cocok." : "Belum ada data pelanggan."}
          </div>
        ) : (
          filtered.map((customer) => {
            const count = orderCountByCustomer[customer.id] ?? 0;
            return (
              <div
                key={customer.id}
                className="flex items-center justify-between rounded-xl border border-border bg-card p-3 shadow-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">{customer.name}</p>
                    {count > 0 && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                        {count} pesanan
                      </span>
                    )}
                  </div>
                  {customer.phone && (
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      <span>{customer.phone}</span>
                    </div>
                  )}
                  {customer.note && (
                    <p className="mt-1 line-clamp-1 text-xs italic text-muted-foreground">
                      "{customer.note}"
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {customer.phone && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-emerald-600 hover:text-emerald-700"
                      onClick={() => {
                        const digits = customer.phone!.replace(/\D/g, "").replace(/^0/, "62");
                        window.open(`https://wa.me/${digits}`, "_blank");
                      }}
                      title="Hubungi via WhatsApp"
                    >
                      <MessageSquare className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() =>
                      setDraft({
                        id: customer.id,
                        name: customer.name,
                        phone: customer.phone ?? "",
                        note: customer.note ?? "",
                      })
                    }
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(customer)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit Pelanggan" : "Tambah Pelanggan Baru"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nama Pelanggan *</Label>
              <Input
                value={draft?.name ?? ""}
                onChange={(e) => setDraft((d) => d && { ...d, name: e.target.value })}
                placeholder="mis. Pak Budi"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>No. Telepon / WhatsApp</Label>
              <Input
                type="tel"
                value={draft?.phone ?? ""}
                onChange={(e) => setDraft((d) => d && { ...d, phone: e.target.value })}
                placeholder="mis. 08123456789"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Catatan Khusus</Label>
              <Textarea
                rows={2}
                value={draft?.note ?? ""}
                onChange={(e) => setDraft((d) => d && { ...d, note: e.target.value })}
                placeholder="mis. Porsi banyak, kuah dipisah, langganan kantor"
              />
            </div>
            <Button onClick={save} className="w-full">
              Simpan
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Pelanggan?</AlertDialogTitle>
            <AlertDialogDescription>
              Data pelanggan "{deleteTarget?.name}" akan dihapus dari daftar. Transaksi yang sudah
              dicatat sebelumnya tidak akan terpengaruh.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && remove(deleteTarget)}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
