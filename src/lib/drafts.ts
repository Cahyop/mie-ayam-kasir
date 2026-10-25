import { db } from "./db";
import { getUserId } from "./sync";
import { uid } from "./format";
import { computeTransactionOrderType } from "./sales";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { CartItem, DraftOrder, OrderType } from "./types";

export const POS_DRAFT_ORDERS_KEY = "pos_draft_orders";

let draftsChannel: RealtimeChannel | null = null;

export function getDraftsRealtimeChannel(userId: string): RealtimeChannel | null {
  if (typeof window === "undefined" || !userId || userId === "anonymous") return null;
  if (!draftsChannel) {
    initDraftsRealtime(userId);
  }
  return draftsChannel;
}

export function initDraftsRealtime(userId: string): () => void {
  if (typeof window === "undefined" || !userId || userId === "anonymous") {
    return () => undefined;
  }
  if (draftsChannel) {
    try {
      draftsChannel.unsubscribe();
    } catch {
      // ignore
    }
  }

  draftsChannel = supabase.channel(`drafts_sync_${userId}`, {
    config: { broadcast: { self: false } },
  });

  draftsChannel
    .on("broadcast", { event: "draft_updated" }, async ({ payload }) => {
      const draft = payload?.draft as DraftOrder | undefined;
      if (draft && draft.id) {
        await db.draft_orders.put({ ...draft, cloud_synced: true });
        await syncDraftsToLocalStorage();
      }
    })
    .on("broadcast", { event: "draft_deleted" }, async ({ payload }) => {
      const id = payload?.id as string | undefined;
      if (id) {
        await db.draft_orders.delete(id);
        await syncDraftsToLocalStorage();
      }
    })
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "customers",
        filter: `user_id=eq.${userId}`,
      },
      async (payload) => {
        if (payload.eventType === "DELETE") {
          const oldRow = payload.old as { id?: string } | undefined;
          if (oldRow?.id) {
            await db.draft_orders.delete(oldRow.id);
            await syncDraftsToLocalStorage();
          }
        } else if (payload.new) {
          const newRow = payload.new as { id?: string; name?: string; note?: string } | undefined;
          if (newRow?.name === "__DRAFT_ORDER__" && newRow.note) {
            try {
              const draft = JSON.parse(newRow.note) as DraftOrder;
              await db.draft_orders.put({ ...draft, cloud_synced: true });
              await syncDraftsToLocalStorage();
            } catch {
              // ignore
            }
          }
        }
      },
    )
    .subscribe();

  return () => {
    if (draftsChannel) {
      draftsChannel.unsubscribe();
      draftsChannel = null;
    }
  };
}

export async function pushDraftOrderToCloud(draft: DraftOrder): Promise<void> {
  try {
    let userId = getUserId();
    if (!userId || userId === "anonymous") {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    }
    if (!userId || userId === "anonymous") return;

    const payload: DraftOrder = {
      ...draft,
      cloud_synced: true,
    };

    const { error } = await supabase.from("customers").upsert({
      id: draft.id,
      user_id: userId,
      name: "__DRAFT_ORDER__",
      phone: draft.table_no || null,
      note: JSON.stringify(payload),
      created_at: draft.created_at || draft.updated_at || new Date().toISOString(),
      updated_at: draft.updated_at || new Date().toISOString(),
    });

    if (error) {
      console.warn("Gagal upsert draft order ke cloud:", error);
      return;
    }

    await db.draft_orders.update(draft.id, { cloud_synced: true });

    const channel = getDraftsRealtimeChannel(userId);
    if (channel) {
      void channel.send({
        type: "broadcast",
        event: "draft_updated",
        payload: { draft: payload },
      });
    }
  } catch (err) {
    console.warn("Gagal sinkron draft order ke cloud:", err);
  }
}

export async function deleteDraftOrderFromCloud(id: string): Promise<void> {
  try {
    let userId = getUserId();
    if (!userId || userId === "anonymous") {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    }
    if (!userId || userId === "anonymous") return;

    await supabase.from("customers").delete().eq("id", id).eq("name", "__DRAFT_ORDER__");

    const channel = getDraftsRealtimeChannel(userId);
    if (channel) {
      void channel.send({
        type: "broadcast",
        event: "draft_deleted",
        payload: { id },
      });
    }
  } catch (err) {
    console.warn("Gagal menghapus draft order dari cloud:", err);
  }
}

export async function pullDraftOrdersFromCloud(): Promise<DraftOrder[]> {
  try {
    let userId = getUserId();
    if (!userId || userId === "anonymous") {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    }
    if (!userId || userId === "anonymous") return [];

    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("user_id", userId)
      .eq("name", "__DRAFT_ORDER__");

    if (error || !data) return [];

    const cloudDrafts: DraftOrder[] = [];
    for (const row of data) {
      try {
        if (row.note) {
          const parsed = JSON.parse(row.note as string) as DraftOrder;
          cloudDrafts.push({ ...parsed, cloud_synced: true });
        }
      } catch {
        // ignore
      }
    }

    const localDrafts = await db.draft_orders.toArray();
    const cloudIds = new Set(cloudDrafts.map((d) => d.id));

    // Handle local drafts yang tidak ada di cloud:
    // Jika sebelumnya sudah pernah disinkron ke cloud (cloud_synced === true), berarti sudah dibayar/dihapus di device lain
    // Jika belum pernah disinkron (dibuat offline), upload ke cloud
    for (const local of localDrafts) {
      if (!cloudIds.has(local.id)) {
        if (local.cloud_synced) {
          await db.draft_orders.delete(local.id);
        } else {
          void pushDraftOrderToCloud(local);
        }
      }
    }

    if (cloudDrafts.length > 0) {
      await db.draft_orders.bulkPut(cloudDrafts);
    }
    await syncDraftsToLocalStorage();

    return await db.draft_orders.orderBy("updated_at").reverse().toArray();
  } catch (err) {
    console.warn("Gagal menarik draft orders dari cloud:", err);
    return [];
  }
}

async function syncDraftsToLocalStorage(): Promise<void> {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const drafts = await db.draft_orders.toArray();
    localStorage.setItem(POS_DRAFT_ORDERS_KEY, JSON.stringify(drafts));
  } catch {
    // ignore
  }
}

export async function ensureDraftOrdersRestored(): Promise<DraftOrder[]> {
  try {
    const count = await db.draft_orders.count();
    if (count === 0 && typeof window !== "undefined" && window.localStorage) {
      const raw = localStorage.getItem(POS_DRAFT_ORDERS_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as DraftOrder[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            await db.draft_orders.bulkPut(parsed);
          }
        } catch {
          // ignore
        }
      }
    } else if (count > 0) {
      await syncDraftsToLocalStorage();
    }

    // Selalu tarik versi terkini dari Supabase Cloud agar sinkron antar perangkat
    void pullDraftOrdersFromCloud();

    return await db.draft_orders.orderBy("updated_at").reverse().toArray();
  } catch {
    return [];
  }
}

export type SaveDraftInput = {
  id?: string | null;
  tableNo: string | null;
  customerName?: string | null;
  customerId?: string | null;
  note?: string | null;
  items: CartItem[];
  orderType?: OrderType;
  discount?: number;
};

export async function saveDraftOrder(input: SaveDraftInput): Promise<DraftOrder> {
  let userId = getUserId();
  if (!userId) {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? "anonymous";
    } catch {
      userId = "anonymous";
    }
  }

  const now = new Date().toISOString();
  const computedType = input.orderType || computeTransactionOrderType(input.items);

  if (input.id) {
    const existing = await db.draft_orders.get(input.id);
    if (existing) {
      const updated: DraftOrder = {
        ...existing,
        table_no: input.tableNo?.trim() || null,
        customer_name: input.customerName?.trim() || null,
        customer_id: input.customerId || null,
        note: input.note?.trim() || null,
        items: input.items,
        order_type: computedType,
        discount: input.discount ?? existing.discount ?? 0,
        updated_at: now,
      };
      await db.draft_orders.put(updated);
      await syncDraftsToLocalStorage();
      void pushDraftOrderToCloud(updated);
      return updated;
    }
  }

  const newDraft: DraftOrder = {
    id: uid(),
    user_id: userId,
    table_no: input.tableNo?.trim() || null,
    customer_name: input.customerName?.trim() || null,
    customer_id: input.customerId || null,
    note: input.note?.trim() || null,
    items: input.items,
    order_type: computedType,
    discount: input.discount ?? 0,
    created_at: now,
    updated_at: now,
  };
  await db.draft_orders.put(newDraft);
  await syncDraftsToLocalStorage();
  void pushDraftOrderToCloud(newDraft);
  return newDraft;
}

export async function deleteDraftOrder(id: string): Promise<void> {
  await db.draft_orders.delete(id);
  await syncDraftsToLocalStorage();
  void deleteDraftOrderFromCloud(id);
}

export async function getDraftOrder(id: string): Promise<DraftOrder | undefined> {
  return db.draft_orders.get(id);
}

export async function getDraftOrders(): Promise<DraftOrder[]> {
  const list = await db.draft_orders.orderBy("updated_at").reverse().toArray();
  if (list.length === 0) {
    return ensureDraftOrdersRestored();
  }
  return list;
}

export function formatTimeAgo(dateIso: string): string {
  const diffMs = Date.now() - new Date(dateIso).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Baru saja";
  if (diffMins < 60) return `${diffMins} mnt lalu`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} jam lalu`;
  return `${Math.floor(diffHours / 24)} hari lalu`;
}
