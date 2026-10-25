import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Atur Password Baru — POS Mie Ayam" },
      { name: "description", content: "Buat password baru untuk akun POS Mie Ayam Anda." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const isRecovery = window.location.hash.includes("type=recovery");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password berhasil diubah");
      await navigate({ to: "/kasir" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengubah password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5">
        <h1 className="text-lg font-bold text-foreground">Atur password baru</h1>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          {isRecovery
            ? "Buat password baru untuk akun Anda."
            : "Tautan tidak valid. Buka ulang tautan dari email."}
        </p>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="password">Password baru</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimal 6 karakter"
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy || !isRecovery}>
            {busy ? "Menyimpan…" : "Simpan password"}
          </Button>
        </form>
      </div>
    </div>
  );
}
