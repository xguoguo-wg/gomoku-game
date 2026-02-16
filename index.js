// ===== 五子棋 — 游戏引擎（人机 + 联机） =====
(function () {
  'use strict';

  // --- 常量 ---
  const SIZE = 15;
  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;
  const CELL_SIZE = 36;
  const PADDING = 24;
  const BOARD_PX = CELL_SIZE * (SIZE - 1) + PADDING * 2;
  const STONE_R = CELL_SIZE * 0.42;

  // --- DOM ---
  const canvas = document.getElementById('boardCanvas');
  const ctx = canvas.getContext('2d');
  const statusText = document.getElementById('statusText');
  const playerBlack = document.getElementById('playerBlack');
  const playerWhite = document.getElementById('playerWhite');
  const resultOverlay = document.getElementById('resultOverlay');
  const resultIcon = document.getElementById('resultIcon');
  const resultText = document.getElementById('resultText');
  const resultNewGame = document.getElementById('resultNewGame');
  const btnNewGame = document.getElementById('btnNewGame');
  const btnUndo = document.getElementById('btnUndo');
  const scorePlayer = document.getElementById('scorePlayer');
  const scoreDraw = document.getElementById('scoreDraw');
  const scoreAI = document.getElementById('scoreAI');
  const settingsOverlay = document.getElementById('settingsOverlay');
  const orderOptions = document.getElementById('orderOptions');
  const difficultyOptions = document.getElementById('difficultyOptions');
  const btnStartGame = document.getElementById('btnStartGame');
  const headerSubtitle = document.getElementById('headerSubtitle');
  const playerBlackLabel = playerBlack.querySelector('.status-bar__label');
  const playerWhiteLabel = playerWhite.querySelector('.status-bar__label');
  const scoreLabelLeft = document.getElementById('scoreLabelLeft');
  const scoreLabelRight = document.getElementById('scoreLabelRight');

  // 新 DOM
  const modeSelect = document.getElementById('modeSelect');
  const modeAI = document.getElementById('modeAI');
  const modeLAN = document.getElementById('modeLAN');
  const lobbyOverlay = document.getElementById('lobbyOverlay');
  const lobbyStatus = document.getElementById('lobbyStatus');
  const lobbyStatusDot = lobbyStatus.querySelector('.lobby-status__dot');
  const lobbyStatusText = lobbyStatus.querySelector('.lobby-status__text');
  const roomNameInput = document.getElementById('roomNameInput');
  const roomIdInput = document.getElementById('roomIdInput');
  const btnCreateRoom = document.getElementById('btnCreateRoom');
  const btnJoinRoom = document.getElementById('btnJoinRoom');
  const btnRefreshRooms = document.getElementById('btnRefreshRooms');
  const roomListEl = document.getElementById('roomList');
  const btnBackFromLobby = document.getElementById('btnBackFromLobby');
  const btnBackFromSettings = document.getElementById('btnBackFromSettings');
  const waitingOverlay = document.getElementById('waitingOverlay');
  const waitingRoomId = document.getElementById('waitingRoomId');
  const waitingRoomName = document.getElementById('waitingRoomName');
  const btnLeaveRoom = document.getElementById('btnLeaveRoom');
  const btnBackToMenu = document.getElementById('btnBackToMenu');
  const gameMain = document.getElementById('gameMain');
  const footerTip = document.getElementById('footerTip');

  // --- 游戏状态 ---
  let board = [];
  let history = [];
  let currentPlayer = BLACK;
  let gameOver = false;
  let aiThinking = false;
  let scores = { player: 0, draw: 0, ai: 0 };
  let winLine = null;

  // --- 设置 ---
  let playerColor = BLACK;
  let aiColor = WHITE;
  let difficulty = 'medium';
  const DIFF_CONFIG = {
    easy: { depth: 1, candidates: 12 },
    medium: { depth: 2, candidates: 20 },
    hard: { depth: 3, candidates: 25 }
  };

  // --- 模式 ---
  let gameMode = null; // 'ai' | 'lan'

  // --- 联机状态 ---
  let ws = null;
  let myPlayerIndex = -1; // 0=黑, 1=白
  let myColor = BLACK;
  let opponentColor = WHITE;
  let onlineRoomId = null;

  // --- DPR ---
  const dpr = window.devicePixelRatio || 1;

  // --- 离屏棋盘缓存 ---
  let boardBgCache = null;

  function initCanvas() {
    canvas.style.width = BOARD_PX + 'px';
    canvas.style.height = BOARD_PX + 'px';
    canvas.width = BOARD_PX * dpr;
    canvas.height = BOARD_PX * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    boardBgCache = null;
  }

  // --- 坐标转换 ---
  function toPixel(idx) { return PADDING + idx * CELL_SIZE; }
  function toIndex(px) {
    const idx = Math.round((px - PADDING) / CELL_SIZE);
    return idx >= 0 && idx < SIZE ? idx : -1;
  }

  // ===== 绘制 =====
  function buildBoardBgCache() {
    const offscreen = document.createElement('canvas');
    offscreen.width = BOARD_PX * dpr;
    offscreen.height = BOARD_PX * dpr;
    const oc = offscreen.getContext('2d');
    oc.setTransform(dpr, 0, 0, dpr, 0, 0);

    const grad = oc.createLinearGradient(0, 0, BOARD_PX, BOARD_PX);
    grad.addColorStop(0, '#d4a843');
    grad.addColorStop(0.5, '#c8a055');
    grad.addColorStop(1, '#b8903e');
    oc.fillStyle = grad;
    oc.fillRect(0, 0, BOARD_PX, BOARD_PX);

    oc.strokeStyle = 'rgba(60, 40, 10, 0.6)';
    oc.lineWidth = 1;
    for (let i = 0; i < SIZE; i++) {
      const p = toPixel(i);
      oc.beginPath(); oc.moveTo(PADDING, p); oc.lineTo(toPixel(SIZE - 1), p); oc.stroke();
      oc.beginPath(); oc.moveTo(p, PADDING); oc.lineTo(p, toPixel(SIZE - 1)); oc.stroke();
    }

    const stars = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11], [3, 7], [7, 3], [7, 11], [11, 7]];
    oc.fillStyle = 'rgba(60, 40, 10, 0.8)';
    for (const [r, c] of stars) {
      if (r < SIZE && c < SIZE) {
        oc.beginPath(); oc.arc(toPixel(c), toPixel(r), 3.5, 0, Math.PI * 2); oc.fill();
      }
    }
    boardBgCache = offscreen;
  }

  function drawBoard() {
    if (!boardBgCache) buildBoardBgCache();
    ctx.drawImage(boardBgCache, 0, 0, BOARD_PX, BOARD_PX);
  }

  function drawStone(r, c, color) {
    const x = toPixel(c);
    const y = toPixel(r);
    const radius = STONE_R;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (color === BLACK) {
      const g = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
      g.addColorStop(0, '#666'); g.addColorStop(0.6, '#222'); g.addColorStop(1, '#000');
      ctx.fillStyle = g;
    } else {
      const g = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
      g.addColorStop(0, '#fff'); g.addColorStop(0.7, '#eee'); g.addColorStop(1, '#ccc');
      ctx.fillStyle = g;
    }
    ctx.fill();
    ctx.restore();
  }

  function drawLastMoveMarker() {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    const x = toPixel(last.c);
    const y = toPixel(last.r);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ff6b6b';
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.restore();
  }

  function drawWinLine() {
    if (!winLine || winLine.length === 0) return;
    ctx.save();
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(toPixel(winLine[0].c), toPixel(winLine[0].r));
    for (let i = 1; i < winLine.length; i++) {
      ctx.lineTo(toPixel(winLine[i].c), toPixel(winLine[i].r));
    }
    ctx.stroke();
    for (const p of winLine) {
      ctx.beginPath();
      ctx.arc(toPixel(p.c), toPixel(p.r), STONE_R + 2, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  function render() {
    drawBoard();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] !== EMPTY) drawStone(r, c, board[r][c]);
      }
    }
    drawLastMoveMarker();
    drawWinLine();
  }

  // ===== 界面切换 =====
  function hideAll() {
    modeSelect.classList.remove('visible');
    settingsOverlay.classList.remove('visible');
    lobbyOverlay.classList.remove('visible');
    waitingOverlay.classList.remove('visible');
    gameMain.classList.remove('visible');
    resultOverlay.classList.remove('visible');
  }

  function showModeSelect() {
    hideAll();
    modeSelect.classList.add('visible');
    headerSubtitle.textContent = '选择游戏模式';
    // 断开 ws
    if (ws) { ws.close(); ws = null; }
  }

  function showAISettings() {
    hideAll();
    settingsOverlay.classList.add('visible');
  }

  function showLobby() {
    hideAll();
    lobbyOverlay.classList.add('visible');
    headerSubtitle.textContent = '联机大厅';
    connectWebSocket();
  }

  function showWaiting(roomId, roomName) {
    hideAll();
    waitingOverlay.classList.add('visible');
    waitingRoomId.textContent = roomId;
    waitingRoomName.textContent = roomName;
    headerSubtitle.textContent = '等待对手…';
  }

  function showGame() {
    hideAll();
    gameMain.classList.add('visible');
  }

  // ===== WebSocket 连接 =====
  function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      updateLobbyStatus('connected');
      wsSend({ type: 'list_rooms' });
      return;
    }

    updateLobbyStatus('connecting');

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      updateLobbyStatus('connected');
      wsSend({ type: 'list_rooms' });
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      handleServerMessage(msg);
    };

    ws.onclose = () => {
      updateLobbyStatus('disconnected');
      // 如果在游戏中断开
      if (gameMode === 'lan' && !gameOver) {
        statusText.textContent = '连接已断开';
      }
    };

    ws.onerror = () => {
      updateLobbyStatus('error');
    };
  }

  function wsSend(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function updateLobbyStatus(state) {
    lobbyStatusDot.classList.remove('connected', 'error');
    switch (state) {
      case 'connecting':
        lobbyStatusText.textContent = '连接中…';
        break;
      case 'connected':
        lobbyStatusDot.classList.add('connected');
        lobbyStatusText.textContent = '已连接';
        break;
      case 'disconnected':
        lobbyStatusDot.classList.add('error');
        lobbyStatusText.textContent = '连接断开';
        break;
      case 'error':
        lobbyStatusDot.classList.add('error');
        lobbyStatusText.textContent = '连接失败 — 请确认服务器已启动';
        break;
    }
  }

  // ===== 服务器消息处理 =====
  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'room_list':
        renderRoomList(msg.rooms);
        break;

      case 'room_created':
        onlineRoomId = msg.roomId;
        myPlayerIndex = msg.playerIndex;
        showWaiting(msg.roomId, msg.roomName);
        break;

      case 'room_joined':
        onlineRoomId = msg.roomId;
        myPlayerIndex = msg.playerIndex;
        // 等待游戏开始
        break;

      case 'game_start':
        myPlayerIndex = msg.playerIndex;
        myColor = msg.playerIndex === 0 ? BLACK : WHITE;
        opponentColor = myColor === BLACK ? WHITE : BLACK;
        startOnlineGame(msg);
        break;

      case 'stone_placed':
        onStonePlaced(msg);
        break;

      case 'turn_change':
        currentPlayer = msg.currentPlayer;
        updateOnlineStatus();
        break;

      case 'game_over':
        onGameOver(msg);
        break;

      case 'opponent_left':
        onOpponentLeft(msg);
        break;

      case 'new_game_requested':
        // 自动接受，服务器会发 game_start
        break;

      case 'left_room':
        onlineRoomId = null;
        break;

      case 'error':
        alert(msg.message);
        break;
    }
  }

  function renderRoomList(rooms) {
    if (!rooms || rooms.length === 0) {
      roomListEl.innerHTML = '<div class="lobby-empty">暂无房间</div>';
      return;
    }
    roomListEl.innerHTML = rooms
      .filter(r => !r.gameStarted) // 只显示可加入的房间
      .map(r => `
        <div class="lobby-room-item">
          <div class="lobby-room-item__info">
            <span class="lobby-room-item__name">${escHtml(r.name)}</span>
            <span class="lobby-room-item__id">ID: ${r.id}</span>
          </div>
          <span class="lobby-room-item__count">${r.playerCount}/2</span>
          <button class="btn btn--primary lobby-join-btn" data-room-id="${r.id}"
            ${r.playerCount >= 2 ? 'disabled' : ''}>加入</button>
        </div>
      `).join('');

    if (roomListEl.innerHTML.trim() === '') {
      roomListEl.innerHTML = '<div class="lobby-empty">暂无可加入房间</div>';
    }

    // 绑定加入按钮事件
    roomListEl.querySelectorAll('.lobby-join-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const roomId = btn.dataset.roomId;
        wsSend({ type: 'join_room', roomId });
      });
    });
  }

  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== 联机对战 =====
  function startOnlineGame(msg) {
    gameMode = 'lan';
    board = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
    history = [];
    currentPlayer = BLACK; // 黑先
    gameOver = false;
    aiThinking = false;
    winLine = null;
    scores = { player: 0, draw: 0, ai: 0 };

    // 更新 UI 标签
    if (myColor === BLACK) {
      playerBlackLabel.textContent = '你（黑棋）';
      playerWhiteLabel.textContent = '对手（白棋）';
    } else {
      playerBlackLabel.textContent = '对手（黑棋）';
      playerWhiteLabel.textContent = '你（白棋）';
    }
    headerSubtitle.textContent = `联机对战 · ${msg.roomName} · 你执${myColor === BLACK ? '黑' : '白'}`;
    scoreLabelLeft.textContent = '你';
    scoreLabelRight.textContent = '对手';
    footerTip.textContent = '联机对战中 · 点击棋盘交叉点落子';
    btnUndo.style.display = 'none'; // 联机模式隐藏悔棋

    showGame();
    updateOnlineStatus();
    updateScores();
    render();
  }

  function updateOnlineStatus() {
    if (gameOver) return;
    const isMyTurn = currentPlayer === myColor;
    statusText.textContent = isMyTurn ? '轮到你落子' : '等待对手落子…';
    playerBlack.classList.toggle('active', currentPlayer === BLACK);
    playerWhite.classList.toggle('active', currentPlayer === WHITE);
  }

  function onStonePlaced(msg) {
    board[msg.r][msg.c] = msg.color;
    history.push({ r: msg.r, c: msg.c, color: msg.color });
    render();
  }

  function onGameOver(msg) {
    gameOver = true;

    // 找出获胜连线（本地检测，用于显示）
    if (msg.winner >= 0 && history.length > 0) {
      const last = history[history.length - 1];
      const wl = checkWin(last.r, last.c, last.color);
      if (wl) {
        winLine = wl;
        render();
      }
    }

    if (msg.winner === myPlayerIndex) {
      resultIcon.textContent = '🎉';
      resultText.textContent = '你赢了！';
      scores.player++;
      popScore(scorePlayer);
      statusText.textContent = '你赢了！';
    } else if (msg.winner === -1) {
      resultIcon.textContent = '🤝';
      resultText.textContent = '平局！';
      scores.draw++;
      popScore(scoreDraw);
      statusText.textContent = '平局！';
    } else {
      resultIcon.textContent = '😔';
      resultText.textContent = '你输了！';
      scores.ai++;
      popScore(scoreAI);
      statusText.textContent = '你输了！';
    }
    updateScores();
    setTimeout(() => resultOverlay.classList.add('visible'), 400);
  }

  function onOpponentLeft(msg) {
    if (gameMode === 'lan') {
      gameOver = true;
      statusText.textContent = '对手已离开';
      resultIcon.textContent = '🚪';
      resultText.textContent = '对手已离开';
      setTimeout(() => resultOverlay.classList.add('visible'), 400);
    }
  }

  // ===== AI 游戏逻辑（保留原有） =====
  function showSettings() {
    showAISettings();
  }

  function startGame() {
    gameMode = 'ai';
    const orderSel = orderOptions.querySelector('.settings-opt.active');
    const diffSel = difficultyOptions.querySelector('.settings-opt.active');
    playerColor = (orderSel && orderSel.dataset.value === 'white') ? WHITE : BLACK;
    aiColor = playerColor === BLACK ? WHITE : BLACK;
    difficulty = diffSel ? diffSel.dataset.value : 'medium';

    const diffLabel = { easy: '简单', medium: '中等', hard: '困难' }[difficulty];
    headerSubtitle.textContent = `人机对弈 · ${playerColor === BLACK ? '执黑先行' : '执白后手'} · ${diffLabel}`;
    if (playerColor === BLACK) {
      playerBlackLabel.textContent = '你（黑棋）';
      playerWhiteLabel.textContent = 'AI（白棋）';
    } else {
      playerBlackLabel.textContent = 'AI（黑棋）';
      playerWhiteLabel.textContent = '你（白棋）';
    }
    scoreLabelLeft.textContent = '你';
    scoreLabelRight.textContent = 'AI';
    footerTip.textContent = '点击棋盘交叉点落子 · AI 思考中请稍候';
    btnUndo.style.display = '';

    showGame();
    newGame();
  }

  function newGame() {
    board = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
    history = [];
    currentPlayer = BLACK;
    gameOver = false;
    aiThinking = false;
    winLine = null;
    resultOverlay.classList.remove('visible');
    updateStatus();
    render();

    if (gameMode === 'ai' && aiColor === BLACK) {
      currentPlayer = BLACK;
      aiMove();
    }
  }

  function placeStone(r, c, color) {
    board[r][c] = color;
    history.push({ r, c, color });
  }

  function updateStatus() {
    if (gameOver) return;
    if (gameMode === 'lan') {
      updateOnlineStatus();
      return;
    }
    const isPlayerTurn = currentPlayer === playerColor;
    statusText.textContent = isPlayerTurn ? '轮到你落子' : 'AI 思考中…';
    playerBlack.classList.toggle('active', currentPlayer === BLACK);
    playerWhite.classList.toggle('active', currentPlayer === WHITE);
    btnUndo.disabled = history.length < 2 || aiThinking || gameOver;
  }

  function updateScores() {
    scorePlayer.textContent = scores.player;
    scoreAI.textContent = scores.ai;
    scoreDraw.textContent = scores.draw;
  }

  function popScore(el) {
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  // --- 胜负检测 ---
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  function checkWin(r, c, color) {
    for (const [dr, dc] of DIRS) {
      const line = [{ r, c }];
      for (let i = 1; i < 5; i++) {
        const nr = r + dr * i, nc = c + dc * i;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || board[nr][nc] !== color) break;
        line.push({ r: nr, c: nc });
      }
      for (let i = 1; i < 5; i++) {
        const nr = r - dr * i, nc = c - dc * i;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || board[nr][nc] !== color) break;
        line.push({ r: nr, c: nc });
      }
      if (line.length >= 5) {
        line.sort((a, b) => a.r !== b.r ? a.r - b.r : a.c - b.c);
        return line;
      }
    }
    return null;
  }

  function isBoardFull() {
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        if (board[r][c] === EMPTY) return false;
    return true;
  }

  function showResult(winner) {
    gameOver = true;
    if (winner === playerColor) {
      resultIcon.textContent = '🎉';
      resultText.textContent = '你赢了！';
      scores.player++;
      popScore(scorePlayer);
    } else if (winner === aiColor) {
      resultIcon.textContent = '🤖';
      resultText.textContent = 'AI 赢了！';
      scores.ai++;
      popScore(scoreAI);
    } else {
      resultIcon.textContent = '🤝';
      resultText.textContent = '平局！';
      scores.draw++;
      popScore(scoreDraw);
    }
    updateScores();
    statusText.textContent = winner === playerColor ? '你赢了！' : winner === aiColor ? 'AI 赢了！' : '平局！';
    btnUndo.disabled = true;
    setTimeout(() => resultOverlay.classList.add('visible'), 400);
  }

  // ===== AI =====
  function patternScore(count, openEnds, isAI) {
    if (count >= 5) return 1000000;
    if (count === 4) {
      if (openEnds === 2) return isAI ? 100000 : 90000;
      if (openEnds === 1) return isAI ? 8000 : 7000;
    }
    if (count === 3) {
      if (openEnds === 2) return isAI ? 5000 : 4500;
      if (openEnds === 1) return isAI ? 500 : 400;
    }
    if (count === 2) {
      if (openEnds === 2) return isAI ? 300 : 250;
      if (openEnds === 1) return isAI ? 30 : 25;
    }
    if (count === 1) {
      if (openEnds === 2) return 10;
      if (openEnds === 1) return 2;
    }
    return 0;
  }

  function evaluateLine(r, c, dr, dc, color) {
    let count = 1, openEnds = 0, i = 1;
    while (true) {
      const nr = r + dr * i, nc = c + dc * i;
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) break;
      if (board[nr][nc] === color) { count++; i++; }
      else { if (board[nr][nc] === EMPTY) openEnds++; break; }
    }
    i = 1;
    while (true) {
      const nr = r - dr * i, nc = c - dc * i;
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) break;
      if (board[nr][nc] === color) { count++; i++; }
      else { if (board[nr][nc] === EMPTY) openEnds++; break; }
    }
    return patternScore(count, openEnds, color === aiColor);
  }

  function evaluatePoint(r, c, color) {
    let score = 0;
    for (const [dr, dc] of DIRS) score += evaluateLine(r, c, dr, dc, color);
    return score;
  }

  function evaluateBoard() {
    let score = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === aiColor) score += evaluatePoint(r, c, aiColor);
        else if (board[r][c] === playerColor) score -= evaluatePoint(r, c, playerColor);
      }
    }
    return score;
  }

  function getCandidates() {
    const cands = [];
    const visited = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
    const RANGE = 2;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] !== EMPTY) {
          for (let dr = -RANGE; dr <= RANGE; dr++) {
            for (let dc = -RANGE; dc <= RANGE; dc++) {
              const nr = r + dr, nc = c + dc;
              if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === EMPTY && !visited[nr][nc]) {
                visited[nr][nc] = true;
                const s = evaluatePoint(nr, nc, aiColor) + evaluatePoint(nr, nc, playerColor);
                cands.push({ r: nr, c: nc, s });
              }
            }
          }
        }
      }
    }
    cands.sort((a, b) => b.s - a.s);
    const cfg = DIFF_CONFIG[difficulty] || DIFF_CONFIG.medium;
    return cands.slice(0, cfg.candidates);
  }

  function minimax(depth, alpha, beta, isMaximizing) {
    if (depth === 0) return evaluateBoard();
    const cands = getCandidates();
    if (cands.length === 0) return evaluateBoard();
    if (isMaximizing) {
      let maxEval = -Infinity;
      for (const { r, c } of cands) {
        board[r][c] = aiColor;
        const win = checkWin(r, c, aiColor);
        let evalScore = win ? 10000000 + depth : minimax(depth - 1, alpha, beta, false);
        board[r][c] = EMPTY;
        maxEval = Math.max(maxEval, evalScore);
        alpha = Math.max(alpha, evalScore);
        if (beta <= alpha) break;
      }
      return maxEval;
    } else {
      let minEval = Infinity;
      for (const { r, c } of cands) {
        board[r][c] = playerColor;
        const win = checkWin(r, c, playerColor);
        let evalScore = win ? -10000000 - depth : minimax(depth - 1, alpha, beta, true);
        board[r][c] = EMPTY;
        minEval = Math.min(minEval, evalScore);
        beta = Math.min(beta, evalScore);
        if (beta <= alpha) break;
      }
      return minEval;
    }
  }

  function aiMove() {
    aiThinking = true;
    updateStatus();
    setTimeout(() => {
      if (history.length <= 1) {
        const center = Math.floor(SIZE / 2);
        if (board[center][center] === EMPTY) { finishAiMove(center, center); return; }
        for (let d = 1; d <= 2; d++) {
          for (let dr = -d; dr <= d; dr++) {
            for (let dc = -d; dc <= d; dc++) {
              const nr = center + dr, nc = center + dc;
              if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === EMPTY) {
                finishAiMove(nr, nc); return;
              }
            }
          }
        }
      }
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (board[r][c] === EMPTY) {
            board[r][c] = aiColor;
            if (checkWin(r, c, aiColor)) { board[r][c] = EMPTY; finishAiMove(r, c); return; }
            board[r][c] = EMPTY;
          }
        }
      }
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (board[r][c] === EMPTY) {
            board[r][c] = playerColor;
            if (checkWin(r, c, playerColor)) { board[r][c] = EMPTY; finishAiMove(r, c); return; }
            board[r][c] = EMPTY;
          }
        }
      }
      const cands = getCandidates();
      if (cands.length === 0) { finishAiMove(Math.floor(SIZE / 2), Math.floor(SIZE / 2)); return; }
      let bestScore = -Infinity, bestMove = cands[0];
      const cfg = DIFF_CONFIG[difficulty] || DIFF_CONFIG.medium;
      for (const { r, c } of cands) {
        board[r][c] = aiColor;
        const score = minimax(cfg.depth - 1, -Infinity, Infinity, false);
        board[r][c] = EMPTY;
        if (score > bestScore) { bestScore = score; bestMove = { r, c }; }
      }
      finishAiMove(bestMove.r, bestMove.c);
    }, 200);
  }

  function finishAiMove(r, c) {
    placeStone(r, c, aiColor);
    render();
    const wl = checkWin(r, c, aiColor);
    if (wl) { winLine = wl; render(); showResult(aiColor); }
    else if (isBoardFull()) { showResult(null); }
    else { currentPlayer = playerColor; updateStatus(); }
    aiThinking = false;
    btnUndo.disabled = history.length < 2 || gameOver;
  }

  // ===== 点击事件 =====
  canvas.addEventListener('click', (e) => {
    if (gameOver) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const c = toIndex(x);
    const r = toIndex(y);
    if (r < 0 || c < 0 || board[r][c] !== EMPTY) return;

    if (gameMode === 'lan') {
      // 联机模式：只在自己的回合落子
      if (currentPlayer !== myColor) return;
      wsSend({ type: 'place_stone', r, c });
      return;
    }

    // AI 模式
    if (aiThinking || currentPlayer !== playerColor) return;
    placeStone(r, c, playerColor);
    render();
    const wl = checkWin(r, c, playerColor);
    if (wl) { winLine = wl; render(); showResult(playerColor); return; }
    if (isBoardFull()) { showResult(null); return; }
    currentPlayer = aiColor;
    updateStatus();
    aiMove();
  });

  // 悬浮预览
  canvas.addEventListener('mousemove', (e) => {
    if (gameOver) { canvas.style.cursor = 'default'; return; }

    if (gameMode === 'lan') {
      if (currentPlayer !== myColor) { canvas.style.cursor = 'default'; return; }
    } else {
      if (aiThinking || currentPlayer !== playerColor) { canvas.style.cursor = 'default'; return; }
    }

    const rect = canvas.getBoundingClientRect();
    const c = toIndex(e.clientX - rect.left);
    const r = toIndex(e.clientY - rect.top);
    if (r >= 0 && c >= 0 && board[r][c] === EMPTY) {
      canvas.style.cursor = 'pointer';
      render();
      const px = toPixel(c), py = toPixel(r);
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(px, py, STONE_R, 0, Math.PI * 2);
      const previewColor = gameMode === 'lan' ? myColor : playerColor;
      const g = ctx.createRadialGradient(px - STONE_R * 0.3, py - STONE_R * 0.3, STONE_R * 0.1, px, py, STONE_R);
      if (previewColor === BLACK) {
        g.addColorStop(0, '#555'); g.addColorStop(1, '#000');
      } else {
        g.addColorStop(0, '#fff'); g.addColorStop(1, '#ccc');
      }
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
    } else {
      canvas.style.cursor = 'default';
    }
  });

  canvas.addEventListener('mouseleave', () => { if (!gameOver) render(); });

  // ===== 按钮事件 =====

  // 模式选择
  modeAI.addEventListener('click', showAISettings);
  modeLAN.addEventListener('click', showLobby);

  // 设置面板
  function setupOptionGroup(container) {
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.settings-opt');
      if (!btn) return;
      container.querySelectorAll('.settings-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  }
  setupOptionGroup(orderOptions);
  setupOptionGroup(difficultyOptions);

  btnStartGame.addEventListener('click', startGame);
  btnBackFromSettings.addEventListener('click', showModeSelect);

  // 联机大厅
  btnCreateRoom.addEventListener('click', () => {
    const name = roomNameInput.value.trim();
    wsSend({ type: 'create_room', name });
  });

  btnJoinRoom.addEventListener('click', () => {
    const roomId = roomIdInput.value.trim();
    if (!roomId) { alert('请输入房间 ID'); return; }
    wsSend({ type: 'join_room', roomId });
  });

  btnRefreshRooms.addEventListener('click', () => {
    wsSend({ type: 'list_rooms' });
  });

  btnBackFromLobby.addEventListener('click', showModeSelect);

  // 等待页面
  btnLeaveRoom.addEventListener('click', () => {
    wsSend({ type: 'leave_room' });
    showLobby();
  });

  // 游戏中按钮
  btnNewGame.addEventListener('click', () => {
    if (gameMode === 'lan') {
      wsSend({ type: 'request_new_game' });
    } else {
      showAISettings();
    }
  });

  resultNewGame.addEventListener('click', () => {
    if (gameMode === 'lan') {
      wsSend({ type: 'request_new_game' });
      resultOverlay.classList.remove('visible');
    } else {
      showAISettings();
    }
  });

  btnUndo.addEventListener('click', () => {
    if (gameMode === 'lan') return; // 联机不允许悔棋
    if (history.length < 2 || aiThinking || gameOver) return;
    const last1 = history.pop();
    board[last1.r][last1.c] = EMPTY;
    const last2 = history.pop();
    board[last2.r][last2.c] = EMPTY;
    winLine = null;
    currentPlayer = playerColor;
    updateStatus();
    render();
  });

  btnBackToMenu.addEventListener('click', () => {
    if (gameMode === 'lan') {
      wsSend({ type: 'leave_room' });
    }
    scores = { player: 0, draw: 0, ai: 0 };
    updateScores();
    showModeSelect();
  });

  // --- 初始化 ---
  initCanvas();
  render();
  updateScores();
  showModeSelect();
})();
