import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Avatar } from '../Avatar';
import { RestrictedCell } from '../RestrictedCell';

export type ActivityEvent = { id: string; actor: string; action: ReactNode; time?: string; previous?: string; next?: string; sensitive?: boolean };
export type ActivityDay = { day: string; events: ActivityEvent[] };

export function ActivityFeed({ days }: { days: ActivityDay[] }) {
  return (
    <div className="feed">
      {days.map((d) => (
        <section key={d.day}>
          <h3 className="feed__day">{d.day}</h3>
          <ul className="feed__list">
            {d.events.map((e) => (
              <li key={e.id} className="feed__row">
                <Avatar name={e.actor} size={20} />
                <div className="feed__body">
                  <span><strong style={{ fontWeight: 500 }}>{e.actor}</strong> {e.action}</span>
                  {e.sensitive
                    ? <RestrictedCell />
                    : e.previous != null && <span className="feed__change">{e.previous}<ArrowRight size={14} strokeWidth={1.5} aria-label="to" />{e.next}</span>}
                </div>
                {e.time && <time className="feed__time">{e.time}</time>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
