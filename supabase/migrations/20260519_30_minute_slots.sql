-- Convert bookings.hour from "hour-of-day" (0..23) to
-- "minutes from midnight in 30-minute slots" (0..1410).
-- Example: 8 -> 480 (08:00), 19 -> 1140 (19:00)

begin;

alter table public.bookings
  drop constraint if exists bookings_hour_check;

update public.bookings
set hour = hour * 60
where hour between 0 and 23;

alter table public.bookings
  add constraint bookings_hour_check
  check (hour between 0 and 1410 and hour % 30 = 0);

commit;
