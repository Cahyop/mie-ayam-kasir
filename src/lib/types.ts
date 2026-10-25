export type Product = {
  id: string;
  user_id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  track_stock: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type Customer = {
  id: string;
  user_id: string;
  name: string;
  phone: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentMethod = "cash" | "qris";
export type ItemOrderType = "dine_in" | "take_away";
export type OrderType = "dine_in" | "take_away" | "mixed";

export type Transaction = {
  id: string;
  user_id: string;
  receipt_no: string;
  customer_id: string | null;
  payment_method: PaymentMethod;
  subtotal: number;
  discount: number;
  total: number;
  paid_amount: number;
  change_amount: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  shift_id?: string | null;
  order_type?: OrderType;
};

export type TransactionItem = {
  id: string;
  user_id: string;
  transaction_id: string;
  product_id: string | null;
  name: string;
  qty: number;
  price: number;
  total: number;
  order_type?: ItemOrderType;
  created_at?: string;
  updated_at: string;
};

export type CashFlowType = "modal" | "in" | "out";

export type CashFlow = {
  id: string;
  user_id: string;
  type: CashFlowType;
  amount: number;
  note: string | null;
  occurred_at: string;
  created_at: string;
  updated_at: string;
};

export type Settings = {
  user_id: string;
  store_name: string;
  store_address: string | null;
  store_phone: string | null;
  receipt_footer: string;
  paper_width: "58" | "80";
  updated_at: string;
};

export type CartItem = {
  product_id: string | null;
  name: string;
  price: number;
  qty: number;
  order_type?: ItemOrderType;
};

export type ReceiptItemData = {
  name: string;
  qty: number;
  price: number;
  total: number;
  orderType?: ItemOrderType;
};

export type ReceiptData = {
  receiptNo: string;
  createdAt: string;
  storeName: string;
  storeAddress: string | null;
  storePhone: string | null;
  footer: string;
  items: ReceiptItemData[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: PaymentMethod;
  paidAmount: number;
  changeAmount: number;
  customerName?: string | null;
  orderType?: OrderType;
};

export type OutboxTable =
  "products" | "customers" | "transactions" | "transaction_items" | "cash_flows" | "settings";

export type OutboxEntry = {
  seq?: number;
  table: OutboxTable;
  op: "upsert" | "delete";
  row: Record<string, unknown>;
};

export type SyncStatus = "idle" | "syncing" | "offline" | "error";

export const SYNC_TABLES: OutboxTable[] = [
  "products",
  "customers",
  "transactions",
  "transaction_items",
  "cash_flows",
];

export type RegisterShift = {
  id: string;
  user_id: string;
  date: string;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  initial_cash: number;
  actual_cash?: number | null;
  expected_cash?: number | null;
  difference?: number | null;
  notes?: string | null;
};

export type ShiftSummary = {
  shiftId: string;
  openedAt: string;
  closedAt: string;
  initialCash: number;
  cashSales: number;
  cashTxCount: number;
  qrisSales: number;
  qrisTxCount: number;
  totalSales: number;
  totalTxCount: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  actualCash: number;
  difference: number;
  notes?: string | null;
};
