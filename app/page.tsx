"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Matter from "matter-js";

async function fetchWithRetry(
  url: string,
  signal?: AbortSignal
): Promise<Response> {
  const res = await fetch(url, {
    signal,
    headers: { "Api-User-Agent": "P527bot/0.1" },
  });
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") || "1");
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return fetchWithRetry(url, signal);
  }
  return res;
}

interface WikiPart {
  id: string;
  label: string;
  image?: string;
}

async function fetchEntity(id: string, signal?: AbortSignal) {
  const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${id}&props=labels|descriptions|claims|sitelinks&languages=en&format=json&origin=*`;
  const res = await fetchWithRetry(entityUrl, signal);
  const data = await res.json();
  const entity = data.entities[id];

  const label: string | null = entity.labels?.en?.value ?? null;
  const description: string | null = entity.descriptions?.en?.value ?? null;
  const enwikiTitle: string | undefined = entity.sitelinks?.enwiki?.title;
  const wikiUrl = enwikiTitle
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(enwikiTitle)}`
    : `https://www.wikidata.org/wiki/${id}`;

  // Extract P527 ("has part") target Qids
  const claims = entity.claims?.P527 ?? [];
  const partIds: string[] = claims
    .map(
      (c: { mainsnak?: { datavalue?: { value?: { id?: string } } } }) =>
        c.mainsnak?.datavalue?.value?.id
    )
    .filter(Boolean);

  let parts: WikiPart[] = [];
  if (partIds.length > 0) {
    const allEntities: Record<string, {
      labels?: { en?: { value?: string } };
      claims?: { P18?: { mainsnak?: { datavalue?: { value?: string } } }[] };
    }> = {};
    for (let i = 0; i < partIds.length; i += 50) {
      const batch = partIds.slice(i, i + 50);
      const batchUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join("|")}&props=labels|claims&languages=en&format=json&origin=*`;
      const batchRes = await fetchWithRetry(batchUrl, signal);
      const batchData = await batchRes.json();
      Object.assign(allEntities, batchData.entities);
    }
    // Collect image file names from P18 claims
    const fileNames: Record<string, string> = {};
    for (const pid of partIds) {
      const fileName = allEntities[pid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (fileName) fileNames[pid] = fileName;
    }

    // Fetch thumbnail URLs from Commons API in batches of 50
    const thumbUrls: Record<string, string> = {};
    const fileEntries = Object.entries(fileNames);
    for (let i = 0; i < fileEntries.length; i += 50) {
      const batch = fileEntries.slice(i, i + 50);
      const titles = batch.map(([, name]) => `File:${name}`).join("|");
      const thumbUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url&iiurlwidth=120&format=json&origin=*`;
      const thumbRes = await fetchWithRetry(thumbUrl, signal);
      const thumbData = await thumbRes.json();
      const pages = thumbData.query?.pages ?? {};
      for (const [, entry] of batch) {
        for (const page of Object.values(pages) as { title?: string; imageinfo?: { thumburl?: string }[] }[]) {
          if (page.title === `File:${entry}` && page.imageinfo?.[0]?.thumburl) {
            // Find the pid for this file name
            for (const [pid, name] of batch) {
              if (name === entry) {
                thumbUrls[pid] = page.imageinfo[0].thumburl;
              }
            }
          }
        }
      }
    }

    parts = partIds.map((pid) => ({
      id: pid,
      label: allEntities[pid]?.labels?.en?.value ?? pid,
      image: thumbUrls[pid],
    }));
  }

  return { label, description, parts, wikiUrl };
}

const entityCache = new Map<string, { label: string | null; description: string | null; parts: WikiPart[]; wikiUrl: string }>();

function isFullyExplored(id: string, seen = new Set<string>()): boolean {
  if (seen.has(id)) return true;
  const cached = entityCache.get(id);
  if (!cached) return false;
  seen.add(id);
  return cached.parts.every((p) => isFullyExplored(p.id, seen));
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qid, setQid] = useState("Q1");
  const [label, setLabel] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [parts, setParts] = useState<WikiPart[]>([]);
  const [wikiUrl, setWikiUrl] = useState(`https://www.wikidata.org/wiki/Q1`);
  const [depth, setDepth] = useState(0);
  const [bestDepth, setBestDepth] = useState(0);

  const navigateTo = useCallback((newQid: string) => {
    setDepth((prev) => {
      const next = prev + 1;
      setBestDepth((best) => Math.max(best, next));
      return next;
    });
    setQid(newQid);
  }, []);

  const goBack = useCallback(() => {
    setDepth(0);
    setQid("Q1");
  }, []);

  useEffect(() => {
    const cached = entityCache.get(qid);
    if (cached) {
      Promise.resolve(cached).then((result) => {
        setLabel(result.label);
        setDescription(result.description);
        setParts(result.parts);
        setWikiUrl(result.wikiUrl);
      });
      return;
    }
    const controller = new AbortController();
    fetchEntity(qid, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) {
          entityCache.set(qid, result);
          setLabel(result.label);
          setDescription(result.description);
          setParts(result.parts);
          setWikiUrl(result.wikiUrl);
        }
      },
      (err) => {
        if (err.name !== "AbortError") throw err;
      }
    );
    return () => controller.abort();
  }, [qid]);

  const engineRef = useRef<Matter.Engine | null>(null);
  const ballsRef = useRef<
    { body: Matter.Body; r: number; label: string; qid: string; img?: HTMLImageElement }[]
  >([]);
  const navigateRef = useRef(navigateTo);
  useEffect(() => {
    navigateRef.current = navigateTo;
  }, [navigateTo]);
  const goBackRef = useRef(goBack);
  useEffect(() => {
    goBackRef.current = goBack;
  }, [goBack]);
  const qidRef = useRef(qid);
  useEffect(() => {
    qidRef.current = qid;
  }, [qid]);
  const sceneRef = useRef<{
    cx: number;
    cy: number;
    radius: number;
  } | null>(null);

  // Initialise Matter.js engine and renderer once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    const engine = Matter.Engine.create();
    engineRef.current = engine;

    const render = Matter.Render.create({
      canvas,
      engine,
      options: {
        width,
        height,
        wireframes: false,
        background: "#111",
      },
    });

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.4;
    sceneRef.current = { cx, cy, radius };

    // Constrain balls inside a circular boundary
    Matter.Events.on(engine, "afterUpdate", () => {
      const scene = sceneRef.current;
      if (!scene) return;
      for (const entry of ballsRef.current) {
        const { body, r } = entry;
        const dx = body.position.x - scene.cx;
        const dy = body.position.y - scene.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const limit = scene.radius - r;
        if (dist > limit) {
          const nx = dx / dist;
          const ny = dy / dist;
          Matter.Body.setPosition(body, {
            x: scene.cx + nx * limit,
            y: scene.cy + ny * limit,
          });
          const dot = body.velocity.x * nx + body.velocity.y * ny;
          if (dot > 0) {
            Matter.Body.setVelocity(body, {
              x: (body.velocity.x - 2 * dot * nx) * 0.8,
              y: (body.velocity.y - 2 * dot * ny) * 0.8,
            });
          }
        }
      }
    });

    // Draw the circle boundary and ball labels
    Matter.Events.on(render, "afterRender", () => {
      const ctx = render.context;
      const scene = sceneRef.current;
      if (!scene) return;

      ctx.beginPath();
      ctx.arc(scene.cx, scene.cy, scene.radius, 0, 2 * Math.PI);
      ctx.strokeStyle = "#555";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw images and labels on each ball
      for (const entry of ballsRef.current) {
        const bx = entry.body.position.x;
        const by = entry.body.position.y;

        if (entry.img?.complete && entry.img.naturalWidth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(bx, by, entry.r, 0, 2 * Math.PI);
          ctx.clip();
          ctx.drawImage(
            entry.img,
            bx - entry.r,
            by - entry.r,
            entry.r * 2,
            entry.r * 2
          );
          ctx.restore();
        }

        // Border
        ctx.beginPath();
        ctx.arc(bx, by, entry.r, 0, 2 * Math.PI);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "bold 11px sans-serif";
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 3;
        ctx.strokeText(entry.label, bx, by);
        ctx.fillText(entry.label, bx, by);
      }

      // Draw "Reset" inside the circle if no parts and there's history
      if (ballsRef.current.length === 0 && qidRef.current !== "Q1") {
        ctx.font = "bold 32px sans-serif";
        ctx.fillStyle = "#888";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Reset", scene.cx, scene.cy);
      }

      // Draw "Reset" and "Shake" below the circle
      if (ballsRef.current.length > 0) {
        const belowY = scene.cy + scene.radius + 30;
        ctx.font = "14px sans-serif";
        ctx.fillStyle = "#888";
        ctx.textBaseline = "middle";

        if (qidRef.current !== "Q1") {
          ctx.textAlign = "right";
          ctx.fillText("\u2190 Reset", scene.cx - 10, belowY);
          ctx.textAlign = "left";
          ctx.fillText("Shake \u21BB", scene.cx + 10, belowY);
        } else {
          ctx.textAlign = "center";
          ctx.fillText("Shake \u21BB", scene.cx, belowY);
        }
      }
    });

    const shakeBalls = () => {
      const magnitude = 10;
      for (const entry of ballsRef.current) {
        const angle = Math.random() * 2 * Math.PI;
        Matter.Body.setVelocity(entry.body, {
          x: entry.body.velocity.x + Math.cos(angle) * magnitude,
          y: entry.body.velocity.y + Math.sin(angle) * magnitude,
        });
      }
    };

    // Handle clicks on balls, "Back", and "Shake"
    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const scene = sceneRef.current;
      if (scene) {
        // Check "Reset" inside circle (when no parts and there's history)
        if (ballsRef.current.length === 0 && qidRef.current !== "Q1") {
          const dx = x - scene.cx;
          const dy = y - scene.cy;
          if (dx * dx + dy * dy <= scene.radius * scene.radius) {
            goBackRef.current();
            return;
          }
        }

        const belowY = scene.cy + scene.radius + 30;
        if (ballsRef.current.length > 0 && Math.abs(y - belowY) < 12) {
          if (qidRef.current !== "Q1") {
            // "Back" on left, "Shake" on right
            if (x < scene.cx && Math.abs(x - (scene.cx - 10)) < 50) {
              goBackRef.current();
              return;
            }
            if (x >= scene.cx && Math.abs(x - (scene.cx + 10)) < 50) {
              shakeBalls();
              return;
            }
          } else {
            // Only "Shake" centered
            if (Math.abs(x - scene.cx) < 50) {
              shakeBalls();
              return;
            }
          }
        }
      }

      for (const entry of ballsRef.current) {
        const dx = entry.body.position.x - x;
        const dy = entry.body.position.y - y;
        if (dx * dx + dy * dy <= entry.r * entry.r) {
          navigateRef.current(entry.qid);
          break;
        }
      }
    };
    canvas.addEventListener("click", handleClick);

    const runner = Matter.Runner.create();
    Matter.Runner.run(runner, engine);
    Matter.Render.run(render);

    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w;
      canvas.height = h;
      render.options.width = w;
      render.options.height = h;
      render.canvas.width = w;
      render.canvas.height = h;
    };
    window.addEventListener("resize", handleResize);

    return () => {
      canvas.removeEventListener("click", handleClick);
      window.removeEventListener("resize", handleResize);
      Matter.Render.stop(render);
      Matter.Runner.stop(runner);
      Matter.Engine.clear(engine);
      engineRef.current = null;
    };
  }, []);

  // Add/remove balls when parts change
  useEffect(() => {
    const engine = engineRef.current;
    const scene = sceneRef.current;
    if (!engine || !scene) return;

    // Remove old balls
    for (const entry of ballsRef.current) {
      Matter.Composite.remove(engine.world, entry.body);
    }

    const colors = [
      "#e74c3c",
      "#3498db",
      "#2ecc71",
      "#f1c40f",
      "#9b59b6",
      "#e67e22",
      "#1abc9c",
      "#e84393",
    ];

    const newBalls = parts.map((part, i) => {
      const angle = Math.random() * 2 * Math.PI;
      const dist = Math.random() * scene.radius * 0.5;
      const hasImage = !!part.image;
      const baseR = Math.max(20, Math.min(60, part.label.length * 4));
      const r = Math.round(baseR * (hasImage ? 0.7 + Math.random() * 0.6 : 0.5 + Math.random() * 0.6));
      const body = Matter.Bodies.circle(
        scene.cx + Math.cos(angle) * dist,
        scene.cy + Math.sin(angle) * dist,
        r,
        {
          restitution: 0.95,
          render: {
            fillStyle: hasImage ? "transparent" : colors[i % colors.length],
          },
        }
      );

      let img: HTMLImageElement | undefined;
      if (part.image) {
        img = new Image();
        img.crossOrigin = "anonymous";
        img.src = part.image;
      }

      return { body, r, label: part.label, qid: part.id, img };
    });

    ballsRef.current = newBalls;
    Matter.Composite.add(
      engine.world,
      newBalls.map((b) => b.body)
    );
  }, [parts]);

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* Drawer */}
      <div
        className="absolute top-0 left-0 z-10 h-full w-80 bg-black/80 backdrop-blur-md border-r border-white/10 transform transition-transform duration-300 translate-x-0"
      >
        <div className="h-full p-6 overflow-y-scroll">
          <div className="flex flex-row items-baseline gap-2">
            <a href={wikiUrl} target="_blank" rel="noopener noreferrer" className="mt-1 text-2xl font-bold text-white underline transition-colors hover:text-blue-400">{label ?? "…"}</a>
            <p className="text-sm font-mono text-white/50">({qid})</p>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-white/60">
            {description ?? "…"}
          </p>
          {parts.length > 0 ? (
            <div className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">
                Has part{parts.length === 1 ? "" : "s"}
              </h3>
              <ul className="mt-2 space-y-1 overflow-y-scroll">
                {parts.map((part) => (
                  <li key={part.id} className="flex items-baseline gap-2 text-sm">
                    <button onClick={() => navigateTo(part.id)} className={`cursor-pointer text-left hover:text-white/80 ${isFullyExplored(part.id) ? "text-white/40" : "text-white"}`}>{part.label}</button>
                  </li>
                ))}
              </ul>
            </div>
          ) : qid !== "Q1" ? (
            <div className="mt-6">
              <button onClick={goBack} className="text-sm text-white/60 cursor-pointer hover:text-white">← Reset</button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Right sidebar */}
      <div
        className="absolute top-0 right-0 z-10 h-full w-80 bg-black/80 backdrop-blur-md border-l border-white/10 flex flex-col"
      >
        <div className="p-6">
          <h1 className="text-2xl font-bold text-white">Fathom</h1>
          <p className="mt-2 text-sm text-white/60">            
            A Wikidata roguelike
          </p>
          <p className="mt-1 text-sm text-white/60">
            Click a ball or use the left sidebar to navigate into its parts.
          </p>
          <div className="mt-6 border-t border-white/10 pt-4">
            <p className="text-xs text-white/40">Depth</p>
            <p className="mt-1 text-sm text-white">{depth} fathom{depth === 1 ? "" : "s"}</p>
            <p className="mt-3 text-xs text-white/40">Best depth</p>
            <p className="mt-1 text-sm text-white">{bestDepth} fathom{depth === 1 ? "" : "s"}</p>
          </div>
        </div>
        <div className="mt-auto p-6 border-t border-white/10">
          <p className="text-xs text-white/40">Created by</p>
          <a href="https://anirudhra0.com" target="_blank" rel="noopener noreferrer" className="mt-1 text-sm text-white hover:text-blue-600 transition-colors">Anirudh Rao</a>
        </div>
      </div>
    </div>
  );
}
