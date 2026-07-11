import { Header } from "./components/Header";
import { useTableModel } from "./state/useTableModel";
import { useTheme } from "./theme/useTheme";
import "./styles/layout.css";

export function App() {
  const { state, dispatch } = useTableModel();
  const { resolved, toggle } = useTheme();

  return (
    <div className="app">
      <Header state={state} dispatch={dispatch} resolved={resolved} onToggleTheme={toggle} />
      <div className="app__main">
        <div style={{ padding: 24, color: "var(--text-muted)", fontSize: 13 }}>
          Graph, toolbar, and side panel land in the next phases. Current version: {state.current}.
        </div>
      </div>
    </div>
  );
}
