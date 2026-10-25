alter table public.transaction_items add column updated_at timestamptz not null default now();
create index transaction_items_updated_idx on public.transaction_items(user_id, updated_at);
create trigger trg_transaction_items_updated before update on public.transaction_items for each row execute function public.set_updated_at();
grant select, insert, update, delete on public.transaction_items to authenticated;
grant all on public.transaction_items to service_role;
