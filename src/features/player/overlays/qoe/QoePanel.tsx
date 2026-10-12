import React, { useEffect, useState } from 'react';

import { type QoeRow, qoeContent } from './qoeContent';
import {
  copyQoeExport,
  QOE_COPIED,
  QOE_COPY_REFUSED,
  qoeExportFileName,
  qoeExportJson,
  saveQoeExport,
} from './qoeExport';
import type { QoeMetrics } from './useHlsQoeMetrics';

/** What the toggle and the panel's region are called for a screen reader. */
export const QOE_PANEL_NAME = 'QoE metrics';

/** How long a word under the header stays: long enough to read, short enough not to linger over the metrics. */
const NOTICE_MS = { copied: 2_000, refused: 8_000 } as const;

/**
 * The panel: the content `qoeContent` builds, top to bottom, and in its header Copy and Save, which export that same
 * content as JSON. `release` is the viewer's build label, and `topic` names the stream in the saved file's name.
 * Ported from Nandor Komlodi's panel in the streaming monorepo's client.
 */
export const QoePanel: React.FC<{ metrics: QoeMetrics; release: string | null; topic?: string }> = ({
  metrics,
  release,
  topic,
}) => {
  const content = qoeContent(metrics, release);
  const [notice, setNotice] = useState<{ text: string; ms: number } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.ms);
    return () => clearTimeout(timer);
  }, [notice]);

  const copy = async () => {
    const outcome = await copyQoeExport(qoeExportJson(content));
    setNotice(
      outcome === 'copied'
        ? { text: QOE_COPIED, ms: NOTICE_MS.copied }
        : { text: QOE_COPY_REFUSED, ms: NOTICE_MS.refused },
    );
  };

  const save = () => {
    saveQoeExport(qoeExportJson(content), qoeExportFileName(topic, new Date()));
  };

  return (
    <div className="qoe-overlay__panel" role="region" aria-label={QOE_PANEL_NAME} tabIndex={0}>
      <div className="qoe-overlay__header">
        <span className="qoe-overlay__title">{content.title}</span>
        <span className="qoe-overlay__actions">
          <button
            type="button"
            className="qoe-overlay__action"
            onClick={() => void copy()}
            title="Copy what the panel shows, as JSON"
          >
            Copy
          </button>
          <button
            type="button"
            className="qoe-overlay__action"
            onClick={save}
            title="Save what the panel shows, as a JSON file"
          >
            Save
          </button>
        </span>
      </div>
      <QoeNotice text={notice?.text ?? null} />
      {content.build !== null && <BuildRow text={content.build} />}

      {content.sections.map((section) => (
        <div key={section.title} className="qoe-overlay__section">
          <div className="qoe-overlay__section-title">{section.title}</div>
          {section.rows.map((row) => (
            <Row key={row.label} row={row} />
          ))}
        </div>
      ))}

      <div className="qoe-overlay__footer">{content.footer}</div>
    </div>
  );
};

/**
 * What Copy came to, under the header. The element is always there, empty between notices, and only its text changes:
 * a screen reader announces a live region whose text changes, and often not one that arrives already filled.
 */
export const QoeNotice: React.FC<{ text: string | null }> = ({ text }) => (
  <div className="qoe-overlay__notice" role="status">
    {text}
  </div>
);

/** A bad value's mark beside its colour: a sign to see, and words for a screen reader. */
const BadFlag: React.FC = () => (
  <span className="qoe-overlay__flag">
    <span aria-hidden="true">!</span>
    <span className="qoe-overlay__visually-hidden">out of range</span>
  </span>
);

const Row: React.FC<{ row: QoeRow }> = ({ row: { label, value, bad } }) => (
  <div className={`qoe-overlay__row${bad ? ' qoe-overlay__row--bad' : ''}`}>
    <span className="qoe-overlay__label">{label}</span>
    {bad && <BadFlag />}
    <span className="qoe-overlay__value">{value}</span>
  </div>
);

/** Which build of the viewer is playing, the label the Sources screen's diagnostics show too. */
const BuildRow: React.FC<{ text: string }> = ({ text }) => (
  <div className="qoe-overlay__row qoe-overlay__release">
    <span className="qoe-overlay__label">Build</span>
    <span className="qoe-overlay__value">{text}</span>
  </div>
);
