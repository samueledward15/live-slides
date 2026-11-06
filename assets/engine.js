// ===== Live Slides engine (shared by screen / join / control) =====
// Config: Supabase public (publishable) key is safe in the browser; the presenter key is never stored in code.
const LS = (() => {
  const SUPABASE_URL = "https://oudxxticgahmdibpshul.supabase.co";
  const SUPABASE_KEY = "sb_publishable_Cr_M2lVdm3juxonOEea6Eg_kkJnwwVi";
  const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const params = new URLSearchParams(location.search);
  const session = params.get("s") || "square";
  const key = params.get("k") || "";

  // Deck is registered by /decks/<session>.js via LS.registerDeck(...)
  let deck = null;
  const registerDeck = (d) => { deck = d; };
  const getDeck = () => deck;

  // Load deck script dynamically: /decks/<session>.js
  const loadDeck = () => new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = `/decks/${encodeURIComponent(session)}.js?v=${Date.now()}`;
    s.onload = () => { if (!deck) return rej(new Error("deck not registered")); applyTheme(deck); res(deck); };
    s.onerror = () => rej(new Error("deck not found"));
    document.head.appendChild(s);
  });

  // Theme = /themes/<name>/theme.css + body class "theme-<name>"; deck.logo optional
  const applyTheme = (d) => {
    if (!d.theme) return;
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = `/themes/${d.theme}/theme.css`;
    document.head.appendChild(l); document.body.classList.add("theme-" + d.theme);
  };

  // Anonymous participant id (kept on this phone so a vote can be changed, not duplicated)
  const participant = (() => {
    const k = "ls_pid";
    try {
      let v = localStorage.getItem(k);
      if (!v) { v = crypto.getRandomValues(new Uint8Array(16)).reduce((a, b) => a + b.toString(16).padStart(2, "0"), ""); localStorage.setItem(k, v); }
      return v;
    } catch { return crypto.getRandomValues(new Uint8Array(16)).reduce((a, b) => a + b.toString(16).padStart(2, "0"), ""); }
  })();

  // ---- session state
  const getState = async () => {
    const { data, error } = await db.from("sessions").select("current_slide").eq("id", session).single();
    if (error) throw error;
    return data.current_slide;
  };
  const setSlide = (i) => db.rpc("set_slide", { p_session: session, p_key: key, p_slide: i });
  const resetSlide = (slideId) => db.rpc("reset_slide", { p_session: session, p_key: key, p_slide_id: slideId });

  // ---- responses
  const submit = (slideId, value) => db.rpc("submit", { p_session: session, p_slide_id: slideId, p_participant: participant, p_value: value });
  const getResponses = async (slideId) => {
    const { data, error } = await db.from("responses").select("value").eq("session_id", session).eq("slide_id", slideId);
    if (error) throw error;
    return data.map((r) => r.value);
  };
  // All rows under "<prefix>:" (Q&A questions "<id>:q:<qid>" and votes "<id>:v:<qid>")
  const getResponsesLike = async (prefix) => {
    const { data, error } = await db.from("responses").select("slide_id,value,created_at").eq("session_id", session).like("slide_id", prefix + ":%");
    if (error) throw error;
    return data;
  };

  // ---- talk timer (server clock): { elapsed seconds, running }
  const timerNow = async () => {
    const { data, error } = await db.rpc("timer_now", { p_session: session });
    if (error || !data || !data[0]) return { elapsed: 0, running: false };
    return { elapsed: Number(data[0].elapsed) || 0, running: !!data[0].running };
  };
  const timerCtl = (action) => db.rpc("timer_ctl", { p_session: session, p_key: key, p_action: action });
  // local 1s ticker synced to the server; returns resync() to call on realtime updates
  const watchTimer = (cb) => {
    let base = 0, running = false, at = performance.now();
    const sync = async () => { const t = await timerNow(); base = t.elapsed; running = t.running; at = performance.now(); tick(); };
    const tick = () => cb(base + (running ? (performance.now() - at) / 1000 : 0), running);
    setInterval(tick, 1000); sync(); setInterval(sync, 10000);
    return sync;
  };
  // m:ss in Arabic-Indic digits
  const clock = (sec) => { const a = Math.abs(Math.round(sec)); return ar(`${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`); };

  // ---- presenter moderation flags: kind "hide" (word / question) or "answered" (question)
  const getMod = async (slideId) => {
    const { data, error } = await db.from("mod").select("item,kind").eq("session_id", session).eq("slide_id", slideId);
    if (error) throw error;
    return data;
  };
  const moderate = (slideId, item, kind, on) => db.rpc("moderate", { p_session: session, p_key: key, p_slide_id: slideId, p_item: item, p_kind: kind, p_on: on });

  // ---- realtime: onSlide(i), onResponse(slideId)
  const subscribe = ({ onSlide, onResponse, onMod, onTimer }) => {
    db.channel(`ls-${session}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "sessions", filter: `id=eq.${session}` },
        (p) => { onSlide && onSlide(p.new.current_slide); onTimer && onTimer(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "responses", filter: `session_id=eq.${session}` },
        (p) => onResponse && onResponse((p.new && p.new.slide_id) || (p.old && p.old.slide_id)))
      .on("postgres_changes", { event: "*", schema: "public", table: "mod", filter: `session_id=eq.${session}` },
        (p) => { const id = (p.new && p.new.slide_id) || (p.old && p.old.slide_id); (onMod || onResponse) && (onMod || onResponse)(id); })
      .subscribe();
  };

  // ---- helpers
  const ar = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const joinUrl = () => `${location.origin}/join?s=${encodeURIComponent(session)}`;
  const tally = (values, n) => {
    const c = Array(n).fill(0);
    values.forEach((v) => { if (Number.isInteger(v?.choice) && v.choice < n) c[v.choice]++; });
    return c;
  };

  // random short id (Q&A question ids)
  const rid = () => crypto.getRandomValues(new Uint8Array(6)).reduce((a, b) => a + b.toString(16).padStart(2, "0"), "");
  // normalise a typed word for the cloud: trim, collapse spaces, strip tatweel/diacritics, unify alef/yaa/taa marbuta
  const norm = (w) => String(w || "").trim().replace(/\s+/g, " ").replace(/[\u0640\u064B-\u0652]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة$/g, "ه").slice(0, 30);

  return { db, session, key, participant, registerDeck, getDeck, loadDeck, getState, setSlide, resetSlide,
           submit, getResponses, getResponsesLike, getMod, moderate, timerNow, timerCtl, watchTimer, clock, subscribe, ar, esc, joinUrl, tally, rid, norm };
})();
