create table public.clean_table (id int primary key);
grant select on public.clean_table to anon, authenticated;
