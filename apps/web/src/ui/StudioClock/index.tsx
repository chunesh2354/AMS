import { useEffect, useState } from 'react';
import './StudioClock.css';

export type StudioClockProps = {
  /** The line above the time. */
  place?: string;
  /** What a screen reader hears before the time, as in "Studio time 14:05". */
  label?: string;
  /** IANA time zone. The studios work in India, so the default is Asia/Kolkata. */
  timeZone?: string;
};

/** How often the clock reads the time. Minutes are all it shows, so 15 s keeps it within a quarter minute. */
export const CLOCK_TICK_MS = 15_000;

/** "Sunday 8 November 2026": built from parts, so no browser adds a comma after the weekday. */
function dateLine(now: Date, timeZone?: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')} ${part('year')}`;
}

function read(now: Date, timeZone: string) {
  try {
    return { time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }), date: dateLine(now, timeZone) };
  } catch {
    // An unknown zone: show the device time rather than nothing.
    return { time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), date: dateLine(now) };
  }
}

/** The studio's local time, large and light, for the quiet side of the sign-in pages. */
export function StudioClock({ place = 'Studio time, Mumbai', label = 'Studio time', timeZone = 'Asia/Kolkata' }: StudioClockProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  const { time, date } = read(now, timeZone);
  return (
    <div className="studio-clock">
      <p className="studio-clock__place">{place}</p>
      <p className="studio-clock__time" role="img" aria-label={`${label} ${time}`}>{time}</p>
      <p className="studio-clock__date">{date}</p>
    </div>
  );
}
