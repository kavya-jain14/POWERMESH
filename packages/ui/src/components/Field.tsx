"use client";

import {
  cloneElement,
  forwardRef,
  type InputHTMLAttributes,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  useId,
} from "react";
import { cx } from "../cx";
import styles from "./Field.module.css";
import { Icon } from "./Icon";

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** A single form control. Field wires id, aria-describedby and aria-invalid onto it. */
  children: ReactElement<Record<string, unknown>>;
  className?: string;
}

/** Label + control + hint + error, with ids wired for assistive tech. */
export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        required,
      })
    : children;

  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {required ? <span className={styles.required}> (required)</span> : null}
      </label>
      {control}
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={styles.error}>
          <Icon name="alert" size={14} />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...rest }, ref) {
    return <input ref={ref} className={cx(styles.input, className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <span className={styles.selectWrap}>
        <select ref={ref} className={cx(styles.input, styles.select, className)} {...rest}>
          {children}
        </select>
        <Icon name="chevronDown" className={styles.selectIcon} />
      </span>
    );
  },
);

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

/** On/off switch (role="switch"). The label states what "on" means. */
export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  const id = useId();
  return (
    <div className={styles.toggleRow}>
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        className={styles.toggle}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.thumb} aria-hidden="true" />
      </button>
      <div>
        <label htmlFor={id} className={styles.toggleLabel}>
          {label}
        </label>
        {description ? (
          <p id={`${id}-desc`} className={styles.hint}>
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export interface ChoiceOption<V extends string> {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** Shown when disabled: why this option can't be picked. */
  disabledReason?: ReactNode;
}

export interface ChoiceGroupProps<V extends string> {
  legend: ReactNode;
  name: string;
  value: V | null;
  onChange: (value: V) => void;
  options: Array<ChoiceOption<V>>;
  hint?: ReactNode;
  error?: ReactNode;
}

/** Radio cards: a fieldset of large, described radio options. */
export function ChoiceGroup<V extends string>({
  legend,
  name,
  value,
  onChange,
  options,
  hint,
  error,
}: ChoiceGroupProps<V>) {
  const id = useId();
  return (
    <fieldset
      className={styles.fieldset}
      aria-describedby={
        [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(" ") || undefined
      }
    >
      <legend className={styles.label}>{legend}</legend>
      {hint ? (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      <div className={styles.choices}>
        {options.map((opt) => {
          const optId = `${id}-${opt.value}`;
          return (
            <label
              key={opt.value}
              htmlFor={optId}
              className={cx(
                styles.choice,
                value === opt.value && styles.choiceChecked,
                opt.disabled && styles.choiceDisabled,
              )}
            >
              <input
                type="radio"
                id={optId}
                name={name}
                value={opt.value}
                checked={value === opt.value}
                disabled={opt.disabled}
                onChange={() => onChange(opt.value)}
                className={styles.radio}
                aria-describedby={opt.description || opt.disabledReason ? `${optId}-d` : undefined}
              />
              <span className={styles.choiceText}>
                <span className={styles.choiceLabel}>{opt.label}</span>
                {opt.description || (opt.disabled && opt.disabledReason) ? (
                  <span id={`${optId}-d`} className={styles.choiceDesc}>
                    {opt.disabled && opt.disabledReason ? opt.disabledReason : opt.description}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p id={`${id}-err`} className={styles.error}>
          <Icon name="alert" size={14} />
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
