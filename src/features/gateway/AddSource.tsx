import { useId, useRef, useState } from 'react';

import { Button, ButtonVariant } from '@/shared/components/Button/Button';
import type { BeeNodeAccess } from '@/swarm/beeNodeAccess';
import type { SwarmSettings } from '@/swarm/settings';
import { SOURCE_NAME_MAX_LENGTH, SOURCE_TYPES, type SourceType } from '@/swarm/sources';

import type { Help } from './checkSentences';
import { checkSourceAddress, OWN_NODE_DEFAULT_ADDRESS } from './gatewayProbe';
import { HelpSteps } from './HelpSteps';
import type { CheckResult } from './providerTest';
import { ADDRESS_PLACEHOLDERS, addressHint, TYPE_LABELS, unavailableTypeReason } from './sourceWords';

const KEY_ENTER = 'Enter';

/** What checking a new source found: that it can be added, or why not and how to fix it. */
export type AddCheck =
  /** The results of the Test, for a source the check ran it on. */
  | { readonly ok: true; readonly results?: readonly CheckResult[] }
  | { readonly ok: false; readonly text: string; readonly help: Help | null };

type Status = { kind: 'idle' } | { kind: 'checking' } | { kind: 'refused'; text: string; help: Help | null };

const IDLE: Status = { kind: 'idle' };

interface AddSourceProps {
  readonly access: BeeNodeAccess;
  readonly kinds: SwarmSettings['kinds'];
  /** Asks the address whether it is a source this viewer can read from. Never rejects. */
  readonly check: (type: SourceType, url: string) => Promise<AddCheck>;
  readonly onAdd: (source: { type: SourceType; name: string; url: string }, results?: readonly CheckResult[]) => void;
}

/**
 * Adding a source: a tile per type, the types this site does not allow greyed with their reason, then a
 * name and an address, checked before the source is added. A refusal says why in one sentence, with
 * the steps of its fix behind "How to fix".
 */
export function AddSource({ access, kinds, check, onAdd }: AddSourceProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<SourceType | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<Status>(IDLE);
  // Bumped on every check, on every change of what was typed and on cancel, so a check that comes back
  // late cannot add an address the viewer no longer meant.
  const generation = useRef(0);
  const nameId = useId();
  const addressId = useId();
  const hintId = useId();
  const statusId = useId();

  const reset = () => {
    generation.current += 1;
    setType(null);
    setStatus(IDLE);
  };

  const pick = (picked: SourceType) => {
    generation.current += 1;
    setType(picked);
    setName('');
    setAddress(picked === 'bee-node' ? OWN_NODE_DEFAULT_ADDRESS : '');
    setStatus(IDLE);
  };

  const typed = (set: (value: string) => void) => (value: string) => {
    set(value);
    if (status.kind !== 'idle') {
      generation.current += 1;
      setStatus(IDLE);
    }
  };

  const checkAndAdd = async () => {
    if (type === null || status.kind === 'checking') {
      return;
    }
    const allowed = checkSourceAddress(type, address, access);
    if (!allowed.ok) {
      setStatus({ kind: 'refused', text: allowed.text, help: null });
      return;
    }
    const asked = ++generation.current;
    setStatus({ kind: 'checking' });
    const found = await check(type, allowed.url);
    if (asked !== generation.current) {
      return;
    }
    if (!found.ok) {
      setStatus({ kind: 'refused', text: found.text, help: found.help });
      return;
    }
    onAdd({ type, name, url: allowed.url }, found.results);
    reset();
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <button type="button" className="sources-text-button" aria-expanded={false} onClick={() => setIsOpen(true)}>
        Add source
      </button>
    );
  }

  return (
    <section className="add-source" aria-label="Add source">
      <div className="add-source-tiles">
        {SOURCE_TYPES.map((tile) => {
          const reason = unavailableTypeReason(tile, access, kinds);
          return (
            <button
              key={tile}
              type="button"
              className={`add-source-tile${type === tile ? ' picked' : ''}`}
              disabled={reason !== null}
              aria-pressed={type === tile}
              onClick={() => pick(tile)}
            >
              <span className="add-source-tile-name">{TYPE_LABELS[tile]}</span>
              {reason !== null && <span className="add-source-tile-reason">{reason}</span>}
            </button>
          );
        })}
      </div>

      {type !== null && (
        <div className="add-source-form">
          <label className="sources-label" htmlFor={nameId}>
            Name
          </label>
          <input
            id={nameId}
            className="sources-input"
            type="text"
            autoComplete="off"
            maxLength={SOURCE_NAME_MAX_LENGTH}
            placeholder={TYPE_LABELS[type]}
            value={name}
            onChange={(event) => typed(setName)(event.target.value)}
            aria-label="Name"
          />
          <label className="sources-label" htmlFor={addressId}>
            Address
          </label>
          <input
            id={addressId}
            className="sources-input"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={ADDRESS_PLACEHOLDERS[type]}
            value={address}
            onChange={(event) => typed(setAddress)(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === KEY_ENTER) {
                void checkAndAdd();
              }
            }}
            aria-label="Address"
            aria-describedby={`${hintId} ${statusId}`}
            aria-invalid={status.kind === 'refused'}
          />
          <p className="sources-muted" id={hintId}>
            {addressHint(type, access)}
          </p>
          <p className={`sources-message${status.kind === 'refused' ? ' error' : ''}`} id={statusId} role="status">
            {status.kind === 'checking' && 'Checking'}
            {status.kind === 'refused' && status.text}
          </p>
          {status.kind === 'refused' && status.help && (
            <details className="source-fix">
              <summary>How to fix</summary>
              <HelpSteps help={status.help} />
            </details>
          )}
          <div className="source-actions">
            <Button onClick={() => void checkAndAdd()} disabled={status.kind === 'checking'}>
              {status.kind === 'checking' ? 'Checking' : 'Check and add'}
            </Button>
            <Button
              variant={ButtonVariant.SECONDARY}
              onClick={() => {
                reset();
                setIsOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
