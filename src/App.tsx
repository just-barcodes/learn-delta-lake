import { Header } from "./components/Header";
import { GraphCanvas } from "./components/graph/GraphCanvas";
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
        <GraphCanvas state={state} dispatch={dispatch} themeKey={resolved} />
      </div>
    </div>
  );
}
