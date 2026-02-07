// app.js (FULL, cleaned, no double-boot, no duplicate state keys)
// ✅ persist login on mobile (Supabase auth persistSession + localStorage)
// ✅ one single auth flow (onAuthStateChange is the "source of truth")
// ✅ friends + dm + rooms hooks included
// ⚠️ You MUST have these tables in Supabase: friends, friend_requests, dm_messages, chat_rooms, chat_room_members, chat_room_messages

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ------------------------------------------------------------
// 1) SUPABASE INIT
// ------------------------------------------------------------
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: localStorage,
  },
});

// ------------------------------------------------------------
// 2) CONSTANTS / HELPERS
// ------------------------------------------------------------
const ANIME_CATEGORIES = [
  "Alle","Shonen","Seinen","Shojo","Josei","Romance","Slice of Life","Action","Fantasy","Isekai",
  "Horror","Comedy","Sports","Mecha","Drama","Mystery","Sci-Fi","News/Infos"
];

const QUESTION_TYPES = [
  "— (optional) —","Empfehlung","Diskussion","Hilfe/Frage","Theorie","News","Review/Meinung"
];

const el = (id) => document.getElementById(id);

const escapeHTML = (s)=>String(s ?? "")
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#039;");

const normalizeTag = (t)=>String(t||"")
  .trim().toLowerCase().replaceAll(/\s+/g,"-").replaceAll(/[^a-z0-9\-äöüß]/g,"");

const parseTags = (input)=>String(input||"")
  .split(",").map(normalizeTag).filter(Boolean).slice(0, 10);

const fmt = (iso)=> new Date(iso).toLocaleString("de-DE",{dateStyle:"medium",timeStyle:"short"});

function lockScroll(lock){
  document.documentElement.classList.toggle("noScroll", lock);
  document.body.classList.toggle("noScroll", lock);
}

function rankForPoints(points){
  if (points >= 800) return "Anime-Legende";
  if (points >= 500) return "Otaku-Veteran";
  if (points >= 300) return "Senpai";
  if (points >= 160) return "Kenner";
  if (points >= 80)  return "Mitglied";
  if (points >= 30)  return "Rookie";
  return "Novize";
}

// ------------------------------------------------------------
// 3) STATE (NO DUPLICATES)
// ------------------------------------------------------------
const state = {
  view: "feed",
  mineFilter: "public",
  query: "",
  category: "Alle",

  session: null,
  me: null,
  isAdmin: false,

  presenceChannel: null,
  dmChannel: null,
  roomChannel: null,

  chatMode: null,     // "dm" | null
  chatPeerId: null,   // friend user_id
};

// ------------------------------------------------------------
// 4) UI NODES
// ------------------------------------------------------------
const tabs = Array.from(document.querySelectorAll(".tab"));
const mineSubtabs = el("mineSubtabs");

const btnNewPost = el("btnNewPost");
const btnLogout  = el("btnLogout");
const btnChangeAvatar = el("btnChangeAvatar");
const btnAddFollow = el("btnAddFollow");
const btnAddTopic  = el("btnAddTopic");

const meName  = el("meName");
const meAvatar= el("meAvatar");
const meRank  = el("meRank");
const mePoints= el("mePoints");
const meAdminBadge = el("meAdminBadge");

const search = el("search");
const filterCategory = el("filterCategory");

const viewTitle = el("viewTitle");
const viewMeta  = el("viewMeta");
const postList  = el("postList");

const onlineCount = el("onlineCount");
const onlineList  = el("onlineList");

const followList = el("followList");
const topicList  = el("topicList");

// Modal
const modal = el("modal");
const modalTitle = el("modalTitle");
const modalBody  = el("modalBody");
const modalClose = el("modalClose");
const modalCancel= el("modalCancel");
const modalOk    = el("modalOk");

// Auth overlay
const authOverlay = el("authOverlay");
const authEmail = el("authEmail");
const authPass  = el("authPass");
const authUser  = el("authUser");
const authMsg   = el("authMsg");
const btnLogin  = el("btnLogin");
const btnSignup = el("btnSignup");

// Mobile composer
const composerSheet = el("composerSheet");
const openComposerBtn = el("openComposer");
const closeComposerBtn= el("closeComposer");
const submitComposerBtn= el("submitComposer");

// ------------------------------------------------------------
// 5) MODAL HELPER
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// 6) AUTH UI
// ------------------------------------------------------------
function showAuth(msg=""){
  authMsg.textContent = msg;
  authOverlay.classList.remove("hidden");
}
function hideAuth(){
  authOverlay.classList.add("hidden");
  authMsg.textContent = "";
}

// ------------------------------------------------------------
// 7) PROFILE
// ------------------------------------------------------------
async function ensureProfile(user, usernameFromSignup){
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

// ------------------------------------------------------------
// 8) PRESENCE
// ------------------------------------------------------------
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
    const ps = ch.presenceState();
    const list = [];
    Object.values(ps).forEach(arr => arr.forEach(p => list.push(p)));
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

// ------------------------------------------------------------
// 9) TABS / FILTERS
// ------------------------------------------------------------
function renderTabs(){
  tabs.forEach(t=>t.classList.toggle("active", t.dataset.view === state.view));
  mineSubtabs.classList.toggle("hidden", state.view !== "mine");

  if (state.view === "mine"){
    Array.from(document.querySelectorAll(".subtab"))
      .forEach(s=>s.classList.toggle("active", s.dataset.mine === state.mineFilter));
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

  const cCat = el("c_category");
  if (cCat){
    cCat.innerHTML = "";
    ANIME_CATEGORIES.filter(x=>x!=="Alle").forEach(cat=>{
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      cCat.appendChild(opt);
    });
  }

  const cQ = el("c_qtype");
  if (cQ){
    cQ.innerHTML = "";
    QUESTION_TYPES.forEach(q=>{
      const opt = document.createElement("option");
      opt.value = q;
      opt.textContent = q;
      cQ.appendChild(opt);
    });
  }
}

// ------------------------------------------------------------
// 10) STORAGE UPLOAD
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// 11) FOLLOW LISTS
// ------------------------------------------------------------
async function fetchFollowLists(){
  const uid = state.session.user.id;

  const { data: fu, error: e1 } = await supabase
    .from("follows_users")
    .select("followed_id, profiles:followed_id(username)")
    .eq("follower_id", uid);

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
          .eq("follower_id", uid)
          .eq("followed_id", id);
        await fetchFollowLists();
      };
    });
  }

  const { data: ft, error: e2 } = await supabase
    .from("follows_tags")
    .select("tag")
    .eq("follower_id", uid);

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
          .eq("follower_id", uid)
          .eq("tag", tag);
        await fetchFollowLists();
      };
    });
  }
}

// ------------------------------------------------------------
// 12) POSTS
// ------------------------------------------------------------
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
    const followedTags  = new Set((ft||[]).map(x=>x.tag));

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

function renderRepliesHTML(replies){
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
  postList.innerHTML = `<div class="panel"><div class="muted">Lade…</div></div>`;

  const all = await fetchPosts();
  const posts = applyClientFilter(all);

  if (state.view === "feed") viewTitle.textContent = "Aktuelle Posts";
  if (state.view === "following") viewTitle.textContent = "Gefolgt";
  if (state.view === "mine") viewTitle.textContent = "Meine Posts";

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

      <div class="replyBox">
        <div class="muted">Antworten:</div>
        <div id="replyList-${p.id}">
          ${renderRepliesHTML(p.replies || [])}
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

  // delete post
  postList.querySelectorAll("[data-del-post]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-del-post");
      if (!confirm("Post wirklich löschen?")) return;

      const { data: atts } = await supabase.from("post_attachments").select("id, path").eq("post_id", id);
      if (atts?.length){
        await supabase.storage.from("attachments").remove(atts.map(x=>x.path));
        await supabase.from("post_attachments").delete().eq("post_id", id);
      }
      await supabase.from("posts").delete().eq("id", id);
      await refreshAll();
    };
  });

  // delete reply
  postList.querySelectorAll("[data-del-reply]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-del-reply");
      if (!confirm("Antwort wirklich löschen?")) return;
      await supabase.from("replies").delete().eq("id", id);
      await refreshAll();
    };
  });

  // delete attachment
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

  // send reply
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

// ------------------------------------------------------------
// 13) CREATE POST / AVATAR / FOLLOW MODALS
// ------------------------------------------------------------
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
        .eq("username", q)
        .maybeSingle();

      if (error) { alert(error.message); return false; }
      if (!data) { alert("User nicht gefunden."); return false; }

      if (data.id === state.session.user.id) {
        alert("Du kannst dir nicht selbst folgen.");
        return false;
      }

      const { error: e2 } = await supabase.from("follows_users").insert({
        follower_id: state.session.user.id,
        followed_id: data.id
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

      await loadMe();
      renderMe();
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

// ------------------------------------------------------------
// 14) FRIENDS + CHAT VIEWS
// ------------------------------------------------------------
async function renderFriendsView(){
  viewTitle.textContent = "Freunde";
  viewMeta.textContent = "";

  const uid = state.session.user.id;

  postList.innerHTML = `<div class="panel"><div class="muted">Lade…</div></div>`;

  const { data: fr, error: e1 } = await supabase
    .from("friends")
    .select("low_id, high_id, created_at")
    .or(`low_id.eq.${uid},high_id.eq.${uid}`);

  if (e1) { postList.innerHTML = `<div class="panel"><div class="muted">${escapeHTML(e1.message)}</div></div>`; return; }

  const friendIds = (fr||[]).map(x => (x.low_id === uid ? x.high_id : x.low_id));

  let friends = [];
  if (friendIds.length){
    const { data: ps } = await supabase
      .from("profiles")
      .select("id, username, avatar_url, points")
      .in("id", friendIds);
    friends = ps || [];
  }

  const { data: req, error: e2 } = await supabase
    .from("friend_requests")
    .select("id, sender_id, receiver_id, status, created_at, sender:profiles!friend_requests_sender_id_fkey(username), receiver:profiles!friend_requests_receiver_id_fkey(username)")
    .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
    .order("created_at", { ascending:false });

  if (e2) { postList.innerHTML = `<div class="panel"><div class="muted">${escapeHTML(e2.message)}</div></div>`; return; }

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

        const { data: target } = await supabase
          .from("profiles")
          .select("id, username")
          .eq("username", name)
          .maybeSingle();

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

  document.getElementById("btnPickDm").onclick = async ()=>{
    const uid = state.session.user.id;
    const { data: fr } = await supabase
      .from("friends")
      .select("low_id, high_id")
      .or(`low_id.eq.${uid},high_id.eq.${uid}`);

    const friendIds = (fr||[]).map(x => (x.low_id === uid ? x.high_id : x.low_id));
    if (!friendIds.length){ alert("Du hast noch keine Freunde."); return; }

    const { data: ps } = await supabase.from("profiles").select("id, username").in("id", friendIds);

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="field">
        <div class="label">Freund auswählen</div>
        <select class="select" id="peer">
          ${(ps||[]).sort((a,b)=>a.username.localeCompare(b.username))
            .map(p=>`<option value="${p.id}">${escapeHTML(p.username)}</option>`).join("")}
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

  await renderRooms();

  if (state.chatMode === "dm" && state.chatPeerId){
    await renderDM();
  }
}

async function renderDM(){
  const dmBox  = document.getElementById("dmBox");
  const dmHint = document.getElementById("dmHint");

  const uid  = state.session.user.id;
  const peer = state.chatPeerId;
  if (!peer) return;

  const { data: peerP } = await supabase.from("profiles").select("username").eq("id", peer).maybeSingle();
  dmHint.textContent = `DM mit ${peerP?.username || "—"}`;

  const { data, error } = await supabase
    .from("dm_messages")
    .select("id, sender_id, receiver_id, body, created_at")
    .or(`and(sender_id.eq.${uid},receiver_id.eq.${peer}),and(sender_id.eq.${peer},receiver_id.eq.${uid})`)
    .order("created_at", { ascending: true })
    .limit(60);

  if (error){
    dmBox.innerHTML = `<div class="muted">${escapeHTML(error.message)}<br><br>
      <b>Hinweis:</b> Die Tabelle <code>dm_messages</code> existiert wahrscheinlich noch nicht.
    </div>`;
    return;
  }

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

  // realtime
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
  const rooms   = document.getElementById("rooms");
  const roomBox = document.getElementById("roomBox");
  const uid = state.session.user.id;

  const { data: mem, error } = await supabase
    .from("chat_room_members")
    .select("room_id, room:chat_rooms(id,name,owner_id)")
    .eq("user_id", uid);

  if (error){
    rooms.innerHTML = `<div class="muted">${escapeHTML(error.message)}<br><br>
      <b>Hinweis:</b> Tabellen <code>chat_rooms</code>/<code>chat_room_members</code> fehlen evtl.
    </div>`;
    roomBox.innerHTML = "";
    return;
  }

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

        const { data: room, error: e1 } = await supabase
          .from("chat_rooms")
          .insert({ name, owner_id: uid })
          .select("id")
          .single();

        if (e1) { alert(e1.message); return false; }

        const { error: e2 } = await supabase
          .from("chat_room_members")
          .insert({ room_id: room.id, user_id: uid });

        if (e2) { alert(e2.message); return false; }

        await renderRooms();
        return true;
      }
    });
  };

  rooms.querySelectorAll("[data-open-room]").forEach(b=>{
    b.onclick = async ()=>{
      const rid = b.getAttribute("data-open-room");
      await renderRoom(rid);
    };
  });

  async function renderRoom(roomId){
    const { data: info } = await supabase
      .from("chat_rooms")
      .select("id,name,owner_id")
      .eq("id", roomId)
      .single();

    const { data: msgs, error: e3 } = await supabase
      .from("chat_room_messages")
      .select("id, room_id, sender_id, body, created_at, sender:profiles(username)")
      .eq("room_id", roomId)
      .order("created_at", { ascending:true })
      .limit(60);

    if (e3){ roomBox.innerHTML = `<div class="muted">${escapeHTML(e3.message)}</div>`; return; }

    roomBox.innerHTML = `
      <div class="card">
        <div class="cardTop">
          <div><b>${escapeHTML(info?.name || "Raum")}</b></div>
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

    // realtime
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

// ------------------------------------------------------------
// 15) VIEW ROUTING
// ------------------------------------------------------------
async function setView(view){
  state.view = view;
  renderTabs();

  if (view === "friends") return renderFriendsView();
  if (view === "chat")    return renderChatView();

  return renderPosts();
}

// ------------------------------------------------------------
// 16) REFRESH
// ------------------------------------------------------------
async function refreshAll(reloadMe=false){
  if (reloadMe){
    await loadMe();
    renderMe();
    await startPresence();
  }
  await fetchFollowLists();
  renderTabs();

  if (state.view === "friends") return renderFriendsView();
  if (state.view === "chat")    return renderChatView();
  return renderPosts();
}

// ------------------------------------------------------------
// 17) EVENTS
// ------------------------------------------------------------
tabs.forEach(t=>{
  t.onclick = async ()=> setView(t.dataset.view);
});

Array.from(document.querySelectorAll(".subtab")).forEach(s=>{
  s.onclick = async ()=>{
    state.mineFilter = s.dataset.mine;
    renderTabs();
    await renderPosts();
  };
});

search.oninput = ()=>{ state.query = search.value || ""; renderPosts(); };
filterCategory.onchange = ()=>{ state.category = filterCategory.value || "Alle"; renderPosts(); };

btnNewPost.onclick = () => {
  const isMobile = window.matchMedia("(max-width: 900px)").matches;
  if (isMobile && composerSheet) {
    composerSheet.hidden = false;
    lockScroll(true);
    setTimeout(() => el("c_body")?.focus(), 80);
  } else {
    // Desktop: reuse sheet-style modal for simplicity
    composerSheet.hidden = false;
    lockScroll(true);
    setTimeout(() => el("c_body")?.focus(), 80);
  }
};

btnChangeAvatar.onclick = changeAvatarModal;
btnAddFollow.onclick = addFollowModal;
btnAddTopic.onclick = addTopicModal;

btnLogout.onclick = async ()=>{
  await supabase.auth.signOut();
  // cleanup channels
  if (state.presenceChannel) supabase.removeChannel(state.presenceChannel);
  if (state.dmChannel) supabase.removeChannel(state.dmChannel);
  if (state.roomChannel) supabase.removeChannel(state.roomChannel);
  location.reload();
};

// Mobile BottomNav
document.querySelectorAll(".bottomNav .bn").forEach(btn => {
  btn.addEventListener("click", async () => {
    await setView(btn.dataset.view);
  });
});

// Mobile Composer
openComposerBtn?.addEventListener("click", () => {
  composerSheet.hidden = false;
  lockScroll(true);
  setTimeout(() => el("c_body")?.focus(), 80);
});

closeComposerBtn?.addEventListener("click", () => {
  composerSheet.hidden = true;
  lockScroll(false);
});

submitComposerBtn?.addEventListener("click", async () => {
  try {
    const category = el("c_category")?.value || ANIME_CATEGORIES[1];
    const privacy  = el("c_privacy")?.value || "public";

    const title = (el("c_title")?.value || "").trim();
    const body  = (el("c_body")?.value  || "").trim();
    if (!body) { alert("Nachricht ist Pflicht."); return; }

    const animeTitle = (el("c_anime")?.value || "").trim();
    const questionType = el("c_qtype")?.value || null;
    const spoiler = (el("c_spoiler")?.value === "true");
    const tags = parseTags(el("c_tags")?.value || "");
    const files = el("c_file")?.files || [];

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

    composerSheet.hidden = true;
    lockScroll(false);

    state.view = "mine";
    state.mineFilter = privacy;
    await refreshAll(true);

    if (el("c_title")) el("c_title").value = "";
    if (el("c_body"))  el("c_body").value = "";
    if (el("c_anime")) el("c_anime").value = "";
    if (el("c_tags"))  el("c_tags").value = "";
    if (el("c_file"))  el("c_file").value = "";

  } catch (err) {
    alert(err.message);
  }
});

// Auth actions
btnLogin.onclick = async ()=>{
  authMsg.textContent = "Logge ein…";
  try{
    const email = authEmail.value.trim();
    const password = authPass.value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // onAuthStateChange übernimmt ab hier
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

    // direkt einloggen (damit wir Profil schreiben können)
    const { data: si, error: e2 } = await supabase.auth.signInWithPassword({ email, password });
    if (e2) throw e2;

    await ensureProfile(si.session.user, username);
    // onAuthStateChange übernimmt ab hier
  }catch(err){
    authMsg.textContent = err.message;
  }
};

// ------------------------------------------------------------
// 18) SINGLE SOURCE OF TRUTH: AUTH STATE CHANGE
// ------------------------------------------------------------
supabase.auth.onAuthStateChange(async (_event, session) => {
  state.session = session;

  // logged out
  if (!session){
    state.me = null;
    state.isAdmin = false;

    // cleanup channels
    if (state.presenceChannel) supabase.removeChannel(state.presenceChannel);
    if (state.dmChannel) supabase.removeChannel(state.dmChannel);
    if (state.roomChannel) supabase.removeChannel(state.roomChannel);

    showAuth("Bitte einloggen oder registrieren.");
    return;
  }

  // logged in
  try{
    // make sure profile exists (if missing username -> force signup UI)
    const { data: { user } } = await supabase.auth.getUser();
    if (user){
      try { await ensureProfile(user, ""); }
      catch { showAuth("Bitte registrieren (Username fehlt)."); return; }
    }

    hideAuth();
    renderCategoryFilter();
    await loadMe();
    renderMe();
    await startPresence();

    // first render
    await refreshAll(false);

  }catch(err){
    showAuth(err.message);
  }
});

// ------------------------------------------------------------
// 19) BOOT (ONLY GET SESSION ONCE)
// ------------------------------------------------------------
async function boot(){
  renderCategoryFilter();

  const { data } = await supabase.auth.getSession();
  state.session = data.session;

  if (!state.session){
    showAuth("Bitte einloggen oder registrieren.");
    return;
  }

  // if already logged in, onAuthStateChange will run immediately in many cases,
  // but to be safe, force a light refresh here:
  try{
    hideAuth();
    await loadMe();
    renderMe();
    renderTabs();
    await startPresence();
    await refreshAll(false);
  }catch(err){
    showAuth(err.message);
  }
}

boot();
