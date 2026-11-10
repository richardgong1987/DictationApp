import { useEffect, useRef } from "react";
import { formatCount } from "../../format";

interface Props {
  lessonCount: number;
  selectedCount: number;
  /** A deletion is running; nothing can be selected or deleted meanwhile. */
  isDeleting: boolean;
  onSelectAll: (isSelected: boolean) => void;
  onDeleteSelected: () => void;
}

/** Selects every lesson at once, and deletes the selected lessons together. */
export default function LessonSelectionBar({
  lessonCount,
  selectedCount,
  isDeleting,
  onSelectAll,
  onDeleteSelected,
}: Props) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  const isAllSelected = selectedCount === lessonCount;
  const isPartlySelected = selectedCount > 0 && !isAllSelected;

  // "Indeterminate" has no HTML attribute, so React cannot set it.
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = isPartlySelected;
  }, [isPartlySelected]);

  return (
    <div className="lesson-selection">
      <label className="checkbox-field">
        <input
          ref={selectAllRef}
          type="checkbox"
          checked={isAllSelected}
          onChange={(e) => onSelectAll(e.target.checked)}
          disabled={isDeleting}
        />
        Select all
      </label>
      <button onClick={onDeleteSelected} disabled={isDeleting || selectedCount === 0}>
        {selectedCount > 0 ? `Delete ${formatCount(selectedCount, "lesson")}` : "Delete selected"}
      </button>
    </div>
  );
}
