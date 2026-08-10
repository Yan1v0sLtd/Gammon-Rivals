import {useCallback, useEffect, useState} from "react"

import {createPortal} from "react-dom"

import styles from "./useConfirm.module.css"

/**
 * Non-blocking confirm / prompt dialogs for the Back Office.
 *
 * Why this exists: native `window.confirm()` / `window.prompt()` are
 * SYNCHRONOUS — they block the main thread for the entire time the dialog is
 * open. The browser can't paint until you dismiss them, so it attributes the
 * whole dwell time to the click handler and the INP monitor reports a
 * multi-second "blocked UI updates" spike. These promise-based dialogs render
 * a normal React modal instead: the click handler returns immediately and the
 * promise resolves when the user picks an option. No main-thread block.
 *
 * Usage:
 *   const { confirm, prompt, confirmUI } = useConfirm();
 *   // ...inside an async handler:
 *   if (!(await confirm({ title: 'Delete X?', tone: 'danger' }))) return;
 *   const note = await prompt({ title: 'Reason?', defaultValue: 'default' });
 *   if (note === null) return; // cancelled
 *   // ...and render {confirmUI} somewhere in the component's JSX.
 */

type Tone = "danger" | "normal"

type ConfirmOpts = {
  title: string,
  message?: string,
  confirmLabel?: string,
  cancelLabel?: string,
  tone?: Tone,
  /** If set, a text input is shown and Confirm stays disabled until the user
   *  types this exact word (case-insensitive). For irreversible actions. */
  requireWord?: string,
}

type PromptOpts = {
  title: string,
  message?: string,
  confirmLabel?: string,
  cancelLabel?: string,
  tone?: Tone,
  defaultValue?: string,
  placeholder?: string,
}

type Pending = | ({
  mode: "confirm",
  resolve: (v: boolean) => void,
} & ConfirmOpts) | ({
  mode: "prompt",
  resolve: (v: string | null) => void,
} & PromptOpts)

export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null)
  const [text, setText] = useState("")

  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => {
    setText("")
    setPending({
      mode: "confirm",
      resolve,
      ...opts,
    })
  }), [])

  const prompt = useCallback((opts: PromptOpts) => new Promise<string | null>((resolve) => {
    setText(opts.defaultValue ?? "")
    setPending({
      mode: "prompt",
      resolve,
      ...opts,
    })
  }), [])

  // Resolve + close. Reads `pending`/`text` from the current render closure;
  // the live modal always uses the latest because the component re-renders.
  const cancel = () => {
    if (!pending) return
    if (pending.mode === "confirm") pending.resolve(false); else pending.resolve(null)
    setPending(null)
    setText("")
  }
  const accept = () => {
    if (!pending) return
    if (pending.mode === "confirm") pending.resolve(true); else pending.resolve(text)
    setPending(null)
    setText("")
  }

  // Escape always cancels. Bound only while a dialog is open; resolves the
  // captured `pending` directly to avoid stale-closure issues.
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      if (pending.mode === "confirm") pending.resolve(false); else pending.resolve(null)
      setPending(null)
      setText("")
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
    }
  }, [pending])

  const requireWord = pending?.mode === "confirm" ? pending.requireWord : undefined
  const showInput = pending?.mode === "prompt" || !!requireWord
  const wordOk = requireWord ? text.trim().toUpperCase() === requireWord.toUpperCase() : true
  const danger = (pending?.tone ?? "normal") === "danger"

  const confirmUI = pending ? createPortal(<div
    className={styles.overlay}
    onMouseDown={(e) => {
      if (e.target === e.currentTarget) cancel()
    }}>
    <div className={styles.dialog}>
      <h2 className={styles.title}>{pending.title}</h2>
      {pending.message && (<p className={styles.message}>
        {pending.message}
      </p>)}
      {showInput && (<input
        autoFocus
        className={styles.input}
        placeholder={pending.mode === "prompt" ? pending.placeholder : requireWord}
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && wordOk) accept()
        }}/>)}
      <div className={styles.actions}>
        <button
          className={styles.cancelButton}
          type="button"
          onClick={cancel}>
          {pending.cancelLabel ?? "Cancel"}
        </button>
        <button
          autoFocus={!showInput}
          className={`${styles.confirmButton} ${danger ? styles.danger : styles.normal}`}
          disabled={!wordOk}
          type="button"
          onClick={accept}>
          {pending.confirmLabel ?? "Confirm"}
        </button>
      </div>
    </div>
  </div>, document.body) : null

  return {
    confirm,
    prompt,
    confirmUI,
  }
}
