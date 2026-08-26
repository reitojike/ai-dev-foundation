create table public.clean_table (id int primary key);
grant select on public.clean_table to anon, authenticated;

create table public.leaky_table (id int primary key);
grant select on public.leaky_table to authenticated;
grant trigger on public.leaky_table to authenticated;
