import { Track } from "../lib/types";
import { PillButton } from "./ListPage";
import TrackRow from "./TrackRow";

export interface ArtistPageData {
  name: string;
  /** Tracks by this artist you've played, most-played first. */
  yours: { track: Track; plays: number }[];
  /** Search results that look like this artist's songs. */
  popular: Track[];
}

interface ArtistViewProps {
  data: ArtistPageData | null;
  isLoading: boolean;
  error: string | null;
  currentTrackId: string | null;
  isPlaying: boolean;
  onPlay: (track: Track, list: Track[]) => void;
  onPlayAll: (tracks: Track[], shuffle?: boolean) => void;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export default function ArtistView({
  data,
  isLoading,
  error,
  currentTrackId,
  isPlaying,
  onPlay,
  onPlayAll,
}: ArtistViewProps) {
  if (!data) {
    return (
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <p className="text-sm text-mist-500">{isLoading ? "Loading artist…" : "Artist not found."}</p>
      </div>
    );
  }

  const yourTracks = data.yours.map((y) => y.track);
  const yourIds = new Set(yourTracks.map((t) => t.id));
  // Songs already under "Your top tracks" don't need repeating below.
  const morePopular = data.popular.filter((t) => !yourIds.has(t.id));
  const everything = [...yourTracks, ...morePopular];
  const totalPlays = data.yours.reduce((sum, y) => sum + y.plays, 0);

  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <div className="flex items-center gap-5 max-w-3xl">
        <div
          aria-hidden="true"
          className="w-24 h-24 rounded-full bg-ink-700 flex items-center justify-center font-display text-3xl font-semibold text-mist-300 shrink-0 overflow-hidden"
        >
          {data.popular[0] || yourTracks[0] ? (
            <img
              src={(yourTracks[0] ?? data.popular[0]).thumbnail}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            initials(data.name)
          )}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-mist-500 uppercase tracking-wide">Artist</p>
          <h1 className="font-display text-3xl font-semibold truncate">{data.name}</h1>
          {totalPlays > 0 && (
            <p className="text-sm text-mist-500 mt-1">
              You've played them {totalPlays} time{totalPlays === 1 ? "" : "s"}
            </p>
          )}
          <div className="flex items-center gap-2 mt-3">
            <PillButton primary onClick={() => onPlayAll(everything)} disabled={everything.length === 0}>
              Play all
            </PillButton>
            <PillButton onClick={() => onPlayAll(everything, true)} disabled={everything.length === 0}>
              Shuffle
            </PillButton>
          </div>
        </div>
      </div>

      {data.yours.length > 0 && (
        <section className="mt-8 max-w-3xl">
          <h2 className="text-sm font-medium text-mist-100 mb-1">Your top tracks</h2>
          <ul className="flex flex-col divide-y divide-ink-800">
            {data.yours.map(({ track, plays }) => (
              <TrackRow
                key={track.id}
                track={track}
                subtitle={`${plays} play${plays === 1 ? "" : "s"}`}
                isCurrent={track.id === currentTrackId}
                isPlaying={isPlaying}
                onPlay={() => onPlay(track, yourTracks)}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 max-w-3xl">
        <h2 className="text-sm font-medium text-mist-100 mb-1">
          {yourTracks.length > 0 ? "More from this artist" : "Popular"}
        </h2>
        {isLoading && data.popular.length === 0 ? (
          <p className="text-sm text-mist-500 py-3">Finding their songs…</p>
        ) : error ? (
          <p className="text-sm text-ember-soft py-3">{error}</p>
        ) : morePopular.length === 0 ? (
          <p className="text-sm text-mist-500 py-3">
            {data.popular.length > 0
              ? "Everything found is already in your top tracks above."
              : "Couldn't find more songs by this artist."}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-ink-800">
            {morePopular.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                isCurrent={track.id === currentTrackId}
                isPlaying={isPlaying}
                onPlay={() => onPlay(track, morePopular)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
