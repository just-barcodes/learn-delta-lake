import { DeletePicker } from "./components/DeletePicker";
import { Header } from "./components/Header";
import { Inspector } from "./components/Inspector";
import { SidePanel } from "./components/SidePanel";
import { Toolbar } from "./components/Toolbar";
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
      <Toolbar state={state} dispatch={dispatch} />
      <div className="app__main">
        <GraphCanvas state={state} dispatch={dispatch} themeKey={resolved} />
        <SidePanel state={state} />
      </div>
      <Inspector state={state} dispatch={dispatch} />
      <DeletePicker state={state} dispatch={dispatch} />
    </div>
  );
}
