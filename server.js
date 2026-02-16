// ===== 五子棋 — 局域网联机服务器 =====
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const SIZE = 15;

// --- MIME 类型 ---
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
};

// --- HTTP 静态文件服务 ---
const httpServer = http.createServer((req, res) => {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, filePath);
    const ext = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
    });
});

// --- WebSocket 服务 ---
const wss = new WebSocketServer({ server: httpServer });

// --- 房间管理 ---
const rooms = new Map(); // roomId -> Room
let roomIdCounter = 1000;

function generateRoomId() {
    roomIdCounter++;
    return String(roomIdCounter);
}

/**
 * Room:
 * {
 *   id: string,
 *   name: string,
 *   players: [ws, ws],  // [黑棋, 白棋]
 *   board: number[][],
 *   currentPlayer: 1|2, // BLACK=1, WHITE=2
 *   gameStarted: boolean,
 *   gameOver: boolean,
 * }
 */
function createRoom(name) {
    const id = generateRoomId();
    const room = {
        id,
        name: name || `房间 ${id}`,
        players: [null, null],
        board: Array.from({ length: SIZE }, () => Array(SIZE).fill(0)),
        currentPlayer: 1, // BLACK first
        gameStarted: false,
        gameOver: false,
    };
    rooms.set(id, room);
    return room;
}

function getRoomList() {
    const list = [];
    for (const [id, room] of rooms) {
        const playerCount = room.players.filter(p => p !== null).length;
        list.push({
            id: room.id,
            name: room.name,
            playerCount,
            gameStarted: room.gameStarted,
        });
    }
    return list;
}

function getPlayerIndex(room, ws) {
    return room.players.indexOf(ws);
}

function send(ws, msg) {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(msg));
    }
}

function broadcast(room, msg) {
    for (const p of room.players) {
        send(p, msg);
    }
}

// --- 胜负检测（服务器端验证） ---
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

function checkWin(board, r, c, color) {
    for (const [dr, dc] of DIRS) {
        let count = 1;
        for (let i = 1; i < 5; i++) {
            const nr = r + dr * i, nc = c + dc * i;
            if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || board[nr][nc] !== color) break;
            count++;
        }
        for (let i = 1; i < 5; i++) {
            const nr = r - dr * i, nc = c - dc * i;
            if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || board[nr][nc] !== color) break;
            count++;
        }
        if (count >= 5) return true;
    }
    return false;
}

function isBoardFull(board) {
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (board[r][c] === 0) return false;
    return true;
}

// --- 清理断开的玩家 ---
function handleDisconnect(ws) {
    for (const [id, room] of rooms) {
        const idx = getPlayerIndex(room, ws);
        if (idx === -1) continue;

        room.players[idx] = null;
        const remaining = room.players.filter(p => p !== null);

        if (remaining.length === 0) {
            // 无人，删除房间
            rooms.delete(id);
        } else {
            // 通知对手
            broadcast(room, {
                type: 'opponent_left',
                message: '对手已断开连接',
            });
            // 回到等待状态
            room.gameStarted = false;
            room.gameOver = true;
        }
        break;
    }
    // 广播房间列表更新
    broadcastRoomList();
}

function broadcastRoomList() {
    const list = getRoomList();
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(JSON.stringify({ type: 'room_list', rooms: list }));
        }
    });
}

// --- 消息处理 ---
wss.on('connection', (ws) => {
    console.log('新连接');

    ws.on('message', (data) => {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch (e) {
            return;
        }

        switch (msg.type) {
            case 'list_rooms': {
                send(ws, { type: 'room_list', rooms: getRoomList() });
                break;
            }

            case 'create_room': {
                // 先离开已有房间
                leaveAllRooms(ws);

                const room = createRoom(msg.name);
                room.players[0] = ws; // 房主执黑
                send(ws, {
                    type: 'room_created',
                    roomId: room.id,
                    roomName: room.name,
                    playerIndex: 0, // 黑棋
                });
                broadcastRoomList();
                break;
            }

            case 'join_room': {
                const room = rooms.get(msg.roomId);
                if (!room) {
                    send(ws, { type: 'error', message: '房间不存在' });
                    break;
                }
                // 检查是否已在该房间
                if (room.players.includes(ws)) {
                    send(ws, { type: 'error', message: '你已在该房间中' });
                    break;
                }
                // 找空位
                const slot = room.players.indexOf(null);
                if (slot === -1) {
                    send(ws, { type: 'error', message: '房间已满' });
                    break;
                }

                leaveAllRooms(ws);
                room.players[slot] = ws;
                send(ws, {
                    type: 'room_joined',
                    roomId: room.id,
                    roomName: room.name,
                    playerIndex: slot,
                });

                // 如果两人齐了，自动开始
                if (room.players[0] && room.players[1]) {
                    startGameInRoom(room);
                }
                broadcastRoomList();
                break;
            }

            case 'leave_room': {
                leaveAllRooms(ws);
                send(ws, { type: 'left_room' });
                broadcastRoomList();
                break;
            }

            case 'place_stone': {
                const room = findRoom(ws);
                if (!room || !room.gameStarted || room.gameOver) break;

                const pIdx = getPlayerIndex(room, ws);
                const color = pIdx + 1; // 0->BLACK(1), 1->WHITE(2)

                // 验证是否轮到该玩家
                if (color !== room.currentPlayer) {
                    send(ws, { type: 'error', message: '还没轮到你' });
                    break;
                }

                const { r, c } = msg;
                if (r < 0 || r >= SIZE || c < 0 || c >= SIZE || room.board[r][c] !== 0) {
                    send(ws, { type: 'error', message: '无效落子' });
                    break;
                }

                room.board[r][c] = color;
                broadcast(room, {
                    type: 'stone_placed',
                    r,
                    c,
                    color,
                    playerIndex: pIdx,
                });

                // 检查胜负
                if (checkWin(room.board, r, c, color)) {
                    room.gameOver = true;
                    broadcast(room, {
                        type: 'game_over',
                        winner: pIdx,
                        winnerColor: color,
                    });
                } else if (isBoardFull(room.board)) {
                    room.gameOver = true;
                    broadcast(room, {
                        type: 'game_over',
                        winner: -1, // 平局
                    });
                } else {
                    room.currentPlayer = color === 1 ? 2 : 1;
                    broadcast(room, {
                        type: 'turn_change',
                        currentPlayer: room.currentPlayer,
                    });
                }
                break;
            }

            case 'request_new_game': {
                const room = findRoom(ws);
                if (!room) break;

                // 通知对方请求重新开局
                const opIdx = getPlayerIndex(room, ws) === 0 ? 1 : 0;
                const opponent = room.players[opIdx];
                if (opponent) {
                    send(opponent, { type: 'new_game_requested' });
                }
                // 简化：直接重开
                if (room.players[0] && room.players[1]) {
                    startGameInRoom(room);
                }
                break;
            }
        }
    });

    ws.on('close', () => {
        console.log('连接断开');
        handleDisconnect(ws);
    });
});

function leaveAllRooms(ws) {
    for (const [id, room] of rooms) {
        const idx = getPlayerIndex(room, ws);
        if (idx === -1) continue;

        room.players[idx] = null;
        const remaining = room.players.filter(p => p !== null);

        if (remaining.length === 0) {
            rooms.delete(id);
        } else {
            broadcast(room, {
                type: 'opponent_left',
                message: '对手已离开房间',
            });
            room.gameStarted = false;
            room.gameOver = true;
        }
    }
}

function findRoom(ws) {
    for (const [id, room] of rooms) {
        if (room.players.includes(ws)) return room;
    }
    return null;
}

function startGameInRoom(room) {
    room.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    room.currentPlayer = 1;
    room.gameStarted = true;
    room.gameOver = false;

    for (let i = 0; i < 2; i++) {
        send(room.players[i], {
            type: 'game_start',
            playerIndex: i,
            currentPlayer: 1,
            roomName: room.name,
        });
    }
}

// --- 启动 ---
httpServer.listen(PORT, '0.0.0.0', () => {
    // 获取本机 IP
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let localIP = 'localhost';
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                localIP = iface.address;
                break;
            }
        }
    }
    console.log(`\n===== 五子棋服务器已启动 =====`);
    console.log(`本机访问: http://localhost:${PORT}`);
    console.log(`局域网访问: http://${localIP}:${PORT}`);
    console.log(`==============================\n`);
});
