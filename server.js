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
function createRoom(name, creatorColor) {
    const id = generateRoomId();
    const room = {
        id,
        name: name || `房间 ${id}`,
        players: [null, null],
        board: Array.from({ length: SIZE }, () => Array(SIZE).fill(0)),
        history: [], // Track moves for undo
        currentPlayer: 1, // BLACK first
        gameStarted: false,
        gameOver: false,
        hostColor: creatorColor === 'white' ? 2 : 1 // 1=BLACK, 2=WHITE
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
            hostColor: room.hostColor,
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

                const room = createRoom(msg.name, msg.color);
                const pIdx = room.hostColor === 1 ? 0 : 1; // 1->0(BLACK), 2->1(WHITE)
                room.players[pIdx] = ws;
                send(ws, {
                    type: 'room_created',
                    roomId: room.id,
                    roomName: room.name,
                    playerIndex: pIdx,
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
                room.history.push({ r, c, color });
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

            case 'request_undo': {
                const room = findRoom(ws);
                if (!room || !room.gameStarted || room.gameOver) break;
                // 转发给对方
                const opIdx = getPlayerIndex(room, ws) === 0 ? 1 : 0;
                const opponent = room.players[opIdx];
                if (opponent) {
                    send(opponent, { type: 'undo_requested' });
                }
                break;
            }

            case 'undo_response': {
                const room = findRoom(ws);
                if (!room || !room.gameStarted || room.gameOver) break;

                if (msg.approved && room.history.length > 0) {
                    // 撤销 history 最后一步
                    const last = room.history.pop();
                    room.board[last.r][last.c] = 0;

                    // 切换回上一个执棋者
                    room.currentPlayer = last.color;

                    broadcast(room, {
                        type: 'undo_executed',
                    });

                    broadcast(room, {
                        type: 'turn_change',
                        currentPlayer: room.currentPlayer,
                    });
                }

                // 通知请求者结果
                if (!msg.approved) {
                    const opIdx = getPlayerIndex(room, ws) === 0 ? 1 : 0;
                    const requester = room.players[opIdx];
                    if (requester) {
                        send(requester, { type: 'undo_response', approved: false });
                    }
                }
                break;
            }

            case 'request_undo': {
                const room = findRoom(ws);
                if (!room || !room.gameStarted || room.gameOver) break;
                // 转发给对方
                const opIdx = getPlayerIndex(room, ws) === 0 ? 1 : 0;
                const opponent = room.players[opIdx];
                if (opponent) {
                    send(opponent, { type: 'undo_requested' });
                }
                break;
            }

            case 'undo_response': {
                const room = findRoom(ws);
                if (!room || !room.gameStarted || room.gameOver) break;
                // 如果同意
                if (msg.approved) {
                    // 回退一步（双方各退一步，或者只退当前落子的人）
                    // 简单逻辑：撤销 history 中最后一步，并切换 currentPlayer
                    // 实际上通常悔棋是悔“两步”（回到自己回合），或者“一步”（回到对方回合）
                    // 这里简化：收到同意后，通知双方“触发悔棋”，客户端自己处理回退逻辑（或者服务器处理）

                    // 服务器端简单处理：假设悔一步（回到上一个人）
                    // 但通常请求悔棋的人是“刚落子的人”，所以现在的 currentPlayer 是对方
                    // 所以退一步，currentPlayer 变回 请求者

                    // 稍微复杂点：如果 history 保存了服务端状态
                    // 这里服务器只有 board，没有 history。
                    // 所以最好是广播“undo_executed”，让客户端自己 pop history 并重绘
                    // 但服务器 board 也得改。
                    // 鉴于 server.js 没存 history，很难精确回退 board。
                    // 方案：让客户端发回 undo 后的 board？不安全。
                    // 方案：服务器只负责转发 undo 指令，board 状态由客户端同步？不太好。
                    // 方案：服务器记录 history。

                    // 既然 server.js 目前也没校验 board 连贯性（只校验空位），
                    // 我们可以让客户端发送“我要撤销到哪一步”或者服务器增加 history 记录。
                    // 为了不改动太大：
                    // 我们给 server.js 增加简易 history 记录
                    // 或者：服务器只转发 undo_approved，客户端自己处理 UI，
                    // 下次落子时覆盖服务器 board。
                    // 因为 place_stone 会直接修改 board[r][c] = color
                    // 如果我们允许客户端 undo，客户端 board 变了，
                    // 再次落子时，服务器 board 那个旧位置还是有子的。
                    // 所以必须清除服务器 board 对应位置。

                    // 临时方案：request_undo 时，客户端把要清除的坐标发过来？
                    // 不，服务器应该记录。

                    // 让我们给 server.js 的 room 增加 history

                    // 重新根据 task 描述：
                    // "Update server.js to handle request_undo and undo_response"
                    // 我直接转发 undo_response 给 requester，并附带 "approved: true"
                    // 同时广播 "undo_executed"，带上要清除的坐标？

                    // 鉴于 server.js 现有代码没有 history，我将在 on place_stone 时记录 history。
                }

                const opIdx = getPlayerIndex(room, ws) === 0 ? 1 : 0;
                const requester = room.players[opIdx];
                if (requester) {
                    send(requester, { type: 'undo_response', approved: msg.approved });
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
