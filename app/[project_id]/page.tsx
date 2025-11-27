"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { FaArrowLeft, FaLink, FaRedo } from "react-icons/fa";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

type PreviewState = "loading" | "ready" | "error";

const normalizeRoute = (route: string): string => {
  if (!route) return "/";
  return route.startsWith("/") ? route : `/${route}`;
};

const joinPreviewUrl = (base: string, route: string, bustCache = false): string => {
  const normalizedRoute = normalizeRoute(route);

  try {
    const url = new URL(base);
    url.pathname = normalizedRoute;
    if (bustCache) {
      url.searchParams.set("_ts", Date.now().toString());
    }
    return url.toString();
  } catch {
    const trimmed = base.replace(/\/+$/, "");
    const cacheSuffix = bustCache ? `${normalizedRoute}${normalizedRoute.includes("?") ? "&" : "?"}_ts=${Date.now()}` : normalizedRoute;
    return `${trimmed}${cacheSuffix}`;
  }
};

export default function ProjectPreviewPage() {
  const params = useParams<{ project_id: string }>();
  const searchParams = useSearchParams();
  const projectId = params?.project_id ?? "";

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<PreviewState>("loading");
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const apiBase = useMemo(() => (API_BASE || "").replace(/\/+$/, ""), []);
  const initialRoute = useMemo(
    () => normalizeRoute(searchParams?.get("route") ?? "/"),
    [searchParams]
  );
  const isEmbedded = useMemo(() => {
    const raw = searchParams?.get("embed");
    return raw === "1" || raw === "true";
  }, [searchParams]);
  const [currentRoute, setCurrentRoute] = useState<string>(initialRoute);

  const extractPreviewUrl = (data: any): string | null => {
    if (!data || typeof data !== "object") return null;
    if (typeof data.url === "string") return data.url;
    if (typeof data.previewUrl === "string") return data.previewUrl;
    return null;
  };

  const requestPreview = useCallback(async (): Promise<string | null> => {
    const statusRes = await fetch(`${apiBase}/api/projects/${projectId}/preview/status`);
    if (statusRes.ok) {
      const payload = await statusRes.json().catch(() => ({}));
      const statusData = payload?.data ?? payload ?? {};
      const runningUrl = extractPreviewUrl(statusData);
      if (runningUrl) {
        return runningUrl;
      }
    }

    const startRes = await fetch(`${apiBase}/api/projects/${projectId}/preview/start`, {
      method: "POST",
    });
    if (!startRes.ok) {
      const text = await startRes.text().catch(() => "Failed to start preview");
      throw new Error(text);
    }
    const payload = await startRes.json().catch(() => ({}));
    const startData = payload?.data ?? payload ?? {};
    return extractPreviewUrl(startData);
  }, [apiBase, projectId]);

  const ensurePreview = useCallback(async () => {
    if (!projectId) return;
    setStatus("loading");
    setError(null);
    try {
      const url = await requestPreview();
      if (!url) {
        throw new Error("Preview URL was not returned from the server.");
      }
      setPreviewUrl(url);
      setStatus("ready");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start preview";
      setError(message);
      setStatus("error");
    }
  }, [projectId, requestPreview]);

  useEffect(() => {
    void ensurePreview();
  }, [ensurePreview]);

  useEffect(() => {
    if (!previewUrl || !iframeRef.current || status !== "ready") return;
    iframeRef.current.src = joinPreviewUrl(previewUrl, currentRoute);
  }, [previewUrl, currentRoute, status]);

  const handleRefresh = useCallback(() => {
    if (previewUrl && iframeRef.current) {
      iframeRef.current.src = joinPreviewUrl(previewUrl, currentRoute, true);
    } else {
      void ensurePreview();
    }
  }, [previewUrl, currentRoute, ensurePreview]);

  const openRawPreview = useMemo(() => {
    if (!previewUrl) return null;
    return joinPreviewUrl(previewUrl, "/");
  }, [previewUrl]);

  return (
    <div className={`min-h-screen flex flex-col ${isEmbedded ? "" : "bg-black text-white"}`}>
      {!isEmbedded && (
        <header className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black">
          <div className="flex items-center gap-3">
            <Link
              href={`/${projectId}/chat`}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:bg-gray-100 transition"
            >
              <FaArrowLeft size={12} />
              Back to chat
            </Link>
            {openRawPreview && (
              <a
                href={openRawPreview}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 text-sm text-white hover:bg-white/5 transition"
              >
                <FaLink size={12} />
                Open underlying preview
              </a>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg bg-white/5 border border-white/10 px-2">
              <span className="text-xs text-white/70 mr-1">/{projectId}</span>
              <span className="text-xs text-white/40">→</span>
              <input
                value={currentRoute === "/" ? "" : currentRoute.replace(/^\//, "")}
                onChange={(event) => setCurrentRoute(normalizeRoute(event.target.value))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleRefresh();
                  }
                }}
                placeholder="route"
                className="bg-transparent text-sm text-white outline-none px-2 py-1 w-32"
              />
            </div>
            <button
              onClick={handleRefresh}
              className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-white/10 text-white hover:bg-white/5 transition"
              title="Refresh preview"
            >
              <FaRedo size={14} />
            </button>
          </div>
        </header>
      )}

      <div className="flex-1 relative bg-black">
        {status === "ready" && previewUrl ? (
          <iframe
            ref={iframeRef}
            className="w-full h-full border-none bg-white"
            src={joinPreviewUrl(previewUrl, currentRoute)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-3 bg-gradient-to-b from-black via-black to-gray-900">
            <div className="w-12 h-12 rounded-full border-4 border-white/30 border-t-white animate-spin" />
            <div className="text-sm font-medium">
              {status === "error" ? "Preview unavailable" : "Starting preview..."}
            </div>
            {error && (
              <div className="text-xs text-red-300 max-w-md text-center px-4">
                {error}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => void ensurePreview()}
                className="px-3 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:bg-gray-100 transition"
              >
                Retry
              </button>
              {!isEmbedded && (
                <Link
                  href={`/${projectId}/chat`}
                  className="px-3 py-2 rounded-lg border border-white/10 text-sm text-white hover:bg-white/5 transition"
                >
                  Back to chat
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
