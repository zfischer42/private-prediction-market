import type { ReactNode } from 'react';

// A button that opens the photo picker. The real <input> is visually hidden rather than
// display:none so the keyboard can still reach it.
export default function PhotoInput({
  max,
  disabled,
  onPick,
  children,
}: {
  // How many photos it will hand back; extras are dropped.
  max: number;
  disabled?: boolean;
  onPick: (files: File[]) => void;
  children: ReactNode;
}) {
  return (
    <label className={`btn small file-btn${disabled ? ' disabled' : ''}`}>
      {children}
      <input
        type="file"
        accept="image/*"
        multiple={max > 1}
        disabled={disabled}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          // Clear it, so picking the same photo again still fires a change.
          e.target.value = '';
          if (files.length > 0) onPick(files.slice(0, max));
        }}
      />
    </label>
  );
}
