// Desktop keyboard shortcuts shared by every modal: Escape dismisses,
// Enter saves.

import { useEffect } from 'react'

// Which modal Escape should close when several are stacked (a picker sheet
// opening FoodEntryModal on top of itself, say) — only the most-recently-
// mounted one. Module-level rather than context: modals are mounted straight
// off local `useState` all over the tree, not through a shared provider.
let modalStack = []
let nextId = 0

/**
 * Escape closes the modal, from anywhere — not just while a field inside it
 * is focused. A `keydown` handler on the `.modal-overlay` div only fires for
 * events that bubble up from a focused descendant; nothing inside a modal is
 * focused by default (no autofocus), so focus is still sitting on whatever
 * trigger button opened it, outside the overlay entirely, and the div-level
 * handler never sees the keypress. A document-level listener sidesteps that.
 */
export function useEscapeClose(onClose) {
  useEffect(() => {
    const id = ++nextId
    modalStack.push(id)
    function onKeyDown(e) {
      if (e.key !== 'Escape') return
      if (modalStack[modalStack.length - 1] !== id) return
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      modalStack = modalStack.filter(x => x !== id)
    }
  }, [onClose])
}

/**
 * Attach to a modal's `<form>`: Enter submits, from any field including a
 * checkbox or a focused button, not just a native-submitting text input.
 * Skipped in a `<textarea>`, where Enter means "new line".
 */
export function onFormKeyDown(e) {
  if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault()
    e.currentTarget.requestSubmit()
  }
}

/**
 * Desktop shortcut: pressing `key` fires `onTrigger` — used for each tab's
 * `+` FAB ("a" opens it). Skipped while typing anywhere, and while any modal
 * is open (`modalStack`, shared with `useEscapeClose` above) so the letter
 * doesn't fire through a modal that happens to have no input focused, and so
 * only one page's shortcut can ever act on a given keypress.
 */
export function useKeyShortcut(key, onTrigger) {
  useEffect(() => {
    function onKeyDown(e) {
      if (modalStack.length > 0) return
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return
      if (e.key === key) {
        e.preventDefault()
        onTrigger()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [key, onTrigger])
}
