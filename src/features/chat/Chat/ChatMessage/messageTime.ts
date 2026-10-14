/** A message's time as the design writes it and as a `<time>` names it. */
export interface MessageTime {
  /** Hours and minutes on the viewer's own clock, 24 hour. */
  readonly shown: string;
  readonly iso: string;
}

/** Null for a time a date cannot hold, which a message from anybody may carry. */
export function messageTime(timestamp: number): MessageTime | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const twoDigits = (value: number) => String(value).padStart(2, '0');
  return { shown: `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`, iso: date.toISOString() };
}
