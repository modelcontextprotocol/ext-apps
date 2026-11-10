/**
 * Type-checked examples for the useViewState hook.
 *
 * @module
 */

import { useApp } from "./index.js";
import { useViewState } from "./useViewState.js";

/**
 * Example: Keep an unsent draft.
 */
function useViewState_basicUsage() {
  //#region useViewState_basicUsage
  type Draft = { version: 1; text: string };
  const EMPTY_DRAFT: Draft = { version: 1, text: "" };

  function MyApp() {
    const { app } = useApp({
      appInfo: { name: "MyApp", version: "1.0.0" },
      capabilities: {},
    });

    const [saved, setDraft] = useViewState<Draft>(app, EMPTY_DRAFT);
    // The saved state may come from an older version of this View
    const draft = saved.version === 1 ? saved : EMPTY_DRAFT;

    return (
      <textarea
        value={draft.text}
        onChange={(e) => setDraft({ ...draft, text: e.target.value })}
      />
    );
  }
  //#endregion useViewState_basicUsage
}
