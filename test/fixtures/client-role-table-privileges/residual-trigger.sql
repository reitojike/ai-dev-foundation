create table public.orders (id int primary key);
grant trigger on public.orders to authenticated;
