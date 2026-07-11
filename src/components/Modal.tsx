import { useEffect, type ReactNode } from "react";
import "./modal.css";

interface Props {
  onClose: () => void;
  width: number;
  children: ReactNode;
}

/** A centered modal over a dimming backdrop. Closes on backdrop click and Escape. */
export function Modal({ onClose, width, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ width }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

interface HeaderProps {
  pillKind: string;
  pill: ReactNode;
  title: string;
  subtitle: string;
  mono?: boolean;
  onClose: () => void;
}

/** Shared modal header: a colored kind pill, a title/subtitle, and a close button. */
export function ModalHeader({ pillKind, pill, title, subtitle, mono, onClose }: HeaderProps) {
  return (
    <div className="modal-head">
      <span className={`pill node--${pillKind}`}>{pill}</span>
      <div className="modal-head__titles">
        <div className={"modal-head__title" + (mono ? " modal-head__title--mono" : "")}>
          {title}
        </div>
        <div className="modal-head__subtitle">{subtitle}</div>
      </div>
      <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
