import { ReactNode } from "react";

interface ListPageProps {
  title: ReactNode;
  description?: ReactNode;
  headerActions?: ReactNode;
  isLoading?: boolean;
  loadingText?: string;
  isEmpty: boolean;
  emptyText: ReactNode;
  children: ReactNode;
}

/** Shared page frame for every track list: heading, optional actions,
 * loading and empty states, then the rows. */
export default function ListPage({
  title,
  description,
  headerActions,
  isLoading,
  loadingText = "Loading…",
  isEmpty,
  emptyText,
  children,
}: ListPageProps) {
  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <div className="flex items-center justify-between gap-4 max-w-3xl mb-2">
        <h1 className="font-display text-xl font-semibold min-w-0 truncate">{title}</h1>
        {headerActions && <div className="flex items-center gap-2 shrink-0">{headerActions}</div>}
      </div>
      {description && <p className="text-sm text-mist-500 mb-6 max-w-3xl">{description}</p>}
      {!description && <div className="mb-4" />}

      {isLoading && isEmpty ? (
        <p className="text-sm text-mist-500">{loadingText}</p>
      ) : isEmpty ? (
        <p className="text-sm text-mist-500 max-w-xl">{emptyText}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-ink-800 max-w-3xl">{children}</ul>
      )}
    </div>
  );
}

export function PillButton({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        primary
          ? "bg-ember/10 text-ember hover:bg-ember hover:text-ink-950"
          : "text-mist-500 hover:text-mist-100 hover:bg-ink-800"
      }`}
    >
      {children}
    </button>
  );
}
