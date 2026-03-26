import express from "express";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import path from "path";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// --- OPENCLAW RELAY SERVER ---

// Store pending requests from Termux
interface PendingRequest {
  id: string;
  data: any;
  res: express.Response; // The held connection to Termux
  timestamp: number;
}

const pendingRequests: Map<string, PendingRequest> = new Map();

// Store collaborative directions/messages from Termux to React
const pendingCollab: any[] = [];

// Store the latest state from React
let latestState: any = null;

// 1. Termux sends a request here (Holds connection open)
app.post("/api/openclaw", (req, res) => {
  const taskId = Math.random().toString(36).substring(2, 15);
  
  const timeoutId = setTimeout(() => {
    if (pendingRequests.has(taskId)) {
      const pending = pendingRequests.get(taskId);
      pending?.res.status(504).json({
        status: "error",
        message: "Timeout: GeminiRP web app did not respond in time. Make sure the web app is open."
      });
      pendingRequests.delete(taskId);
    }
  }, 60000);

  pendingRequests.set(taskId, {
    id: taskId,
    data: req.body,
    res,
    timestamp: Date.now()
  });
});

// 2. React App polls this to get pending requests
app.get("/api/openclaw/pending", (req, res) => {
  const now = Date.now();
  for (const [id, reqObj] of pendingRequests.entries()) {
    if (now - reqObj.timestamp > 65000) {
      pendingRequests.delete(id);
    }
  }

  const pending = Array.from(pendingRequests.values())[0];
  
  if (pending) {
    res.json({
      has_pending: true,
      task_id: pending.id,
      request: pending.data
    });
  } else {
    res.json({ has_pending: false });
  }
});

// 3. React App sends the Gemini response here
app.post("/api/openclaw/respond", (req, res) => {
  const { task_id, response } = req.body;

  if (!task_id || !pendingRequests.has(task_id)) {
    return res.status(404).json({ error: "Task not found or already completed" });
  }

  const pending = pendingRequests.get(task_id);
  pending?.res.json(response);
  pendingRequests.delete(task_id);

  res.json({ success: true });
});

// --- COLLAB & SYNC ENDPOINTS ---

// React App syncs state here
app.post("/api/openclaw/sync-state", (req, res) => {
  latestState = req.body;
  res.json({ success: true });
});

// Termux can get the latest state here
app.get("/api/openclaw/state", (req, res) => {
  res.json(latestState || {});
});

// React App notifies when character replies
app.post("/api/openclaw/collab-notify", (req, res) => {
  // We can store this or just return success
  res.json({ success: true });
});

// Termux sends a collaborative message/direction here
app.post("/api/openclaw/send-collab", (req, res) => {
  pendingCollab.push(req.body);
  res.json({ success: true, message: "Collab message queued for React app" });
});

// React App polls for collaborative messages here
app.get("/api/openclaw/poll-collab", (req, res) => {
  if (pendingCollab.length > 0) {
    const nextCollab = pendingCollab.shift();
    res.json({
      has_collab: true,
      data: nextCollab
    });
  } else {
    res.json({ has_collab: false });
  }
});

// --- VITE MIDDLEWARE ---
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
