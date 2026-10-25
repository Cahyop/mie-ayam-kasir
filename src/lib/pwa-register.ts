// PWA service-worker registration wrapper.
// Registers only in published, non-preview contexts. In every refused context
// it unregisters any stale app service worker instead.

function hostnameMatches(hostname: string, suffixes: string[]): boolean {
  return suffixes.some((suffix) => hostname === suffix || hostname.endsWith(suffix));
}

function isPreviewContext(): boolean {
  const hostname = window.location.hostname.toLowerCase();

  if (!import.meta.env.PROD) return true;
  if (window.self !== window.top) return true;
  if (
    hostnameMatches(hostname, [
      "lovable.app",
      "gpt-eng.com",
      "gptengineer.run",
      "lovableproject.com",
      "lovableproject-dev.com",
      "beta.lovable.dev",
    ])
  ) {
    if (/^(?:id-preview|preview)(?:-[a-z0-9]+)?--.+$/.test(hostname)) return true;
    if (hostname.startsWith("project--")) return true;
    if (hostname === "lovable.app") return true;
  }
  if (window.location.search.includes("sw=off")) return true;
  return false;
}

export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  if (isPreviewContext()) {
    await unregisterAppServiceWorker();
    return;
  }

  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

export async function unregisterAppServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) =>
          registration.active?.scriptURL.endsWith("/sw.js"),
        )
        .map((registration) => registration.unregister()),
    );
  } catch {
    // ignore
  }
}
