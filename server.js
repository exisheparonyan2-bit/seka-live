require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { AccessToken } = require("livekit-server-sdk");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e6
});

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const LIVEKIT_URL = process.env.LIVEKIT_URL;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const ROOM = "seka-live-main";

app.get("/api/config", (_req, res) => {
  res.json({ livekitUrl: LIVEKIT_URL || "" });
});

app.post("/api/token", async (req, res) => {
  try {
    const { name, role, adminPassword } = req.body || {};
    const safeName = String(name || "").trim().slice(0, 24);
    const isAdmin = role === "host" && ADMIN_PASSWORD &&
      String(adminPassword || "") === ADMIN_PASSWORD;

    if (!safeName) return res.status(400).json({ error: "Անունը պարտադիր է։" });
    if (role === "host" && !isAdmin) {
      return res.status(403).json({ error: "Ադմինի գաղտնաբառը սխալ է։" });
    }
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return res.status(503).json({ error: "LIVE հեռարձակումը դեռ կարգավորված չէ։ Ավելացրու LiveKit-ի բանալիները։" });
    }

    const identity = `${isAdmin ? "host" : "viewer"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      name: safeName,
      ttl: "2h"
    });
    token.addGrant({
      roomJoin: true,
      room: ROOM,
      canPublish: !!isAdmin,
      canSubscribe: true,
      canPublishData: !!isAdmin
    });

    res.json({ token: await token.toJwt(), room: ROOM, identity, isHost: !!isAdmin });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Չհաջողվեց ստեղծել միացման տվյալները։" });
  }
});

let liveState = { live: false, hostName: "", startedAt: null };

io.on("connection", (socket) => {
  socket.emit("live-state", liveState);

  socket.on("join-chat", (rawName) => {
    const name = String(rawName || "").trim().slice(0, 24);
    if (!name) return;
    socket.data.name = name;
    socket.emit("chat-system", { text: `Բարի գալուստ, ${name}։` });
    socket.broadcast.emit("chat-system", { text: `${name}-ը միացավ չաթին։` });
  });

  socket.on("chat-message", (rawText) => {
    const name = socket.data.name;
    const text = String(rawText || "").trim().slice(0, 500);
    if (!name || !text) return;
    io.emit("chat-message", {
      name,
      text,
      time: new Date().toLocaleTimeString("hy-AM", { hour: "2-digit", minute: "2-digit" })
    });
  });

  socket.on("host-live-state", (payload) => {
    if (!socket.data.isHost) return;
    liveState = {
      live: !!payload?.live,
      hostName: socket.data.name || "",
      startedAt: payload?.live ? (liveState.startedAt || Date.now()) : null
    };
    io.emit("live-state", liveState);
  });

  socket.on("host-authenticated", () => { socket.data.isHost = true; });
});

server.listen(PORT, () => console.log(`SEKA LIVE running on ${PORT}`));
