-- ===== POS Mie Ayam: core tables =====

create table public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  category text not null default 'Makanan',
  price numeric(14,2) not null default 0,
  stock integer not null default 0,
  track_stock boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_user_idx on public.products(user_id);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  phone text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_user_idx on public.customers(user_id);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  receipt_no text not null,
  customer_id uuid,
  payment_method text not null default 'cash' check (payment_method in ('cash','qris')),
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  change_amount numeric(14,2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transactions_user_idx on public.transactions(user_id);
create index transactions_created_idx on public.transactions(user_id, created_at);

create table public.transaction_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  product_id uuid,
  name text not null,
  qty numeric(10,2) not null default 1,
  price numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0
);
create index transaction_items_txn_idx on public.transaction_items(transaction_id);
create index transaction_items_user_idx on public.transaction_items(user_id);

create table public.cash_flows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null check (type in ('modal','in','out')),
  amount numeric(14,2) not null default 0,
  note text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cash_flows_user_idx on public.cash_flows(user_id, occurred_at);

create table public.settings (
  user_id uuid primary key,
  store_name text not null default 'Mie Ayam',
  store_address text,
  store_phone text,
  receipt_footer text not null default 'Terima kasih atas kunjungan Anda!',
  paper_width text not null default '58' check (paper_width in ('58','80')),
  updated_at timestamptz not null default now()
);

-- ===== updated_at maintenance =====
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_products_updated before update on public.products for each row execute function public.set_updated_at();
create trigger trg_customers_updated before update on public.customers for each row execute function public.set_updated_at();
create trigger trg_transactions_updated before update on public.transactions for each row execute function public.set_updated_at();
create trigger trg_cash_flows_updated before update on public.cash_flows for each row execute function public.set_updated_at();
create trigger trg_settings_updated before update on public.settings for each row execute function public.set_updated_at();

-- ===== seed sample data for each new user =====
create or replace function public.seed_pos_for_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.settings (user_id, store_name)
  values (new.id, 'Mie Ayam')
  on conflict (user_id) do nothing;

  insert into public.products (user_id, name, category, price, stock, track_stock) values
    (new.id, 'Mie Ayam Biasa', 'Mie Ayam', 12000, 50, true),
    (new.id, 'Mie Ayam Pangsit', 'Mie Ayam', 15000, 50, true),
    (new.id, 'Mie Ayam Ceker', 'Mie Ayam', 15000, 50, true),
    (new.id, 'Mie Ayam Bakso', 'Mie Ayam', 17000, 50, true),
    (new.id, 'Mie Ayam Bakso Pangsit', 'Mie Ayam', 19000, 50, true),
    (new.id, 'Mie Ayam Jumbo', 'Mie Ayam', 18000, 50, true),
    (new.id, 'Pangsit Goreng (5 pcs)', 'Tambahan', 5000, 30, true),
    (new.id, 'Bakso Tambahan', 'Tambahan', 6000, 30, true),
    (new.id, 'Es Teh', 'Minuman', 5000, 100, true),
    (new.id, 'Es Jeruk', 'Minuman', 6000, 100, true),
    (new.id, 'Teh Panas', 'Minuman', 4000, 100, true);
  return new;
exception when others then
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.seed_pos_for_new_user();

-- ===== RLS + GRANT =====
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_items enable row level security;
alter table public.cash_flows enable row level security;
alter table public.settings enable row level security;

create policy "products owner all" on public.products for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "customers owner all" on public.customers for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "transactions owner all" on public.transactions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "transaction_items owner all" on public.transaction_items for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "cash_flows owner all" on public.cash_flows for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "settings owner all" on public.settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.transaction_items to authenticated;
grant select, insert, update, delete on public.cash_flows to authenticated;
grant select, insert, update, delete on public.settings to authenticated;
grant all on public.products to service_role;
grant all on public.customers to service_role;
grant all on public.transactions to service_role;
grant all on public.transaction_items to service_role;
grant all on public.cash_flows to service_role;
grant all on public.settings to service_role;
grant execute on function public.seed_pos_for_new_user() to service_role;
grant execute on function public.set_updated_at() to authenticated, service_role;
