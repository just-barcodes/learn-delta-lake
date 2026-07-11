import type { CSSProperties, ReactNode } from "react";

interface Props {
  accent: string;
  title: ReactNode;
  desc: string;
  onClick: () => void;
}

/** A toolbar action: an accent dot plus a two-line label. Colour is set via --act. */
export function ActionButton({ accent, title, desc, onClick }: Props) {
  return (
    <button
      type="button"
      className="action"
      style={{ ["--act"]: accent } as CSSProperties}
      onClick={onClick}
    >
      <span className="action__dot" />
      <span className="action__label">
        <span className="action__title">{title}</span>
        <span className="action__desc">{desc}</span>
      </span>
    </button>
  );
}
