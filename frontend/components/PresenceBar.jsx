import { useState, useRef, useEffect } from "react";
import { shareUrlForRoom } from "@/lib/config";

export default function PresenceBar({
  roomId,
  users,
  selfName,
  selfColor,
  userCount,
  connectionStatus,
  isViewer = false,
}) {
  const [copied, setCopied] = useState(null);
  const [showUserList, setShowUserList] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const containerRef = useRef(null);
  const shareRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setShowUserList(false);
      }
      if (shareRef.current && !shareRef.current.contains(event.target)) {
        setShowShareMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCopy = async (role) => {
    try {
      await navigator.clipboard.writeText(shareUrlForRoom(roomId, role));
      setCopied(role);
      setShowShareMenu(false);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // Clipboard API can fail in insecure contexts; fail silently
    }
  };

  const statusLabel =
    connectionStatus === "open" ? "Live" : connectionStatus === "connecting" ? "Connecting…" : "Disconnected";
  const statusDot =
    connectionStatus === "open" ? "bg-emerald-500" : connectionStatus === "connecting" ? "bg-amber" : "bg-red-500";

  const allUsers = [{ id: "__self__", name: selfName, color: selfColor }, ...users];
  const visible = allUsers.slice(0, 5);
  const overflow = allUsers.length - visible.length;

  const shareButtonLabel = copied ? "Copied!" : "Share link";

  return (
    <div className="flex h-14 w-full items-center justify-between gap-3 border-b border-line bg-surface px-4 sm:px-5">
      <div className="flex items-center gap-3">
        <span className="font-display text-sm font-semibold tracking-tight">Sketch.io</span>
        <span className="hidden h-4 w-px bg-line sm:block" />
        {!isViewer && (
          <button
            onClick={() => handleCopy("editor")}
            className="hidden items-center gap-1.5 rounded-md border border-line px-2.5 py-1 font-mono text-xs text-ink-soft transition hover:border-accent hover:text-accent sm:flex"
            title="Copy room link"
          >
            <span>{roomId}</span>
            <CopyIcon />
          </button>
        )}
        {isViewer && (
          <span className="hidden rounded-full bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-amber-700 sm:inline dark:bg-amber-950/50 dark:text-amber-400">
            View only
          </span>
        )}
      </div>

      <div ref={containerRef} className="flex items-center gap-3 sm:gap-4 relative">
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink-soft">
          <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
          {statusLabel}
        </span>

        <button
          onClick={() => setShowUserList(!showUserList)}
          className="flex items-center gap-2 hover:opacity-85 focus:outline-none"
          title="Click to view all users in room"
        >
          <div className="flex items-center -space-x-2">
            {visible.map((u) => (
              <div
                key={u.id}
                style={{ backgroundColor: u.color }}
                className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface text-[10px] font-semibold text-white avatar-ring"
              >
                {u.name.trim().charAt(0).toUpperCase()}
              </div>
            ))}
            {overflow > 0 && (
              <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-line text-[10px] font-semibold text-ink-soft">
                +{overflow}
              </div>
            )}
          </div>

          <span className="font-mono text-xs text-ink-soft select-none hover:text-accent flex items-center gap-1">
            <span>{userCount} online</span>
            <ChevronDownIcon className={`h-3 w-3 transition-transform duration-150 ${showUserList ? "rotate-180" : ""}`} />
          </span>
        </button>

        {showUserList && (
          <div className="absolute right-0 top-10 z-50 w-56 rounded-xl border border-line bg-surface p-3 shadow-md animate-fade-in">
            <p className="font-mono text-[9px] uppercase tracking-wider text-ink-soft mb-2 px-1 text-left">
              Active in Room
            </p>
            <div className="max-h-60 overflow-y-auto flex flex-col gap-1.5">
              {allUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent-soft/30 transition-colors"
                >
                  <div
                    style={{ backgroundColor: u.color }}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                  >
                    {u.name.trim().charAt(0).toUpperCase()}
                  </div>
                  <span className="text-xs font-medium truncate flex-1 text-left">
                    {u.name}
                  </span>
                  {u.id === "__self__" && (
                    <span className="text-[9px] font-mono bg-accent/10 text-accent px-1.5 py-0.5 rounded">
                      You
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!isViewer && (
          <div ref={shareRef} className="relative">
            <button
              onClick={() => setShowShareMenu(!showShareMenu)}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 sm:hidden"
            >
              {copied ? "Copied!" : "Share"}
            </button>
            <button
              onClick={() => setShowShareMenu(!showShareMenu)}
              className="hidden items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 sm:flex"
            >
              {shareButtonLabel}
              <ChevronDownIcon className={`h-3 w-3 transition-transform duration-150 ${showShareMenu ? "rotate-180" : ""}`} />
            </button>

            {showShareMenu && (
              <div className="absolute right-0 top-10 z-50 w-64 rounded-xl border border-line bg-surface p-2 shadow-md animate-fade-in">
                <p className="font-mono text-[9px] uppercase tracking-wider text-ink-soft mb-2 px-2 pt-1 text-left">
                  Share as
                </p>
                <button
                  onClick={() => handleCopy("editor")}
                  className="flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2.5 text-left transition hover:bg-accent-soft/40"
                >
                  <span className="text-xs font-semibold text-ink">Editor</span>
                  <span className="text-[10px] text-ink-soft">Can draw and edit the board</span>
                </button>
                <button
                  onClick={() => handleCopy("viewer")}
                  className="flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2.5 text-left transition hover:bg-accent-soft/40"
                >
                  <span className="text-xs font-semibold text-ink">Viewer</span>
                  <span className="text-[10px] text-ink-soft">Can only view — no drawing</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function ChevronDownIcon({ className }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
