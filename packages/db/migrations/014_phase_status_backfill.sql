-- Phase status follows delivery progress (project and phase status, Nov 2026).
-- Until now nothing set a phase's status after creation, so phases made in the app stayed 'Not started' forever and
-- Health called finished work late. From here PUT /phases/:id/progress keeps status in step; this brings existing rows
-- in line once: a phase at 100% that is not closed becomes Complete, and a Not started phase with some progress
-- becomes In progress. Cancelled and Complete phases are left as they are. Safe to run again.
update phase set status = 'Complete', updated_at = now()
 where delivery_progress_pct = 100 and status in ('Not started', 'In progress');

update phase set status = 'In progress', updated_at = now()
 where delivery_progress_pct > 0 and delivery_progress_pct < 100 and status = 'Not started';
