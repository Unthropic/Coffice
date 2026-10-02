"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Link from "next/link";
import { useCompanionFeed } from "./use-companion-feed";
import type { NormalizedStatusValue } from "../lib/domain";
import {
  COMPANION_COLORS,
  COMPANION_WIDTH,
  companionDesk,
  companionCoffeeRoute,
  companionIdentity,
  companionStatus,
  companionWorldHeight,
} from "../lib/companion-world";
import styles from "./companion-office.module.css";

type CompanionTask = {
  id: string;
  title: string;
  agentName?: string;
  model?: string;
  status: {
    value: NormalizedStatusValue;
    stale?: boolean;
    timestamp?: string | null;
    evidence?: string;
  };
};

const DEMO_TASKS: CompanionTask[] = [
  {
    id: "demo-juniper-1",
    title: "A little garden for the internet",
    agentName: "Juniper",
    status: { value: "coding", evidence: "simulated" },
  },
  {
    id: "demo-milo-2",
    title: "Make the buttons feel lovely",
    agentName: "Milo",
    status: { value: "thinking", evidence: "simulated" },
  },
  {
    id: "demo-clementine-0",
    title: "A story about a very small moon",
    agentName: "Clementine",
    status: { value: "completed", evidence: "simulated" },
  },
  {
    id: "demo-pip-6",
    title: "Which shade of green?",
    agentName: "Pip",
    status: { value: "waiting_for_user", evidence: "simulated" },
  },
  {
    id: "demo-olive-1",
    title: "Explore something wonderful",
    agentName: "Olive",
    status: { value: "researching", evidence: "simulated" },
  },
  {
    id: "demo-bean-3",
    title: "Keep the office company",
    agentName: "Bean",
    status: { value: "idle", evidence: "simulated" },
  },
];

function Plant({ x, y, size = 1 }: { x: number; y: number; size?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`}>
      <circle cy="5" r="27" fill="#815845" opacity=".12" />
      <circle r="25" fill="#cf9679" />
      <circle r="20" fill="#755a40" />
      {[0, 60, 120, 180, 240, 300].map((angle, index) => (
        <ellipse
          key={angle}
          cx="0"
          cy="-18"
          rx="13"
          ry="29"
          transform={`rotate(${angle})`}
          fill={index % 2 ? "#7f9e68" : "#587e59"}
          stroke="#527455"
          strokeWidth="1.5"
        />
      ))}
      <circle r="10" fill="#a1b67c" />
    </g>
  );
}

function Desk({
  index,
  occupied,
  working,
}: {
  index: number;
  occupied: boolean;
  working: boolean;
}) {
  const { x, y } = companionDesk(index);
  return (
    <g
      transform={`translate(${x} ${y})`}
      className={styles.desk}
      data-working={working}
    >
      <rect
        x="-82"
        y="-57"
        width="164"
        height="108"
        rx="18"
        fill="#85684d"
        opacity=".13"
      />
      <rect
        x="-82"
        y="-64"
        width="164"
        height="108"
        rx="18"
        fill="#c9a57e"
        stroke="#b28d6d"
        strokeWidth="2"
      />
      <rect x="-75" y="-57" width="150" height="92" rx="13" fill="#e3c6a1" />
      <path d="M-63 17H63M-63-39H63" stroke="#c9a680" opacity=".35" />
      <rect x="-44" y="-46" width="88" height="49" rx="7" fill="#44594f" />
      <rect
        x="-38"
        y="-40"
        width="76"
        height="36"
        rx="3"
        fill={occupied ? "#a8c8bc" : "#60746a"}
      />
      {occupied && (
        <g
          stroke="#f5f9df"
          strokeWidth="3"
          strokeLinecap="round"
          opacity={working ? ".9" : ".4"}
        >
          <path d="M-28-28h27M-28-20h43M-28-12h17" />
        </g>
      )}
      <rect x="-15" y="2" width="30" height="5" rx="2" fill="#64756a" />
      <rect
        x="-31"
        y="13"
        width="62"
        height="17"
        rx="4"
        fill="#faf0de"
        stroke="#bbaa8e"
      />
      <path
        d="M-24 18H24M-24 23H24"
        stroke="#c8b99e"
        strokeWidth="2"
        strokeDasharray="3 3"
      />
      <rect x="43" y="11" width="13" height="19" rx="6" fill="#f5ead8" />
      <circle cx="-62" cy="-26" r="9" fill="#fff4db" />
      <circle cx="-62" cy="-26" r="5.5" fill="#956b48" />
      <circle cx="63" cy="-37" r="11" fill="#d39873" />
      <path d="M56-40l7-12 7 12-7 7Z" fill="#729966" />
      <rect
        x="-32"
        y="60"
        width="64"
        height="60"
        rx="24"
        fill="#b2b79a"
        stroke="#8e9b83"
        strokeWidth="3"
      />
      <rect x="-27" y="95" width="54" height="13" rx="6" fill="#8e9b83" />
    </g>
  );
}

function RoomArt({
  count,
  tasks,
  height,
  night,
}: {
  count: number;
  tasks: CompanionTask[];
  height: number;
  night: boolean;
}) {
  return (
    <svg
      className={styles.roomArt}
      width={COMPANION_WIDTH}
      height={height}
      viewBox={`0 0 ${COMPANION_WIDTH} ${height}`}
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="coffice-floor"
          width="140"
          height="68"
          patternUnits="userSpaceOnUse"
        >
          <rect width="140" height="68" fill="#f1dfc2" />
          <path
            d="M0 0H140M0 34H140M70 0V34M20 34V68"
            fill="none"
            stroke="#d8c4a5"
            strokeWidth="1"
            opacity=".55"
          />
          <path d="M15 9h34m42 39h29M81 23h34" stroke="#d8c4a5" opacity=".25" />
        </pattern>
        <pattern
          id="coffice-rug"
          width="14"
          height="14"
          patternUnits="userSpaceOnUse"
        >
          <rect width="14" height="14" fill="#d0d9bb" />
          <path
            d="M0 7H14M7 0V14"
            stroke="#aaba98"
            strokeWidth=".7"
            opacity=".6"
          />
        </pattern>
      </defs>
      <rect
        x="20"
        y="27"
        width="1060"
        height={height - 47}
        rx="38"
        fill="#667965"
        opacity=".14"
      />
      <rect
        x="20"
        y="14"
        width="1060"
        height={height - 47}
        rx="38"
        fill="#e3d5bc"
        stroke="#c2baa3"
        strokeWidth="3"
      />
      <rect
        x="34"
        y="28"
        width="1032"
        height={height - 74}
        rx="27"
        fill="url(#coffice-floor)"
        stroke="#e9edd7"
        strokeWidth="10"
      />
      <path
        d="M110 29H345M486 29H695M811 29H996"
        stroke="#799d97"
        strokeWidth="12"
      />
      <path
        d="M110 27H345M486 27H695M811 27H996"
        stroke="#d9f0df"
        strokeWidth="6"
      />
      {!night && (
        <g fill="#fff6d1" opacity=".33">
          <path d="M110 40H345L451 190H215Z" />
          <path d="M811 40H996L1056 190H916Z" />
        </g>
      )}
      <rect
        x="430"
        y="118"
        width="600"
        height={height - 218}
        rx="34"
        fill="url(#coffice-rug)"
        stroke="#b0bd97"
        strokeWidth="2"
      />
      <rect
        x="441"
        y="129"
        width="578"
        height={height - 240}
        rx="26"
        fill="none"
        stroke="#eef0d5"
        strokeWidth="3"
      />
      <rect
        x="83"
        y="302"
        width="292"
        height="230"
        rx="88"
        fill="#dda790"
        opacity=".63"
      />
      <rect
        x="95"
        y="314"
        width="268"
        height="206"
        rx="78"
        fill="none"
        stroke="#f5d4b9"
        strokeWidth="3"
      />
      <rect
        x="88"
        y="87"
        width="276"
        height="101"
        rx="16"
        fill="#b7a07e"
        stroke="#a08d72"
        strokeWidth="2"
      />
      <rect x="96" y="95" width="260" height="84" rx="11" fill="#f2ead4" />
      <rect x="113" y="107" width="68" height="56" rx="9" fill="#47695c" />
      <rect x="124" y="115" width="46" height="20" rx="4" fill="#93b2a0" />
      <circle cx="138" cy="148" r="7" fill="#f8e9c7" />
      <circle cx="156" cy="148" r="7" fill="#f8e9c7" />
      <rect x="209" y="111" width="49" height="46" rx="6" fill="#d9b47d" />
      <circle cx="222" cy="126" r="6" fill="#faf1db" />
      <circle cx="244" cy="138" r="6" fill="#faf1db" />
      <circle cx="222" cy="148" r="6" fill="#faf1db" />
      <ellipse cx="309" cy="135" rx="26" ry="22" fill="#decaa8" />
      <ellipse cx="309" cy="135" rx="19" ry="15" fill="#b57b4c" />
      <path
        d="M297 133l6-4m7 11 9-4m-18 8 6-2"
        stroke="#edd19a"
        strokeWidth="3"
      />
      <text
        x="226"
        y="220"
        textAnchor="middle"
        fill="#796049"
        fontSize="13"
        fontWeight="700"
        letterSpacing="4"
      >
        THE COFFEE CORNER
      </text>
      <rect
        x="99"
        y="343"
        width="90"
        height="145"
        rx="24"
        fill="#638d83"
        stroke="#507d72"
        strokeWidth="4"
      />
      <rect x="107" y="351" width="70" height="60" rx="15" fill="#8eb0a1" />
      <rect x="107" y="421" width="70" height="58" rx="15" fill="#8eb0a1" />
      <rect x="107" y="351" width="17" height="128" rx="8" fill="#77a194" />
      <circle cx="279" cy="414" r="57" fill="#a28261" opacity=".2" />
      <circle
        cx="279"
        cy="406"
        r="57"
        fill="#ebd3ac"
        stroke="#bda17a"
        strokeWidth="3"
      />
      <circle cx="291" cy="398" r="11" fill="#fff8e6" />
      <circle cx="291" cy="398" r="7" fill="#976c42" />
      <rect
        x="248"
        y="403"
        width="28"
        height="35"
        rx="3"
        fill="#c87760"
        transform="rotate(-16 262 420)"
      />
      <path d="M255 414l13-4m-11 9 13-4" stroke="#edd4b3" strokeWidth="2" />
      <circle
        cx="280"
        cy="315"
        r="26"
        fill="#caa36e"
        stroke="#b58d5e"
        strokeWidth="3"
      />
      <circle
        cx="370"
        cy="419"
        r="24"
        fill="#caa36e"
        stroke="#b58d5e"
        strokeWidth="3"
      />
      <rect
        x="85"
        y={height - 134}
        width="282"
        height="52"
        rx="15"
        fill="#ab8863"
      />
      <rect
        x="91"
        y={height - 129}
        width="270"
        height="41"
        rx="10"
        fill="#79905e"
      />
      {[117, 171, 225, 279, 335].map((x, i) => (
        <Plant key={x} x={x} y={height - 110} size={0.54 + (i % 2) * 0.1} />
      ))}
      <Plant x={80} y={262} size={0.72} />
      <Plant x={1020} y={78} size={0.75} />
      <Plant x={1031} y={height - 80} size={0.8} />
      {Array.from({ length: Math.max(6, count) }, (_, index) => (
        <Desk
          key={index}
          index={index}
          occupied={index < count}
          working={
            !!tasks[index] &&
            companionStatus(
              tasks[index].status.value,
              tasks[index].status.stale,
            ).mood === "working"
          }
        />
      ))}
      <text
        x="728"
        y="89"
        textAnchor="middle"
        fill="#796049"
        fontSize="13"
        fontWeight="700"
        letterSpacing="5"
      >
        GOOD THINGS TAKE A LITTLE TIME
      </text>
      <path d={`M482 ${height - 38}h160`} stroke="#f4e7cc" strokeWidth="13" />
      {night && (
        <rect
          x="34"
          y="28"
          width="1032"
          height={height - 74}
          rx="27"
          fill="#735751"
          opacity=".14"
        />
      )}
    </svg>
  );
}

function Avatar({
  identity,
  walking = false,
  working = false,
  mini = false,
}: {
  identity: number;
  walking?: boolean;
  working?: boolean;
  mini?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`${styles.avatar} ${walking ? styles.walking : ""} ${working ? styles.working : ""} ${mini ? styles.miniAvatar : ""}`}
      style={
        {
          "--avatar-x": `${(identity % 3) * 50}%`,
          "--avatar-y": `${Math.floor(identity / 3) * 100}%`,
        } as CSSProperties
      }
    />
  );
}

function WorldAgent({
  task,
  index,
  selected,
  coffeeRound,
  breakRound,
  onSelect,
}: {
  task: CompanionTask;
  index: number;
  selected: boolean;
  coffeeRound: number;
  breakRound: number;
  onSelect: () => void;
}) {
  const identity = companionIdentity(task.id);
  const desk = companionDesk(index);
  const status = companionStatus(task.status.value, task.status.stale);
  const [coffee, setCoffee] = useState(false);
  const [walking, setWalking] = useState(false);
  const [trip, setTrip] = useState<{
    x: number;
    y: number;
    duration: number;
    angle: number;
  } | null>(null);
  useEffect(() => {
    if (!coffeeRound) return;
    const served = window.setTimeout(() => setCoffee(true), 50);
    const finished = window.setTimeout(() => setCoffee(false), 6000);
    return () => {
      window.clearTimeout(served);
      window.clearTimeout(finished);
    };
  }, [coffeeRound]);
  useEffect(() => {
    if (!breakRound) return;
    const route = companionCoffeeRoute(index);
    const timers = route.map((step) =>
      window.setTimeout(() => {
        setTrip(step);
        setWalking(step.walking);
      }, step.startsAt),
    );
    const last = route[route.length - 1];
    timers.push(
      window.setTimeout(
        () => {
          setTrip(null);
          setWalking(false);
        },
        last.startsAt + last.duration + 30,
      ),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [breakRound, index]);
  const position = trip ?? { x: desk.x, y: desk.y + 78 };
  return (
    <button
      type="button"
      className={styles.worldAgent}
      data-selected={selected}
      data-mood={status.mood}
      data-coffee={coffee}
      style={
        {
          left: position.x,
          top: position.y,
          "--agent-color": COMPANION_COLORS[identity],
          transitionDuration: `${trip?.duration ?? 0}ms`,
        } as CSSProperties
      }
      onClick={onSelect}
      aria-label={`${task.agentName || task.title}: ${status.label}`}
      aria-pressed={selected}
    >
      <span className={styles.agentShadow} />
      <span
        className={styles.agentOrientation}
        style={{ transform: `rotate(${trip?.angle ?? 180}deg)` }}
      >
        <Avatar
          identity={identity}
          walking={walking}
          working={!trip && status.mood === "working"}
        />
      </span>
      <span className={styles.bubble} aria-hidden="true">
        {coffee || (trip && !walking) ? "☕" : status.symbol}
      </span>
      <span className={styles.worldName}>
        {task.agentName || `Desk ${String(index + 1).padStart(2, "0")}`}
      </span>
    </button>
  );
}

function CoffeeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 8h12v7a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5V8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M17 9h2a3 3 0 0 1 0 6h-2M8 3v2m4-2v2m4-2v2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CompanionOffice() {
  const feed = useCompanionFeed();
  const [demo, setDemo] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [night, setNight] = useState(false);
  const [coffeeRound, setCoffeeRound] = useState(0);
  const [coffeeBusy, setCoffeeBusy] = useState(false);
  const [coffeeVisit, setCoffeeVisit] = useState<{
    id: string;
    round: number;
  } | null>(null);
  const [petCount, setPetCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({ width: 1100, height: 720 });
  const viewport = useRef<HTMLDivElement>(null);
  const projects = feed.snapshot?.projects ?? [];
  const project =
    projects.find((candidate) => candidate.id === projectId) ??
    projects.find((candidate) =>
      candidate.tasks.some(
        (task) =>
          companionStatus(task.status.value, task.status.stale).mood ===
          "working",
      ),
    ) ??
    projects.find((candidate) => candidate.tasks.length > 0) ??
    projects[0];
  const tasks = useMemo<CompanionTask[]>(
    () => (demo ? DEMO_TASKS : (project?.tasks ?? [])),
    [demo, project?.tasks],
  );
  const selected = tasks.find((task) => task.id === selectedId);
  const coffeeGuestIndex = coffeeVisit
    ? tasks.findIndex((task) => task.id === coffeeVisit.id)
    : -1;
  const worldHeight = companionWorldHeight(tasks.length);
  const fit = Math.max(
    0.48,
    Math.min(
      1,
      (size.width - 40) / COMPANION_WIDTH,
      (size.height - 32) / worldHeight,
    ),
  );
  const scale = fit * zoom;
  const sourceStale =
    !demo &&
    (feed.phase === "disconnected" ||
      feed.snapshot?.sourceFreshness === "stale" ||
      feed.snapshot?.refreshState === "failed");
  const working = tasks.filter(
    (task) =>
      companionStatus(task.status.value, task.status.stale || sourceStale)
        .mood === "working",
  ).length;
  const attention = tasks.filter(
    (task) =>
      companionStatus(task.status.value, task.status.stale || sourceStale)
        .mood === "attention",
  ).length;
  const sourceLabel = demo
    ? "Demo · simulated agents"
    : feed.phase === "loading"
      ? "Connecting to Codex…"
      : sourceStale
        ? "Last known office · reconnecting"
        : feed.phase === "parser-error"
          ? "Connected · some metadata unavailable"
          : "Connected to local Codex";
  const roomName = demo
    ? "The Sunday studio"
    : (project?.name ?? "Your little office");

  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!coffeeBusy) return;
    const timer = window.setTimeout(() => setCoffeeBusy(false), 6100);
    return () => window.clearTimeout(timer);
  }, [coffeeBusy, tasks.length]);

  useEffect(() => {
    if (!coffeeVisit) return;
    const route = companionCoffeeRoute(Math.max(0, coffeeGuestIndex));
    const last = route[route.length - 1];
    const timer = window.setTimeout(
      () => setCoffeeVisit(null),
      last.startsAt + last.duration + 100,
    );
    return () => window.clearTimeout(timer);
  }, [coffeeVisit, coffeeGuestIndex]);

  useEffect(() => {
    if (projectId || !project) return;
    const timer = window.setTimeout(() => setProjectId(project.id), 0);
    return () => window.clearTimeout(timer);
  }, [projectId, project]);

  useEffect(() => {
    if (!selectedId) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selectedId]);

  function changeRoom(id: string | null, nextDemo = false) {
    setProjectId(id);
    setDemo(nextDemo);
    setSelectedId(null);
    setCoffeeRound(0);
    setCoffeeBusy(false);
    setCoffeeVisit(null);
    setZoom(1);
    viewport.current?.scrollTo({ top: 0, left: 0 });
  }

  return (
    <main className={styles.app} data-night={night}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Coffice home">
          <span className={styles.brandIcon}>
            <CoffeeIcon />
          </span>
          <span>
            Coffice<small>a little company</small>
          </span>
        </Link>
        <span
          className={styles.connection}
          data-muted={sourceStale}
          role="status"
        >
          <i />
          {sourceLabel}
        </span>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={night ? "Switch to daylight" : "Switch to evening"}
            onClick={() => setNight(!night)}
          >
            {night ? "☀" : "☾"}
          </button>
          <Link href="/workbench" className={styles.workbench}>
            Workbench <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>

      <section className={styles.office} aria-label="Companion office">
        <div className={styles.titlebar}>
          <div>
            <p className={styles.eyebrow}>
              {demo
                ? "A PLACE TO TRY THINGS"
                : "YOUR CODEX, A LITTLE MORE ALIVE"}
            </p>
            <h1>{roomName}</h1>
            <p className={styles.subtitle}>
              {tasks.length
                ? `${tasks.length} ${tasks.length === 1 ? "companion" : "companions"}${working ? ` · ${working} quietly working` : " · room to breathe"}${attention ? ` · ${attention} waiting for you` : ""}`
                : "Every idea starts with an empty desk."}
            </p>
          </div>
          <button
            className={styles.coffeeButton}
            type="button"
            disabled={!tasks.length || coffeeBusy}
            onClick={() => {
              setCoffeeRound((round) => round + 1);
              setCoffeeBusy(true);
            }}
          >
            <CoffeeIcon />
            {coffeeBusy ? "Coffee is on its way…" : "Brew a round"}
          </button>
        </div>

        <nav className={styles.projects} aria-label="Choose an office">
          <label className={styles.officePicker}>
            <span>OFFICE</span>
            <select
              aria-label="Choose a project office"
              value={demo ? "__demo__" : (project?.id ?? "")}
              onChange={(event) =>
                changeRoom(
                  event.target.value,
                  event.target.value === "__demo__",
                )
              }
            >
              {!projects.length && !demo && (
                <option value="">Waiting for Codex</option>
              )}
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.tasks.length}{" "}
                  {item.tasks.length === 1 ? "companion" : "companions"}
                </option>
              ))}
              {demo && <option value="__demo__">Sunday studio · demo</option>}
            </select>
          </label>
          <span className={styles.roomCount}>
            {projects.length} {projects.length === 1 ? "office" : "offices"} in
            your neighborhood
          </span>
          <button
            type="button"
            className={styles.demoButton}
            onClick={() => changeRoom(null, !demo)}
          >
            {demo ? "Back to my office" : "Visit the demo"}
            <span aria-hidden="true">{demo ? "↩" : "↗"}</span>
          </button>
        </nav>

        <div className={styles.sceneContainer}>
          <div
            className={styles.sceneViewport}
            ref={viewport}
            aria-label="Office room; scroll to explore"
            tabIndex={0}
          >
            <div
              className={styles.sceneStage}
              style={{
                width: COMPANION_WIDTH * scale,
                height: worldHeight * scale,
              }}
            >
              <div
                className={styles.world}
                style={{
                  width: COMPANION_WIDTH,
                  height: worldHeight,
                  transform: `scale(${scale})`,
                }}
              >
                <RoomArt
                  count={tasks.length}
                  tasks={
                    sourceStale
                      ? tasks.map((task) => ({
                          ...task,
                          status: { ...task.status, stale: true },
                        }))
                      : tasks
                  }
                  height={worldHeight}
                  night={night}
                />
                {tasks.map((task, index) => (
                  <WorldAgent
                    key={`${demo ? "demo" : project?.id}-${task.id}`}
                    task={
                      sourceStale
                        ? { ...task, status: { ...task.status, stale: true } }
                        : task
                    }
                    index={index}
                    selected={task.id === selectedId}
                    coffeeRound={coffeeRound}
                    breakRound={
                      coffeeVisit?.id === task.id ? coffeeVisit.round : 0
                    }
                    onSelect={() =>
                      setSelectedId(task.id === selectedId ? null : task.id)
                    }
                  />
                ))}
                <button
                  type="button"
                  className={styles.cat}
                  style={{ top: worldHeight - 201 }}
                  onClick={() => setPetCount((count) => count + 1)}
                  aria-label="Pet the office cat"
                >
                  <svg viewBox="0 0 90 65" aria-hidden="true">
                    <ellipse
                      cx="45"
                      cy="39"
                      rx="34"
                      ry="21"
                      fill="#b97b56"
                      opacity=".17"
                    />
                    <ellipse cx="44" cy="32" rx="31" ry="22" fill="#d9a777" />
                    <path
                      d="M20 25L16 6l19 11M41 16 54 6l4 23"
                      fill="#c89365"
                    />
                    <ellipse cx="36" cy="26" rx="22" ry="17" fill="#eac095" />
                    <path
                      d="M18 28q7-5 13 0m7 0q7-5 12 0"
                      fill="none"
                      stroke="#956944"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <path
                      d="M65 24c27 15 12 37-17 25"
                      fill="none"
                      stroke="#bb8357"
                      strokeWidth="12"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span>{petCount ? "♥" : "z z"}</span>
                </button>
              </div>
            </div>
          </div>
          {!tasks.length && (
            <div className={styles.welcome}>
              <span className={styles.welcomeMark}>
                <CoffeeIcon />
              </span>
              <h2>
                {feed.phase === "loading"
                  ? "Putting the kettle on…"
                  : "A desk is waiting for you."}
              </h2>
              <p>
                {feed.phase === "loading"
                  ? "Looking for your local Codex projects."
                  : sourceStale
                    ? "Codex isn’t connected yet. Explore the demo while we keep looking."
                    : "Open a task in a Codex project and it can join the office. Or meet the demo crew."}
              </p>
              <button type="button" onClick={() => changeRoom(null, true)}>
                Meet the demo crew <span aria-hidden="true">→</span>
              </button>
            </div>
          )}
          <div className={styles.sceneCaption}>
            <span>{night ? "☾ Evening glow" : "☀ A bright little day"}</span>
            <span>
              {demo
                ? "All activity in this room is simulated"
                : "Real task metadata · playful little rituals"}
            </span>
          </div>
          <div className={styles.zoomControls} aria-label="Room zoom">
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}
              disabled={zoom <= 0.75}
            >
              −
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                viewport.current?.scrollTo({ top: 0, left: 0 });
              }}
            >
              Fit
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => setZoom((value) => Math.min(2, value + 0.25))}
              disabled={zoom >= 2}
            >
              +
            </button>
          </div>
          {selected && (
            <aside
              className={styles.selectedCard}
              aria-label="Selected companion"
            >
              <button
                type="button"
                className={styles.closeCard}
                aria-label="Close companion details"
                onClick={() => setSelectedId(null)}
              >
                ×
              </button>
              <div className={styles.selectedIdentity}>
                <Avatar identity={companionIdentity(selected.id)} mini />
                <div>
                  <span className={styles.eyebrow}>
                    {demo ? "DEMO COMPANION" : "CODEX TASK"}
                  </span>
                  <h2>{selected.agentName || "Your companion"}</h2>
                </div>
              </div>
              <p className={styles.taskTitle}>{selected.title}</p>
              <span
                className={styles.statusPill}
                data-mood={
                  companionStatus(
                    selected.status.value,
                    selected.status.stale || sourceStale,
                  ).mood
                }
              >
                {
                  companionStatus(
                    selected.status.value,
                    selected.status.stale || sourceStale,
                  ).label
                }
              </span>
              <p className={styles.cardNote}>
                {demo
                  ? "A fictional task, here to show you around."
                  : selected.status.stale || sourceStale
                    ? "This is the last known status. Coffice is waiting for a fresh update."
                    : selected.status.evidence === "inferred"
                      ? "Estimated from local metadata; it may lag behind Codex."
                      : "Reported by local Codex metadata. Updates can take a moment."}
              </p>
              {selected.model && (
                <small className={styles.model}>{selected.model}</small>
              )}
              {!demo && selected.status.timestamp && (
                <small className={styles.model}>
                  Last observed{" "}
                  {new Date(selected.status.timestamp).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </small>
              )}
              <button
                type="button"
                className={styles.takeBreak}
                disabled={!!coffeeVisit}
                onClick={() =>
                  setCoffeeVisit({ id: selected.id, round: Date.now() })
                }
              >
                <CoffeeIcon />
                {coffeeVisit?.id === selected.id
                  ? "Enjoying a little break…"
                  : "Take a coffee walk"}
              </button>
              <p className={styles.playNote}>
                Coffee breaks are just for fun. Their real work continues.
              </p>
            </aside>
          )}
        </div>

        <div className={styles.roster} aria-label="Office companions">
          <span className={styles.rosterLabel}>IN THE OFFICE</span>
          <div className={styles.rosterList}>
            {tasks.length ? (
              tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() =>
                    setSelectedId(task.id === selectedId ? null : task.id)
                  }
                  aria-pressed={task.id === selectedId}
                >
                  <Avatar identity={companionIdentity(task.id)} mini />
                  <span>
                    <strong>{task.agentName || task.title}</strong>
                    <small>
                      {
                        companionStatus(
                          task.status.value,
                          task.status.stale || sourceStale,
                        ).label
                      }
                    </small>
                  </span>
                  <i
                    data-mood={
                      companionStatus(
                        task.status.value,
                        task.status.stale || sourceStale,
                      ).mood
                    }
                  />
                </button>
              ))
            ) : (
              <p>The room is yours. Make yourself at home.</p>
            )}
          </div>
        </div>
      </section>
      <footer className={styles.footer}>
        <span>
          <i />
          {demo
            ? "Demo world · no real tasks"
            : "Lives on your computer. Codex stays in charge."}
        </span>
        <span role="status" aria-live="polite">
          {petCount
            ? `The office cat approves${petCount > 1 ? ` (${petCount} pets)` : "."}`
            : "Tip: click a companion. Pet the cat. Take a breath."}
        </span>
      </footer>
    </main>
  );
}
