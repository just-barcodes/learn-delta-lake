import type { Action } from "../domain/reducer";
import type { DetailLevel, TableState } from "../domain/types";
import { ThemeToggle } from "../theme/ThemeToggle";
import type { ResolvedTheme } from "../theme/useTheme";
import "./header.css";

interface Props {
  state: TableState;
  dispatch: (action: Action) => void;
  resolved: ResolvedTheme;
  onToggleTheme: () => void;
}

const LEVELS: { key: DetailLevel; label: string }[] = [
  { key: "simple", label: "Simple" },
  { key: "medium", label: "Medium" },
  { key: "advanced", label: "Advanced" },
];

export function Header({ state, dispatch, resolved, onToggleTheme }: Props) {
  return (
    <header className="header">
      <div className="header__logo">
        <DeltaMark />
      </div>
      <div className="header__titles">
        <h1 className="header__title">Inside a Delta Lake Table</h1>
        <p className="header__subtitle">
          Run commits and watch the transaction log and data files rewire. Click any node to inspect
          it; click a version to time-travel.
        </p>
      </div>
      <div className="header__spacer" />
      <div className="header__level">
        <span className="header__level-label">Detail level</span>
        <div className="segmented" role="group" aria-label="Detail level">
          {LEVELS.map((lv) => (
            <button
              key={lv.key}
              type="button"
              className={"segmented__btn" + (state.level === lv.key ? " is-active" : "")}
              aria-pressed={state.level === lv.key}
              onClick={() => dispatch({ type: "setLevel", level: lv.key })}
            >
              {lv.label}
            </button>
          ))}
        </div>
      </div>
      <button type="button" className="btn-ghost" onClick={() => dispatch({ type: "reset" })}>
        Reset table
      </button>
      <ThemeToggle resolved={resolved} onToggle={onToggleTheme} />
    </header>
  );
}

function DeltaMark() {
  return (
    <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" fill="#123b4f" />
      <rect y="17" width="32" height="15" fill="#0e2f40" />
      <path d="M16 5 L27 24 L5 24 Z" fill="#3fd0c9" />
      <path d="M16 12 L22.2 24 L9.8 24 Z" fill="#123b4f" opacity="0.55" />
      <path
        d="M0 20 q8 -3 16 0 t16 0"
        stroke="#3fd0c9"
        strokeWidth="1.2"
        fill="none"
        opacity="0.5"
      />
    </svg>
  );
}
