import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Soup } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Masuk — POS Mie Ayam" },
      { name: "description", content: "Masuk atau daftar akun POS Mie Ayam Anda." },
    ],
  }),
  beforeLoad: () => undefined,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  async function afterAuth() {
    await navigate({ to: "/kasir" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setInfo(null);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (data.session) {
          await afterAuth();
        } else {
          setInfo(
            "Pendaftaran berhasil! Buka email Anda dan klik tautan konfirmasi untuk mengaktifkan akun.",
          );
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await afterAuth();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Terjadi kesalahan");
    } finally {
      setBusy(false);
    }
  }

  async function social(provider: "google" | "lovable") {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
      if (!result.redirected) await afterAuth();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal masuk");
    } finally {
      setBusy(false);
    }
  }

  async function forgotPassword() {
    if (!email) {
      toast.error("Isi email dulu, lalu tekan Lupa password");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success("Email atur ulang password dikirim, cek kotak masuk Anda");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengirim email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Soup className="h-9 w-9" />
          </span>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">POS Mie Ayam</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Kasir, struk, kas, stok &amp; pelanggan — bisa dipakai offline
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-md py-2 text-sm font-semibold transition-colors",
                  mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {m === "signin" ? "Masuk" : "Daftar"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@email.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimal 6 karakter"
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Memproses…" : mode === "signin" ? "Masuk" : "Daftar"}
            </Button>
          </form>

          {mode === "signin" && (
            <button
              type="button"
              onClick={forgotPassword}
              className="mt-2 text-xs text-muted-foreground underline underline-offset-2"
            >
              Lupa password?
            </button>
          )}

          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] text-muted-foreground">atau</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={busy}
              onClick={() => social("google")}
            >
              Lanjut dengan Google
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={busy}
              onClick={() => social("lovable")}
            >
              Lanjut dengan Lovable
            </Button>
          </div>
        </div>

        {info && (
          <p className="mt-4 rounded-xl border border-border bg-muted/50 p-3 text-center text-xs text-foreground">
            {info}
          </p>
        )}
      </div>
    </div>
  );
}
