import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { enqueueDelete, enqueueUpsert, getUserId } from "@/lib/sync";
import { supabase } from "@/integrations/supabase/client";
import { formatRupiah, formatPlain, parseNumberInput, uid } from "@/lib/format";
import type { Product } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { Search, Plus, Pencil, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/produk")({
  head: () => ({
    meta: [
      { title: "Produk & Stok — POS Mie Ayam" },
      { name: "description", content: "Kelola menu, harga, dan stok." },
    ],
  }),
  component: ProdukPage,
});

type Draft = Omit<Product, "user_id" | "created_at" | "updated_at"> & {
  user_id?: string;
  created_at?: string;
};

const emptyDraft: Draft = {
  id: "",
  name: "",
  category: "Makanan",
  price: 0,
  stock: 0,
  track_stock: false,
  active: true,
};

const SAMPLE_PRODUCTS = [
  {
    name: "Mie Ayam Biasa",
    category: "Makanan",
    price: 15000,
    stock: 50,
    track_stock: false,
    active: true,
  },
  {
    name: "Mie Ayam Bakso",
    category: "Makanan",
    price: 20000,
    stock: 50,
    track_stock: false,
    active: true,
  },
  {
    name: "Mie Ayam Pangsit",
    category: "Makanan",
    price: 18000,
    stock: 50,
    track_stock: false,
    active: true,
  },
  {
    name: "Mie Ayam Komplit",
    category: "Makanan",
    price: 24000,
    stock: 50,
    track_stock: false,
    active: true,
  },
  {
    name: "Bakso Kuah (Porsi)",
    category: "Makanan",
    price: 15000,
    stock: 30,
    track_stock: false,
    active: true,
  },
  {
    name: "Pangsit Goreng",
    category: "Tambahan",
    price: 3000,
    stock: 100,
    track_stock: false,
    active: true,
  },
  {
    name: "Es Teh Manis",
    category: "Minuman",
    price: 5000,
    stock: 100,
    track_stock: false,
    active: true,
  },
  {
    name: "Es Jeruk",
    category: "Minuman",
    price: 7000,
    stock: 100,
    track_stock: false,
    active: true,
  },
];

function ProdukPage() {
  const products = useLiveQuery(async () => {
    try {
      const all = await db.products.toArray();
      return all.sort((a, b) => a.name.localeCompare(b.name, "id-ID"));
    } catch {
      return [];
    }
  }, []);

  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [seeding, setSeeding] = useState(false);

  const filtered = (products ?? []).filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );

  async function resolveUserId(): Promise<string> {
    const current = getUserId();
    if (current) return current;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? "anonymous";
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error("Nama menu wajib diisi");
      return;
    }
    const userId = await resolveUserId();
    const now = new Date().toISOString();
    const existing = draft.id ? await db.products.get(draft.id) : undefined;
    const row: Product = {
      id: draft.id || uid(),
      user_id: userId,
      name: draft.name.trim(),
      category: draft.category.trim() || "Makanan",
      price: draft.price,
      stock: draft.track_stock ? draft.stock : 0,
      track_stock: draft.track_stock,
      active: draft.active,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await db.products.put(row);
    await enqueueUpsert("products", row);
    setDraft(null);
    toast.success(existing ? "Menu diperbarui" : "Menu ditambahkan");
  }

  async function remove(product: Product) {
    await db.products.delete(product.id);
    await enqueueDelete("products", product.id);
    setDeleteTarget(null);
    toast.success("Menu dihapus");
  }

  async function handleSeedSampleProducts() {
    setSeeding(true);
    try {
      const userId = await resolveUserId();
      const now = new Date().toISOString();
      for (const item of SAMPLE_PRODUCTS) {
        const row: Product = {
          id: uid(),
          user_id: userId,
          ...item,
          created_at: now,
          updated_at: now,
        };
        await db.products.put(row);
        await enqueueUpsert("products", row);
      }
      toast.success("Menu contoh berhasil ditambahkan!");
    } catch {
      toast.error("Gagal menambahkan menu contoh");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold">Produk &amp; Stok</h1>
        <Button size="sm" onClick={() => setDraft({ ...emptyDraft })}>
          <Plus className="mr-1 h-4 w-4" /> Tambah
        </Button>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari menu…"
          className="pl-9"
        />
      </div>

      <div className="space-y-2">
        {filtered.map((product) => (
          <div
            key={product.id}
            className="flex items-center justify-between rounded-xl border border-border bg-card p-3 shadow-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {product.name}
                {!product.active && (
                  <span className="ml-2 text-[10px] font-medium text-muted-foreground">
                    (nonaktif)
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {product.category} · {formatRupiah(product.price)} ·{" "}
                {product.track_stock ? `Stok ${product.stock}` : "tanpa stok"}
              </p>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setDraft({ ...product })}
                className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => setDeleteTarget(product)}
                className="rounded-lg p-2 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}

        {!filtered.length && (
          <div className="rounded-2xl border border-dashed border-border py-10 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              {search ? "Menu tidak ditemukan." : "Belum ada menu produk."}
            </p>
            {!search && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSeedSampleProducts}
                disabled={seeding}
                className="gap-1.5 text-xs text-primary"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {seeding ? "Memuat…" : "Muat Contoh Menu Mie Ayam"}
              </Button>
            )}
          </div>
        )}
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Ubah Menu" : "Menu Baru"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Nama menu</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Mie Ayam Biasa"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Kategori</Label>
                  <Input
                    value={draft.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Harga (Rp)</Label>
                  <Input
                    inputMode="numeric"
                    value={draft.price ? formatPlain(draft.price) : ""}
                    onChange={(e) =>
                      setDraft({ ...draft, price: parseNumberInput(e.target.value) })
                    }
                  />
                </div>
              </div>
              {draft.track_stock && (
                <div className="space-y-1.5">
                  <Label>Stok</Label>
                  <Input
                    inputMode="numeric"
                    value={formatPlain(draft.stock)}
                    onChange={(e) =>
                      setDraft({ ...draft, stock: parseNumberInput(e.target.value) })
                    }
                  />
                </div>
              )}
              <div className="flex items-center justify-between rounded-xl border border-border p-3">
                <Label htmlFor="track-stock">Kelola stok</Label>
                <Switch
                  id="track-stock"
                  checked={draft.track_stock}
                  onCheckedChange={(v) => setDraft({ ...draft, track_stock: v })}
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border p-3">
                <Label htmlFor="active">Tampil di kasir</Label>
                <Switch
                  id="active"
                  checked={draft.active}
                  onCheckedChange={(v) => setDraft({ ...draft, active: v })}
                />
              </div>
              <Button onClick={save} className="w-full">
                Simpan
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus menu?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name} akan dihapus dari daftar menu.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && remove(deleteTarget)}>
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
