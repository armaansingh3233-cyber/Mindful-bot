# 🌿 Mindful Chat — Full Stack Setup Guide

## Stack
| Part | Tool | Free |
|------|------|------|
| Frontend | Vercel | ✅ |
| Backend | Render | ✅ |
| Auth | Clerk | ✅ |
| AI | Groq | ✅ |
| Database | MongoDB Atlas | ✅ |

---

## Step 1 — MongoDB Atlas (Database)

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com) → Create free account
2. Create a **free M0 cluster** (choose any region)
3. In **Database Access** → Add a user with username + password
4. In **Network Access** → Add IP `0.0.0.0/0` (allow all, needed for Render)
5. Click **Connect** → **Drivers** → copy the connection string
   - Looks like: `mongodb+srv://username:password@cluster.mongodb.net/`
   - Change the database name to `mindful-chat`:
   - `mongodb+srv://username:password@cluster.mongodb.net/mindful-chat?retryWrites=true&w=majority`
6. Save this — you'll need it as `MONGODB_URI`

---

## Step 2 — Clerk (Auth)

1. Go to [clerk.com](https://clerk.com) → Create free account
2. Create a new application → Name it **Mindful Chat**
3. Enable **Google** as a social provider (under Social connections)
4. In **API Keys**, copy your **Publishable Key** (`pk_live_...`) and **Secret Key**
5. In **Domains**, add your Vercel URL later (after deploy)

---

## Step 3 — Backend (Render)

1. Push your `backend/` folder to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo, select the backend folder
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Node version:** 20
5. Add **Environment Variables** (from the `.env.example`):
   ```
   GROQ_API_KEY=your_groq_key
   MONGODB_URI=your_mongodb_uri
   CLERK_PUBLISHABLE_KEY=pk_live_xxx
   FRONTEND_URL=https://your-app.vercel.app
   ```
6. Deploy → copy your Render URL (e.g. `https://mindful-chat-api.onrender.com`)

---

## Step 4 — Frontend (Vercel)

### Before deploying, update 2 values in the frontend files:

**In `index.html`** — replace `YOUR_PUBLISHABLE_KEY` with your Clerk publishable key:
```html
data-clerk-publishable-key="pk_live_your_actual_key_here"
```

**In `app.js`** — replace the API base URL with your Render URL:
```js
const API_BASE = "https://mindful-chat-api.onrender.com";
```

### Deploy to Vercel:
1. Push the `frontend/` folder to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import repo
3. No build settings needed (it's plain HTML/CSS/JS)
4. Deploy → copy your Vercel URL

### Final step — add Vercel URL to Clerk:
- In Clerk Dashboard → **Domains** → Add your `https://your-app.vercel.app` URL

---

## Local Development

### Backend
```bash
cd backend
npm install
cp .env.example .env
# Fill in your .env values
npm run dev
```

### Frontend
Open `frontend/index.html` directly in browser, **or** use a local server:
```bash
cd frontend
npx serve .
```

---

## Features
- ✅ Google Sign-in via Clerk
- ✅ Personalized greeting with user's first name
- ✅ Private chat history per user (stored in MongoDB)
- ✅ Auto-generated chat titles from first message
- ✅ Individual chat deletion from sidebar
- ✅ Mood tracker synced to database per user
- ✅ Crisis detection with helpline numbers
- ✅ Dark/light theme toggle
- ✅ Mobile responsive

---

## Folder Structure
```
mindful-chat/
├── frontend/
│   ├── index.html
│   ├── app.js
│   └── style.css
└── backend/
    ├── server.js
    ├── package.json
    └── .env.example
```
