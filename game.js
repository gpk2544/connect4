// game.js
import { ref, update, onValue, remove, get } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js";

// --- Constants ---
const ROWS = 6;
const COLS = 7;
const EMPTY = 0;
const PLAYER_1 = 1; // Red - Host starts
const PLAYER_2 = 2; // Yellow

// --- State ---
let roomId;
let playerId;
let myPlayerNumber; 
let playerIds = []; // [P1_ID, P2_ID]

// --- DOM Elements ---
const boardContainer = document.getElementById('board-container');
const gameStatus = document.getElementById('game-status');
const endScreen = document.getElementById('end-screen');
const endMessage = document.getElementById('end-message');
const playAgainBtn = document.getElementById('playAgainBtn');
const returnToLobbyBtn = document.getElementById('returnToLobbyBtn');

// --- Initialization ---
function initGame() {
    console.log("Initializing game...");
    const urlParams = new URLSearchParams(window.location.search);
    roomId = urlParams.get('room');
    playerId = urlParams.get('player');

    console.log("Room ID:", roomId, "Player ID:", playerId);

    if (!roomId || !playerId) {
        console.error("Missing room or player ID");
        window.location.href = "index.html"; 
        return;
    }
    
    const roomRef = ref(window.db, `rooms/${roomId}`);
    
    // --- Setup Listeners ---
    onValue(roomRef, (snap) => {
        console.log("Firebase data received:", snap.exists());
        if (!snap.exists()) {
            alert("Game session ended.");
            window.location.href = "index.html";
            return;
        }

        const roomData = snap.val();
        console.log("Room data:", roomData);
        
        // Determine player roles on first load
        if (!myPlayerNumber) {
            playerIds = Object.keys(roomData.players);
            myPlayerNumber = playerIds[0] === playerId ? PLAYER_1 : PLAYER_2;
            console.log("My player number:", myPlayerNumber, "Player IDs:", playerIds);
        }
        
        // Player 1 (host) initializes the game state once the game starts
        if (myPlayerNumber === PLAYER_1 && !roomData.board) { 
            console.log("Initializing board as Player 1");
            initializeFirebaseBoard(roomRef, roomData.players);
        }
        
        // Render and update UI
        if (roomData.board) {
            console.log("Rendering board");
            renderBoard(roomData);
        } else {
            console.log("No board data available yet");
        }
        updateUI(roomData);
    });

    // --- Button Actions ---
    returnToLobbyBtn.onclick = async () => {
        await leaveGame(roomId, playerId);
        window.location.href = "index.html";
    };

    playAgainBtn.onclick = async () => {
        // Only the host resets the board
        if (myPlayerNumber === PLAYER_1) {
            await resetGame(roomRef);
        }
        playAgainBtn.classList.add('hidden');
    };
}

// --- Firebase Data Helpers ---
function createInitialBoard() {
    return Array(ROWS).fill(0).map(() => Array(COLS).fill(EMPTY));
}

async function initializeFirebaseBoard(roomRef, players) {
    // Determine the player IDs again for safety
    const pIds = Object.keys(players);
    
    await update(roomRef, {
        board: createInitialBoard(),
        currentPlayer: pIds[0], 
        gameStatus: "playing",
        moves: 0,
        winnerId: null
    });
}

async function resetGame(roomRef) {
    await update(roomRef, {
        board: createInitialBoard(),
        currentPlayer: playerIds[0], 
        gameStatus: "playing",
        moves: 0,
        winnerId: null
    });
}

async function leaveGame(roomId, playerId) {
    const opponentId = playerIds.find(id => id !== playerId);
    
    // Mark game as finished, giving the win to the opponent
    await update(ref(window.db, `rooms/${roomId}`), {
         gameStatus: "finished",
         winnerId: opponentId, 
         status: "waiting" 
    });
    
    await remove(ref(window.db, `rooms/${roomId}/players/${playerId}`));
    
    // Cleanup room if empty
    const snap = await get(ref(window.db, `rooms/${roomId}/players`));
    if (!snap.exists() || Object.keys(snap.val()).length === 0) {
        await remove(ref(window.db, `rooms/${roomId}`));
    }
}

// --- DOM Rendering and UI Logic ---
function renderBoard(roomData) {
    const board = roomData.board;
    boardContainer.innerHTML = '';
    boardContainer.style.setProperty('--cols', COLS);
    boardContainer.style.setProperty('--rows', ROWS);

    for (let c = 0; c < COLS; c++) {
        const column = document.createElement('div');
        column.className = 'connect4-column';
        column.dataset.col = c;
        
        // Attach click handler only if game is playing and it's their turn
        if (roomData.gameStatus === "playing" && roomData.currentPlayer === playerId) {
            column.onclick = () => makeMove(board, c);
        } else {
            column.onclick = null;
        }

        for (let r = 0; r < ROWS; r++) {
            const slot = document.createElement('div');
            slot.className = 'connect4-slot';
            const piece = document.createElement('div');
            piece.className = 'connect4-piece';

            const playerValue = board[r][c];
            if (playerValue === PLAYER_1) {
                piece.classList.add('player-1', 'dropped');
            } else if (playerValue === PLAYER_2) {
                piece.classList.add('player-2', 'dropped');
            }
            slot.appendChild(piece);
            column.appendChild(slot);
        }
        boardContainer.appendChild(column);
    }
}

function updateUI(roomData) {
    const p1Name = roomData.players[playerIds[0]]?.name || "Player 1";
    const p2Name = roomData.players[playerIds[1]]?.name || "Player 2";
    const isMyTurn = roomData.currentPlayer === playerId;

    // 1. Update Title
    document.getElementById('game-title').innerHTML = `
        <span class="player-1">${p1Name} 🔴</span> vs <span class="player-2">${p2Name} 🟡</span>
    `;

    // 2. Handle Game Status and End Screen
    endScreen.classList.add('hidden');
    boardContainer.classList.remove('game-over');
    returnToLobbyBtn.textContent = "Return to Lobby";

    if (roomData.gameStatus === "playing") {
        gameStatus.textContent = isMyTurn 
            ? "Your turn! Click a column to drop a piece." 
            : `${roomData.players[roomData.currentPlayer]?.name}'s turn.`;
            
        gameStatus.className = isMyTurn ? "status-my-turn" : "status-waiting";
            
    } else if (roomData.gameStatus === "finished") {
        let message;
        if (roomData.winnerId === "draw") {
            message = "It's a Draw! 🤝";
        } else if (roomData.winnerId === playerId) {
            message = "You Win! 🎉";
            returnToLobbyBtn.textContent = "Continue to Lobby";
        } else {
            message = `${roomData.players[roomData.winnerId]?.name} Wins! 😭`;
        }
        
        // Show End Screen
        gameStatus.textContent = "";
        endMessage.innerHTML = `<strong>${message}</strong>`;
        endScreen.classList.remove('hidden');
        boardContainer.classList.add('game-over');

        // Play Again logic
        if (myPlayerNumber === PLAYER_1) {
            playAgainBtn.classList.remove('hidden');
        } else {
            playAgainBtn.classList.add('hidden');
        }
    }
}

// --- Core Game Logic ---
async function makeMove(board, col) {
    const roomRef = ref(window.db, `rooms/${roomId}`);
    const snap = await get(roomRef);
    const roomData = snap.val();

    if (roomData.currentPlayer !== playerId || roomData.gameStatus !== "playing") return;

    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r][col] === EMPTY) {
            row = r;
            break;
        }
    }

    if (row === -1) return; 

    const newBoard = JSON.parse(JSON.stringify(board));
    newBoard[row][col] = myPlayerNumber;

    const winner = checkWin(newBoard, row, col, myPlayerNumber);
    const nextPlayerId = playerIds.find(id => id !== playerId);
        
    let updateData = {
        board: newBoard,
        moves: roomData.moves + 1
    };
    
    // Determine next state
    if (winner) {
        updateData.gameStatus = "finished";
        updateData.winnerId = playerId;
        updateData.status = "waiting";
    } else if (roomData.moves + 1 === ROWS * COLS) {
        updateData.gameStatus = "finished";
        updateData.winnerId = "draw";
        updateData.status = "waiting"; 
    } else {
        updateData.currentPlayer = nextPlayerId;
    }

    // Update Firebase
    await update(roomRef, updateData);
}

// Win checking logic
function checkWin(board, r, c, player) {
    const count = (dr, dc) => {
        let count = 0;
        for (let i = -3; i <= 3; i++) {
            const nr = r + i * dr;
            const nc = c + i * dc;

            if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && board[nr][nc] === player) {
                count++;
                if (count >= 4) return true;
            } else {
                count = 0; 
            }
        }
        return false;
    };

    return count(0, 1) || count(1, 0) || count(1, 1) || count(1, -1);
}

// Start the game initialization
initGame();
