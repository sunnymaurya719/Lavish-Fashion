import { useEffect } from 'react';

/**
 * Register simple keyboard shortcuts.
 *
 * shortcuts:
 *   { 'Escape': handler, '/': handler, 'g d': handler, ... }
 *
 * - Single key entries match `event.key` directly.
 * - Two-segment entries (e.g. `'g d'`) match a sequence — first key, then
 *   second key within 600ms.
 * - Handlers are skipped while the user is typing in an input/textarea/select
 *   unless the shortcut is `Escape`.
 */
const useKeyboardShortcut = (shortcuts, { enabled = true } = {}) => {
  useEffect(() => {
    if (!enabled || !shortcuts) return undefined;

    let pendingPrefix = null;
    let pendingTimeout = null;

    const isEditableTarget = (event) => {
      const target = event.target;
      if (!target) return false;
      const tag = target.tagName;
      return (
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
      );
    };

    const handler = (event) => {
      if (event.key !== 'Escape' && isEditableTarget(event)) return;

      const direct = shortcuts[event.key];
      const sequenceKeys = Object.keys(shortcuts).filter((key) => key.includes(' '));

      if (pendingPrefix) {
        const sequence = `${pendingPrefix} ${event.key}`;
        const seqHandler = shortcuts[sequence];
        clearTimeout(pendingTimeout);
        pendingPrefix = null;
        pendingTimeout = null;
        if (seqHandler) {
          event.preventDefault();
          seqHandler(event);
          return;
        }
      }

      if (direct && !sequenceKeys.some((seq) => seq.startsWith(`${event.key} `))) {
        event.preventDefault();
        direct(event);
        return;
      }

      const startsSequence = sequenceKeys.find((seq) => seq.startsWith(`${event.key} `));
      if (startsSequence) {
        pendingPrefix = event.key;
        pendingTimeout = setTimeout(() => {
          pendingPrefix = null;
          pendingTimeout = null;
        }, 600);
      }
    };

    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      if (pendingTimeout) clearTimeout(pendingTimeout);
    };
  }, [shortcuts, enabled]);
};

export default useKeyboardShortcut;
