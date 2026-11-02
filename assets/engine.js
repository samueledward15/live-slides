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

  // ---- realtime: onSlide(i), onResponse(slideId)
  const subscribe = ({ onSlide, onResponse }) => {
    db.channel(`ls-${session}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "sessions", filter: `id=eq.${session}` },
        (p) => onSlide && onSlide(p.new.current_slide))
      .on("postgres_changes", { event: "*", schema: "public", table: "responses", filter: `session_id=eq.${session}` },
        (p) => onResponse && onResponse((p.new && p.new.slide_id) || (p.old && p.old.slide_id)))
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

  return { db, session, key, participant, registerDeck, getDeck, loadDeck, getState, setSlide, resetSlide,
           submit, getResponses, subscribe, ar, esc, joinUrl, tally };
})();
