import { useReducer } from "react";
import { initialState } from "../domain/initialState";
import { reducer } from "../domain/reducer";

/** The single source of truth for the table: reducer state plus its dispatch. */
export function useTableModel() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  return { state, dispatch };
}
