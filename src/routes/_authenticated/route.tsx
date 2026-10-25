import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/app-layout";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/auth" });
  },
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
});
