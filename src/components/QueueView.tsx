import { Track } from "../lib/types";
import { useDragReorder } from "../lib/useDragReorder";
import ListPage, { PillButton } from "./ListPage";
import TrackRow from "./TrackRow";

interface QueueViewProps {
  queue: Track[];
  currentTrackId: string | null;
  onPlay: (track: Track) => void;
  onRemove: (trackId: string) => void;
  onReorder: (next: Track[]) => void;
  onClear: () => void;
}

export default function QueueView({
  queue,
  currentTrackId,
  onPlay,
  onRemove,
  onReorder,
  onClear,
}: QueueViewProps) {
  const { rowProps, indicatorFor, dragIndex } = useDragReorder(queue, onReorder);

  return (
    <ListPage
      title="Queue"
      description={queue.length > 0 ? "Drag tracks to change the order." : undefined}
      headerActions={
        <PillButton onClick={onClear} disabled={queue.length === 0}>
          Clear
        </PillButton>
      }
      isEmpty={queue.length === 0}
      emptyText="Nothing queued. Play something from a list and the rest of that list lines up here, or add tracks from any ⋯ menu."
    >
      {queue.map((track, i) => (
        <TrackRow
          key={track.id}
          track={track}
          isCurrent={track.id === currentTrackId}
          onPlay={() => onPlay(track)}
          hideAddToQueue
          extraActions={[{ label: "Remove from queue", onClick: () => onRemove(track.id) }]}
          drag={rowProps(i)}
          dropIndicator={indicatorFor(i)}
          isDragging={dragIndex === i}
        />
      ))}
    </ListPage>
  );
}
