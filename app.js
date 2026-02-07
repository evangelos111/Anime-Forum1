import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/** ====== CONFIG ====== */
const SUPABASE_URL = "https://kdzjlyvquttonkqtqgnx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkempseXZxdXR0b25rcXRxZ254Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MjA1MDIsImV4cCI6MjA4NTk5NjUwMn0.pc_UX8YMPAl4M9fh8W6DilTje8x3ThgsNhblQ33Zt_I";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** ====== CONSTANTS ====== */
const ANIME_CATEGORIES = [
  "Alle","Shonen","Seinen","Shojo","Josei","Romance","Slice of Life","Action","Fantasy","Isekai",
  "Horror","Comedy","Sports","Mecha","Drama","Mystery","Sci-Fi","News/Infos"
];

const QUESTION_TYPES = [
  "— (optional) —","Empfehlung","Diskussion","Hilfe/Frage","Theorie","News","Review/Meinung"
];

const el = (id)=>document.getElementById(id);
const escapeHTML = (s)=>String(s ?? "")
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#039;");

const normalizeTag = (t)=>String(t||"")
  .trim().toLowerCase().replaceAll(/\s+/g,"-").replaceAll(/[^a-z0-9\-äöüß]/g,"");

const parseTags = (input)=>String(input||"")
  .split(",").map(normalizeTag).filter(Boolean).slice(0, 10);

const fmt = (iso)=> new Date(iso).toLocaleString("de-DE",{dateStyle:"medium",timeStyle:"short"});

/** ====== STATE ====== */
let state = {
  view: "feed",
  mineFilter: "public",
  query: "",
  category: "Alle",
  me: null,           // profile_rank row
  session: null,
  isAdmin: false,
  presenceChannel: null,
};

/** ====== UI NODES ====== */
const tabs = Array.from(document.querySelectorAll(".tab"));
const mineSubtabs = el("mineSubtabs");
const subtabs = ()=>Array.from(document.querySelectorAll(".subtab"));

const btnNewPost = el("btnNewPost");
const btnLogout = el("btnLogout");
const btnChangeAvatar = el("btnChangeAvatar");
const btnAddFollow = el("btnAddFollow");
const btnAddTopic = el("btnAddTopic");

const meName = el("meName");
const meAvatar = el("meAvatar");
const meRank = el("meRank");
const mePoints = el("mePoints");
const meAdminBadge = el("meAdminBadge");

const search = el("search");
const filterCategory = el("filterCategory");

const viewTitle = el("viewTitle");
const viewMeta = el("viewMeta");
const postList = el("postList");

const onlineCount = el("onlineCount");
const onlineList = el("onlineList");

const followList = el("followList");
const topicList = el("topicList");

/** Modal */
const modal = el("modal");
const modalTitle = el("modalTitle");
const modalBody = el("modalBody");
const modalClose = el("modalClose");
const modalCancel = el("modalCancel");
const modalOk = el("modalOk");

/** Auth overlay */
const authOverlay = el("authOverlay");
const authEmail = el("authEmail");
const authPass = el("authPass");
const authUser = el("authUser");
const authMsg = el("authMsg");
const btnLogin = el("btnLogin");
const btnSignup = el("btnSignup");

/** ====== Modal helper ====== */
function openModal({ title, contentNode, okText="OK", cancelText="Abbrechen", onOk }) {
  modalTitle.textContent = title;
  modalBody.innerHTML = "";
  modalBody.appendChild(contentNode);

  modalOk.textContent = okText;
  modalCancel.textContent = cancelText;

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");

  const close = ()=> {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden","true");
    modalOk.onclick = null;
    window.onkeydown = null;
  };

  modalOk.onclick = async ()=> {
    const res = await onOk?.();
    if (res !== false) close();
  };

  modalClose.onclick = close;
  modalCancel.onclick = close;
  window.onkeydown = (e)=> { if (e.key === "Escape") close(); };
}

/** ====== Auth / Profiles ====== */
function showAuth(msg=""){
  authMsg.textContent = msg;
  authOverlay.classList.remove("hidden");
}
function hideAuth(){
  authOverlay.classList.add("hidden");
  authMsg.textContent = "";
}

async function ensureProfile(user, usernameFromSignup){
  // exists?
  const { data: existing, error: e1 } = await supabase
    .from("profiles")
    .select("id, username")
    .eq("id", user.id)
    .maybeSingle();
  if (e1) throw e1;
  if (existing) return existing;

  const username = String(usernameFromSignup || "").trim();
  if (!username) throw new Error("Username fehlt (bei Registrierung).");

  const { error: e2 } = await supabase
    .from("profiles")
    .insert({ id: user.id, username });

  if (e2) throw e2;
  return { id: user.id, username };
}

async function loadMe(){
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profile_rank")
    .select("id, username, avatar_url, role, points, rank")
    .eq("id", user.id)
    .single();

  if (error) throw error;
  state.me = data;
  state.isAdmin = data.role === "admin";
  return data;
}

function renderMe(){
  if (!state.me) return;
  meName.textContent = state.me.username;
  meAvatar.src = state.me.avatar_url || `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(state.me.username)}`;
  meRank.textContent = state.me.rank;
  mePoints.textContent = `(${state.me.points} Punkte)`;
  meAdminBadge.classList.toggle("hidden", !state.isAdmin);
}

/** ====== Presence (Aktive Besucher) ====== */
async function startPresence(){
  if (!state.session?.user) return;
  if (state.presenceChannel) {
    supabase.removeChannel(state.presenceChannel);
    state.presenceChannel = null;
  }

  const ch = supabase.channel("online-users", {
    config: { presence: { key: state.session.user.id } }
  });

  ch.on("presence", { event: "sync" }, () => {
    const ps = ch.presenceState(); // { key: [{...}] }
    const list = [];
    Object.values(ps).forEach(arr => {
      arr.forEach(p => list.push(p));
    });
    renderOnline(list);
  });

  await ch.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await ch.track({
        user_id: state.session.user.id,
        username: state.me?.username || "—",
        role: state.me?.role || "user",
        at: new Date().toISOString(),
      });
    }
  });

  state.presenceChannel = ch;
}

function renderOnline(list){
  // dedupe by user_id (take newest)
  const map = new Map();
  for (const p of list){
    const key = p.user_id;
    const prev = map.get(key);
    if (!prev || (p.at > prev.at)) map.set(key, p);
  }
  const arr = Array.from(map.values()).sort((a,b)=> (a.username||"").localeCompare(b.username||""));

  onlineCount.textContent = String(arr.length);
  onlineList.innerHTML = "";

  if (!arr.length){
    onlineList.innerHTML = `<div class="muted">Niemand online.</div>`;
    return;
  }

  for (const u of arr){
    const row = document.createElement("div");
    row.className = "followItem";
    row.innerHTML = `
      <div>
        <div class="followName">${escapeHTML(u.username || "—")}</div>
        <div class="muted">${u.role === "admin" ? "ADMIN" : "User"} • ${fmt(u.at)}</div>
      </div>
      <span class="pill">${u.role === "admin" ? "👑" : "🟢"}</span>
    `;
    onlineList.appendChild(row);
  }
}

/** ====== Filters / Tabs ====== */
function renderTabs(){
  tabs.forEach(t=>t.classList.toggle("active", t.dataset.view === state.view));
  mineSubtabs.classList.toggle("hidden", state.view !== "mine");
  if (state.view === "mine"){
    subtabs().forEach(s=>s.classList.toggle("active", s.dataset.mine === state.mineFilter));
  }
}

function renderCategoryFilter(){
  filterCategory.innerHTML = "";
  ANIME_CATEGORIES.forEach(cat=>{
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    filterCategory.appendChild(opt);
  });
  filterCategory.value = state.category;
}

/** ====== Storage Upload ====== */
async function uploadToAttachmentsBucket(file){
  const userId = state.session.user.id;
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const safeBase = file.name.replaceAll(/[^a-z0-9\.\-_äöüß]/gi, "_").slice(0, 60);
  const path = `${userId}/${crypto.randomUUID()}_${safeBase}.${ext}`;

  const { error } = await supabase.storage
    .from("attachments")
    .upload(path, file, { upsert: false, contentType: file.type });

  if (error) throw error;

  const { data } = supabase.storage.from("attachments").getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

/** ====== Data loading ====== */
async function fetchFollowLists(){
  // followed users
  const { data: fu, error: e1 } = await supabase
    .from("follows_users")
    .select("followed_id, profiles:followed_id(username)")
    .eq("follower_id", state.session.user.id);

  if (e1) throw e1;

  followList.innerHTML = "";
  if (!fu?.length){
    followList.innerHTML = `<div class="muted">Du folgst niemandem.</div>`;
  } else {
    fu.forEach(x=>{
      const row = document.createElement("div");
      row.className = "followItem";
      row.innerHTML = `
        <div>
          <div class="followName">${escapeHTML(x.profiles?.username || "—")}</div>
          <div class="muted">Account</div>
        </div>
        <button class="miniBtn" data-unfollow="${x.followed_id}">Entfolgen</button>
      `;
      followList.appendChild(row);
    });

    followList.querySelectorAll("[data-unfollow]").forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute("data-unfollow");
        await supabase.from("follows_users").delete()
          .eq("follower_id", state.session.user.id)
          .eq("followed_id", id);
        await fetchFollowLists();
      };
    });
  }

  // followed tags
  const { data: ft, error: e2 } = await supabase
    .from("follows_tags")
    .select("tag")
    .eq("follower_id", state.session.user.id);

  if (e2) throw e2;

  topicList.innerHTML = "";
  if (!ft?.length){
    topicList.innerHTML = `<div class="muted">Du folgst keinen Tags.</div>`;
  } else {
    ft.sort((a,b)=>a.tag.localeCompare(b.tag)).forEach(x=>{
      const row = document.createElement("div");
      row.className = "followItem";
      row.innerHTML = `
        <div>
          <div class="followName">#${escapeHTML(x.tag)}</div>
          <div class="muted">Tag</div>
        </div>
        <button class="miniBtn" data-untag="${x.tag}">Entfolgen</button>
      `;
      topicList.appendChild(row);
    });

    topicList.querySelectorAll("[data-untag]").forEach(btn=>{
      btn.onclick = async ()=>{
        const tag = btn.getAttribute("data-untag");
        await supabase.from("follows_tags").delete()
          .eq("follower_id", state.session.user.id)
          .eq("tag", tag);
        await fetchFollowLists();
      };
    });
  }
}

function applyClientFilter(posts){
  const q = (state.query || "").toLowerCase();
  const cat = state.category;

  let filtered = posts;
  if (cat && cat !== "Alle"){
    filtered = filtered.filter(p => (p.category || "") === cat);
  }
  if (q){
    filtered = filtered.filter(p => {
      const s = [
        p.title, p.body, p.category, p.anime_title, p.question_type,
        (p.tags || []).join(" "),
        p.author?.username
      ].join(" ").toLowerCase();
      return s.includes(q);
    });
  }

  if (state.view === "mine"){
    filtered = filtered.filter(p => p.author_id === state.session.user.id && p.privacy === state.mineFilter);
  }

  return filtered;
}

async function fetchPosts(){
  // base fetch: public + own already handled by RLS
  // if "following" view: filter by followed users or tags (client side after fetch for simplicity)
  const { data, error } = await supabase
    .from("posts")
    .select(`
      id, author_id, title, body, privacy, category, anime_title, question_type, spoiler, spoiler_to, tags, created_at,
      author:profiles ( id, username, avatar_url, role, points )
    `)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;

  const posts = (data || []).map(p => ({
    ...p,
    author: p.author || { username:"—", avatar_url:"", role:"user", points:0 }
  }));

  // attachments (batch)
  const ids = posts.map(p => p.id);
  let attachments = [];
  let replies = [];

  if (ids.length){
    const { data: a, error: ea } = await supabase
      .from("post_attachments")
      .select("id, post_id, author_id, path, file_name, mime_type, size, created_at")
      .in("post_id", ids);

    if (ea) throw ea;
    attachments = a || [];

    const { data: r, error: er } = await supabase
      .from("replies")
      .select(`
        id, post_id, author_id, body, created_at,
        author:profiles ( id, username, avatar_url, role, points )
      `)
      .in("post_id", ids)
      .order("created_at", { ascending: true });

    if (er) throw er;
    replies = r || [];
  }

  const attByPost = new Map();
  for (const a of attachments){
    if (!attByPost.has(a.post_id)) attByPost.set(a.post_id, []);
    const { data: pub } = supabase.storage.from("attachments").getPublicUrl(a.path);
    attByPost.get(a.post_id).push({ ...a, publicUrl: pub.publicUrl });
  }

  const repByPost = new Map();
  for (const r of replies){
    if (!repByPost.has(r.post_id)) repByPost.set(r.post_id, []);
    repByPost.get(r.post_id).push({
      ...r,
      author: r.author || { username:"—", avatar_url:"", role:"user", points:0 }
    });
  }

  // following filter
  if (state.view === "following"){
    const { data: fu } = await supabase
      .from("follows_users")
      .select("followed_id")
      .eq("follower_id", state.session.user.id);

    const { data: ft } = await supabase
      .from("follows_tags")
      .select("tag")
      .eq("follower_id", state.session.user.id);

    const followedUsers = new Set((fu||[]).map(x=>x.followed_id));
    const followedTags = new Set((ft||[]).map(x=>x.tag));

    return posts.filter(p => {
      if (p.author_id === state.session.user.id) return true;
      if (followedUsers.has(p.author_id)) return true;
      return (p.tags || []).some(t => followedTags.has(t));
    }).map(p => ({
      ...p,
      attachments: attByPost.get(p.id) || [],
      replies: repByPost.get(p.id) || []
    }));
  }

  return posts.map(p => ({
    ...p,
    attachments: attByPost.get(p.id) || [],
    replies: repByPost.get(p.id) || []
  }));
}

/** ====== Render Posts (inkl Admin-Buttons) ====== */
function rankForPoints(points){
  if (points >= 800) return "Anime-Legende";
  if (points >= 500) return "Otaku-Veteran";
  if (points >= 300) return "Senpai";
  if (points >= 160) return "Kenner";
  if (points >= 80) return "Mitglied";
  if (points >= 30) return "Rookie";
  return "Novize";
}

function renderAttachmentsHTML(atts, post){
  if (!atts?.length) return "";
  const items = atts.map(a=>{
    const isImg = (a.mime_type || "").startsWith("image/");
    const name = escapeHTML(a.file_name);
    const delBtn = (state.isAdmin || post.author_id === state.session.user.id) ? `
      <button class="miniBtn danger" data-del-attach="${a.id}" data-path="${escapeHTML(a.path)}">Löschen</button>
    ` : "";

    if (isImg){
      return `
        <div class="attachItem">
          <img class="attachImg" src="${a.publicUrl}" alt="${name}">
          <div class="attachInfo">
            <div class="attachName">${name}</div>
            <div class="row">
              <a class="attachLink" href="${a.publicUrl}" target="_blank" rel="noreferrer">Öffnen</a>
              ${delBtn}
            </div>
          </div>
        </div>
      `;
    }
    return `
      <div class="attachItem">
        <div class="attachInfo">
          <div class="attachName">${name}</div>
          <div class="row">
            <a class="attachLink" href="${a.publicUrl}" target="_blank" rel="noreferrer">Download</a>
            ${delBtn}
          </div>
        </div>
      </div>
    `;
  }).join("");

  return `<div class="attachGrid">${items}</div>`;
}

function renderRepliesHTML(replies, postId){
  if (!replies?.length) return `<div class="muted">Noch keine Antworten.</div>`;
  return replies.map(r=>{
    const u = r.author || {};
    const rank = rankForPoints(u.points || 0);
    const delBtn = (state.isAdmin || r.author_id === state.session.user.id) ? `
      <button class="miniBtn danger" data-del-reply="${r.id}">Löschen</button>
    ` : "";

    return `
      <div class="card" style="margin-top:8px;">
        <div class="cardTop">
          <div class="authorRow">
            <img class="avatarMini" src="${u.avatar_url || `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(u.username||"u")}`}" alt="">
            <span>👤 ${escapeHTML(u.username || "—")}</span>
            <span class="pill">🏅 ${escapeHTML(rank)}</span>
          </div>
          <div class="row">
            <span>🕒 ${fmt(r.created_at)}</span>
            ${delBtn}
          </div>
        </div>
        <div class="cardBody">${escapeHTML(r.body)}</div>
      </div>
    `;
  }).join("");
}

async function renderPosts(){
  postList.innerHTML = `<div class="panel"><div class="muted">Lade Posts…</div></div>`;
  const all = await fetchPosts();
  const posts = applyClientFilter(all);

  // header
  if (state.view === "feed"){ viewTitle.textContent = "Aktuelle Posts"; }
  if (state.view === "following"){ viewTitle.textContent = "Gefolgt"; }
  if (state.view === "mine"){ viewTitle.textContent = "Meine Posts"; }
  viewMeta.textContent = `${posts.length} Post(s)`;

  postList.innerHTML = "";
  if (!posts.length){
    postList.innerHTML = `<div class="panel"><h3>Nichts gefunden</h3><div class="muted">Filter/Suche ändern oder Post erstellen.</div></div>`;
    return;
  }

  for (const p of posts){
    const a = p.author || {};
    const rank = rankForPoints(a.points || 0);

    const adminDelete = (state.isAdmin || p.author_id === state.session.user.id) ? `
      <button class="miniBtn danger" data-del-post="${p.id}">Post löschen</button>
    ` : "";

    const tagsRow = (p.tags?.length)
      ? `<div class="cardMetaRow">${p.tags.map(t => `<span class="pill">#${escapeHTML(t)}</span>`).join("")}</div>`
      : "";

    const spoilerLine = p.spoiler ? `⚠️ Spoiler bis: ${escapeHTML(p.spoiler_to || "—")}` : "✅ spoilerfrei";
    const qType = p.question_type ? `❓ ${escapeHTML(p.question_type)}` : "";

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="cardTop">
        <div class="authorRow">
          <img class="avatarMini" src="${a.avatar_url || `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(a.username||"u")}`}" alt="">
          <span>👤 ${escapeHTML(a.username || "—")}</span>
          <span class="pill">🏅 ${escapeHTML(rank)}</span>
          <span class="pill">🔒 ${escapeHTML(p.privacy)}</span>
          ${a.role === "admin" ? `<span class="pill">👑 admin</span>` : ``}
        </div>
        <div class="row">
          <span>🕒 ${fmt(p.created_at)}</span>
          ${adminDelete}
        </div>
      </div>

      <div class="cardTitle">${escapeHTML(p.title)}</div>
      <div class="cardBody">${escapeHTML(p.body)}</div>

      <div class="cardMetaRow">
        <span class="pill">🏷️ ${escapeHTML(p.category || "—")}</span>
        <span class="pill">🎬 ${escapeHTML(p.anime_title || "(kein Titel)")}</span>
        <span class="pill">${spoilerLine}</span>
        ${qType ? `<span class="pill">${qType}</span>` : ""}
      </div>

      ${tagsRow}

      ${renderAttachmentsHTML(p.attachments || [], p)}

      <div class="replyBox" id="rb-${p.id}">
        <div class="muted">Antworten:</div>
        <div id="replyList-${p.id}">
          ${renderRepliesHTML(p.replies || [], p.id)}
        </div>

        <div class="field">
          <div class="label">Deine Antwort</div>
          <textarea class="textarea" id="replyText-${p.id}" placeholder="Schreibe eine Antwort…"></textarea>
        </div>
        <button class="btn primary" data-send-reply="${p.id}">Antwort senden</button>
      </div>
    `;

    postList.appendChild(card);
  }

  // Handlers: delete post
  postList.querySelectorAll("[data-del-post]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-del-post");
      if (!confirm("Post wirklich löschen?")) return;

      // delete attachments storage objects first
      const { data: atts } = await supabase.from("post_attachments").select("id, path").eq("post_id", id);
      if (atts?.length){
        await supabase.storage.from("attachments").remove(atts.map(x=>x.path));
        await supabase.from("post_attachments").delete().eq("post_id", id);
      }
      await supabase.from("posts").delete().eq("id", id);
      await refreshAll();
    };
  });

  // Handlers: delete reply
  postList.querySelectorAll("[data-del-reply]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-del-reply");
      if (!confirm("Antwort wirklich löschen?")) return;
      await supabase.from("replies").delete().eq("id", id);
      await refreshAll();
    };
  });

  // Handlers: delete attachment
  postList.querySelectorAll("[data-del-attach]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-del-attach");
      const path = btn.getAttribute("data-path");
      if (!confirm("Anhang wirklich löschen?")) return;
      await supabase.storage.from("attachments").remove([path]);
      await supabase.from("post_attachments").delete().eq("id", id);
      await refreshAll();
    };
  });

  // Handlers: send reply
  postList.querySelectorAll("[data-send-reply]").forEach(btn=>{
    btn.onclick = async ()=>{
      const postId = btn.getAttribute("data-send-reply");
      const ta = el(`replyText-${postId}`);
      const text = (ta.value || "").trim();
      if (!text) return;

      const { error } = await supabase.from("replies").insert({
        post_id: postId,
        author_id: state.session.user.id,
        body: text
      });
      if (error) { alert(error.message); return; }

      ta.value = "";
      await refreshAll();
    };
  });
}

/** ====== Create Post / Avatar / Follow Modals ====== */
function addTopicModal(){
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="field">
      <div class="label">Tag (z.B. naruto, cosplay, animation)</div>
      <input class="input" id="t" placeholder="naruto" />
    </div>
  `;
  openModal({
    title:"Tag folgen",
    contentNode: wrap,
    okText:"Folgen",
    onOk: async ()=>{
      const tag = normalizeTag(wrap.querySelector("#t").value);
      if (!tag) return false;

      const { error } = await supabase.from("follows_tags").insert({
        follower_id: state.session.user.id,
        tag
      });
      if (error) { alert(error.message); return false; }

      await fetchFollowLists();
      return true;
    }
  });
}

function addFollowModal(){
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="field">
      <div class="label">Suche Username</div>
      <input class="input" id="q" placeholder="z.B. SakuraFan" />
    </div>
    <div class="smallNote">Du folgst dann genau diesem User.</div>
  `;
  openModal({
    title:"Account folgen",
    contentNode: wrap,
    okText:"Suchen & Folgen",
    onOk: async ()=>{
      const q = (wrap.querySelector("#q").value || "").trim();
      if (!q) return false;

      const { data, error } = await supabase
        .from("profiles")
        .select("id, username")
        .ilike("username", q)
        .limit(1);

      if (error) { alert(error.message); return false; }
      if (!data?.length) { alert("User nicht gefunden."); return false; }

      const target = data[0];
      if (target.id === state.session.user.id) { alert("Du kannst dir nicht selbst folgen."); return false; }

      const { error: e2 } = await supabase.from("follows_users").insert({
        follower_id: state.session.user.id,
        followed_id: target.id
      });
      if (e2) { alert(e2.message); return false; }

      await fetchFollowLists();
      return true;
    }
  });
}

function changeAvatarModal(){
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="field">
      <div class="label">Profilbild auswählen (JPG/PNG/WebP)</div>
      <input class="input" type="file" id="av" accept="image/*" />
      <div class="smallNote">Wird in Storage gespeichert (global).</div>
    </div>
  `;
  openModal({
    title:"Profilbild ändern",
    contentNode: wrap,
    okText:"Speichern",
    onOk: async ()=>{
      const f = wrap.querySelector("#av").files?.[0];
      if (!f) return false;

      const up = await uploadToAttachmentsBucket(f);
      const { error } = await supabase.from("profiles").update({
        avatar_url: up.publicUrl
      }).eq("id", state.session.user.id);

      if (error) { alert(error.message); return false; }
      await refreshAll(true);
      return true;
    }
  });
}
async function createPostWithUploads({
  category, title, body, privacy,
  animeTitle, tags, questionType,
  spoiler, spoilerTo,
  files
}) {
  const { data: created, error: ep } = await supabase.from("posts")
    .insert({
      author_id: state.session.user.id,
      title,
      body,
      privacy,
      category,
      anime_title: animeTitle || null,
      question_type: (questionType && questionType !== "— (optional) —") ? questionType : null,
      spoiler: !!spoiler,
      spoiler_to: spoilerTo || null,
      tags: tags || []
    })
    .select("id")
    .single();

  if (ep) throw ep;

  const arr = Array.from(files || []);
  for (const f of arr) {
    const up = await uploadToAttachmentsBucket(f);
    const { error: ea } = await supabase.from("post_attachments").insert({
      post_id: created.id,
      author_id: state.session.user.id,
      path: up.path,
      file_name: f.name,
      mime_type: f.type || null,
      size: f.size
    });
    if (ea) throw ea;
  }

  return created.id;
}


function newPostModal(){
  const wrap = document.createElement("div");
  const catOptions = ANIME_CATEGORIES.filter(x=>x!=="Alle").map(c=>`<option value="${c}">${escapeHTML(c)}</option>`).join("");
  const qOptions = QUESTION_TYPES.map(q=>`<option value="${q}">${escapeHTML(q)}</option>`).join("");

  wrap.innerHTML = `
    <div class="field">
      <div class="label">Kategorie (Pflicht)</div>
      <select class="select" id="pCat">${catOptions}</select>
    </div>

    <div class="field">
      <div class="label">Anime-Titel (optional)</div>
      <input class="input" id="pAnime" placeholder="z.B. One Piece" />
    </div>

    <div class="field">
      <div class="label">Tags (optional, Komma)</div>
      <input class="input" id="pTags" placeholder="naruto, theory, animation" />
    </div>

    <div class="field">
      <div class="label">Frage-Typ (optional)</div>
      <select class="select" id="pQ">${qOptions}</select>
    </div>

    <div class="field">
      <div class="label">Spoiler?</div>
      <div class="row">
        <label class="pill"><input type="checkbox" id="pSpoiler" /> Ja</label>
        <input class="input" id="pSpoilerTo" placeholder="bis Episode/Chapter (optional)" style="flex:1; min-width:220px;" />
      </div>
    </div>

    <div class="field">
      <div class="label">Titel (Pflicht)</div>
      <input class="input" id="pTitle" placeholder="Titel deines Posts…" />
    </div>

    <div class="field">
      <div class="label">Nachricht (Pflicht)</div>
      <textarea class="textarea" id="pBody" placeholder="Was willst du teilen?"></textarea>
    </div>

    <div class="field">
      <div class="label">Sichtbarkeit</div>
      <select class="select" id="pPrivacy">
        <option value="public">public</option>
        <option value="friends">friends</option>
        <option value="private">private</option>
      </select>
      <div class="smallNote">friends ist vorbereitet (Freundesystem baust du als nächstes).</div>
    </div>

    <div class="field">
      <div class="label">Anhänge (optional)</div>
      <input class="input" type="file" id="pFiles" multiple />
      <div class="smallNote">Uploads gehen in Storage, kein localStorage-Limit.</div>
    </div>
  `;

  openModal({
    title:"Post verfassen",
    contentNode: wrap,
    okText:"Posten",
    onOk: async ()=>{
      const category = wrap.querySelector("#pCat").value;
      const title = (wrap.querySelector("#pTitle").value || "").trim();
      const body = (wrap.querySelector("#pBody").value || "").trim();
      const privacy = wrap.querySelector("#pPrivacy").value;

      if (!category || !title || !body) return false;

      const animeTitle = (wrap.querySelector("#pAnime").value || "").trim();
      const tags = parseTags(wrap.querySelector("#pTags").value);
      const questionType = wrap.querySelector("#pQ").value;
      const spoiler = wrap.querySelector("#pSpoiler").checked;
      const spoilerTo = (wrap.querySelector("#pSpoilerTo").value || "").trim();

      // 1) create post row
      try {
  const postId = await createPostWithUploads({
    category,
    title,
    body,
    privacy,
    animeTitle,
    tags,
    questionType,
    spoiler,
    spoilerTo,
    files: wrap.querySelector("#pFiles").files
  });

  state.view = "mine";
  state.mineFilter = privacy;
  await refreshAll(true);
  return true;
} catch (err) {
  alert(err.message);
  return false;
}


      // 2) upload files + insert attachment rows
      const files = Array.from(wrap.querySelector("#pFiles").files || []);
      for (const f of files){
        const up = await uploadToAttachmentsBucket(f);
        const { error: ea } = await supabase.from("post_attachments").insert({
          post_id: created.id,
          author_id: state.session.user.id,
          path: up.path,
          file_name: f.name,
          mime_type: f.type || null,
          size: f.size
        });
        if (ea) { alert(ea.message); return false; }
      }

      state.view = "mine";
      state.mineFilter = privacy;
      await refreshAll(true);
      return true;
    }
  });
}

/** ====== Refresh ====== */
async function refreshAll(reloadMe=false){
  if (reloadMe){
    await loadMe();
    renderMe();
    await startPresence();
  }
  await fetchFollowLists();
  renderTabs();
  await renderPosts();
}

/** ====== Events ====== */
tabs.forEach(t=>{
  t.onclick = async ()=>{
    state.view = t.dataset.view;
    if (state.view === "friends") { await renderFriendsView(); return; }
    if (state.view === "chat") { await renderChatView(); return; }

    renderTabs();
    await renderPosts();
  };
});

document.addEventListener("click", (e)=>{
  const st = e.target.closest(".subtab");
  if (!st) return;
  state.mineFilter = st.dataset.mine;
  renderTabs();
  renderPosts();
});

search.oninput = ()=>{ state.query = search.value || ""; renderPosts(); };
filterCategory.onchange = ()=>{ state.category = filterCategory.value || "Alle"; renderPosts(); };

btnNewPost.onclick = newPostModal;
btnChangeAvatar.onclick = changeAvatarModal;
btnAddFollow.onclick = addFollowModal;
btnAddTopic.onclick = addTopicModal;

btnLogout.onclick = async ()=>{
  await supabase.auth.signOut();
  location.reload();
};

/** ====== Auth overlay actions ====== */
btnLogin.onclick = async ()=>{
  authMsg.textContent = "Logge ein…";
  try{
    const email = authEmail.value.trim();
    const password = authPass.value;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    state.session = data.session;
    await loadMe();
    hideAuth();
    renderMe();
    renderCategoryFilter();
    await startPresence();
    await refreshAll();
  }catch(err){
    authMsg.textContent = err.message;
  }
};

btnSignup.onclick = async ()=>{
  authMsg.textContent = "Registriere…";
  try{
    const email = authEmail.value.trim();
    const password = authPass.value;
    const username = authUser.value.trim();
    if (!username) throw new Error("Username fehlt.");

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;

    // If email confirmation is ON, user might not have session yet.
    // Try to sign in immediately (works if confirmation OFF).
    const { data: si, error: e2 } = await supabase.auth.signInWithPassword({ email, password });
    if (e2) throw e2;

    state.session = si.session;
    await ensureProfile(si.session.user, username);
    await loadMe();

    hideAuth();
    renderMe();
    renderCategoryFilter();
    await startPresence();
    await refreshAll(true);
  }catch(err){
    authMsg.textContent = err.message;
  }
};

/** ====== Boot ====== */
async function boot(){
  renderCategoryFilter();

  const { data } = await supabase.auth.getSession();
  state.session = data.session;

  if (!state.session){
    showAuth("Bitte einloggen oder registrieren.");
    return;
  }

  // Ensure profile exists (in case)
  const { data: { user } } = await supabase.auth.getUser();
  if (user){
    // if profile missing, user must create username (rare)
    try{
      await ensureProfile(user, "");
    }catch{
      showAuth("Bitte registrieren (Username fehlt).");
      return;
    }
  }

  await loadMe();
  renderMe();
  renderTabs();
  await startPresence();
  await refreshAll();
}
async function renderFriendsView(){
  viewTitle.textContent = "Freunde";
  viewMeta.textContent = "";

  // 1) Freunde laden
  const uid = state.session.user.id;
  const { data: fr, error: e1 } = await supabase
    .from("friends")
    .select("low_id, high_id, created_at")
    .or(`low_id.eq.${uid},high_id.eq.${uid}`);

  if (e1) { postList.innerHTML = `<div class="panel"><div class="muted">${e1.message}</div></div>`; return; }

  const friendIds = (fr||[]).map(x => (x.low_id === uid ? x.high_id : x.low_id));

  let friends = [];
  if (friendIds.length){
    const { data: ps } = await supabase.from("profiles").select("id, username, avatar_url, points").in("id", friendIds);
    friends = ps || [];
  }

  // 2) Requests laden
  const { data: req, error: e2 } = await supabase
    .from("friend_requests")
    .select("id, sender_id, receiver_id, status, created_at, sender:profiles!friend_requests_sender_id_fkey(username), receiver:profiles!friend_requests_receiver_id_fkey(username)")
    .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
    .order("created_at", { ascending:false });

  if (e2) { postList.innerHTML = `<div class="panel"><div class="muted">${e2.message}</div></div>`; return; }

  postList.innerHTML = `
    <div class="panel">
      <div class="panelHeader">
        <h3>Freunde</h3>
        <button class="btn small" id="btnSendReq">+ Freund hinzufügen</button>
      </div>
      <div id="friendsList"></div>
    </div>

    <div class="panel" style="margin-top:12px;">
      <h3>Anfragen</h3>
      <div id="reqList"></div>
      <div class="smallNote">Nur Empfänger kann annehmen/ablehnen.</div>
    </div>
  `;

  const friendsList = document.getElementById("friendsList");
  const reqList = document.getElementById("reqList");

  if (!friends.length){
    friendsList.innerHTML = `<div class="muted">Noch keine Freunde.</div>`;
  } else {
    friends.sort((a,b)=>a.username.localeCompare(b.username));
    friendsList.innerHTML = friends.map(f=>`
      <div class="followItem">
        <div>
          <div class="followName">${escapeHTML(f.username)}</div>
          <div class="muted">Rang: ${escapeHTML(rankForPoints(f.points||0))}</div>
        </div>
        <button class="miniBtn" data-open-dm="${f.id}">DM</button>
      </div>
    `).join("");
  }

  // Requests render
  const pending = (req||[]).filter(r=>r.status==="pending");
  if (!pending.length){
    reqList.innerHTML = `<div class="muted">Keine offenen Anfragen.</div>`;
  } else {
    reqList.innerHTML = pending.map(r=>{
      const amReceiver = r.receiver_id === uid;
      const who = amReceiver ? r.sender?.username : r.receiver?.username;
      return `
        <div class="followItem">
          <div>
            <div class="followName">${escapeHTML(who || "—")}</div>
            <div class="muted">${amReceiver ? "hat dir eine Anfrage gesendet" : "du hast angefragt"}</div>
          </div>
          <div class="row">
            ${amReceiver ? `<button class="miniBtn" data-accept="${r.id}">Annehmen</button>` : ``}
            ${amReceiver ? `<button class="miniBtn danger" data-reject="${r.id}">Ablehnen</button>` : `<button class="miniBtn danger" data-cancel="${r.id}">Zurückziehen</button>`}
          </div>
        </div>
      `;
    }).join("");
  }

  // send request modal
  document.getElementById("btnSendReq").onclick = ()=>{
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="field">
        <div class="label">Username des Users</div>
        <input class="input" id="u" placeholder="z.B. SakuraFan" />
      </div>
    `;
    openModal({
      title: "Freund anfragen",
      contentNode: wrap,
      okText: "Anfrage senden",
      onOk: async ()=>{
        const name = (wrap.querySelector("#u").value||"").trim();
        if (!name) return false;

        const { data: target } = await supabase.from("profiles").select("id, username").eq("username", name).maybeSingle();
        if (!target) { alert("User nicht gefunden."); return false; }
        if (target.id === uid) { alert("Du kannst dich nicht selbst hinzufügen."); return false; }

        const { error } = await supabase.from("friend_requests").insert({
          sender_id: uid,
          receiver_id: target.id
        });
        if (error) { alert(error.message); return false; }

        await renderFriendsView();
        return true;
      }
    });
  };

  // accept/reject/cancel
  reqList.querySelectorAll("[data-accept]").forEach(b=>{
    b.onclick = async ()=>{
      const id = b.getAttribute("data-accept");
      const { error } = await supabase.rpc("accept_friend_request", { req_id: id });
      if (error) alert(error.message);
      await renderFriendsView();
    };
  });
  reqList.querySelectorAll("[data-reject]").forEach(b=>{
    b.onclick = async ()=>{
      const id = b.getAttribute("data-reject");
      const { error } = await supabase.rpc("reject_friend_request", { req_id: id });
      if (error) alert(error.message);
      await renderFriendsView();
    };
  });
  reqList.querySelectorAll("[data-cancel]").forEach(b=>{
    b.onclick = async ()=>{
      const id = b.getAttribute("data-cancel");
      await supabase.from("friend_requests").delete().eq("id", id);
      await renderFriendsView();
    };
  });

  // open DM
  friendsList.querySelectorAll("[data-open-dm]").forEach(b=>{
    b.onclick = async ()=>{
      state.view = "chat";
      state.chatMode = "dm";
      state.chatPeerId = b.getAttribute("data-open-dm");
      await renderChatView();
    };
  });
}

async function renderChatView(){
  viewTitle.textContent = "Chat";
  viewMeta.textContent = "DM + Gruppen";

  postList.innerHTML = `
    <div class="panel">
      <div class="panelHeader">
        <h3>DMs</h3>
        <button class="btn small" id="btnPickDm">DM öffnen</button>
      </div>
      <div id="dmHint" class="muted">Wähle einen Freund oder öffne DM.</div>
      <div id="dmBox"></div>
    </div>

    <div class="panel" style="margin-top:12px;">
      <div class="panelHeader">
        <h3>Gruppenräume</h3>
        <button class="btn small" id="btnNewRoom">+ Raum</button>
      </div>
      <div id="rooms"></div>
      <div id="roomBox" style="margin-top:10px;"></div>
    </div>
  `;

  // DM pick modal
  document.getElementById("btnPickDm").onclick = async ()=>{
    const uid = state.session.user.id;
    const { data: fr } = await supabase.from("friends").select("low_id, high_id").or(`low_id.eq.${uid},high_id.eq.${uid}`);
    const friendIds = (fr||[]).map(x => (x.low_id === uid ? x.high_id : x.low_id));
    if (!friendIds.length){ alert("Du hast noch keine Freunde."); return; }

    const { data: ps } = await supabase.from("profiles").select("id, username").in("id", friendIds);
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="field">
        <div class="label">Freund auswählen</div>
        <select class="select" id="peer">
          ${(ps||[]).sort((a,b)=>a.username.localeCompare(b.username)).map(p=>`<option value="${p.id}">${escapeHTML(p.username)}</option>`).join("")}
        </select>
      </div>
    `;
    openModal({
      title:"DM öffnen",
      contentNode: wrap,
      okText:"Öffnen",
      onOk: async ()=>{
        state.chatMode = "dm";
        state.chatPeerId = wrap.querySelector("#peer").value;
        await renderDM();
        return true;
      }
    });
  };

  // Rooms list
  await renderRooms();

  // If already selected DM from friends view
  if (state.chatMode === "dm" && state.chatPeerId){
    await renderDM();
  }
}

async function renderDM(){
  const dmBox = document.getElementById("dmBox");
  const dmHint = document.getElementById("dmHint");
  const uid = state.session.user.id;
  const peer = state.chatPeerId;
  if (!peer) return;

  const { data: peerP } = await supabase.from("profiles").select("username").eq("id", peer).maybeSingle();
  dmHint.textContent = `DM mit ${peerP?.username || "—"}`;

  // load messages (last 50)
  const { data, error } = await supabase
    .from("dm_messages")
    .select("id, sender_id, receiver_id, body, created_at")
    .or(`and(sender_id.eq.${uid},receiver_id.eq.${peer}),and(sender_id.eq.${peer},receiver_id.eq.${uid})`)
    .order("created_at", { ascending: true })
    .limit(50);

  if (error){ dmBox.innerHTML = `<div class="muted">${error.message}</div>`; return; }

  dmBox.innerHTML = `
    <div class="card" style="max-height:260px; overflow:auto;">
      ${(data||[]).map(m=>{
        const mine = m.sender_id === uid;
        return `<div style="margin:8px 0; text-align:${mine?"right":"left"};">
          <span class="pill">${mine?"Du":"Er/Sie"} • ${fmt(m.created_at)}</span><br/>
          <span>${escapeHTML(m.body)}</span>
        </div>`;
      }).join("")}
    </div>

    <div class="field" style="margin-top:10px;">
      <div class="label">Nachricht</div>
      <input class="input" id="dmText" placeholder="Schreiben…" />
    </div>
    <button class="btn primary" id="dmSend">Senden</button>
  `;

  document.getElementById("dmSend").onclick = async ()=>{
    const text = (document.getElementById("dmText").value||"").trim();
    if (!text) return;

    const { error: e } = await supabase.from("dm_messages").insert({
      sender_id: uid,
      receiver_id: peer,
      body: text
    });
    if (e) { alert(e.message); return; }

    await renderDM();
  };

  // Realtime DM refresh (einfach & stabil)
  if (state.dmChannel) supabase.removeChannel(state.dmChannel);
  state.dmChannel = supabase.channel(`dm-${uid}-${peer}`);
  state.dmChannel
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "dm_messages" },
      async (payload)=>{
        const m = payload.new;
        const ok = (m.sender_id===uid && m.receiver_id===peer) || (m.sender_id===peer && m.receiver_id===uid);
        if (ok) await renderDM();
      }
    )
    .subscribe();
}

async function renderRooms(){
  const rooms = document.getElementById("rooms");
  const roomBox = document.getElementById("roomBox");
  const uid = state.session.user.id;

  // rooms where member
  const { data: mem } = await supabase
    .from("chat_room_members")
    .select("room_id, room:chat_rooms(id,name,owner_id)")
    .eq("user_id", uid);

  const list = (mem||[]).map(x=>x.room).filter(Boolean);

  rooms.innerHTML = list.length ? list.map(r=>`
    <div class="followItem">
      <div>
        <div class="followName">${escapeHTML(r.name)}</div>
        <div class="muted">${r.owner_id===uid?"Owner":"Mitglied"}</div>
      </div>
      <button class="miniBtn" data-open-room="${r.id}">Öffnen</button>
    </div>
  `).join("") : `<div class="muted">Du bist in keinen Räumen.</div>`;

  // create room
  document.getElementById("btnNewRoom").onclick = ()=>{
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="field">
        <div class="label">Raumname</div>
        <input class="input" id="rn" placeholder="z.B. One Piece Theorie" />
      </div>
    `;
    openModal({
      title:"Neuen Raum erstellen",
      contentNode: wrap,
      okText:"Erstellen",
      onOk: async ()=>{
        const name = (wrap.querySelector("#rn").value||"").trim();
        if (!name) return false;

        const { data: room, error } = await supabase
          .from("chat_rooms")
          .insert({ name, owner_id: uid })
          .select("id")
          .single();

        if (error) { alert(error.message); return false; }

        // owner becomes member
        await supabase.from("chat_room_members").insert({ room_id: room.id, user_id: uid });

        await renderRooms();
        return true;
      }
    });
  };

  // open room
  rooms.querySelectorAll("[data-open-room]").forEach(b=>{
    b.onclick = async ()=>{
      const rid = b.getAttribute("data-open-room");
      await renderRoom(rid);
    };
  });

  async function renderRoom(roomId){
    const { data: info } = await supabase.from("chat_rooms").select("id,name,owner_id").eq("id", roomId).single();

    const { data: msgs, error } = await supabase
      .from("chat_room_messages")
      .select("id, room_id, sender_id, body, created_at, sender:profiles(username)")
      .eq("room_id", roomId)
      .order("created_at", { ascending:true })
      .limit(60);

    if (error){ roomBox.innerHTML = `<div class="muted">${error.message}</div>`; return; }

    roomBox.innerHTML = `
      <div class="card">
        <div class="cardTop">
          <div><b>${escapeHTML(info.name)}</b></div>
          <div class="muted">Raum</div>
        </div>
        <div style="max-height:220px; overflow:auto;">
          ${(msgs||[]).map(m=>`
            <div style="margin:8px 0;">
              <span class="pill">${escapeHTML(m.sender?.username || "—")} • ${fmt(m.created_at)}</span><br/>
              <span>${escapeHTML(m.body)}</span>
            </div>
          `).join("")}
        </div>
        <div class="field" style="margin-top:10px;">
          <div class="label">Nachricht</div>
          <input class="input" id="rmText" placeholder="Schreiben…" />
        </div>
        <button class="btn primary" id="rmSend">Senden</button>
      </div>
    `;

    document.getElementById("rmSend").onclick = async ()=>{
      const text = (document.getElementById("rmText").value||"").trim();
      if (!text) return;
      const { error: e } = await supabase.from("chat_room_messages").insert({
        room_id: roomId,
        sender_id: uid,
        body: text
      });
      if (e){ alert(e.message); return; }
      await renderRoom(roomId);
    };

    // Realtime room refresh
    if (state.roomChannel) supabase.removeChannel(state.roomChannel);
    state.roomChannel = supabase.channel(`room-${roomId}`);
    state.roomChannel
      .on("postgres_changes",
        { event:"INSERT", schema:"public", table:"chat_room_messages", filter:`room_id=eq.${roomId}` },
        async ()=>{ await renderRoom(roomId); }
      )
      .subscribe();
  }
}
// BottomNav -> triggert die gleichen Klicks wie deine Tabs (falls vorhanden)
// Fällt zurück auf state.view + refreshAll() wenn du das hast.
document.querySelectorAll(".bottomNav .bn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const view = btn.dataset.view;

    // 1) Wenn es oben Tabs mit data-view gibt: klicke die automatisch
    const tab = document.querySelector(`.tab[data-view="${view}"]`);
    if (tab) { tab.click(); return; }

    // 2) Fallback: wenn du state.view + refreshAll nutzt
    if (window.state) state.view = view;
    if (typeof refreshAll === "function") await refreshAll();
  });
});
// Mobile fix: beim Tippen das Feld in die Mitte scrollen (Keyboard-Friendly)
document.addEventListener("focusin", (e) => {
  const el = e.target;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) {
    setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 150);
  }
});

// ===== Mobile: BottomNav klickt Views an (nutzt Tabs, falls vorhanden) =====
document.querySelectorAll(".bottomNav .bn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const view = btn.dataset.view;

    // wenn oben Tabs existieren, nutze sie
    const tab = document.querySelector(`.tab[data-view="${view}"]`);
    if (tab) { tab.click(); return; }

    // fallback wenn du state + refreshAll hast
    if (window.state) state.view = view;
    if (typeof refreshAll === "function") await refreshAll();
  });
});

// ===== Mobile: Composer Sheet =====
const composerSheet = document.getElementById("composerSheet");
const openComposerBtn = document.getElementById("openComposer");
const closeComposerBtn = document.getElementById("closeComposer");
const submitComposerBtn = document.getElementById("submitComposer");

if (openComposerBtn && composerSheet) {
  openComposerBtn.addEventListener("click", () => {
    composerSheet.hidden = false;
    // Fokus direkt ins Textfeld
    setTimeout(() => document.getElementById("c_body")?.focus(), 80);
  });
}
if (closeComposerBtn && composerSheet) {
  closeComposerBtn.addEventListener("click", () => {
    composerSheet.hidden = true;
  });
}

// Wenn du schon eine Funktion zum Posten hast, ruf sie hier auf.
// Beispiel: createPostFromComposer(); -> musst du an deinen Code anpassen.
if (submitComposerBtn) {
  submitComposerBtn.addEventListener("click", async () => {
    try {
      const category = document.getElementById("c_category")?.value || "Allgemein";
      const privacy  = document.getElementById("c_privacy")?.value || "public";

      const title = (document.getElementById("c_title")?.value || "").trim();
      const body  = (document.getElementById("c_body")?.value  || "").trim();
      if (!body) { alert("Nachricht ist Pflicht."); return; }

      const animeTitle = (document.getElementById("c_anime")?.value || "").trim();
      const questionType = document.getElementById("c_qtype")?.value || null;
      const spoiler = (document.getElementById("c_spoiler")?.value === "true");
      const tags = parseTags(document.getElementById("c_tags")?.value || "");

      // Datei: dein Handy-Composer hat i.d.R. nur 1 File Input
      const files = document.getElementById("c_file")?.files || [];

      await createPostWithUploads({
        category,
        title: title || "(ohne Titel)",
        body,
        privacy,
        animeTitle,
        tags,
        questionType,
        spoiler,
        spoilerTo: null,
        files
      });

      // schließen + feed neu laden
      if (composerSheet) composerSheet.hidden = true;
      state.view = "mine";
      state.mineFilter = privacy;
      await refreshAll(true);

      // Felder leeren
      if (document.getElementById("c_title")) document.getElementById("c_title").value = "";
      if (document.getElementById("c_body")) document.getElementById("c_body").value = "";
      if (document.getElementById("c_anime")) document.getElementById("c_anime").value = "";
      if (document.getElementById("c_tags")) document.getElementById("c_tags").value = "";
      if (document.getElementById("c_file")) document.getElementById("c_file").value = "";

    } catch (err) {
      alert(err.message);
    }
  });
}


// ===== Mobile: Keyboard-Friendly Scroll =====
document.addEventListener("focusin", (e) => {
  const el = e.target;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) {
    setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 150);
  }
});


boot();








