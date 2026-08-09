import { useEscapeClose, overlayDismiss } from '../modalKeys.js'

/**
 * In-app replacement for `window.confirm`.
 *
 * The native dialog is jarring here: it's the one piece of chrome in the app
 * that isn't styled, it renders at the top of the screen on Android (nowhere
 * near the thumb that pressed Delete), and inside an installed PWA it announces
 * the origin like a security prompt. This is the same bottom sheet as every
 * other modal, so a destructive step reads as part of the app.
 *
 * Stacked *above* whichever modal opened it — same z-index, later in the DOM.
 * `useEscapeClose` keeps a mount-ordered stack, so Escape dismisses this one
 * and leaves the modal underneath open.
 *
 * `busy` is for the window between confirming and the request returning: the
 * sheet stays up with its button in a pending state rather than vanishing and
 * leaving nothing to look at.
 */
export default function ConfirmModal({
  title = 'Are you sure?',
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}) {
  useEscapeClose(onCancel)

  return (
    <div className="modal-overlay" {...overlayDismiss(busy ? () => {} : onCancel)}>
      <div className="modal modal--confirm">
        <div className="modal-header modal-header--compact">
          <div className="modal-title modal-title--compact">{title}</div>
          <button className="modal-close" onClick={onCancel} disabled={busy}>✕</button>
        </div>

        {message && <div className="confirm-message">{message}</div>}

        <div className="modal-actions modal-actions--compact">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
