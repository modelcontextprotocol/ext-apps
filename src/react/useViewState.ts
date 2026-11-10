import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { App } from "../app.js";

/**
 * Options for the {@link useViewState `useViewState`} hook.
 */
export interface UseViewStateOptions {
  /**
   * How long to wait after the last change before saving, in milliseconds.
   * Changes made within this time are saved together, as one request.
   *
   * @default 500
   */
  debounceMs?: number;
}

/** What the hook keeps in React state: the value, and where it came from. */
interface Slot<T> {
  value: T;
  /** Whether the setter has changed `value`; only such a value is saved. */
  changed: boolean;
  /** The app whose saved state has been looked at, so it is done once per app. */
  seededFrom: App | null;
}

/** `slot` after the saved state of `app`, if any, has been taken into account. */
function seed<T>(slot: Slot<T>, app: App | null): Slot<T> {
  if (!app || slot.seededFrom === app) {
    return slot;
  }
  const saved = app.getHostContext()?.viewState;
  return {
    // What the user has already changed wins over what was saved earlier.
    value: saved && !slot.changed ? (saved as T) : slot.value,
    changed: slot.changed,
    seededFrom: app,
  };
}

/**
 * React hook that keeps a piece of state and saves it with the host, so that
 * it comes back the next time the View is rendered (for example after a
 * reload, or in a reopened conversation).
 *
 * It works like `useState`. The state starts as `initial`; once `app` is
 * connected, it becomes the state that the host has saved for this View, if
 * any (`viewState` in {@link App.getHostContext `App.getHostContext`}). Each call
 * of the setter changes the state at once and, after `debounceMs` without
 * another change, saves it with {@link App.setViewState `App.setViewState`}.
 *
 * - **No host support**: when the host does not advertise the `viewState`
 *   capability, nothing is saved and the hook behaves like plain `useState`.
 * - **Failed saves**: a save that the host refuses (for example because the
 *   state is larger than the host's `maxBytes`) is reported with
 *   `console.warn` and otherwise ignored; the state on screen is kept, and the
 *   next change is saved as usual.
 * - **Only changes are saved**: the initial value and the restored value are
 *   not saved by themselves.
 * - **Changes before `app` is connected** are kept: they win over the state
 *   that the host has saved, and are saved once `app` is connected.
 * - **Unmount**: a save that is still waiting is sent at once when the
 *   component unmounts (unless `app` has been closed), so that the last change
 *   is not lost. If the host removes the View before the wait is over, that
 *   change is lost.
 *
 * **One hook per View.** A save replaces everything that is saved for the
 * View, so two `useViewState` hooks on the same `app` would overwrite each
 * other. Keep all the state to save in one object, in one hook. For the same
 * reason, do not mix this hook with your own calls of `App.setViewState`.
 *
 * **Version and check the state.** The saved state may have been written by an
 * older version of your View. The hook cannot check it against `T`: it returns
 * what the host saved as it is. Put a version in the state, and check it
 * before you use the state, as the example below does.
 *
 * @typeParam T - The state: a JSON object. Values that JSON cannot hold
 *   (functions, `undefined`, `Date`, `Map`, ...) do not come back as they were.
 *   Declare it with `type`, not `interface`: TypeScript does not accept an
 *   interface as a `Record<string, unknown>` unless it has an index signature.
 * @param app - The connected {@link App `App`} instance, or null during initialization
 * @param initial - State to use until, and unless, saved state is found
 * @param options - See {@link UseViewStateOptions `UseViewStateOptions`}
 * @returns The current state and a function to change it, as `useState` does
 *
 * @example Keep an unsent draft
 * ```tsx source="./useViewState.examples.tsx#useViewState_basicUsage"
 * type Draft = { version: 1; text: string };
 * const EMPTY_DRAFT: Draft = { version: 1, text: "" };
 *
 * function MyApp() {
 *   const { app } = useApp({
 *     appInfo: { name: "MyApp", version: "1.0.0" },
 *     capabilities: {},
 *   });
 *
 *   const [saved, setDraft] = useViewState<Draft>(app, EMPTY_DRAFT);
 *   // The saved state may come from an older version of this View
 *   const draft = saved.version === 1 ? saved : EMPTY_DRAFT;
 *
 *   return (
 *     <textarea
 *       value={draft.text}
 *       onChange={(e) => setDraft({ ...draft, text: e.target.value })}
 *     />
 *   );
 * }
 * ```
 *
 * @see {@link App.setViewState `App.setViewState`} for the underlying method
 * @see {@link useApp `useApp`} for the hook that provides `app`
 */
export function useViewState<T extends Record<string, unknown>>(
  app: App | null,
  initial: T,
  { debounceMs = 500 }: UseViewStateOptions = {},
): [T, Dispatch<SetStateAction<T>>] {
  const [slot, setSlot] = useState<Slot<T>>(() =>
    seed({ value: initial, changed: false, seededFrom: null }, app),
  );

  // `app` arrived after the first render (the usual case with `useApp`): take
  // its saved state now. Setting state while rendering makes React render
  // again at once, so a connected app is never shown with `initial` first.
  const seeded = seed(slot, app);
  if (seeded !== slot) {
    setSlot(seeded);
  }

  const setState = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    setSlot((slot) => {
      const value = typeof action === "function" ? action(slot.value) : action;
      return Object.is(value, slot.value)
        ? slot
        : { ...slot, value, changed: true };
    });
  }, []);

  // The save that is waiting for its timer, if any.
  const pendingSave = useRef<(() => void) | null>(null);

  const { value, changed } = slot;
  useEffect(() => {
    pendingSave.current = null;
    if (!changed || !app?.getHostCapabilities()?.viewState) {
      return;
    }
    const save = () => {
      pendingSave.current = null;
      // A closed app (for example `useApp` unmounting with us) cannot save.
      if (!app.transport) {
        return;
      }
      app.setViewState(value).catch((error) => {
        console.warn("[useViewState] Failed to save view state:", error);
      });
    };
    pendingSave.current = save;
    const timer = setTimeout(save, debounceMs);
    // Runs on each change (the new change then starts its own timer) and on
    // unmount (the effect below then sends the save).
    return () => clearTimeout(timer);
  }, [app, value, changed, debounceMs]);

  // On unmount, send the save that is still waiting.
  useEffect(() => () => pendingSave.current?.(), []);

  return [slot.value, setState];
}
