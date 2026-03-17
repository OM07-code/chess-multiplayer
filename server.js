require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const AWS = require('aws-sdk');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===================== AWS S3 SETUP =====================
const s3 = new AWS.S3({
  region: process.env.AWS_REGION || 'ap-south-1', 
  ...(process.env.AWS_ACCESS_KEY_ID && {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  })
});

const BUCKET = process.env.S3_BUCKET || 'chessmaster-data-bucket';

// Helper: safe S3 get (returns null if not found)
async function s3Get(key) {
  try {
    const obj = await s3.getObject({ Bucket: BUCKET, Key: key }).promise();
    return JSON.parse(obj.Body.toString());
  } catch (e) { return null; }
}

// Helper: S3 put JSON
async function s3Put(key, data) {
  await s3.putObject({
    Bucket: BUCKET, Key: key,
    Body: JSON.stringify(data),
    ContentType: 'application/json'
  }).promise();
}

// Helper: Get Username -> ID Mapping
async function getUserMap() {
  const map = await s3Get('user_map.json');
  return map || {}; 
}

// ===================== REST API =====================

// 1. Load profile by USERNAME 
app.get('/api/user/by-name/:username', async (req, res) => {
  try {
    const userMap = await getUserMap();
    const userId = userMap[req.params.username];

    if (!userId) return res.status(404).json({ error: 'Username not found' });

    const userData = await s3Get(`users/${userId}.json`);
    res.json(userData);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. Save profile + Update Lookup Map
app.post('/api/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { username } = req.body;

    await s3Put(`users/${userId}.json`, { ...req.body, updatedAt: new Date().toISOString() });

    const userMap = await getUserMap();
    userMap[username] = userId; 
    await s3Put('user_map.json', userMap);

    console.log(`✅ Profile Saved & Map Updated: ${username} -> ${userId}`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. Save game replay
app.post('/api/replay', async (req, res) => {
  const gameId = uuidv4();
  try {
    await s3Put(`replays/${gameId}.json`, { gameId, ...req.body, savedAt: new Date().toISOString() });
    console.log(`🎬 Replay saved: ${gameId}`);
    res.json({ gameId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. Update Leaderboard (With In-Memory Write Queue)
let leaderboardLock = false;
const leaderboardQueue = [];

async function processLeaderboardQueue() {
  if (leaderboardQueue.length === 0) { leaderboardLock = false; return; }
  leaderboardLock = true;
  
  const { req, res } = leaderboardQueue.shift();
  try {
    let board = (await s3Get('leaderboard.json')) || [];
    const { userId, username, wins = 0, losses = 0, draws = 0 } = req.body;
    
    const idx = board.findIndex(p => p.userId === userId);
    const rating = Math.max(800, 1200 + wins * 15 - losses * 12 + draws * 3);
    const entry = { userId, username, wins, losses, draws, rating: Math.floor(rating) };
    
    idx >= 0 ? (board[idx] = entry) : board.push(entry);
    board.sort((a, b) => b.rating - a.rating);
    
    await s3Put('leaderboard.json', board);
    res.json({ success: true, rank: board.findIndex(p => p.userId === userId) + 1 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
  
  processLeaderboardQueue();
}

app.post('/api/leaderboard', (req, res) => {
  leaderboardQueue.push({ req, res });
  if (!leaderboardLock) processLeaderboardQueue();
});

// 5. Fetch Lists (Leaderboard & Replays)
app.get('/api/leaderboard', async (req, res) => {
  const data = await s3Get('leaderboard.json');
  res.json(data || []);
});

app.get('/api/replays', async (req, res) => {
  try {
    const results = [];
    let token;
    do {
      const resp = await s3.listObjectsV2({
        Bucket: BUCKET, 
        Prefix: 'replays/',
        ...(token && { ContinuationToken: token })
      }).promise();
      
      results.push(...(resp.Contents || []));
      token = resp.IsTruncated ? resp.NextContinuationToken : null;
    } while (token);

    res.json(results.map(o => ({
      gameId: o.Key.replace('replays/', '').replace('.json', ''),
      date: o.LastModified
    })));
  } catch (e) { res.json([]); }
});

// Health Check
app.get('/health', (req, res) => res.json({ status: 'live', bucket: BUCKET }));


// ===================== WEBSOCKET — MULTIPLAYER =====================
const rooms = new Map();

io.on('connection', socket => {
  console.log(`🔌 Client connected: ${socket.id}`);

  socket.on('ping_check', () => socket.emit('pong_check'));

  socket.on('create_room', async ({ roomId, username }) => {
    if (rooms.has(roomId)) return socket.emit('room_error', 'Room occupied');
    
    const newRoom = { 
      roomId,
      players: [{ id: socket.id, username, color: 'w' }],
      currentTurn: 'w',
      moves: [],
      createdAt: Date.now()
    };
    
    rooms.set(roomId, newRoom);
    socket.join(roomId);
    socket.emit('room_created', { color: 'w', roomId });
    
    s3Put(`rooms/${roomId}.json`, newRoom).catch(console.error);
  });

  socket.on('join_room', async ({ roomId, username }) => {
    let room = rooms.get(roomId);
    
    if (!room) {
       room = await s3Get(`rooms/${roomId}.json`);
       if(room) rooms.set(roomId, room);
    }
    
    if (!room) return socket.emit('room_error', 'Room not found');
    if (room.players.length >= 2) return socket.emit('room_error', 'Room full');
    
    room.players.push({ id: socket.id, username, color: 'b' });
    socket.join(roomId);
    socket.emit('room_joined', { color: 'b', roomId });
    
    io.to(roomId).emit('game_start', {
      white: room.players[0].username,
      black: room.players[1].username
    });

    s3Put(`rooms/${roomId}.json`, room).catch(console.error);
  });

  socket.on('rejoin_room', async ({ roomId, username }) => {
     let roomData = await s3Get(`rooms/${roomId}.json`);
     if (!roomData) return socket.emit('room_error', 'Room expired');
     
     const player = roomData.players.find(p => p.username === username);
     if (!player) return socket.emit('room_error', 'Not in this room');
     
     player.id = socket.id; 
     rooms.set(roomId, roomData); 
     socket.join(roomId);
  });

  socket.on('move', ({ roomId, move }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.color !== room.currentTurn) {
      console.log(`❌ Rejected move from ${player ? player.username : 'Unknown'} in room ${roomId} (Not their turn)`);
      return socket.emit('move_rejected', { reason: 'Not your turn' });
    }

    room.moves.push(move);
    room.currentTurn = room.currentTurn === 'w' ? 'b' : 'w';
    
    socket.to(roomId).emit('opponent_move', move);
    s3Put(`rooms/${roomId}.json`, room).catch(console.error);
  });

  // --- MISSING SYNC FIXES ADDED HERE ---
  socket.on('offer_draw', ({ roomId }) => {
    socket.to(roomId).emit('draw_offered');
  });

  socket.on('accept_draw', ({ roomId }) => {
    io.to(roomId).emit('game_over_mp', { reason: 'draw' });
    rooms.delete(roomId);
  });

  socket.on('resign', ({ roomId }) => {
    socket.to(roomId).emit('game_over_mp', { reason: 'resign' });
    rooms.delete(roomId);
  });
  // -------------------------------------

  socket.on('disconnect', () => {
    for (const [roomId, room] of rooms.entries()) {
      const p = room.players.find(p => p.id === socket.id);
      if (p) {
        socket.to(roomId).emit('opponent_disconnected', { username: p.username });
        rooms.delete(roomId); 
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server live at http://localhost:${PORT}`);
  console.log(`📂 AWS S3 Target: ${BUCKET}\n`);
});