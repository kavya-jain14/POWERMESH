"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { cx } from "../cx";
import styles from "./Dialog.module.css";
import { Icon } from "./Icon";

export interface DialogProps {
  open: boolean;
  /** Called for Esc, the close button and backdrop click. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** "center" for confirmations, "sheet" for the Approval Sheet (slides from the right, full-height). */
  variant?: "center" | "sheet";
  /** Element to focus on open. Defaults to the first focusable element in the body. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Hide the × close button (e.g. while an irreversible action is in flight). */
  dismissible?: boolean;
  className?: string;
}

/**
 * Modal built on the native <dialog> element: the browser provides the focus trap, inert
 * background and Esc handling. Focus returns to the previously focused element on close.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = "center",
  initialFocusRef,
  dismissible = true,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusTo.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      const target = initialFocusRef?.current;
      if (target) target.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialFocusRef]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => {
      const el = returnFocusTo.current;
      if (el && document.contains(el)) el.focus();
    };
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, []);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click handler only closes on a backdrop click; keyboard users close with Esc (onCancel) or the Close button.
    <dialog
      ref={ref}
      className={cx(styles.dialog, styles[variant], className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        // Backdrop click: the click target is the <dialog> itself, not its content.
        if (dismissible && e.target === ref.current) onClose();
      }}
    >
      {open ? (
        <div className={styles.inner}>
          <header className={styles.header}>
            <div>
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
              {description ? (
                <p id={descId} className={styles.description}>
                  {description}
                </p>
              ) : null}
            </div>
            {dismissible ? (
              <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
                <Icon name="x" />
              </button>
            ) : null}
          </header>
          <div className={styles.body}>{children}</div>
          {footer ? <footer className={styles.footer}>{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}
