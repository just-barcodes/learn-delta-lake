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
      <a
        className="icon-link"
        href="https://github.com/just-barcodes/learn-delta-lake"
        target="_blank"
        rel="noreferrer"
        aria-label="View source on GitHub"
        title="View source on GitHub"
      >
        <GitHubIcon />
      </a>
      <ThemeToggle resolved={resolved} onToggle={onToggleTheme} />
    </header>
  );
}

function GitHubIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
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
