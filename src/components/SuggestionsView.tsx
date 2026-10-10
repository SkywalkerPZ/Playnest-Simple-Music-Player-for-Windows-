import { Recommendation, Track } from "../lib/types";
import ListPage, { PillButton } from "./ListPage";
import TrackRow from "./TrackRow";

interface SuggestionsViewProps {
  recommendations: Recommendation[];
  isLoading: boolean;
  hasHistory: boolean;
  currentTrackId: string | null;
  isPlaying: boolean;
  onPlay: (track: Track) => void;
  onRefresh: () => void;
}

export default function SuggestionsView({
  recommendations,
  isLoading,
  hasHistory,
  currentTrackId,
  isPlaying,
  onPlay,
  onRefresh,
}: SuggestionsViewProps) {
  return (
    <ListPage
      title="Suggestions"
      description="Built from what you play, like and search. Every pick says why it's here."
      headerActions={
        <PillButton onClick={onRefresh} disabled={isLoading}>
          {isLoading ? "Refreshing…" : "Refresh"}
        </PillButton>
      }
      isLoading={isLoading}
      loadingText="Finding suggestions…"
      isEmpty={recommendations.length === 0}
      emptyText={
        hasHistory
          ? "Couldn't find anything new right now. Play or like a few more tracks, then refresh."
          : "Search for and play a few tracks first. Suggestions come from what you actually listen to, so there's nothing to go on yet."
      }
    >
      {recommendations.map(({ track, reason }) => (
        <TrackRow
          key={track.id}
          track={track}
          subtitle={reason}
          isCurrent={track.id === currentTrackId}
          isPlaying={isPlaying}
          onPlay={() => onPlay(track)}
        />
      ))}
    </ListPage>
  );
}
