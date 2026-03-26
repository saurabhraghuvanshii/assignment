"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { signIn as nextSignIn, signOut as nextSignOut } from "next-auth/react";
import {
  Car,
  MapPin,
  Clock,
  TrendingUp,
  Check,
  X,
  Pencil,
  History,
  Brain,
  Zap,
  RefreshCw,
  ArrowRight,
  AlertTriangle,
  UtensilsCrossed,
  Star,
  Timer,
  Truck,
  ChefHat,
  Target,
  BarChart3,
  Wallet,
  Smartphone,
  Wifi,
  WifiOff,
  Radio,
} from "lucide-react";

// ---- Ride types ----

interface PlatformQuote {
  platform: string;
  platformDisplayName: string;
  rideType: string;
  rideTypeDisplayName: string;
  price: number;
  priceDisplay: string;
  eta: number;
  tripDuration: number;
  surgeMultiplier: number;
  available: boolean;
  error?: string;
}

interface LiveData {
  quotes: PlatformQuote[];
  trafficCondition: string;
  trafficDelayMinutes: number;
  fetchedAt: string;
  errors: string[];
  dataSource?: {
    uber: "live" | "simulated" | "error";
    ola: "simulated";
    rapido: "simulated";
  };
}

interface RideSuggestion {
  id: string;
  status: string;
  patternId: string | null;
  origin: { address: string; lat: number; lng: number };
  destination: { address: string; lat: number; lng: number };
  suggestedDepartureTime: string;
  suggestedDepartureTimeDisplay: string;
  explanation: string;
  liveData: LiveData;
  recommendedPlatform: string | null;
  recommendedRideType: string | null;
  confidence: number;
}

interface RideHistoryItem {
  id: string;
  platform: string;
  rideType: string;
  originAddress: string;
  destAddress: string;
  departureTime: string;
  cost: number;
  distance: number;
  dayOfWeek: number;
}

interface RidePatternItem {
  id: string;
  dayOfWeek: number;
  hourOfDay: number;
  originAddress: string;
  destAddress: string;
  confidence: number;
  frequency: number;
  preferredPlatform: string | null;
  preferredRideType: string | null;
  consecutiveDismissals: number;
}

// ---- Food types ----

interface FoodSuggestion {
  id: string;
  status: string;
  patternId: string | null;
  platform: string;
  restaurantName: string;
  items: Array<{ name: string; price: number; quantity: number }>;
  cuisine: string;
  estimatedCost: number;
  estimatedDeliveryMin: number;
  explanation: string;
  liveData: {
    restaurants: Array<{
      platform: string;
      platformDisplayName: string;
      restaurantName: string;
      cuisine: string;
      rating: number;
      deliveryTimeMin: number;
      deliveryFee: number;
      deliveryFeeDisplay: string;
      surgeActive: boolean;
      surgeMultiplier: number;
      available: boolean;
      menu: Array<{
        name: string;
        price: number;
        priceDisplay: string;
        available: boolean;
        isVeg: boolean;
        isBestseller: boolean;
      }>;
    }>;
    deliveryCondition: string;
    extraDelayMinutes: number;
    fetchedAt: string;
    errors: string[];
    dataSource?: {
      zomato: "live" | "simulated" | "error";
      swiggy: "simulated";
    };
  };
  alternatives: Array<{
    platform: string;
    platformDisplayName: string;
    restaurantName: string;
    cuisine: string;
    rating: number;
    deliveryTimeMin: number;
    estimatedCost: number;
    deliveryFee: number;
    deliveryFeeDisplay: string;
    available: boolean;
  }>;
  confidence: number;
}

interface FoodOrderItem {
  id: string;
  platform: string;
  restaurantName: string;
  items: Array<{ name: string; quantity: number; price: number }>;
  cuisine: string;
  totalCost: number;
  deliveryFee: number;
  orderTime: string;
  deliveryDurationMinutes: number | null;
  dayOfWeek: number;
  rating: number | null;
}

interface FoodPatternItem {
  id: string;
  dayOfWeek: number;
  hourOfDay: number;
  cuisine: string;
  restaurantName: string;
  typicalItems: Array<{ name: string; frequency: number }>;
  confidence: number;
  frequency: number;
  averageCost: number;
  preferredPlatform: string | null;
  consecutiveDismissals: number;
}

// ---- Constants ----

const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const platformLogos: Record<string, { src: string; alt: string }> = {
  uber: { src: "/uber-svgrepo-com.svg", alt: "Uber" },
  ola: { src: "/ola-cabs.svg", alt: "Ola" },
  rapido: { src: "/rapido.svg", alt: "Rapido" },
  swiggy: { src: "/swiggy-1.svg", alt: "Swiggy" },
  zomato: { src: "/zomato-2.svg", alt: "Zomato" },
};

function PlatformLogo({ platform, size }: { platform: string; size?: number }) {
  const logo = platformLogos[platform];
  if (!logo)
    return (
      <div className="platform-fallback">
        {platform.slice(0, 1).toUpperCase()}
      </div>
    );
  return (
    <img
      className="platform-logo"
      src={logo.src}
      alt={logo.alt}
      style={
        size
          ? {
              width: size,
              height: size,
            }
          : undefined
      }
    />
  );
}

function DataSourceBadge({
  source,
  platform,
}: {
  source: "live" | "simulated" | "error";
  platform: string;
}) {
  if (source === "live") {
    return (
      <span
        className="data-source-badge data-source-live"
        title={`${platform}: Live data from real scraper`}
      >
        <Wifi size={10} /> {platform} Live
      </span>
    );
  }
  if (source === "error") {
    return (
      <span
        className="data-source-badge data-source-error"
        title={`${platform}: Scraper failed`}
      >
        <WifiOff size={10} /> {platform} Offline
      </span>
    );
  }
  return (
    <span
      className="data-source-badge data-source-simulated"
      title={`${platform}: Using simulated data`}
    >
      <Radio size={10} /> {platform} Simulated
    </span>
  );
}

function shortAddress(address: string): string {
  return address.split(",")[0].trim();
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatHour(h: number): string {
  if (h === 0) return "12:00 AM";
  if (h === 12) return "12:00 PM";
  return h > 12 ? `${h - 12}:00 PM` : `${h}:00 AM`;
}

function GoogleSignIn({
  showToast,
}: {
  showToast: (msg: string, type: "success" | "error") => void;
}) {
  return (
    <button
      className="btn-confirm"
      style={{ justifyContent: "center", display: "inline-flex" }}
      onClick={() => {
        showToast("Redirecting to Google…", "success");
        nextSignIn("google", { callbackUrl: "/" });
      }}
    >
      <ArrowRight size={16} /> Sign in with Google
    </button>
  );
}

function IntegrationsPanel({
  showToast,
  onLogout,
}: {
  showToast: (msg: string, type: "success" | "error") => void;
  onLogout: () => Promise<void>;
}) {
  const [integrations, setIntegrations] = useState<
    Array<{
      provider: string;
      status: string;
      scopes: string[];
      lastSyncAt: string | null;
      lastSyncStatus: string | null;
      sessionLast4: string | null;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await fetch("/api/integrations", { cache: "no-store" });
        const data = await res.json();
        setIntegrations(data.integrations || []);
        return data.integrations || [];
      } catch {
        if (!silent) showToast("Failed to load integrations", "error");
        return [];
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [showToast],
  );

  const pollForZomatoConnection = useCallback(async () => {
    for (let attempt = 0; attempt < 15; attempt++) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      const latest = (await load(true)) as Array<{
        provider: string;
        status: string;
      }>;
      const latestZomato = latest.find((i) => i.provider === "zomato");
      if (latestZomato?.status === "connected") {
        showToast("Zomato connected", "success");
        return;
      }
    }
  }, [load, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthState = params.get("oauth");
    if (!oauthState) return;
    if (oauthState === "uber-connected") {
      showToast("Uber connected via OAuth", "success");
      load();
    } else if (oauthState.startsWith("uber-")) {
      showToast(`Uber OAuth: ${oauthState}`, "error");
    }
    params.delete("oauth");
    const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", next);
  }, [load, showToast]);

  const zomato = integrations.find((i) => i.provider === "zomato");
  const uber = integrations.find((i) => i.provider === "uber");

  const connectZomatoWithBrowser = async () => {
    setConnecting(true);
    try {
      const res = await fetch("/api/integrations/zomato/playwright/start", {
        method: "POST",
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(
          data.error ||
            (data.logPath
              ? `Browser connect failed. Check ${data.logPath}`
              : "Browser connect failed"),
        );
      }
      showToast(
        data.message ||
          "Zomato login window launched. Complete login there to connect.",
        "success",
      );
      void pollForZomatoConnection();
    } catch (e) {
      showToast((e as Error).message, "error");
    }
    setConnecting(false);
  };

  const syncZomato = async () => {
    setConnecting(true);
    try {
      const res = await fetch("/api/integrations/zomato/sync", {
        method: "POST",
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.reason || data.error || "Sync failed");
      showToast(`Imported ${data.imported} Zomato orders`, "success");
      await load();
    } catch (e) {
      showToast(`Zomato sync failed: ${(e as Error).message}`, "error");
    }
    setConnecting(false);
  };

  return (
    <div>
      <div className="section-title">
        <Smartphone size={18} /> Integrations
      </div>

      <div
        style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}
      >
        <button className="btn-edit" onClick={onLogout}>
          <X size={14} /> Logout
        </button>
        <a
          className="btn-edit"
          href="/api/scraper-status"
          target="_blank"
          rel="noreferrer"
        >
          <BarChart3 size={14} /> Scraper status
        </a>
      </div>

      {loading ? (
        <div className="loading-container">
          <div className="loading-spinner" />
          <div className="loading-text">Loading integrations…</div>
        </div>
      ) : (
        <div className="patterns-grid">
          <div className="pattern-card food-pattern-card">
            <div className="pattern-header">
              <div className="pattern-day">
                <PlatformLogo platform="zomato" size={44} />
              </div>
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.72)",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              Imports your real Zomato order history using a browser-assisted
              login flow.
            </div>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span
                className={`data-source-badge ${zomato?.status === "connected" ? "data-source-live" : "data-source-simulated"}`}
              >
                {zomato?.status === "connected" ? (
                  <Wifi size={10} />
                ) : (
                  <Radio size={10} />
                )}{" "}
                {zomato?.status || "not connected"}
              </span>
            </div>
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                color: "rgba(255,255,255,0.6)",
              }}
            >
              {zomato?.lastSyncStatus || "Not synced yet"}
            </div>
            <div className="action-buttons" style={{ marginTop: 12 }}>
              <button
                className="btn-confirm food-confirm"
                onClick={connectZomatoWithBrowser}
                disabled={connecting}
                title="Opens a local browser window for Zomato login"
              >
                <ArrowRight size={16} />
                {connecting ? "Launching…" : "Connect with Browser"}
              </button>

              <button
                className="btn-confirm food-confirm"
                onClick={syncZomato}
                disabled={connecting || !zomato}
              >
                <RefreshCw
                  size={16}
                  className={connecting ? "loading-spinner" : ""}
                  style={{ border: "none", width: 16, height: 16 }}
                />
                Sync orders
              </button>
            </div>
          </div>

          <div className="pattern-card">
            <div className="pattern-header">
              <div className="pattern-day">
                <PlatformLogo platform="uber" size={44} />
              </div>
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.72)",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              Uber integration is prepared, but temporarily disabled until
              provider scope approval.
            </div>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span
                className={`data-source-badge ${uber?.status === "connected" ? "data-source-live" : "data-source-simulated"}`}
              >
                {uber?.status === "connected" ? (
                  <Wifi size={10} />
                ) : (
                  <Radio size={10} />
                )}{" "}
                {uber?.status || "not connected"}
              </span>
              {uber?.sessionLast4 && (
                <span className="data-source-badge data-source-simulated">
                  cookie {uber.sessionLast4}
                </span>
              )}
            </div>
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                color: "rgba(255,255,255,0.6)",
              }}
            >
              {uber?.lastSyncStatus || "Pending provider approval"}
            </div>
            <div className="action-buttons" style={{ marginTop: 12 }}>
              <button
                className="btn-confirm"
                disabled
                title="Temporarily disabled"
              >
                <ArrowRight size={16} /> Connect with Uber OAuth
              </button>
              <button
                className="btn-confirm"
                disabled
                title="Temporarily disabled"
              >
                <RefreshCw
                  size={16}
                  className={connecting ? "loading-spinner" : ""}
                  style={{ border: "none", width: 16, height: 16 }}
                />
                Sync trips
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== MAIN COMPONENT =====

export default function Home() {
  const [assistantMode, setAssistantMode] = useState<"rides" | "food">("rides");
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "history" | "patterns" | "integrations"
  >("dashboard");
  const urlHydratedRef = useRef(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [me, setMe] = useState<null | {
    id: string;
    name: string;
    email?: string | null;
  }>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const showToast = useCallback(
    (message: string, type: "success" | "error") => {
      setToast({ message, type });
      setTimeout(() => setToast(null), 3000);
    },
    [],
  );

  const refreshMe = useCallback(async () => {
    setAuthLoading(true);
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      setMe(data.user || null);
    } catch {
      setMe(null);
    }
    setAuthLoading(false);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void refreshMe();
    }, 0);
    return () => window.clearTimeout(id);
  }, [refreshMe]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab");
      const mode = params.get("mode");
      if (
        tab === "dashboard" ||
        tab === "history" ||
        tab === "patterns" ||
        tab === "integrations"
      ) {
        setActiveTab(tab);
      }
      if (mode === "rides" || mode === "food") {
        setAssistantMode(mode);
      }
      urlHydratedRef.current = true;
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!urlHydratedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    params.set("tab", activeTab);
    params.set("mode", assistantMode);
    const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState({}, "", next);
  }, [activeTab, assistantMode]);

  const now = new Date();
  const greeting =
    now.getHours() < 12
      ? "Good morning"
      : now.getHours() < 17
        ? "Good afternoon"
        : "Good evening";
  const displayName = me?.name || "there";

  if (authLoading) {
    return (
      <div className="app-container">
        <div className="loading-container" style={{ minHeight: "60vh" }}>
          <div className="loading-spinner" />
          <div className="loading-text">Loading…</div>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div
        className="app-container"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "70vh",
        }}
      >
        <div className="suggestion-card" style={{ width: "min(520px, 92vw)" }}>
          <div className="section-title" style={{ marginBottom: 8 }}>
            <Brain size={18} /> Sign in to ProAssist
          </div>
          <GoogleSignIn showToast={showToast} />
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <div className="app-logo">
            <span className="app-logo-mark">
              {assistantMode === "rides" ? "RideAssist" : "FoodAssist"}
            </span>
          </div>
          <div className="header-greeting">
            {greeting}, {displayName}
          </div>
          <div className="header-time">
            {now.toLocaleDateString("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}{" "}
            •{" "}
            {now.toLocaleTimeString("en-IN", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })}
          </div>
        </div>
        <div className="header-right">
          <div className="mode-switcher">
            <button
              className={`mode-btn ${assistantMode === "rides" ? "active" : ""}`}
              onClick={() => {
                setAssistantMode("rides");
                setActiveTab("dashboard");
              }}
            >
              <Car size={14} />
              Rides
            </button>
            <button
              className={`mode-btn ${assistantMode === "food" ? "active" : ""}`}
              onClick={() => {
                setAssistantMode("food");
                setActiveTab("dashboard");
              }}
            >
              <UtensilsCrossed size={14} />
              Food
            </button>
          </div>
          <div className="nav-tabs">
            <button
              className={`nav-tab ${activeTab === "dashboard" ? "active" : ""}`}
              onClick={() => setActiveTab("dashboard")}
            >
              <Zap
                size={14}
                style={{ marginRight: 4, verticalAlign: "middle" }}
              />
              Dashboard
            </button>
            <button
              className={`nav-tab ${activeTab === "history" ? "active" : ""}`}
              onClick={() => setActiveTab("history")}
            >
              <History
                size={14}
                style={{ marginRight: 4, verticalAlign: "middle" }}
              />
              History
            </button>
            <button
              className={`nav-tab ${activeTab === "patterns" ? "active" : ""}`}
              onClick={() => setActiveTab("patterns")}
            >
              <Brain
                size={14}
                style={{ marginRight: 4, verticalAlign: "middle" }}
              />
              Patterns
            </button>
            <button
              className={`nav-tab ${activeTab === "integrations" ? "active" : ""}`}
              onClick={() => setActiveTab("integrations")}
            >
              <Smartphone
                size={14}
                style={{ marginRight: 4, verticalAlign: "middle" }}
              />
              Integrations
            </button>
          </div>
        </div>
      </header>

      {activeTab === "integrations" ? (
        <IntegrationsPanel
          showToast={showToast}
          onLogout={async () => {
            // Let NextAuth clear its cookies
            await nextSignOut({ callbackUrl: "/" });
          }}
        />
      ) : assistantMode === "rides" ? (
        <RideAssistant activeTab={activeTab} showToast={showToast} />
      ) : (
        <FoodAssistant activeTab={activeTab} showToast={showToast} />
      )}

      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === "success" ? (
            <Check size={16} color="var(--accent-success)" />
          ) : (
            <X size={16} color="var(--accent-danger)" />
          )}
          {toast.message}
        </div>
      )}
    </div>
  );
}

// ===== RIDE ASSISTANT =====

function RideAssistant({
  activeTab,
  showToast,
}: {
  activeTab: string;
  showToast: (msg: string, type: "success" | "error") => void;
}) {
  const [suggestion, setSuggestion] = useState<RideSuggestion | null>(null);
  const [hasSuggestion, setHasSuggestion] = useState(false);
  const [noSuggestionReason, setNoSuggestionReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [selectedRideType, setSelectedRideType] = useState<string | null>(null);
  const [editOrigin, setEditOrigin] = useState("");
  const [editDest, setEditDest] = useState("");
  const [editTime, setEditTime] = useState("");
  const [rides, setRides] = useState<RideHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyFilter, setHistoryFilter] = useState<string | null>(null);
  const [patterns, setPatterns] = useState<RidePatternItem[]>([]);
  const [patternsLoading, setPatternsLoading] = useState(false);

  const fetchSuggestion = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/suggestions");
      const data = await res.json();
      setHasSuggestion(data.hasSuggestion);
      setSuggestion(data.suggestion);
      setNoSuggestionReason(data.reason || "");
      if (data.suggestion) {
        setSelectedPlatform(data.suggestion.recommendedPlatform);
        setSelectedRideType(data.suggestion.recommendedRideType);
      }
      setConfirmed(false);
      setEditing(false);
    } catch {
      showToast("Failed to load suggestions", "error");
    }
    setLoading(false);
  }, [showToast]);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(historyPage),
        limit: "15",
      });
      if (historyFilter) params.set("platform", historyFilter);
      const res = await fetch(`/api/ride-history?${params}`);
      const data = await res.json();
      setRides(data.rides || []);
      setHistoryTotal(data.pagination?.totalPages || 1);
    } catch {
      showToast("Failed to load ride history", "error");
    }
    setHistoryLoading(false);
  }, [historyPage, historyFilter, showToast]);

  const fetchPatterns = useCallback(async () => {
    setPatternsLoading(true);
    try {
      const res = await fetch("/api/patterns");
      const data = await res.json();
      setPatterns(data.patterns || []);
    } catch {
      showToast("Failed to load patterns", "error");
    }
    setPatternsLoading(false);
  }, [showToast]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void fetchSuggestion();
    }, 0);
    return () => window.clearTimeout(id);
  }, [fetchSuggestion]);
  useEffect(() => {
    if (activeTab !== "history") return;
    const id = window.setTimeout(() => {
      void fetchHistory();
    }, 0);
    return () => window.clearTimeout(id);
  }, [activeTab, fetchHistory]);
  useEffect(() => {
    if (activeTab !== "patterns") return;
    const id = window.setTimeout(() => {
      void fetchPatterns();
    }, 0);
    return () => window.clearTimeout(id);
  }, [activeTab, fetchPatterns]);

  const handleConfirm = async () => {
    if (!suggestion) return;
    setConfirming(true);
    try {
      const res = await fetch("/api/suggestions/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionId: suggestion.id,
          platform: selectedPlatform,
          rideType: selectedRideType,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setConfirmed(true);
        showToast("Ride confirmed!", "success");
      }
    } catch {
      showToast("Failed to confirm ride", "error");
    }
    setConfirming(false);
  };

  const handleDismiss = async () => {
    if (!suggestion) return;
    try {
      await fetch("/api/suggestions/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestionId: suggestion.id }),
      });
      setHasSuggestion(false);
      setSuggestion(null);
      showToast("Suggestion dismissed", "success");
    } catch {
      showToast("Failed to dismiss suggestion", "error");
    }
  };

  const handleEdit = () => {
    if (!suggestion) return;
    setEditOrigin(suggestion.origin.address);
    setEditDest(suggestion.destination.address);
    setEditTime(suggestion.suggestedDepartureTimeDisplay);
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!suggestion) return;
    try {
      await fetch("/api/suggestions/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionId: suggestion.id,
          editedFields: {
            origin:
              editOrigin !== suggestion.origin.address
                ? { address: editOrigin }
                : undefined,
            destination:
              editDest !== suggestion.destination.address
                ? { address: editDest }
                : undefined,
            departureTime:
              editTime !== suggestion.suggestedDepartureTimeDisplay
                ? editTime
                : undefined,
            platform: selectedPlatform,
            rideType: selectedRideType,
          },
        }),
      });
      setEditing(false);
      showToast("Suggestion updated", "success");
      fetchSuggestion();
    } catch {
      showToast("Failed to save edits", "error");
    }
  };

  const groupedQuotes = suggestion?.liveData?.quotes
    ? Object.values(
        suggestion.liveData.quotes
          .filter((q) => q.available)
          .reduce<Record<string, PlatformQuote[]>>((acc, q) => {
            if (!acc[q.platform]) acc[q.platform] = [];
            acc[q.platform].push(q);
            return acc;
          }, {}),
      ).flat()
    : [];

  if (activeTab === "history") {
    return (
      <div>
        <div className="section-title">
          <History size={18} /> Ride History
        </div>
        <div className="filter-bar">
          {[null, "uber", "ola", "rapido"].map((f) => (
            <button
              key={f || "all"}
              className={`filter-chip ${historyFilter === f ? "active" : ""}`}
              onClick={() => {
                setHistoryFilter(f);
                setHistoryPage(1);
              }}
            >
              {f ? (
                <>
                  <PlatformLogo platform={f} />
                  <span className="sr-only">
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </span>
                </>
              ) : (
                "All"
              )}
            </button>
          ))}
        </div>
        {historyLoading ? (
          <div className="loading-container">
            <div className="loading-spinner" />
            <div className="loading-text">Loading rides...</div>
          </div>
        ) : (
          <>
            <div className="ride-history-list">
              {rides.map((ride) => (
                <div key={ride.id} className="ride-item">
                  <div
                    className={`ride-platform-icon ride-platform-${ride.platform}`}
                  >
                    <PlatformLogo platform={ride.platform} />
                  </div>
                  <div className="ride-info">
                    <div className="ride-route">
                      {shortAddress(ride.originAddress)} →{" "}
                      {shortAddress(ride.destAddress)}
                    </div>
                    <div className="ride-meta">
                      <span>{formatDate(ride.departureTime)}</span>
                      <span>{formatTime(ride.departureTime)}</span>
                      <span>{ride.rideType}</span>
                      <span>{ride.distance} km</span>
                    </div>
                  </div>
                  <div className="ride-cost">₹{ride.cost}</div>
                </div>
              ))}
            </div>
            <div className="pagination">
              <button
                className="page-btn"
                disabled={historyPage <= 1}
                onClick={() => setHistoryPage((p) => p - 1)}
              >
                ← Previous
              </button>
              <span className="page-info">
                Page {historyPage} of {historyTotal}
              </span>
              <button
                className="page-btn"
                disabled={historyPage >= historyTotal}
                onClick={() => setHistoryPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (activeTab === "patterns") {
    return (
      <div>
        <div className="section-title">
          <Brain size={18} /> Learned Ride Patterns
        </div>
        {patternsLoading ? (
          <div className="loading-container">
            <div className="loading-spinner" />
            <div className="loading-text">Loading patterns...</div>
          </div>
        ) : (
          <div className="patterns-grid">
            {patterns.map((pattern) => (
              <div key={pattern.id} className="pattern-card">
                <div className="pattern-header">
                  <div className="pattern-day">
                    {dayNames[pattern.dayOfWeek]} at{" "}
                    {formatHour(pattern.hourOfDay)}
                  </div>
                  <div className="confidence-bar">
                    <div
                      className="confidence-fill"
                      style={{ width: `${pattern.confidence * 100}%` }}
                    />
                  </div>
                </div>
                <div className="pattern-route">
                  {shortAddress(pattern.originAddress)} →{" "}
                  {shortAddress(pattern.destAddress)}
                </div>
                <div className="pattern-details">
                  <span>
                    <Target
                      size={12}
                      style={{ marginRight: 4, verticalAlign: "middle" }}
                    />
                    {Math.round(pattern.confidence * 100)}% confidence
                  </span>
                  <span>
                    <BarChart3
                      size={12}
                      style={{ marginRight: 4, verticalAlign: "middle" }}
                    />
                    {pattern.frequency} rides
                  </span>
                  {pattern.preferredPlatform && (
                    <span>
                      <PlatformLogo platform={pattern.preferredPlatform} />{" "}
                      {pattern.preferredPlatform}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {patterns.length === 0 && (
              <div className="no-suggestion">
                <div className="no-suggestion-title">
                  No patterns detected yet
                </div>
                <div className="no-suggestion-text">
                  Patterns will appear after the learning engine analyzes your
                  ride history.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Dashboard
  return (
    <div>
      {loading ? (
        <div className="loading-container">
          <div className="loading-spinner" />
          <div className="loading-text">Analyzing your ride patterns...</div>
        </div>
      ) : hasSuggestion && suggestion ? (
        <div className={`suggestion-card ${confirmed ? "confirmed" : ""}`}>
          <div className="suggestion-header">
            <div
              className={`suggestion-badge ${confirmed ? "confirmed-badge" : ""}`}
            >
              {confirmed ? (
                <>
                  <Check size={12} /> Confirmed
                </>
              ) : (
                <>
                  <Zap size={12} /> Proactive Suggestion
                </>
              )}
            </div>
            {!confirmed && (
              <button
                className="dismiss-btn"
                onClick={handleDismiss}
                title="Dismiss"
              >
                <X size={16} />
              </button>
            )}
          </div>
          {confirmed ? (
            <div className="confirmed-overlay">
              <div className="confirmed-icon">
                <Check size={32} color="#0a0a0f" />
              </div>
              <div className="confirmed-text">Ride Confirmed!</div>
              <div className="confirmed-subtext">
                {selectedPlatform
                  ? `${selectedPlatform.charAt(0).toUpperCase() + selectedPlatform.slice(1)}`
                  : "Your ride"}{" "}
                to {shortAddress(suggestion.destination.address)} • Departing at{" "}
                {suggestion.suggestedDepartureTimeDisplay}
              </div>
            </div>
          ) : editing ? (
            <div className="edit-overlay">
              <div className="edit-field">
                <div className="edit-label">Pickup Location</div>
                <input
                  className="edit-input"
                  value={editOrigin}
                  onChange={(e) => setEditOrigin(e.target.value)}
                />
              </div>
              <div className="edit-field">
                <div className="edit-label">Destination</div>
                <input
                  className="edit-input"
                  value={editDest}
                  onChange={(e) => setEditDest(e.target.value)}
                />
              </div>
              <div className="edit-field">
                <div className="edit-label">Departure Time</div>
                <input
                  className="edit-input"
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                />
              </div>
              <div className="edit-field">
                <div className="edit-label">Platform</div>
                <select
                  className="edit-select"
                  value={selectedPlatform || ""}
                  onChange={(e) => setSelectedPlatform(e.target.value)}
                >
                  <option value="uber">Uber</option>
                  <option value="ola">Ola</option>
                  <option value="rapido">Rapido</option>
                </select>
              </div>
              <div className="edit-field">
                <div className="edit-label">Ride Type</div>
                <select
                  className="edit-select"
                  value={selectedRideType || ""}
                  onChange={(e) => setSelectedRideType(e.target.value)}
                >
                  <option value="cab">Cab</option>
                  <option value="auto">Auto</option>
                  <option value="bike">Bike</option>
                  <option value="premium">Premium</option>
                </select>
              </div>
              <div className="edit-actions">
                <button className="btn-save-edit" onClick={handleSaveEdit}>
                  Save Changes
                </button>
                <button
                  className="btn-cancel-edit"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="explanation-text">
                <AlertTriangle
                  size={14}
                  style={{
                    marginRight: 6,
                    verticalAlign: "middle",
                    color: "var(--accent-warning)",
                  }}
                />
                {suggestion.explanation}
              </div>
              <div className="route-display">
                <div className="route-point">
                  <div className="route-label">
                    <MapPin
                      size={10}
                      style={{ marginRight: 4, verticalAlign: "middle" }}
                    />{" "}
                    Pickup
                  </div>
                  <div className="route-address">
                    {shortAddress(suggestion.origin.address)}
                  </div>
                </div>
                <div className="route-arrow">
                  <div className="route-arrow-line" />
                  <ArrowRight size={14} />
                </div>
                <div className="route-point">
                  <div className="route-label">
                    <MapPin
                      size={10}
                      style={{ marginRight: 4, verticalAlign: "middle" }}
                    />{" "}
                    Drop-off
                  </div>
                  <div className="route-address">
                    {shortAddress(suggestion.destination.address)}
                  </div>
                </div>
              </div>
              <div className="departure-time-display">
                <Clock
                  size={18}
                  style={{ color: "var(--accent-primary-light)" }}
                />
                <div>
                  <div className="departure-label">Suggested Departure</div>
                  <div className="departure-value">
                    {suggestion.suggestedDepartureTimeDisplay}
                  </div>
                </div>
                <div style={{ marginLeft: "auto" }}>
                  <span
                    className={`traffic-badge traffic-${suggestion.liveData.trafficCondition}`}
                  >
                    <TrendingUp size={10} />
                    {suggestion.liveData.trafficCondition === "low"
                      ? "Clear"
                      : suggestion.liveData.trafficCondition === "moderate"
                        ? "Moderate"
                        : suggestion.liveData.trafficCondition === "heavy"
                          ? "Heavy"
                          : "Severe"}
                    {suggestion.liveData.trafficDelayMinutes > 0 &&
                      ` +${suggestion.liveData.trafficDelayMinutes}m`}
                  </span>
                </div>
              </div>
              {suggestion.liveData.dataSource && (
                <div className="data-source-bar">
                  <DataSourceBadge
                    source={suggestion.liveData.dataSource.uber}
                    platform="Uber"
                  />
                  <DataSourceBadge
                    source={suggestion.liveData.dataSource.ola}
                    platform="Ola"
                  />
                  <DataSourceBadge
                    source={suggestion.liveData.dataSource.rapido}
                    platform="Rapido"
                  />
                </div>
              )}
              <div className="platforms-grid">
                {groupedQuotes.map((q, i) => (
                  <div
                    key={`${q.platform}-${q.rideType}-${i}`}
                    className={`platform-card ${selectedPlatform === q.platform && selectedRideType === q.rideType ? "selected" : ""} ${q.platform === suggestion.recommendedPlatform && q.rideType === suggestion.recommendedRideType ? "recommended" : ""} ${!q.available ? "unavailable" : ""}`}
                    onClick={() => {
                      if (q.available) {
                        setSelectedPlatform(q.platform);
                        setSelectedRideType(q.rideType);
                      }
                    }}
                  >
                    <div className="platform-name">{q.platformDisplayName}</div>
                    <div className="platform-ride-type">
                      {q.rideTypeDisplayName}
                    </div>
                    <div className="platform-price">
                      {q.available ? q.priceDisplay : "--"}
                    </div>
                    {q.surgeMultiplier > 1.1 && (
                      <div className="surge-indicator">
                        <Zap
                          size={12}
                          style={{ marginRight: 4, verticalAlign: "middle" }}
                        />
                        {q.surgeMultiplier}× surge
                      </div>
                    )}
                    <div className="platform-details">
                      <div className="platform-detail">
                        <span className="platform-detail-label">Pickup</span>
                        <span className="platform-detail-value">
                          {q.eta} min
                        </span>
                      </div>
                      <div className="platform-detail">
                        <span className="platform-detail-label">Trip</span>
                        <span className="platform-detail-value">
                          {q.tripDuration} min
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {suggestion.liveData.errors &&
                suggestion.liveData.errors.length > 0 && (
                  <div
                    style={{
                      marginBottom: 16,
                      fontSize: 12,
                      color: "var(--accent-warning)",
                    }}
                  >
                    <AlertTriangle
                      size={12}
                      style={{ marginRight: 6, verticalAlign: "middle" }}
                    />
                    {suggestion.liveData.errors.join(" • ")}
                  </div>
                )}
              <div className="action-buttons">
                <button
                  className="btn-confirm"
                  onClick={handleConfirm}
                  disabled={confirming}
                >
                  {confirming ? (
                    <>
                      <RefreshCw
                        size={16}
                        className="loading-spinner"
                        style={{ border: "none", width: 16, height: 16 }}
                      />{" "}
                      Confirming...
                    </>
                  ) : (
                    <>
                      <Check size={16} /> Confirm Ride
                    </>
                  )}
                </button>
                <button className="btn-edit" onClick={handleEdit}>
                  <Pencil size={14} /> Edit
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="no-suggestion">
          <div className="no-suggestion-icon">
            <Car size={40} />
          </div>
          <div className="no-suggestion-title">
            No rides suggested right now
          </div>
          <div className="no-suggestion-text">
            {noSuggestionReason ||
              "RideAssist will notify you when it detects you may need a ride based on your patterns."}
          </div>
          <button
            className="btn-edit"
            style={{ margin: "16px auto 0", display: "inline-flex" }}
            onClick={fetchSuggestion}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      )}
      {!loading && (
        <div className="stats-bar">
          <div className="stat-item">
            <div className="stat-value">
              {suggestion?.confidence
                ? `${Math.round(suggestion.confidence * 100)}%`
                : "--"}
            </div>
            <div className="stat-label">Pattern Confidence</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">
              {suggestion?.liveData?.trafficDelayMinutes || 0}m
            </div>
            <div className="stat-label">Traffic Delay</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">
              {groupedQuotes.filter((q) => q.available).length || 0}
            </div>
            <div className="stat-label">Options Available</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">
              {groupedQuotes.length > 0
                ? `₹${Math.min(...groupedQuotes.filter((q) => q.available).map((q) => q.price))}`
                : "--"}
            </div>
            <div className="stat-label">Lowest Price</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== FOOD ASSISTANT =====

function FoodAssistant({
  activeTab,
  showToast,
}: {
  activeTab: string;
  showToast: (msg: string, type: "success" | "error") => void;
}) {
  const [suggestion, setSuggestion] = useState<FoodSuggestion | null>(null);
  const [hasSuggestion, setHasSuggestion] = useState(false);
  const [noSuggestionReason, setNoSuggestionReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editRestaurant, setEditRestaurant] = useState("");
  const [editPlatform, setEditPlatform] = useState("");
  const [editItems, setEditItems] = useState<
    Array<{ name: string; price: number; quantity: number }>
  >([]);
  const [orders, setOrders] = useState<FoodOrderItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyFilter, setHistoryFilter] = useState<string | null>(null);
  const [patterns, setPatterns] = useState<FoodPatternItem[]>([]);
  const [patternsLoading, setPatternsLoading] = useState(false);

  const fetchSuggestion = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/food/suggestions");
      const data = await res.json();
      setHasSuggestion(data.hasSuggestion);
      setSuggestion(data.suggestion);
      setNoSuggestionReason(data.reason || "");
      setConfirmed(false);
      setEditing(false);
    } catch {
      showToast("Failed to load food suggestions", "error");
    }
    setLoading(false);
  }, [showToast]);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(historyPage),
        limit: "15",
      });
      if (historyFilter) params.set("platform", historyFilter);
      const res = await fetch(`/api/food/order-history?${params}`);
      const data = await res.json();
      setOrders(data.orders || []);
      setHistoryTotal(data.pagination?.totalPages || 1);
    } catch {
      showToast("Failed to load order history", "error");
    }
    setHistoryLoading(false);
  }, [historyPage, historyFilter, showToast]);

  const fetchPatterns = useCallback(async () => {
    setPatternsLoading(true);
    try {
      const res = await fetch("/api/food/patterns");
      const data = await res.json();
      setPatterns(data.patterns || []);
    } catch {
      showToast("Failed to load food patterns", "error");
    }
    setPatternsLoading(false);
  }, [showToast]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void fetchSuggestion();
    }, 0);
    return () => window.clearTimeout(id);
  }, [fetchSuggestion]);
  useEffect(() => {
    if (activeTab !== "history") return;
    const id = window.setTimeout(() => {
      void fetchHistory();
    }, 0);
    return () => window.clearTimeout(id);
  }, [activeTab, fetchHistory]);
  useEffect(() => {
    if (activeTab !== "patterns") return;
    const id = window.setTimeout(() => {
      void fetchPatterns();
    }, 0);
    return () => window.clearTimeout(id);
  }, [activeTab, fetchPatterns]);

  const handleConfirm = async () => {
    if (!suggestion) return;
    setConfirming(true);
    try {
      const res = await fetch("/api/food/suggestions/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionId: suggestion.id,
          platform: suggestion.platform,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setConfirmed(true);
        showToast("Order confirmed!", "success");
      }
    } catch {
      showToast("Failed to confirm order", "error");
    }
    setConfirming(false);
  };

  const handleDismiss = async () => {
    if (!suggestion) return;
    try {
      await fetch("/api/food/suggestions/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestionId: suggestion.id }),
      });
      setHasSuggestion(false);
      setSuggestion(null);
      showToast("Suggestion dismissed", "success");
    } catch {
      showToast("Failed to dismiss suggestion", "error");
    }
  };

  const handleEdit = () => {
    if (!suggestion) return;
    setEditRestaurant(suggestion.restaurantName);
    setEditPlatform(suggestion.platform);
    setEditItems(suggestion.items.map((i) => ({ ...i })));
    setEditing(true);
  };

  const updateEditItem = (
    index: number,
    field: "name" | "quantity",
    value: string | number,
  ) => {
    setEditItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  const removeEditItem = (index: number) => {
    setEditItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveEdit = async () => {
    if (!suggestion) return;
    try {
      const itemsChanged =
        JSON.stringify(editItems) !== JSON.stringify(suggestion.items);
      await fetch("/api/food/suggestions/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionId: suggestion.id,
          editedFields: {
            restaurant:
              editRestaurant !== suggestion.restaurantName
                ? editRestaurant
                : undefined,
            platform:
              editPlatform !== suggestion.platform ? editPlatform : undefined,
            items: itemsChanged ? editItems : undefined,
          },
        }),
      });
      setEditing(false);
      showToast("Suggestion updated", "success");
      fetchSuggestion();
    } catch {
      showToast("Failed to save edits", "error");
    }
  };

  // History tab
  if (activeTab === "history") {
    return (
      <div>
        <div className="section-title">
          <History size={18} /> Order History
        </div>
        <div className="filter-bar">
          {[null, "swiggy", "zomato"].map((f) => (
            <button
              key={f || "all"}
              className={`filter-chip ${historyFilter === f ? "active" : ""}`}
              onClick={() => {
                setHistoryFilter(f);
                setHistoryPage(1);
              }}
            >
              {f ? (
                <>
                  <PlatformLogo platform={f} />
                  <span className="sr-only">
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </span>
                </>
              ) : (
                "All"
              )}
            </button>
          ))}
        </div>
        {historyLoading ? (
          <div className="loading-container">
            <div className="loading-spinner" />
            <div className="loading-text">Loading orders...</div>
          </div>
        ) : (
          <>
            <div className="ride-history-list">
              {orders.map((order) => (
                <div key={order.id} className="ride-item">
                  <div
                    className={`ride-platform-icon food-platform-${order.platform}`}
                  >
                    <PlatformLogo platform={order.platform} />
                  </div>
                  <div className="ride-info">
                    <div className="ride-route">
                      {order.restaurantName}
                      <span className="food-cuisine-tag">{order.cuisine}</span>
                    </div>
                    <div className="ride-meta">
                      <span>{formatDate(order.orderTime)}</span>
                      <span>{formatTime(order.orderTime)}</span>
                      <span>
                        {(order.items as Array<{ name: string }>)
                          .map((i) => i.name)
                          .join(", ")}
                      </span>
                    </div>
                  </div>
                  <div className="ride-cost">
                    ₹{Math.round(order.totalCost)}
                  </div>
                </div>
              ))}
            </div>
            <div className="pagination">
              <button
                className="page-btn"
                disabled={historyPage <= 1}
                onClick={() => setHistoryPage((p) => p - 1)}
              >
                ← Previous
              </button>
              <span className="page-info">
                Page {historyPage} of {historyTotal}
              </span>
              <button
                className="page-btn"
                disabled={historyPage >= historyTotal}
                onClick={() => setHistoryPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // Patterns tab
  if (activeTab === "patterns") {
    return (
      <div>
        <div className="section-title">
          <Brain size={18} /> Learned Food Patterns
        </div>
        {patternsLoading ? (
          <div className="loading-container">
            <div className="loading-spinner" />
            <div className="loading-text">Loading patterns...</div>
          </div>
        ) : (
          <div className="patterns-grid">
            {patterns.map((pattern) => (
              <div key={pattern.id} className="pattern-card food-pattern-card">
                <div className="pattern-header">
                  <div className="pattern-day">
                    {dayNames[pattern.dayOfWeek]} at{" "}
                    {formatHour(pattern.hourOfDay)}
                  </div>
                  <div className="confidence-bar">
                    <div
                      className="confidence-fill food-confidence"
                      style={{ width: `${pattern.confidence * 100}%` }}
                    />
                  </div>
                </div>
                <div className="pattern-route">
                  <ChefHat
                    size={12}
                    style={{ marginRight: 4, verticalAlign: "middle" }}
                  />
                  {pattern.restaurantName}
                  <span className="food-cuisine-tag">{pattern.cuisine}</span>
                </div>
                <div className="food-pattern-items">
                  {(pattern.typicalItems || []).slice(0, 3).map((item, i) => (
                    <span key={i} className="food-item-chip">
                      {item.name}
                    </span>
                  ))}
                </div>
                <div className="pattern-details">
                  <span>
                    <Target
                      size={12}
                      style={{ marginRight: 4, verticalAlign: "middle" }}
                    />
                    {Math.round(pattern.confidence * 100)}%
                  </span>
                  <span>
                    <BarChart3
                      size={12}
                      style={{ marginRight: 4, verticalAlign: "middle" }}
                    />
                    {pattern.frequency} orders
                  </span>
                  <span>
                    <Wallet
                      size={12}
                      style={{ marginRight: 4, verticalAlign: "middle" }}
                    />
                    ~₹{pattern.averageCost}
                  </span>
                  {pattern.preferredPlatform && (
                    <span>
                      <Smartphone
                        size={12}
                        style={{ marginRight: 4, verticalAlign: "middle" }}
                      />
                      {pattern.preferredPlatform}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {patterns.length === 0 && (
              <div className="no-suggestion">
                <div className="no-suggestion-title">
                  No food patterns detected yet
                </div>
                <div className="no-suggestion-text">
                  Patterns will appear after the learning engine analyzes your
                  order history.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Dashboard
  return (
    <div>
      {loading ? (
        <div className="loading-container">
          <div className="loading-spinner" />
          <div className="loading-text">Analyzing your food patterns...</div>
        </div>
      ) : hasSuggestion && suggestion ? (
        <div
          className={`suggestion-card food-suggestion ${confirmed ? "confirmed" : ""}`}
        >
          <div className="suggestion-header">
            <div
              className={`suggestion-badge food-badge ${confirmed ? "confirmed-badge" : ""}`}
            >
              {confirmed ? (
                <>
                  <Check size={12} /> Confirmed
                </>
              ) : (
                <>
                  <UtensilsCrossed size={12} /> Proactive Suggestion
                </>
              )}
            </div>
            {!confirmed && (
              <button
                className="dismiss-btn"
                onClick={handleDismiss}
                title="Dismiss"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {confirmed ? (
            <div className="confirmed-overlay">
              <div className="confirmed-icon food-confirmed-icon">
                <Check size={32} color="#0a0a0f" />
              </div>
              <div
                className="confirmed-text"
                style={{ color: "var(--accent-food)" }}
              >
                Order Confirmed!
              </div>
              <div className="confirmed-subtext">
                {suggestion.restaurantName} via{" "}
                {suggestion.platform.charAt(0).toUpperCase() +
                  suggestion.platform.slice(1)}{" "}
                • Estimated delivery in {suggestion.estimatedDeliveryMin} min
              </div>
            </div>
          ) : editing ? (
            <div className="edit-overlay">
              <div className="edit-field">
                <div className="edit-label">Restaurant</div>
                <input
                  className="edit-input"
                  value={editRestaurant}
                  onChange={(e) => setEditRestaurant(e.target.value)}
                />
              </div>
              <div className="edit-field">
                <div className="edit-label">Platform</div>
                <select
                  className="edit-select"
                  value={editPlatform}
                  onChange={(e) => setEditPlatform(e.target.value)}
                >
                  <option value="swiggy">Swiggy</option>
                  <option value="zomato">Zomato</option>
                </select>
              </div>
              <div className="edit-field">
                <div className="edit-label">Items</div>
                {editItems.map((item, i) => (
                  <div key={i} className="edit-item-row">
                    <input
                      className="edit-input edit-item-name"
                      value={item.name}
                      onChange={(e) =>
                        updateEditItem(i, "name", e.target.value)
                      }
                      placeholder="Item name"
                    />
                    <select
                      className="edit-select edit-item-qty"
                      value={item.quantity}
                      onChange={(e) =>
                        updateEditItem(i, "quantity", parseInt(e.target.value))
                      }
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}×
                        </option>
                      ))}
                    </select>
                    <button
                      className="edit-item-remove"
                      onClick={() => removeEditItem(i)}
                      title="Remove"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="edit-actions">
                <button
                  className="btn-save-edit food-save"
                  onClick={handleSaveEdit}
                >
                  Save Changes
                </button>
                <button
                  className="btn-cancel-edit"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Explanation */}
              <div className="explanation-text food-explanation">
                <AlertTriangle
                  size={14}
                  style={{
                    marginRight: 6,
                    verticalAlign: "middle",
                    color: "var(--accent-food)",
                  }}
                />
                {suggestion.explanation}
              </div>

              {suggestion.liveData.dataSource && (
                <div className="data-source-bar">
                  <DataSourceBadge
                    source={suggestion.liveData.dataSource.zomato}
                    platform="Zomato"
                  />
                  <DataSourceBadge
                    source={suggestion.liveData.dataSource.swiggy}
                    platform="Swiggy"
                  />
                </div>
              )}

              {/* Restaurant + items */}
              <div className="food-order-card">
                <div className="food-restaurant-header">
                  <div>
                    <div className="food-restaurant-name">
                      {suggestion.restaurantName}
                    </div>
                    <div className="food-restaurant-meta">
                      <span className="food-cuisine-tag">
                        {suggestion.cuisine}
                      </span>
                      <span className="food-platform-tag">
                        {suggestion.platform === "swiggy" ? "Swiggy" : "Zomato"}
                      </span>
                    </div>
                  </div>
                  <div className="food-delivery-info">
                    <div className="food-delivery-time">
                      <Timer size={14} />
                      {suggestion.estimatedDeliveryMin} min
                    </div>
                    <div
                      className={`delivery-badge delivery-${suggestion.liveData.deliveryCondition}`}
                    >
                      <Truck size={10} />
                      {suggestion.liveData.deliveryCondition === "normal"
                        ? "On Time"
                        : suggestion.liveData.deliveryCondition === "busy"
                          ? "Busy"
                          : "Very Busy"}
                      {suggestion.liveData.extraDelayMinutes > 0 &&
                        ` +${suggestion.liveData.extraDelayMinutes}m`}
                    </div>
                  </div>
                </div>

                {/* Suggested items */}
                <div className="food-items-list">
                  {suggestion.items.map((item, i) => (
                    <div key={i} className="food-item-row">
                      <div className="food-item-qty">{item.quantity}×</div>
                      <div className="food-item-name">{item.name}</div>
                      <div className="food-item-price">₹{item.price}</div>
                    </div>
                  ))}
                  <div className="food-item-total">
                    <span>Estimated Total</span>
                    <span>₹{suggestion.estimatedCost}</span>
                  </div>
                </div>
              </div>

              {/* Alternatives */}
              {suggestion.alternatives &&
                suggestion.alternatives.length > 0 && (
                  <div className="food-alternatives">
                    <div className="food-alternatives-title">Other options</div>
                    <div className="food-alternatives-grid">
                      {suggestion.alternatives.map((alt, i) => (
                        <div key={i} className="food-alt-card">
                          <div className="food-alt-name">
                            {alt.restaurantName}
                          </div>
                          <div className="food-alt-meta">
                            <span className="food-cuisine-tag small">
                              {alt.cuisine}
                            </span>
                            <span>
                              <Star size={10} /> {alt.rating}
                            </span>
                          </div>
                          <div className="food-alt-details">
                            <span>
                              <Timer size={10} /> {alt.deliveryTimeMin} min
                            </span>
                            <span>~₹{alt.estimatedCost}</span>
                            <span className="food-alt-platform">
                              {alt.platformDisplayName}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* Errors */}
              {suggestion.liveData.errors &&
                suggestion.liveData.errors.length > 0 && (
                  <div
                    style={{
                      marginBottom: 16,
                      fontSize: 12,
                      color: "var(--accent-warning)",
                    }}
                  >
                    <AlertTriangle
                      size={12}
                      style={{ marginRight: 6, verticalAlign: "middle" }}
                    />
                    {suggestion.liveData.errors.join(" • ")}
                  </div>
                )}

              {/* Actions */}
              <div className="action-buttons">
                <button
                  className="btn-confirm food-confirm"
                  onClick={handleConfirm}
                  disabled={confirming}
                >
                  {confirming ? (
                    <>
                      <RefreshCw
                        size={16}
                        className="loading-spinner"
                        style={{ border: "none", width: 16, height: 16 }}
                      />{" "}
                      Confirming...
                    </>
                  ) : (
                    <>
                      <Check size={16} /> Confirm Order
                    </>
                  )}
                </button>
                <button className="btn-edit" onClick={handleEdit}>
                  <Pencil size={14} /> Edit
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="no-suggestion">
          <div className="no-suggestion-icon">
            <UtensilsCrossed size={40} />
          </div>
          <div className="no-suggestion-title">
            No food suggestions right now
          </div>
          <div className="no-suggestion-text">
            {noSuggestionReason ||
              "FoodAssist will notify you when it detects you may want to order based on your patterns."}
          </div>
          <button
            className="btn-edit"
            style={{ margin: "16px auto 0", display: "inline-flex" }}
            onClick={fetchSuggestion}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      )}

      {/* Stats */}
      {!loading && (
        <div className="stats-bar">
          <div className="stat-item food-stat">
            <div className="stat-value food-stat-value">
              {suggestion?.confidence
                ? `${Math.round(suggestion.confidence * 100)}%`
                : "--"}
            </div>
            <div className="stat-label">Pattern Confidence</div>
          </div>
          <div className="stat-item food-stat">
            <div className="stat-value food-stat-value">
              {suggestion?.estimatedDeliveryMin || 0}m
            </div>
            <div className="stat-label">Est. Delivery</div>
          </div>
          <div className="stat-item food-stat">
            <div className="stat-value food-stat-value">
              {suggestion?.alternatives?.length || 0}
            </div>
            <div className="stat-label">Alternatives</div>
          </div>
          <div className="stat-item food-stat">
            <div className="stat-value food-stat-value">
              {suggestion ? `₹${suggestion.estimatedCost}` : "--"}
            </div>
            <div className="stat-label">Est. Cost</div>
          </div>
        </div>
      )}
    </div>
  );
}
