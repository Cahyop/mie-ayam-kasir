import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "POS Mie Ayam" }, { name: "description", content: "Aplikasi kasir Mie Ayam" }],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/kasir" });
  },
});
