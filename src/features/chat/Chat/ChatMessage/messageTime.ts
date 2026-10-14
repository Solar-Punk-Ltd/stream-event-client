/** Hours and minutes on the viewer's own clock, 24 hour, as the design writes a message's time. */
export function messageTime(timestamp: number): string {
  const date = new Date(timestamp);
  const twoDigits = (value: number) => String(value).padStart(2, '0');
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}
