create table public.orders (id int primary key);
grant select on public.orders to authenticated;
grant references on public.orders to authenticated;
