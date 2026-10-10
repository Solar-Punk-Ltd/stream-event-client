import { useEffect, useId, useRef, useState } from 'react';

import { useThemeChoice } from '@/app/ThemeChoiceProvider';
import { THEME_LABELS, THEME_NAMES } from '@/design/themeNames';
import { Button, ButtonVariant } from '@/shared/components/Button/Button';
import { Dialog } from '@/shared/components/Dialog/Dialog';

import { useChatUser } from '../User';

import '../LoginModal/LoginModal.scss';
import './LoginButton.scss';

const KEY_ESCAPE = 'Escape';

/**
 * The chat name in the header, written as a plain bold link the way msrs-client writes its login: an
 * offer to join when there is none, the name and a menu when there is. The menu carries the theme
 * switcher where the deployment allows it, which changes the colours and typefaces and keeps the pick
 * after a logout.
 */
export function LoginButton() {
  const { session, setIsLoginModalOpen, logout } = useChatUser();
  const { look, canSwitch, chooseLook } = useThemeChoice();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isConfirmingLogout, setIsConfirmingLogout] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }
    const closeOnOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === KEY_ESCAPE) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isMenuOpen]);

  if (!session) {
    return (
      <button type="button" className="login-button" onClick={() => setIsLoginModalOpen(true)}>
        Join chat
      </button>
    );
  }

  const confirmLogout = () => {
    logout();
    setIsConfirmingLogout(false);
  };

  return (
    <div className="login-button-container" ref={containerRef}>
      <button
        type="button"
        className="login-button"
        aria-haspopup="true"
        aria-expanded={isMenuOpen}
        aria-controls={menuId}
        onClick={() => setIsMenuOpen((open) => !open)}
      >
        {session.username}
      </button>

      {isMenuOpen && (
        <div id={menuId} className="login-dropdown">
          {canSwitch && (
            <div role="radiogroup" aria-label="Theme" className="login-dropdown-group">
              <p className="login-dropdown-heading" aria-hidden="true">
                Theme
              </p>
              {THEME_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={look === name}
                  className="login-dropdown-item login-dropdown-theme"
                  onClick={() => chooseLook(name)}
                >
                  <span className="theme-swatch" data-theme-preview={name} aria-hidden="true" />
                  {THEME_LABELS[name]}
                  {look === name && (
                    <span className="login-dropdown-check" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="login-dropdown-item"
            onClick={() => {
              setIsMenuOpen(false);
              setIsConfirmingLogout(true);
            }}
          >
            Log out
          </button>
        </div>
      )}

      {isConfirmingLogout && (
        <Dialog title="Log out of the chat?" onClose={() => setIsConfirmingLogout(false)}>
          <p className="login-modal-content">
            If you log out, your display name won&apos;t be saved. You&apos;ll need to choose one again next time.
          </p>
          <div className="login-modal-actions">
            <Button variant={ButtonVariant.SECONDARY} onClick={() => setIsConfirmingLogout(false)}>
              Cancel
            </Button>
            <Button onClick={confirmLogout}>Log out</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
