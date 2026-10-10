interface WelcomePageProps {
  onGetStarted: () => void;
}

function NestMark() {
  return (
    <svg width="72" height="72" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <circle cx="14" cy="14" r="14" fill="#ff6f3c" />
      <rect x="10.5" y="9.5" width="2.6" height="9" rx="1.3" fill="#0e1016" />
      <rect x="14.7" y="6.5" width="2.6" height="15" rx="1.3" fill="#0e1016" />
    </svg>
  );
}

const HIGHLIGHTS: { title: string; body: string }[] = [
  {
    title: "Search & play",
    body: "Find almost anything and start listening immediately — no account, no paywall.",
  },
  {
    title: "Playlists that stay yours",
    body: "Saved locally on this machine. Nothing is uploaded anywhere.",
  },
  {
    title: "Suggestions as you go",
    body: "The more you search and play, the better the Suggestions tab gets at surfacing more like it.",
  },
];

export default function WelcomePage({ onGetStarted }: WelcomePageProps) {
  return (
    <div className="h-screen w-full flex items-center justify-center bg-ink-900 text-mist-100 px-8">
      <div className="max-w-md w-full flex flex-col items-center text-center">
        <NestMark />
        <h1 className="font-display text-3xl font-semibold mt-6">
          Welcome to Playnest
        </h1>
        <p className="text-sm text-mist-500 mt-2 leading-relaxed">
          An open source, self-contained music player. Your library, your
          playlists, your machine.
        </p>

        <div className="w-full flex flex-col gap-4 mt-8">
          {HIGHLIGHTS.map((item) => (
            <div
              key={item.title}
              className="text-left bg-ink-800 border border-ink-700 rounded-xl px-5 py-4"
            >
              <p className="text-sm font-medium text-mist-100">{item.title}</p>
              <p className="text-xs text-mist-500 mt-1 leading-relaxed">
                {item.body}
              </p>
            </div>
          ))}
        </div>

        <button
          onClick={onGetStarted}
          className="mt-8 w-full text-sm font-medium px-5 py-3 rounded-full bg-ember text-ink-950 hover:bg-ember-dim transition-colors"
        >
          Get started
        </button>
      </div>
    </div>
  );
}
