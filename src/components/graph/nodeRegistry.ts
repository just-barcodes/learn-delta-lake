import { createContext, useContext } from "react";

/** A ref callback factory: `register(id)` returns a ref for that node's DOM element. */
export type RegisterNode = (id: string) => (el: HTMLElement | null) => void;

export const NodeRegistryContext = createContext<RegisterNode | null>(null);

export function useRegisterNode(): RegisterNode {
  const register = useContext(NodeRegistryContext);
  if (!register) throw new Error("useRegisterNode must be used within a NodeRegistryContext");
  return register;
}
