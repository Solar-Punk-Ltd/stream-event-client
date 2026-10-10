import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { BrowserIcon } from '@/shared/components/Icons/BrowserIcon';
import { ChevronIcon } from '@/shared/components/Icons/ChevronIcon';
import { GlobeIcon } from '@/shared/components/Icons/GlobeIcon';
import { HexagonIcon } from '@/shared/components/Icons/HexagonIcon';
import { PlusIcon } from '@/shared/components/Icons/PlusIcon';
import type { BeeNodeAccess } from '@/swarm/beeNodeAccess';
import type { SwarmSettings } from '@/swarm/settings';
import { hasAddress, SOURCE_NAME_MAX_LENGTH, SOURCE_TYPES, type SourceType } from '@/swarm/sources';

import type { Help } from './checkSentences';
import { checkSourceAddress, OWN_NODE_DEFAULT_ADDRESS } from './gatewayProbe';
import { HelpSteps } from './HelpSteps';
import type { CheckResult } from './providerTest';
import {
  ADDRESS_PLACEHOLDERS,
  addressHint,
  NAME_PLACEHOLDERS,
  TYPE_LABELS,
  unavailableTypeReason,
} from './sourceWords';

const KEY_ENTER = 'Enter';

/** What checking a new source found: that it can be added, or why not and how to fix it. */
export type AddCheck =
  /** The results of the Test, for a source the check ran it on. */
  | { readonly ok: true; readonly results?: readonly CheckResult[] }
  | { readonly ok: false; readonly text: string; readonly help: Help | null };

type Status = { kind: 'idle' } | { kind: 'checking' } | { kind: 'refused'; text: string; help: Help | null };

const IDLE: Status = { kind: 'idle' };

const TYPE_ICONS: Readonly<Record<SourceType, ReactNode>> = {
  gateway: <GlobeIcon />,
  'bee-node': <HexagonIcon />,
  'weeb-3': <BrowserIcon />,
};

interface AddSourceProps {
  readonly access: BeeNodeAccess;
  readonly kinds: SwarmSettings['kinds'];
  /** The types of the sources already listed, which a type that may be added once is refused for. */
  readonly addedTypes: readonly SourceType[];
  /** Asks the address whether it is a source this viewer can read from. Never rejects. */
  readonly check: (type: SourceType, url: string) => Promise<AddCheck>;
  readonly onAdd: (source: { type: SourceType; name: string; url: string }, results?: readonly CheckResult[]) => void;
  /** Told when the panel opens and when it closes or goes away, so the screen can quiet its own primary. */
  readonly onOpenChange?: (isOpen: boolean) => void;
}

/**
 * Adding a source: a tile per type, the types this site does not allow greyed with their reason, then a
 * name and an address, checked before the source is added. A refusal says why in one sentence, with
 * the steps of its fix behind "How to fix". The node in this browser has no address, so it is added
 * as it is named and its own status line says how its start goes.
 */
export function AddSource({ access, kinds, addedTypes, check, onAdd, onOpenChange }: AddSourceProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<SourceType | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<Status>(IDLE);
  // Bumped on every check, on every change of what was typed and on cancel, so a check that comes back
  // late cannot add an address the viewer no longer meant.
  const generation = useRef(0);
  const formRef = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const nameId = useId();
  const addressId = useId();
  const hintId = useId();
  const statusId = useId();

  const reset = () => {
    generation.current += 1;
    setType(null);
    setStatus(IDLE);
  };

  // The tiles a viewer can pick first, each with the line under its name.
  const offered = SOURCE_TYPES.map((tile) => ({
    tile,
    reason: unavailableTypeReason(tile, access, kinds, addedTypes),
  }));
  const tiles = [
    ...offered.filter(({ reason }) => reason === null),
    ...offered.filter(({ reason }) => reason !== null),
  ];

  const close = () => {
    reset();
    setIsOpen(false);
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

  useEffect(() => {
    onOpenChangeRef.current?.(isOpen);
  }, [isOpen]);
  useEffect(() => () => onOpenChangeRef.current?.(false), []);

  // The form opens under the tiles, which can be below the fold of the screen's body.
  useEffect(() => {
    if (type !== null) {
      formRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }
  }, [type]);

  const checkAndAdd = async () => {
    if (type === null || status.kind === 'checking') {
      return;
    }
    if (!hasAddress(type)) {
      onAdd({ type, name, url: '' });
      close();
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
    close();
  };

  return (
    <div className={`add-source-area${isOpen ? ' open' : ''}`}>
      {isOpen ? (
        <h3 className="add-source-title">Add source</h3>
      ) : (
        <button
          type="button"
          className="sources-small-button with-icon"
          aria-expanded={false}
          onClick={() => setIsOpen(true)}
        >
          <PlusIcon />
          Add source
        </button>
      )}
      {isOpen && (
        <section className="add-source" aria-label="Add source">
          <div className="add-source-tiles">
            {tiles.map(({ tile, reason }, at) => (
              <button
                key={tile}
                type="button"
                className={`add-source-tile${type === tile ? ' picked' : ''}`}
                disabled={reason !== null}
                aria-pressed={type === tile}
                // The opener is gone once the panel is open, so focus lands on the first tile it offers.
                autoFocus={at === 0 && reason === null}
                onClick={() => pick(tile)}
              >
                <span className="add-source-tile-head">
                  {TYPE_ICONS[tile]}
                  <span className="add-source-tile-name">{TYPE_LABELS[tile]}</span>
                </span>
                <span className="add-source-tile-note" id={type === tile ? hintId : undefined}>
                  {reason ?? addressHint(tile, access)}
                </span>
              </button>
            ))}
          </div>

          {type !== null && (
            <div className="add-source-form" ref={formRef}>
              <div className="add-source-fields">
                <div className="add-source-field">
                  <label className="sources-label" htmlFor={nameId}>
                    Name
                  </label>
                  <input
                    id={nameId}
                    className="sources-input"
                    type="text"
                    autoComplete="off"
                    maxLength={SOURCE_NAME_MAX_LENGTH}
                    placeholder={NAME_PLACEHOLDERS[type]}
                    value={name}
                    onChange={(event) => typed(setName)(event.target.value)}
                    aria-label="Name"
                  />
                </div>
                {hasAddress(type) && (
                  <div className="add-source-field">
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
                  </div>
                )}
              </div>
              <p className={`sources-message${status.kind === 'refused' ? ' error' : ''}`} id={statusId} role="status">
                {status.kind === 'checking' && 'Checking'}
                {status.kind === 'refused' && status.text}
              </p>
              {status.kind === 'refused' && status.help && (
                <details className="source-fix">
                  <summary>
                    How to fix
                    <ChevronIcon />
                  </summary>
                  <HelpSteps help={status.help} />
                </details>
              )}
              <div className="source-actions">
                <button type="button" className="sources-small-button ghost" onClick={close}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="sources-small-button primary"
                  onClick={() => void checkAndAdd()}
                  disabled={status.kind === 'checking'}
                >
                  {status.kind === 'checking' ? 'Checking' : hasAddress(type) ? 'Check and add' : 'Add'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
