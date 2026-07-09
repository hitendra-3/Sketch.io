import { useState } from "react";

export default function NameModal({ roomId, defaultName, isViewer = false, onJoin }) {
  const [name, setName] = useState(defaultName);

  const handleSubmit = (e) => {
    e.preventDefault();
    onJoin(name.trim() || defaultName);
  };

  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 px-4 backdrop-blur-md">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-md animate-pop-in flex flex-col items-center text-center"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent text-2xl font-bold mb-4 shadow-sm border border-accent/10">
          {initial}
        </div>

        <p className="font-mono text-[10px] uppercase tracking-wider text-accent font-semibold bg-accent-soft px-2 py-0.5 rounded-full mb-1">
          Room {roomId}
        </p>
        <h2 className="font-display text-xl font-semibold tracking-tight text-ink">
          {isViewer ? "Join as Viewer" : "Join the Studio"}
        </h2>
        <p className="mt-1 text-xs text-ink-soft max-w-[280px]">
          {isViewer
            ? "You can watch the board live but won't be able to draw or edit."
            : "Enter your name so others can see who is drawing on the board."}
        </p>

        <div className="mt-5 w-full">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 24))}
            placeholder="Your name"
            className="w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-sm text-ink outline-none transition-all duration-150 focus:border-accent focus:ring-4 focus:ring-accent-glow"
          />
        </div>

        <button
          type="submit"
          className="mt-4 w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-accent/90 hover:shadow active:scale-[0.98]"
        >
          {isViewer ? "Enter as Viewer" : "Enter Whiteboard"}
        </button>
      </form>
    </div>
  );
}
