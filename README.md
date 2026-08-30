# ⚡ Real-Time Collaborative Lab Exam Q&A Portal

A high-performance, real-time web application built for live exam assistance and pair-solving between two users. One user uploads exam questions (with direct screenshot pasting), and the other solves them in real time with syntax highlighting, LaTeX math equations, and instant live notifications.

![Platform](https://img.shields.io/badge/Platform-Node.js%20%7C%20Socket.IO%20%7C%20Express-indigo)
![Realtime](https://img.shields.io/badge/Realtime-WebSocket%20Sync-emerald)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## 🌟 Key Features

### 1. 🙋 Friend's Portal (`/ask`)
- **Direct Screenshot Pasting**: Press `Ctrl+V` anywhere on the screen or drag-and-drop images to attach question screenshots instantly.
- **Rich Question Details**: Problem description, starter code snippet, subject/tags (DSA, Python, Java, C++, OS, DBMS, etc.), and urgency level (Normal, High, Urgent).
- **Live Answer Stream**: Real-time notifications with audio chimes as soon as an answer is posted.
- **Live Status Tracking**: Displays whether the solver is *Waiting*, *Working on it*, or *Solved*.
- **One-Click Copy**: Copy solution code or entire answers in 1 click.

### 2. 🧑‍💻 Solver's Portal (`/solve`)
- **Live Question Radar**: Real-time incoming question alerts with Web Audio synthesized chimes and visual glow.
- **Status Broadcasting**: 1-click *"Mark Working on It"* button to reassure the friend that help is underway.
- **Rich Solution Composer**:
  - Markdown formatting
  - LaTeX Math rendering (e.g. `$x^2 + y^2 = r^2$` or `$$\int f(x) dx$$`)
  - Code syntax highlighting for Python, Java, C/C++, JavaScript, SQL, and more.
  - Image attachments & screenshot paste for solution diagrams and handwritten formulas.
- **Live Typing Indicator**: Lets the friend know when a solution is being drafted.

### 3. 📊 Unified Live Dashboard (`/dashboard` & `/`)
- **Combined Live Feed**: View all questions and solutions side-by-side.
- **Search & Filters**: Search by question title, code, or keyword; filter by pending/solved status.
- **Export to Markdown**: Download all questions and answers as a formatted `.md` file for exam notes and archives.
- **LAN Wi-Fi Sharing**: Easily open and share the portal on your phone or friend's laptop across the same Wi-Fi / hotspot.

---

## 🚀 Quick Start (Local Setup)

### Prerequisites
- **Node.js** (v18 or higher recommended)
- **npm**

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/HarshitSaraan/lab-exam.git
   cd lab-exam
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Open in browser:**
   - **Launchpad**: [http://localhost:3000](http://localhost:3000)
   - **Friend / Asker Portal**: [http://localhost:3000/ask](http://localhost:3000/ask)
   - **Solver Portal**: [http://localhost:3000/solve](http://localhost:3000/solve)
   - **Unified Live Board**: [http://localhost:3000/dashboard](http://localhost:3000/dashboard)

---

## 📱 Sharing on Local Wi-Fi / Mobile Hotspot

When you start the server, it outputs your local network IP (e.g., `http://192.168.1.15:3000`).
1. Connect both devices (e.g. your PC and your friend's phone or laptop) to the same Wi-Fi or mobile hotspot.
2. Open `http://<YOUR-IP>:3000/ask` on the phone/friend's laptop.
3. Open `http://localhost:3000/solve` on your laptop.
4. Upload questions and solve with instantaneous real-time sync!

---

## 🌐 Deploy to Cloud (Render / Railway / Heroku / VPS)

### Option 1: Render.com (Free)
1. Fork or push this repository to GitHub.
2. Create a new **Web Service** on [Render](https://render.com).
3. Set **Build Command**: `npm install`
4. Set **Start Command**: `npm start`

### Option 2: Docker
```bash
docker build -t lab-exam .
docker run -p 3000:3000 lab-exam
```

---

## 📂 Project Structure

```
lab-exam/
├── server.js                  # Express backend, Socket.IO handlers & REST APIs
├── package.json               # Dependencies and scripts
├── public/                    # Frontend files
│   ├── index.html             # Landing page & Portal switcher
│   ├── ask.html               # Friend Portal (Question Asker)
│   ├── solve.html             # Solver Portal (Solution Broadcaster)
│   ├── dashboard.html         # Unified Real-time Live Hub
│   ├── css/
│   │   └── style.css          # Styling, glassmorphism & responsive animations
│   ├── js/
│   │   ├── common.js          # Shared sound synthesis, toasts, clipboard & markdown
│   │   ├── ask.js             # Client logic for /ask
│   │   ├── solve.js           # Client logic for /solve
│   │   └── dashboard.js       # Client logic for /dashboard
│   └── uploads/               # Uploaded images & screenshots
├── data/
│   └── db.json                # Persistent JSON database
├── Dockerfile                 # Container setup
└── README.md                  # Documentation
```

---

## 🔒 License
MIT &copy; [Harshit Saraan](https://github.com/HarshitSaraan)
