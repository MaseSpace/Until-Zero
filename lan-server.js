const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const ROOT_DIR = process.cwd();
const STALE_PLAYER_MS = 45_000;

const DEFAULT_SETTINGS = Object.freeze({
  playMode: "network",
  mapPreset: "world-1850",
  rulesPreset: "classic",
  difficulty: "very-easy",
  campaignMode: "deathmatch",
  passPlayers: 2
});

const COUNTRY_IDS = new Set([
  "united-states",
  "united-kingdom",
  "japan",
  "south-africa",
  "russia",
  "india",
  "brazil"
]);
const NETWORK_OWNER_SLOTS = ["player", "ai1", "ai2", "ai3"];

const lobbies = new Map();

function makeId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
}

function sanitizeRoom(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  const cleaned = raw
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 32);
  return cleaned || "empires-room";
}

function sanitizeName(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "Commander";
  return raw.replace(/\s+/g, " ").slice(0, 24);
}

function normalizeSettings(source) {
  const input = source && typeof source === "object" ? source : {};
  return {
    playMode: "network",
    mapPreset: String(input.mapPreset || DEFAULT_SETTINGS.mapPreset),
    rulesPreset: String(input.rulesPreset || DEFAULT_SETTINGS.rulesPreset),
    difficulty: String(input.difficulty || DEFAULT_SETTINGS.difficulty),
    campaignMode: String(input.campaignMode || DEFAULT_SETTINGS.campaignMode),
    passPlayers: Math.max(2, Math.min(6, Number.parseInt(input.passPlayers, 10) || 2))
  };
}

function normalizeMaxPlayers(value) {
  return Math.max(2, Math.min(4, Number.parseInt(value, 10) || 4));
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, statusCode, payload) {
  setCors(res);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function contentTypeForExt(ext) {
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function findPlayer(lobby, playerId) {
  return lobby.players.find((entry) => entry.id === playerId) || null;
}

function isValidOwnerSlot(ownerSlot) {
  return typeof ownerSlot === "string" && NETWORK_OWNER_SLOTS.includes(ownerSlot);
}

function allocateOwnerSlot(lobby) {
  const taken = new Set(
    lobby.players
      .map((entry) => (isValidOwnerSlot(entry.ownerSlot) ? entry.ownerSlot : ""))
      .filter(Boolean)
  );
  return NETWORK_OWNER_SLOTS.find((slot) => !taken.has(slot)) || "";
}

function normalizeLobbyOwnerSlots(lobby) {
  const taken = new Set();
  lobby.players.forEach((entry) => {
    if (isValidOwnerSlot(entry.ownerSlot) && !taken.has(entry.ownerSlot)) {
      taken.add(entry.ownerSlot);
      return;
    }
    const nextSlot = NETWORK_OWNER_SLOTS.find((slot) => !taken.has(slot)) || "";
    entry.ownerSlot = nextSlot;
    if (nextSlot) {
      taken.add(nextSlot);
    }
  });
}

function hasCountryConflict(lobby, countryId, exceptPlayerId = "") {
  return lobby.players.some((entry) => entry.id !== exceptPlayerId && entry.countryId === countryId);
}

function refreshLobbyPlayers(lobby) {
  const now = Date.now();
  lobby.players = lobby.players.filter((entry) => (now - entry.lastSeen) <= STALE_PLAYER_MS);
  if (lobby.players.length < 1) return false;
  if (!findPlayer(lobby, lobby.hostPlayerId)) return false;
  if (lobby.players.length > lobby.maxPlayers) {
    lobby.players = lobby.players.slice(0, lobby.maxPlayers);
  }
  normalizeLobbyOwnerSlots(lobby);
  if (lobby.status === "started" && !findPlayer(lobby, lobby.activePlayerId)) {
    lobby.activePlayerId = lobby.players[0]?.id || "";
  }
  return true;
}

function nextPlayerId(lobby, currentPlayerId) {
  if (!lobby.players.length) return "";
  const index = lobby.players.findIndex((entry) => entry.id === currentPlayerId);
  if (index < 0) return lobby.players[0].id;
  const nextIndex = (index + 1) % lobby.players.length;
  return lobby.players[nextIndex].id;
}

function lobbyPayload(lobby, options = {}) {
  const includePayload = Boolean(options.includePayload);
  const since = Math.max(0, Number.parseInt(options.since, 10) || 0);
  return {
    id: lobby.id,
    room: lobby.room,
    status: lobby.status,
    hostPlayerId: lobby.hostPlayerId,
    maxPlayers: lobby.maxPlayers,
    aiEnabled: lobby.aiEnabled,
    settings: lobby.settings,
    playerCount: lobby.players.length,
    players: lobby.players.map((entry) => ({
      id: entry.id,
      name: entry.name,
      countryId: entry.countryId,
      ownerSlot: isValidOwnerSlot(entry.ownerSlot) ? entry.ownerSlot : "",
      isHost: entry.id === lobby.hostPlayerId
    })),
    activePlayerId: lobby.activePlayerId,
    payloadVersion: lobby.payloadVersion,
    payload: includePayload && lobby.payload && lobby.payloadVersion > since ? lobby.payload : null,
    createdAt: lobby.createdAt,
    updatedAt: lobby.updatedAt
  };
}

function getLobbyOr404(res, lobbyId) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) {
    sendJson(res, 404, { ok: false, message: "Lobby not found." });
    return null;
  }
  if (!refreshLobbyPlayers(lobby)) {
    lobbies.delete(lobbyId);
    sendJson(res, 404, { ok: false, message: "Lobby is no longer active." });
    return null;
  }
  lobby.updatedAt = Date.now();
  return lobby;
}

async function handleApi(req, res, parsedUrl) {
  if (req.method === "OPTIONS") {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const pathname = parsedUrl.pathname || "/";
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 2 && segments[0] === "api" && segments[1] === "lobbies" && req.method === "GET") {
    const openLobbies = [];
    for (const [id, lobby] of lobbies.entries()) {
      if (!refreshLobbyPlayers(lobby)) {
        lobbies.delete(id);
        continue;
      }
      if (lobby.status !== "open") continue;
      openLobbies.push(lobbyPayload(lobby));
    }
    sendJson(res, 200, { ok: true, lobbies: openLobbies });
    return;
  }

  if (segments.length === 2 && segments[0] === "api" && segments[1] === "lobbies" && req.method === "POST") {
    const body = await parseBody(req);
    const lobbyId = makeId("lobby");
    const hostPlayerId = makeId("player");
    const room = sanitizeRoom(body.room);
    const hostCountryId = COUNTRY_IDS.has(body.countryId) ? body.countryId : "";
    const lobby = {
      id: lobbyId,
      room,
      hostPlayerId,
      status: "open",
      maxPlayers: normalizeMaxPlayers(body.maxPlayers),
      aiEnabled: body.aiEnabled !== false,
      settings: normalizeSettings(body.settings),
      players: [
        {
          id: hostPlayerId,
          name: sanitizeName(body.playerName),
          countryId: hostCountryId,
          ownerSlot: "player",
          joinedAt: Date.now(),
          lastSeen: Date.now()
        }
      ],
      activePlayerId: hostPlayerId,
      payloadVersion: 0,
      payload: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    lobbies.set(lobbyId, lobby);
    sendJson(res, 200, {
      ok: true,
      playerId: hostPlayerId,
      lobby: lobbyPayload(lobby)
    });
    return;
  }

  if (segments.length >= 3 && segments[0] === "api" && segments[1] === "lobbies") {
    const lobbyId = segments[2];
    const lobby = getLobbyOr404(res, lobbyId);
    if (!lobby) return;

    if (segments.length === 3 && req.method === "GET") {
      const playerId = parsedUrl.searchParams.get("playerId") || "";
      const since = parsedUrl.searchParams.get("since") || "0";
      if (playerId) {
        const player = findPlayer(lobby, playerId);
        if (player) {
          player.lastSeen = Date.now();
          lobby.updatedAt = Date.now();
        }
      }
      sendJson(res, 200, {
        ok: true,
        lobby: lobbyPayload(lobby, { includePayload: true, since })
      });
      return;
    }

    if (segments.length === 4 && segments[3] === "join" && req.method === "POST") {
      if (lobby.status !== "open") {
        sendJson(res, 409, { ok: false, message: "Match already started." });
        return;
      }
      if (lobby.players.length >= lobby.maxPlayers) {
        sendJson(res, 409, { ok: false, message: "Lobby is full." });
        return;
      }
      const body = await parseBody(req);
      const playerId = makeId("player");
      const desiredCountry = COUNTRY_IDS.has(body.countryId) ? body.countryId : "";
      const countryId = desiredCountry && !hasCountryConflict(lobby, desiredCountry) ? desiredCountry : "";
      const ownerSlot = allocateOwnerSlot(lobby);
      if (!ownerSlot) {
        sendJson(res, 409, { ok: false, message: "Lobby has no available commander slots." });
        return;
      }
      lobby.players.push({
        id: playerId,
        name: sanitizeName(body.playerName),
        countryId,
        ownerSlot,
        joinedAt: Date.now(),
        lastSeen: Date.now()
      });
      normalizeLobbyOwnerSlots(lobby);
      lobby.updatedAt = Date.now();
      sendJson(res, 200, {
        ok: true,
        playerId,
        lobby: lobbyPayload(lobby)
      });
      return;
    }

    if (segments.length === 4 && segments[3] === "leave" && req.method === "POST") {
      const body = await parseBody(req);
      const playerId = String(body.playerId || "");
      lobby.players = lobby.players.filter((entry) => entry.id !== playerId);
      if (playerId === lobby.hostPlayerId || lobby.players.length < 1) {
        lobbies.delete(lobby.id);
        sendJson(res, 200, { ok: true, removed: true });
        return;
      }
      if (!findPlayer(lobby, lobby.activePlayerId)) {
        lobby.activePlayerId = lobby.players[0].id;
      }
      lobby.updatedAt = Date.now();
      sendJson(res, 200, { ok: true, lobby: lobbyPayload(lobby) });
      return;
    }

    if (segments.length === 4 && segments[3] === "settings" && req.method === "POST") {
      const body = await parseBody(req);
      const playerId = String(body.playerId || "");
      if (playerId !== lobby.hostPlayerId) {
        sendJson(res, 403, { ok: false, message: "Only host can update settings." });
        return;
      }
      if (lobby.status !== "open") {
        sendJson(res, 409, { ok: false, message: "Cannot change settings after launch." });
        return;
      }
      const maxPlayers = normalizeMaxPlayers(body.maxPlayers);
      if (maxPlayers < lobby.players.length) {
        sendJson(res, 409, { ok: false, message: "Max players cannot be below joined players." });
        return;
      }
      lobby.maxPlayers = maxPlayers;
      lobby.aiEnabled = body.aiEnabled !== false;
      lobby.settings = normalizeSettings(body.settings);
      lobby.updatedAt = Date.now();
      sendJson(res, 200, { ok: true, lobby: lobbyPayload(lobby) });
      return;
    }

    if (segments.length === 4 && segments[3] === "select-country" && req.method === "POST") {
      const body = await parseBody(req);
      const playerId = String(body.playerId || "");
      const countryId = String(body.countryId || "");
      if (!COUNTRY_IDS.has(countryId)) {
        sendJson(res, 400, { ok: false, message: "Invalid country selection." });
        return;
      }
      const player = findPlayer(lobby, playerId);
      if (!player) {
        sendJson(res, 403, { ok: false, message: "Player is not in this lobby." });
        return;
      }
      if (hasCountryConflict(lobby, countryId, playerId)) {
        sendJson(res, 409, { ok: false, message: "Country already selected by another player." });
        return;
      }
      player.countryId = countryId;
      player.lastSeen = Date.now();
      lobby.updatedAt = Date.now();
      sendJson(res, 200, { ok: true, lobby: lobbyPayload(lobby) });
      return;
    }

    if (segments.length === 4 && segments[3] === "start" && req.method === "POST") {
      const body = await parseBody(req);
      const playerId = String(body.playerId || "");
      if (playerId !== lobby.hostPlayerId) {
        sendJson(res, 403, { ok: false, message: "Only host can launch the match." });
        return;
      }
      if (lobby.status !== "open") {
        sendJson(res, 409, { ok: false, message: "Match already started." });
        return;
      }
      if (lobby.players.length < 2) {
        sendJson(res, 409, { ok: false, message: "Need at least 2 players to start." });
        return;
      }
      if (lobby.players.some((entry) => !entry.countryId)) {
        sendJson(res, 409, { ok: false, message: "All players must pick a country first." });
        return;
      }
      if (!body.payload || typeof body.payload !== "object") {
        sendJson(res, 400, { ok: false, message: "Missing initial game payload." });
        return;
      }
      lobby.status = "started";
      lobby.payload = body.payload;
      lobby.payloadVersion = Math.max(1, lobby.payloadVersion + 1);
      lobby.activePlayerId = lobby.hostPlayerId;
      lobby.updatedAt = Date.now();
      sendJson(res, 200, { ok: true, lobby: lobbyPayload(lobby) });
      return;
    }

    if (segments.length === 4 && segments[3] === "handoff" && req.method === "POST") {
      const body = await parseBody(req);
      const playerId = String(body.playerId || "");
      if (lobby.status !== "started") {
        sendJson(res, 409, { ok: false, message: "Match has not started." });
        return;
      }
      if (playerId !== lobby.activePlayerId) {
        sendJson(res, 409, { ok: false, message: "It is not this player's turn." });
        return;
      }
      if (!body.payload || typeof body.payload !== "object") {
        sendJson(res, 400, { ok: false, message: "Missing handoff payload." });
        return;
      }
      lobby.payload = body.payload;
      lobby.payloadVersion += 1;
      lobby.activePlayerId = nextPlayerId(lobby, playerId);
      lobby.updatedAt = Date.now();
      sendJson(res, 200, { ok: true, lobby: lobbyPayload(lobby) });
      return;
    }
  }

  sendJson(res, 404, { ok: false, message: "API route not found." });
}

function serveStatic(req, res, parsedUrl) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  let requestPath = decodeURIComponent(parsedUrl.pathname || "/");
  if (requestPath === "/") requestPath = "/index.html";

  const absPath = path.resolve(ROOT_DIR, `.${requestPath}`);
  if (!absPath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(absPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentTypeForExt(path.extname(absPath).toLowerCase()) });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(absPath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (parsedUrl.pathname.startsWith("/api/")) {
      await handleApi(req, res, parsedUrl);
      return;
    }
    serveStatic(req, res, parsedUrl);
  } catch (error) {
    sendJson(res, 500, { ok: false, message: error?.message || "Unexpected server error." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Until Zero LAN server running on http://${HOST}:${PORT}`);
  console.log(`Serving files from: ${ROOT_DIR}`);
});
