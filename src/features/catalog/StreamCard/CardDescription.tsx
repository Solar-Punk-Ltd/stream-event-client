import { parseDescription } from './streamDescription';

/**
 * A description as a card and a featured block lay it out: its lines as paragraphs, then its agenda with
 * each item's lead in bold. A last line ending in a colon introduces the agenda, and is set as its heading.
 */
export function CardDescription({ description }: { description: string | undefined }) {
  const { paragraphs, agenda } = parseDescription(description);
  if (paragraphs.length === 0 && agenda.length === 0) {
    return null;
  }

  const introducesAgenda = (i: number) =>
    agenda.length > 0 && i === paragraphs.length - 1 && paragraphs[i].endsWith(':');

  return (
    <div className="stream-card-description">
      {paragraphs.map((paragraph, i) => (
        <p key={`p-${i}`} className={introducesAgenda(i) ? 'stream-card-agenda-heading' : undefined}>
          {paragraph}
        </p>
      ))}
      {agenda.length > 0 && (
        <ul className="stream-card-agenda">
          {agenda.map(({ lead, text }, i) => (
            <li key={`a-${i}`}>
              {lead && <strong>{lead}</strong>} {text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
