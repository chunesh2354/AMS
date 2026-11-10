import { addDays, weekStart } from '@ams/domain';
import { ApiError, notFound } from '../../http/errors';
import { authorize, can, hasFirmCap, visibleProjects } from '../../auth/authorize';
import type { Actor } from '../../auth/actor';
import type { Tx } from '../../db/pool';
import { hours, list, money } from '../../http/responses';
import { isoDate, isUuid } from '../../http/validation';
import type { Api } from '../../http/api';
import { ACCOUNT_TYPES, TYPE_TO_SET, type AccountType } from '../accounts/accounts.routes';
import { localDate } from '../time/time.routes';

/**
 * People directory and person profile (/firm/people, /firm/people/:id). Read only: people are added and changed in
 * Settings, Accounts. GET /people keeps its original shape for existing callers; these are new routes beside it.
 *
 * Not here yet, because nothing stores them: a working schedule (so hours are shown without "vs schedule"),
 * leave today and leave balances (the leave tables are not part of the core path).
 */

const SET_TO_TYPE = Object.fromEntries(Object.entries(TYPE_TO_SET).map(([t, s]) => [s, t])) as Record<string, AccountType>;
const accountTypes = (setKeys: string[] | null) => {
  const have = new Set((setKeys ?? []).map((k) => SET_TO_TYPE[k]).filter(Boolean));
  return ACCOUNT_TYPES.filter((t) => have.has(t));
};

/** The directory tabs. `all` is every person; the default is the active staff list. */
const STATUS_SQL: Record<string, string> = {
  active: `p.employment_state = 'Active'`,
  invited: `p.invitation_state = 'Sent'`,
  pending: `p.employment_state = 'Pending start'`,
  deactivated: `p.employment_state = 'Ended'`,
  all: 'true',
};

/** Logged hours here are the same lines My time counts: everything except an amended original. */
const LOGGED_SQL = `approval_state <> 'Amended'`;
const RESTRICTED = { restricted: true } as const;

/** Today in the studio's timezone. */
async function studioToday(tx: Tx) {
  const tz = (await tx.query('select timezone from firm')).rows[0]?.timezone as string | undefined;
  return localDate(tz || 'Asia/Kolkata');
}
/** The week to report: the one holding ?week=YYYY-MM-DD, else the studio's current week. */
async function weekOf(tx: Tx, week: unknown) {
  return weekStart(week != null && week !== '' ? isoDate(week, 'week') : await studioToday(tx));
}

/**
 * Another person's logged hours are workload data: capacity.manage decides (principal and operations firm-wide,
 * PM and finance view only, staff their own). Anyone else gets {restricted:true}, never a zero.
 */
const canSeeHours = (actor: Actor, personId: string) => can(actor, 'capacity.manage', { read: true, ownerId: personId });
/** The same readers as GET /people/:id/rates: the bill rate managers and the cost rate viewers, firm-wide. */
const canSeeBillRate = (actor: Actor) => hasFirmCap(actor, 'rates.bill.manage') || hasFirmCap(actor, 'rates.cost.view');

const ref = (id: string | null, ref_code: string | null, name: string | null) => (id ? { id, ref_code, name } : null);

export function peopleRoutes(api: Api) {
  const { get } = api;

  get('/people/directory', async ({ tx, actor, query, req }) => {
    authorize(actor, 'people.view', { read: true });
    const status = (query.status ?? 'active') as string;
    if (typeof status !== 'string' || !STATUS_SQL[status]) {
      throw new ApiError(400, 'VALIDATION', 'Status is one of active, invited, pending, deactivated or all.', [{ field: 'status', code: 'enum' }]);
    }
    const start = await weekOf(tx, query.week);
    const end = addDays(start, 6);
    const rows = (await tx.query(
      `select p.id, p.ref_code, p.name, p.job_title, p.employment_state, p.login_state, p.invitation_state,
              m.id as manager_id, m.ref_code as manager_ref, m.name as manager_name,
              (select count(*)::int from project_membership pm join project pr on pr.id = pm.project_id
                where pm.person_id = p.id and pr.status <> 'Archived') as projects_count,
              (select array_agg(distinct s.key) from permission_grant g join permission_set s on s.id = g.permission_set_id
                where g.person_id = p.id) as set_keys,
              coalesce((select sum(te.duration_hours) from time_entry te
                where te.person_id = p.id and te.service_date between $1 and $2 and te.${LOGGED_SQL}), 0) as logged
       from person p left join person m on m.id = p.manager_id
       where ${STATUS_SQL[status]}
       order by p.ref_code`,
      [start, end],
    )).rows;
    return {
      week_start: start,
      ...list(req, rows.map((r) => ({
        id: r.id, ref_code: r.ref_code, name: r.name, job_title: r.job_title,
        employment_state: r.employment_state, login_state: r.login_state, invitation_state: r.invitation_state,
        account_types: accountTypes(r.set_keys),
        manager: ref(r.manager_id, r.manager_ref, r.manager_name),
        projects_count: r.projects_count,
        this_week: { week_start: start, logged_hours: canSeeHours(actor, r.id) ? hours(r.logged) : RESTRICTED },
      }))),
    };
  });

  get('/people/:id/profile', async ({ tx, actor, params, query }) => {
    const key = String(params.id ?? '');
    const own = key === actor.id || key === actor.refCode;
    // Checked before the lookup, so someone without people.view cannot learn who exists.
    if (!own) authorize(actor, 'people.view', { read: true });
    if (!isUuid(key) && !/^[A-Za-z0-9-]{1,32}$/.test(key)) throw notFound('Person');
    const p = (await tx.query(
      `select p.id, p.ref_code, p.name, p.work_email, p.job_title, p.employment_state, p.login_state, p.invitation_state,
              m.id as manager_id, m.ref_code as manager_ref, m.name as manager_name
       from person p left join person m on m.id = p.manager_id where ${isUuid(key) ? 'p.id = $1' : 'p.ref_code = $1'}`,
      [key],
    )).rows[0];
    if (!p) throw notFound('Person');

    const setKeys = (await tx.query(
      `select distinct s.key from permission_grant g join permission_set s on s.id = g.permission_set_id where g.person_id = $1`, [p.id],
    )).rows.map((r) => r.key as string);

    // Memberships on projects the viewer cannot open are counted, not named.
    const visible = visibleProjects(actor);
    const memberships = (await tx.query(
      `select pr.id, pr.code, pr.name, pr.status, pm.project_role
       from project_membership pm join project pr on pr.id = pm.project_id
       where pm.person_id = $1 and pr.status <> 'Archived' order by pr.code`,
      [p.id],
    )).rows;
    const shown = memberships.filter((m) => visible === 'all' || visible.includes(m.id) || p.id === actor.id);

    // Recent time: the four weeks up to and including this one.
    const thisWeek = await weekOf(tx, query.week);
    const from = addDays(thisWeek, -21);
    let time: unknown = RESTRICTED;
    if (canSeeHours(actor, p.id)) {
      const sums = (await tx.query(
        `select (service_date - (extract(isodow from service_date)::int - 1))::text as week_start,
                sum(duration_hours) as logged, coalesce(sum(duration_hours) filter (where approval_state = 'Approved'), 0) as approved
         from time_entry where person_id = $1 and service_date between $2 and $3 and ${LOGGED_SQL}
         group by 1`,
        [p.id, from, addDays(thisWeek, 6)],
      )).rows;
      const byWeek = new Map(sums.map((s) => [s.week_start as string, s]));
      time = {
        week_start: thisWeek,
        weeks: [0, 1, 2, 3].map((i) => {
          const w = addDays(from, i * 7);
          const s = byWeek.get(w);
          return { week_start: w, logged_hours: hours(s?.logged ?? 0), approved_hours: hours(s?.approved ?? 0) };
        }),
      };
    }

    // Firm-wide rates in force today. cost_rate is fenced by the serializer as well (rates.cost.view).
    const today = await studioToday(tx);
    const rates = (await tx.query(
      `select rate_type, amount, effective_from from rate_schedule
       where person_id = $1 and project_id is null and effective_from <= $2 and (effective_to is null or effective_to >= $2)`,
      [p.id, today],
    )).rows;
    const bill = rates.find((r) => r.rate_type === 'bill');
    const cost = rates.find((r) => r.rate_type === 'cost');
    const costOk = hasFirmCap(actor, 'rates.cost.view');
    const billOk = canSeeBillRate(actor);

    return {
      id: p.id, ref_code: p.ref_code, name: p.name, work_email: p.work_email, job_title: p.job_title,
      employment_state: p.employment_state, login_state: p.login_state, invitation_state: p.invitation_state,
      account_types: accountTypes(setKeys),
      manager: ref(p.manager_id, p.manager_ref, p.manager_name),
      projects: shown.map((m) => ({ id: m.id, code: m.code, name: m.name, status: m.status, role: m.project_role })),
      hidden_projects: memberships.length - shown.length,
      time,
      rates: {
        bill_rate: billOk ? money(bill?.amount) : RESTRICTED,
        bill_effective_from: billOk ? (bill?.effective_from ?? null) : null,
        cost_rate: costOk ? money(cost?.amount) : RESTRICTED,
        cost_effective_from: costOk ? (cost?.effective_from ?? null) : null,
      },
    };
  });
}
