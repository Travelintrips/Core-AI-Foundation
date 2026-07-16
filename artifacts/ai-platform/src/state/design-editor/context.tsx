/**
 * Design Template Editor — React Context
 *
 * Provides the editor state and dispatch to all child components.
 * Wrap the editor page with <EditorProvider>.
 */

import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from "react";
import { editorReducer, initialEditorState } from "./reducer";
import type { EditorState, EditorAction } from "./types";

interface EditorContextValue {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  return (
    <EditorContext.Provider value={{ state, dispatch }}>
      {children}
    </EditorContext.Provider>
  );
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used inside <EditorProvider>");
  return ctx;
}

export function useEditorState(): EditorState {
  return useEditor().state;
}

export function useEditorDispatch(): Dispatch<EditorAction> {
  return useEditor().dispatch;
}
