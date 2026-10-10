import { DragEvent, useState } from "react";

export type DropIndicator = "above" | "below" | null;

export interface DragRowProps {
  draggable: true;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: () => void;
}

/** HTML5 drag-and-drop reordering for a list. Returns per-row handlers plus
 * which row is being dragged and where the drop line should show. */
export function useDragReorder<T>(items: T[], onReorder: (next: T[]) => void) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  function reset() {
    setDragIndex(null);
    setOverIndex(null);
  }

  function rowProps(index: number): DragRowProps {
    return {
      draggable: true,
      onDragStart: (e) => {
        setDragIndex(index);
        e.dataTransfer.effectAllowed = "move";
        // Some engines won't start a drag without data set.
        e.dataTransfer.setData("text/plain", String(index));
      },
      onDragOver: (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (overIndex !== index) setOverIndex(index);
      },
      onDrop: (e) => {
        e.preventDefault();
        if (dragIndex !== null && dragIndex !== index) {
          const next = [...items];
          const [moved] = next.splice(dragIndex, 1);
          next.splice(index, 0, moved);
          onReorder(next);
        }
        reset();
      },
      onDragEnd: reset,
    };
  }

  function indicatorFor(index: number): DropIndicator {
    if (dragIndex === null || overIndex !== index || dragIndex === index) return null;
    return dragIndex < index ? "below" : "above";
  }

  return { rowProps, indicatorFor, dragIndex };
}
