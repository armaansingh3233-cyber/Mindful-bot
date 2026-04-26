/* ═══════════════════════════════════════════════════════════
   MINDFUL CHAT — app.js  (Clerk + MongoDB backend edition)
   ═══════════════════════════════════════════════════════════ */

// ─── Config ────────────────────────────────────────────────
const API_BASE = "http://localhost:3000"; // ← Replace with your Render URL

// ─── State ─────────────────────────────────────────────────
let chatHistory   = [];   // messages in current session
let currentChatId = null; // active chat document _id
let isSending     = false;
let currentUser   = null; // Clerk user object
let allSessions   = [];   // list of past chat sessions

// ─── DOM refs ──────────────────────────────────────────────
const messagesEl      = document.getElementById("messages");
const messagesWrapper = document.getElementById("messagesWrapper");
const userInput       = document.getElementById("userInput");
const sendBtn         = document.getElementById("sendBtn");
const typingIndicator = document.getElementById("typingIndicator");
const themeToggle     = document.getElementById("themeToggle");
const moodSummaryEl   = document.getElementById("moodSummary");
const sidebarToggle   = document.getElementById("sidebarToggle");
const sidebar         = document.getElementById("sidebar");
const overlay         = document.getElementById("overlay");
const newChatBtn      = document.getElementById("newChatBtn");
const historyList     = document.getElementById("historyList");
const userNameEl      = document.getElementById("userName");
const userAvatarEl    = document.getElementById("userAvatar");
const signOutBtn      = document.getElementById("signOutBtn");
const authGate        = document.getElementById("authGate");
const appEl           = document.getElementById("app");

// ═══════════════════════════════════════════════════════════
// CLERK AUTHENTICATION
// ═══════════════════════════════════════════════════════════
window.addEventListener("load", async () => {
  await window.Clerk.load();

  if (window.Clerk.user) {
    onSignedIn(window.Clerk.user);
  } else {
    showAuthGate();
  }

  window.Clerk.addListener(({ user }) => {
    if (!user) {
      showAuthGate();
    }
  });
});

function showAuthGate() {
  authGate.style.display = "flex";
  appEl.style.display = "none";
}

async function onSignedIn(user) {
  if (currentUser) return;
  currentUser = user;
  authGate.style.display = "none";
  appEl.style.display = "flex";
  // Set user info in sidebar
  const firstName = user.firstName || user.username || user.emailAddresses?.[0]?.emailAddress?.split("@")[0] || "Friend";
  userNameEl.textContent = firstName;
  if (user.imageUrl) {
    userAvatarEl.style.backgroundImage = `url(${user.imageUrl})`;
    userAvatarEl.style.backgroundSize = "cover";
  } else {
    userAvatarEl.textContent = firstName[0].toUpperCase();
  }

  // Store first name globally for greeting
  window._mindfulFirstName = firstName;

  await loadMoodSummary();
  await loadChatSessions();
  startNewChat();
}

// Google sign-in button
document.getElementById("googleSignInBtn")?.addEventListener("click", async () => {
  await window.Clerk.redirectToSignIn();
});

signOutBtn?.addEventListener("click", async () => {
  await window.Clerk.signOut();
});

// ─── Get Clerk token for API auth ──────────────────────────
async function getToken() {
  return await window.Clerk.session.getToken();
}

// ─── Authenticated fetch helper ────────────────────────────
async function apiFetch(path, opts = {}) {
  const token = await getToken();
  return fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
}

// ═══════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggle.querySelector(".theme-icon").textContent = theme === "dark" ? "🌙" : "☀️";
  localStorage.setItem("mindful-theme", theme);
}

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

applyTheme(localStorage.getItem("mindful-theme") || "light");

// ═══════════════════════════════════════════════════════════
// MOBILE SIDEBAR
// ═══════════════════════════════════════════════════════════
sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("open");
  overlay.classList.toggle("visible");
});

overlay.addEventListener("click", () => {
  sidebar.classList.remove("open");
  overlay.classList.remove("visible");
});

// ═══════════════════════════════════════════════════════════
// MOOD TRACKER  (stored in MongoDB per user)
// ═══════════════════════════════════════════════════════════
const MOOD_LABELS = {
  happy:   { emoji: "😊", label: "Happy" },
  neutral: { emoji: "😐", label: "Neutral" },
  sad:     { emoji: "😢", label: "Sad" },
  stressed:{ emoji: "😰", label: "Stressed" },
};

async function loadMoodSummary() {
  try {
    const res  = await apiFetch("/api/moods");
    const data = await res.json();
    renderMoodSummary(data.counts || {});
  } catch { renderMoodSummary({}); }
}

async function logMood(mood) {
  try {
    await apiFetch("/api/moods", { method: "POST", body: JSON.stringify({ mood }) });
    await loadMoodSummary();
  } catch (e) { console.error(e); }
}

function renderMoodSummary(counts) {
  if (!Object.keys(counts).length) {
    moodSummaryEl.innerHTML = `<p class="mood-empty">No moods logged yet.</p>`;
    return;
  }
  const items = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([mood, count]) => {
      const { emoji, label } = MOOD_LABELS[mood] || { emoji: "🙂", label: mood };
      return `<div class="mood-log-item">
        <span class="mood-log-label">${emoji} ${label}</span>
        <span class="mood-log-count">${count}×</span>
      </div>`;
    }).join("");
  moodSummaryEl.innerHTML = items;
}

document.querySelectorAll(".mood-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const mood = btn.dataset.mood;
    document.querySelectorAll(".mood-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    logMood(mood);
    setTimeout(() => btn.classList.remove("active"), 1500);

    const { emoji, label } = MOOD_LABELS[mood];
    const reply = `I see you're feeling ${label.toLowerCase()} ${emoji}. Thank you for sharing that with me. 💙 How can I support you right now?`;
    appendMessage("bot", reply);
    chatHistory.push({ role: "assistant", content: reply });
    saveChatToServer();
  });
});

// ═══════════════════════════════════════════════════════════
// CHAT SESSIONS  (MongoDB)
// ═══════════════════════════════════════════════════════════
async function loadChatSessions() {
  try {
    const res  = await apiFetch("/api/chats");
    const data = await res.json();
    allSessions = data.chats || [];
    renderHistoryList();
  } catch (e) { console.error(e); }
}

function renderHistoryList() {
  if (!allSessions.length) {
    historyList.innerHTML = `<p class="mood-empty">No past chats yet.</p>`;
    return;
  }
  historyList.innerHTML = allSessions.map(s => `
    <div class="history-item ${s._id === currentChatId ? "active" : ""}" data-id="${s._id}">
      <span class="history-title">${s.title || "Untitled chat"}</span>
      <button class="history-delete" data-id="${s._id}" title="Delete">🗑</button>
    </div>
  `).join("");

  historyList.querySelectorAll(".history-item").forEach(el => {
    el.addEventListener("click", e => {
      if (e.target.classList.contains("history-delete")) return;
      loadChat(el.dataset.id);
    });
  });

  historyList.querySelectorAll(".history-delete").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      deleteChat(btn.dataset.id);
    });
  });
}

async function loadChat(chatId) {
  try {
    const res  = await apiFetch(`/api/chats/${chatId}`);
    const data = await res.json();
    currentChatId = chatId;
    chatHistory   = data.messages || [];

    messagesEl.innerHTML = "";
    chatHistory.forEach(({ role, content }) => {
      appendMessage(role === "user" ? "user" : "bot", content);
    });

    renderHistoryList();
    sidebar.classList.remove("open");
    overlay.classList.remove("visible");
  } catch (e) { console.error(e); }
}

async function deleteChat(chatId) {
  if (!confirm("Delete this chat?")) return;
  try {
    await apiFetch(`/api/chats/${chatId}`, { method: "DELETE" });
    if (currentChatId === chatId) startNewChat();
    await loadChatSessions();
  } catch (e) { console.error(e); }
}

async function saveChatToServer() {
  if (!chatHistory.length) return;
  try {
    if (currentChatId) {
      await apiFetch(`/api/chats/${currentChatId}`, {
        method: "PUT",
        body: JSON.stringify({ messages: chatHistory }),
      });
    } else {
      // Auto-generate title from first user message via server
      const res  = await apiFetch("/api/chats", {
        method: "POST",
        body: JSON.stringify({ messages: chatHistory }),
      });
      const data = await res.json();
      currentChatId = data._id;
      await loadChatSessions();
    }
  } catch (e) { console.error(e); }
}

// ─── New chat ───────────────────────────────────────────────
function startNewChat() {
  currentChatId = null;
  chatHistory   = [];
  messagesEl.innerHTML = "";
  renderWelcomeCard();
  renderHistoryList();
}

newChatBtn.addEventListener("click", startNewChat);

// ═══════════════════════════════════════════════════════════
// MESSAGE RENDERING
// ═══════════════════════════════════════════════════════════
function formatTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function parseMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .split("\n")
    .map(line => line.trim() ? `<p>${line}</p>` : "")
    .join("");
}

function appendMessage(role, content, isCrisis = false) {
  const row = document.createElement("div");
  row.className = `message-row ${role}${isCrisis ? " crisis" : ""}`;

  const avatarContent = role === "user" ? (window._mindfulFirstName?.[0]?.toUpperCase() || "Y") : "🌿";
  const avatar = `<div class="message-avatar">${avatarContent}</div>`;

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.innerHTML = parseMarkdown(content);

  const timeEl = document.createElement("p");
  timeEl.className = "message-time";
  timeEl.textContent = formatTime();

  const inner = document.createElement("div");
  inner.style.maxWidth = "72%";
  inner.appendChild(bubble);
  inner.appendChild(timeEl);

  row.innerHTML = avatar;
  row.appendChild(inner);

  messagesEl.appendChild(row);
  scrollToBottom();
  return row;
}

function scrollToBottom() {
  messagesWrapper.scrollTo({ top: messagesWrapper.scrollHeight, behavior: "smooth" });
}

function renderWelcomeCard() {
  const name = window._mindfulFirstName || "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const card = document.createElement("div");
  card.className = "welcome-card";
  card.innerHTML = `
    <div class="welcome-icon">🌿</div>
    <h2>${greeting}, ${name}! 👋</h2>
    <p>How are you feeling today? This is your safe space — no judgment, just support. I'm here to listen. 💙</p>
    <div class="quick-prompts">
      <button class="quick-prompt-btn">I'm feeling anxious</button>
      <button class="quick-prompt-btn">I can't stop overthinking</button>
      <button class="quick-prompt-btn">I feel lonely</button>
      <button class="quick-prompt-btn">I'm really stressed</button>
    </div>
  `;
  card.querySelectorAll(".quick-prompt-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      userInput.value = btn.textContent;
      sendMessage();
    });
  });
  messagesEl.appendChild(card);
}

// ═══════════════════════════════════════════════════════════
// SEND MESSAGE
// ═══════════════════════════════════════════════════════════
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isSending) return;

  const welcomeCard = messagesEl.querySelector(".welcome-card");
  if (welcomeCard) welcomeCard.remove();

  appendMessage("user", text);
  userInput.value = "";
  autoResizeTextarea();
  chatHistory.push({ role: "user", content: text });

  isSending = true;
  sendBtn.disabled = true;
  typingIndicator.classList.add("visible");
  scrollToBottom();

  try {
    const token = await getToken();
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        message: text,
        history: chatHistory.slice(-21, -1),
      }),
    });

    const data = await res.json();
    typingIndicator.classList.remove("visible");

    if (!res.ok) {
      appendMessage("bot", "⚠️ Something went wrong. Please try again in a moment.");
      return;
    }

    const isCrisis = data.type === "crisis";
    const reply = data.reply || data.error || "I'm sorry, I didn't quite understand that.";
    appendMessage("bot", reply, isCrisis);
    chatHistory.push({ role: "assistant", content: reply });

    // Save to MongoDB (async, non-blocking for UX)
    saveChatToServer();

  } catch (err) {
    typingIndicator.classList.remove("visible");
    appendMessage("bot", "⚠️ I'm having trouble connecting right now. Please make sure the server is running and try again.");
    console.error("Fetch error:", err);
  } finally {
    isSending = false;
    sendBtn.disabled = false;
    userInput.focus();
  }
}

sendBtn.addEventListener("click", sendMessage);

userInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function autoResizeTextarea() {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
}

userInput.addEventListener("input", autoResizeTextarea);
