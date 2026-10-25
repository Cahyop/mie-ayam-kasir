import { db } from "./db";
import { getUserId } from "./sync";
import { uid } from "./format";
import { computeTransactionOrderType } from "./sales";
import type { CartItem, DraftOrder, OrderType } from "./types";

export const POS_DRAFT_ORDERS_KEY = "pos_draft_orders";

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
        const parsed = JSON.parse(raw) as DraftOrder[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          await db.draft_orders.bulkPut(parsed);
          return await db.draft_orders.orderBy("updated_at").reverse().toArray();
        }
      }
    } else if (count > 0) {
      await syncDraftsToLocalStorage();
    }
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
      const { supabase } = await import("@/integrations/supabase/client");
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
  return newDraft;
}

export async function deleteDraftOrder(id: string): Promise<void> {
  await db.draft_orders.delete(id);
  await syncDraftsToLocalStorage();
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
