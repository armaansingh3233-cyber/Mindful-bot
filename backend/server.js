require("dotenv").config();
const express  = require("express");
const cors     = require("cors");
const mongoose = require("mongoose");
const jwt      = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

// ─── Validate env vars ─────────────────────────────────────
const required = ["GROQ_API_KEY", "MONGODB_URI", "CLERK_PUBLISHABLE_KEY"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing env var: ${key}`);
    process.exit(1);
  }
}

// ─── MongoDB connection ────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => { console.error("MongoDB error:", err); process.exit(1); });

// ═══════════════════════════════════════════════════════════
// MONGOOSE SCHEMAS
// ═══════════════════════════════════════════════════════════

// Chat session
const ChatSchema = new mongoose.Schema({
  userId:    { type: String, required: true, index: true },
  title:     { type: String, default: "New chat" },
  messages:  [{
    role:    { type: String, enum: ["user", "assistant"] },
    content: String,
    ts:      { type: Date, default: Date.now },
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Mood log
const MoodSchema = new mongoose.Schema({
  userId:    { type: String, required: true, index: true },
  mood:      { type: String, enum: ["happy", "neutral", "sad", "stressed"] },
  loggedAt:  { type: Date, default: Date.now },
});

const Chat = mongoose.model("Chat", ChatSchema);
const Mood = mongoose.model("Mood", MoodSchema);

// ═══════════════════════════════════════════════════════════
// CLERK JWT VERIFICATION
// ═══════════════════════════════════════════════════════════
// Extract Clerk frontend API from publishable key
// Format: pk_live_<base64> or pk_test_<base64>
function getClerkFrontendApi() {
  const pk = process.env.CLERK_PUBLISHABLE_KEY;
  try {
    const base64 = pk.split("_")[2];
    const decoded = Buffer.from(base64, "base64").toString("utf8");
    // decoded looks like "clerk.your-domain.com$"
    return decoded.replace(/\$$/, "");
  } catch {
    // Fallback: user must set CLERK_FRONTEND_API directly
    return process.env.CLERK_FRONTEND_API || "";
  }
}

const CLERK_JWKS_URI = `https://${getClerkFrontendApi()}/.well-known/jwks.json`;

const jwks = jwksClient({ jwksUri: CLERK_JWKS_URI, cache: true, rateLimit: true });

function getKey(header, callback) {
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

async function verifyClerkToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, getKey, { algorithms: ["RS256"] }, (err, decoded) => {
      if (err) return reject(err);
      resolve(decoded);
    });
  });
}

// ─── Auth middleware ───────────────────────────────────────
async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }
  try {
    const token = auth.slice(7);
    const payload = await verifyClerkToken(token);
    req.userId = payload.sub; // Clerk user ID
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ═══════════════════════════════════════════════════════════
// GROQ AI
// ═══════════════════════════════════════════════════════════
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL   = "llama-3.3-70b-versatile";

const CRISIS_PHRASES = [
  "suicide", "kill myself", "want to die", "end my life", "take my life",
  "don't want to live", "no reason to live", "better off dead", "hurt myself",
  "self harm", "self-harm", "cut myself", "overdose", "jump off",
];

const MENTAL_HEALTH_KEYWORDS = [
  "stress","stressed","anxiety","anxious","depression","depressed","sad","sadness",
  "lonely","loneliness","overthinking","panic","panic attack","burnout","burnt out",
  "exhausted","overwhelmed","hopeless","helpless","worthless","fear","worry","worried",
  "mental health","therapy","therapist","counseling","counselor","emotions","emotional",
  "mood","feeling","feelings","grief","trauma","ptsd","ocd","adhd","bipolar",
  "schizophrenia","anger","angry","irritable","frustration","frustrated","happiness",
  "happy","joy","motivation","unmotivated","numb","crying","cry","tears","breakdown",
  "meltdown","sleep","insomnia","nightmares","confidence","self-esteem","self esteem",
  "shame","guilt","regret","jealousy","jealous","envy","heartbreak","relationship",
  "breakup","divorce","loss","grief","mourning","social anxiety","phobia","obsession",
  "intrusive thoughts","coping","cope","breathing","meditation","mindfulness","calm",
  "support","talk to someone","feeling better","mental wellbeing","psychologist",
  "psychiatrist","medication","antidepressant","difficult time","hard time","struggling",
  "struggle","suffer","life","purpose","meaning","isolation","alone","empty",
];

const SYSTEM_PROMPT = `You are Mindful, a compassionate mental health support chatbot. Your role is to provide empathetic, non-judgmental emotional support.

STRICT RULES:
- Only discuss mental health, emotional well-being, stress, anxiety, depression, relationships, grief, coping strategies, mindfulness, and personal growth.
- If asked about anything unrelated (coding, politics, science, general knowledge, entertainment), respond: "I'm here to support mental health and emotional well-being. I might not be the best for that question."
- NEVER diagnose any mental health condition.
- NEVER prescribe or recommend specific medications.
- NEVER claim to be a licensed therapist or doctor.
- Always encourage professional help for serious concerns.
- Keep responses warm, calm, empathetic, and supportive.
- Use clear, simple language — avoid clinical jargon.
- Keep responses concise (3-5 sentences typically) unless the user needs detailed coping strategies.
- Occasionally use gentle, supportive emojis such as a blue heart, leaf, or sparkle but do not overdo it.
- End responses with an open question to encourage the user to share more.

You are a supportive tool, not a replacement for professional mental health care.`;

async function callGroq(messages) {
  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({ model: GROQ_MODEL, messages, max_tokens: 500, temperature: 0.7 }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq error ${response.status}: ${err}`);
  }
  const data = await response.json();
  return data.choices[0].message.content;
}

function detectCrisis(text) {
  const lower = text.toLowerCase();
  return CRISIS_PHRASES.some(p => lower.includes(p));
}

function quickMentalHealthCheck(text) {
  const lower = text.toLowerCase();
  return MENTAL_HEALTH_KEYWORDS.some(kw => lower.includes(kw));
}

async function classifyWithAI(userMessage) {
  try {
    const reply = await callGroq([
      { role: "system", content: "You are a classifier. Determine if the user message is related to mental health, emotional well-being, stress, anxiety, depression, relationships, or personal struggles. Reply with ONLY one word: YES or NO." },
      { role: "user", content: userMessage },
    ]);
    return reply.trim().toUpperCase().startsWith("YES");
  } catch {
    return true; // fail open
  }
}

// ─── Auto-generate chat title ──────────────────────────────
async function generateTitle(firstUserMessage) {
  try {
    const reply = await callGroq([
      { role: "system", content: "Generate a short, warm, 3-5 word title for a mental health chat that started with the user's message. No quotes, no punctuation at the end. Examples: 'Dealing with work stress', 'Feeling anxious lately', 'Coping with loneliness'" },
      { role: "user", content: firstUserMessage },
    ]);
    return reply.trim().slice(0, 60);
  } catch {
    return firstUserMessage.slice(0, 40) + (firstUserMessage.length > 40 ? "…" : "");
  }
}

// ═══════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════

// ─── Health ───────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", model: GROQ_MODEL });
});

// ─── Chat AI endpoint ──────────────────────────────────────
app.post("/api/chat", requireAuth, async (req, res) => {
  const { message, history = [] } = req.body;

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Message is required." });
  }

  const trimmed = message.trim();

  if (detectCrisis(trimmed)) {
    return res.json({
      type: "crisis",
      reply: "I'm really concerned about you right now, and I want you to know you are not alone. 💙\n\nPlease reach out immediately to someone you trust — a friend, family member, or a professional.\n\n**Crisis Helplines:**\n• iCall (India): 9152987821\n• Vandrevala Foundation: 1860-2662-345 (24/7)\n• International: findahelpline.com\n\nYour life has value. Please talk to someone right now. I care about your safety.",
    });
  }

  const isFollowUp = history.length > 0;
  if (!isFollowUp) {
    const passedKeyword = quickMentalHealthCheck(trimmed);
    const isMentalHealth = passedKeyword || await classifyWithAI(trimmed);
    if (!isMentalHealth) {
      return res.json({
        type: "out_of_scope",
        reply: "I'm here to support mental health and emotional well-being. I might not be the best for that question. 💙 Feel free to share how you're feeling or what's on your mind.",
      });
    }
  }

  try {
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.slice(-20).map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.content })),
      { role: "user", content: trimmed },
    ];
    const reply = await callGroq(messages);
    return res.json({ type: "response", reply });
  } catch (err) {
    console.error("Groq error:", err.message);
    let msg = "Something went wrong. Please try again.";
    if (err.message.includes("401")) msg = "Invalid API key.";
    if (err.message.includes("429")) msg = "Too many requests. Please wait a moment. 🙏";
    return res.status(500).json({ error: msg });
  }
});

// ─── Chat Sessions ─────────────────────────────────────────

// GET /api/chats — list all sessions for user
app.get("/api/chats", requireAuth, async (req, res) => {
  try {
    const chats = await Chat.find({ userId: req.userId })
      .sort({ updatedAt: -1 })
      .select("_id title updatedAt")
      .limit(50);
    res.json({ chats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chats/:id — get one session
app.get("/api/chats/:id", requireAuth, async (req, res) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.id, userId: req.userId });
    if (!chat) return res.status(404).json({ error: "Chat not found" });
    res.json(chat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chats — create new session
app.post("/api/chats", requireAuth, async (req, res) => {
  try {
    const { messages = [] } = req.body;
    const firstUserMsg = messages.find(m => m.role === "user")?.content || "New chat";
    const title = await generateTitle(firstUserMsg);
    const chat = await Chat.create({ userId: req.userId, title, messages });
    res.json(chat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/chats/:id — update messages
app.put("/api/chats/:id", requireAuth, async (req, res) => {
  try {
    const { messages } = req.body;
    const chat = await Chat.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { messages, updatedAt: new Date() },
      { new: true }
    );
    if (!chat) return res.status(404).json({ error: "Chat not found" });
    res.json(chat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chats/:id — delete a session
app.delete("/api/chats/:id", requireAuth, async (req, res) => {
  try {
    await Chat.deleteOne({ _id: req.params.id, userId: req.userId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Mood Endpoints ────────────────────────────────────────

// GET /api/moods — mood summary counts for user
app.get("/api/moods", requireAuth, async (req, res) => {
  try {
    const moods = await Mood.find({ userId: req.userId });
    const counts = {};
    moods.forEach(({ mood }) => { counts[mood] = (counts[mood] || 0) + 1; });
    res.json({ counts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/moods — log a mood
app.post("/api/moods", requireAuth, async (req, res) => {
  try {
    const { mood } = req.body;
    if (!["happy", "neutral", "sad", "stressed"].includes(mood)) {
      return res.status(400).json({ error: "Invalid mood" });
    }
    await Mood.create({ userId: req.userId, mood });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`\n🌿 Mindful Chat backend running at http://localhost:${PORT}`);
  console.log(`   Model : ${GROQ_MODEL}`);
  console.log(`   DB    : MongoDB Atlas\n`);
});
