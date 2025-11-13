// lobby.js
import {
    ref,
    set,
    get,
    onValue,
    update,
    remove,
    onDisconnect,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js"; // UPDATED VERSION

// Database object is available via window.db from index.html

// === Elements ===
const nameInput = document.getElementById("playerNameInput");
const joinBtn = document.getElementById("enterLobbyBtn");
const createBtn = document.getElementById("createRoomBtn");
const roomsList = document.getElementById("roomsList");
const onlineList = document.getElementById("onlinePlayers");
const lobbyView = document.getElementById("lobby-view");

let playerName = "";
let playerId = Math.random().toString(36).substring(2, 8);
let currentRoomId = null;

// === Event Listeners ===
joinBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) return alert("Please enter your name");

    playerName = name;
    
    // UI changes
    joinBtn.disabled = true;
    nameInput.disabled = true;
    createBtn.disabled = false;
    lobbyView.classList.remove("hidden");

    await registerPlayer();
    listenPlayers();
    listenRooms();
});

createBtn.addEventListener("click", async () => {
    if (!playerName || currentRoomId) return;
    await removePlayerFromAnyRoom();

    const roomsRef = ref(window.db, "rooms");
    const snap = await get(roomsRef);
    const rooms = snap.exists() ? snap.val() : {};

    // Generate next numeric ID
    let nextId = 100;
    const ids = Object.keys(rooms).map(Number).filter((x) => !isNaN(x));
    if (ids.length > 0) nextId = Math.max(...ids) + 1;

    const roomId = nextId.toString();
    await set(ref(window.db, `rooms/${roomId}`), {
        id: roomId,
        host: { id: playerId, name: playerName },
        players: { [playerId]: { name: playerName, ready: false, isHost: true } },
        createdAt: Date.now(),
        status: "waiting",
    });

    currentRoomId = roomId;
    createBtn.disabled = true;
});


// === Player Presence Functions ===
async function registerPlayer() {
    const playerRef = ref(window.db, `onlinePlayers/${playerId}`);
    await set(playerRef, { name: playerName, joinedAt: Date.now() });
    onDisconnect(playerRef).remove();

    // Remove player from lobby/room on browser close/refresh
    window.addEventListener("beforeunload", async () => {
        // This hook runs when navigating away (including redirecting to game.html)
        if (currentRoomId) await leaveRoom(currentRoomId);
        await remove(playerRef);
    });
}

function listenPlayers() {
    const playersRef = ref(window.db, "onlinePlayers");
    onValue(playersRef, (snap) => {
        onlineList.innerHTML = "";
        if (!snap.exists()) return;
        Object.values(snap.val()).forEach((p) => {
            const div = document.createElement("div");
            div.className = "user online";
            div.innerHTML = `<div class="status green"></div><span>${p.name}</span>`;
            onlineList.appendChild(div);
        });
    });
}

// === Room Management Functions ===

async function removePlayerFromAnyRoom() {
    const roomsSnap = await get(ref(window.db, "rooms"));
    if (!roomsSnap.exists()) return;

    const rooms = roomsSnap.val();
    for (const id in rooms) {
        if (rooms[id].players && rooms[id].players[playerId]) {
            await leaveRoom(id, true); // Use forceLeave to remove player without complex checks
        }
    }
}

async function leaveRoom(roomId, forceLeave = false) {
    if (!roomId) return;
    const playerPath = ref(window.db, `rooms/${roomId}/players/${playerId}`);
    await remove(playerPath);
    currentRoomId = null; // Clears the currentRoomId here
    createBtn.disabled = false;

    // Check if the room is empty and remove it
    const snap = await get(ref(window.db, `rooms/${roomId}/players`));
    if (!snap.exists()) {
        await remove(ref(window.db, `rooms/${roomId}`));
    } else if (!forceLeave) {
         // If a player leaves normally, set the game status to waiting/stalled
         await update(ref(window.db, `rooms/${roomId}`), { 
             status: "waiting",
             gameStatus: "stalled"
         });
    }
}

function listenRooms() {
    const roomsRef = ref(window.db, "rooms");
    onValue(roomsRef, (snap) => {
        roomsList.innerHTML = "";
        if (!snap.exists()) return;

        const rooms = snap.val();
        Object.keys(rooms)
            .sort((a, b) => parseInt(a) - parseInt(b))
            .forEach((id) => {
                const room = rooms[id];
                const isInRoom = room.players && room.players[playerId]; // Check if current player is in room

                // Render the room if it's waiting/starting OR if the current player is inside it (essential for redirect).
                if (room.status === "waiting" || room.status === "starting" || isInRoom) {
                    renderRoom(room);
                }
            });
    });
}

function renderRoom(room) {
    const div = document.createElement("div");
    div.className = "room";
    
    const players = room.players ? Object.values(room.players) : [];
    const playerCount = players.length;
    const isInRoom = room.players && room.players[playerId];

    div.innerHTML = `
        <div class="room-header"><span>Room ${room.id} - ${room.host.name}'s Game</span></div>
        <div class="room-body">
            <div class="player-section">
                ${players.map(p => `
                        <div class="details">
                            <div class="name">${p.name}</div>
                            <div class="rating">${p.ready ? "✅ Ready" : "⏳ Waiting"}</div>
                        </div>`
                    ).join("")}
            </div>
            <div class="room-info" id="room-actions-${room.id}">
                ${room.status === "starting" ? 
                    `<div id="countdown-${room.id}" class="countdown">Game starting in ${room.countdown || 5}...</div>` : ''
                }
            </div>
        </div>
    `;
    
    const actionSection = div.querySelector(`#room-actions-${room.id}`);

    // --- Join/Leave/Ready Button Logic ---
    if (!isInRoom && !currentRoomId && room.status === "waiting" && playerCount < 2) {
        const joinButton = document.createElement("button");
        joinButton.className = "join-btn primary";
        joinButton.textContent = "Join";
        joinButton.onclick = async () => {
            await removePlayerFromAnyRoom();
            await update(ref(window.db, `rooms/${room.id}/players`), {
                [playerId]: { name: playerName, ready: false },
            });
            currentRoomId = room.id;
            createBtn.disabled = true;
        };
        actionSection.appendChild(joinButton);
    } else if (isInRoom) {
        const readyButton = document.createElement("button");
        readyButton.className = "join-btn primary";
        readyButton.textContent = room.players[playerId].ready ? "Unready" : "Ready";
        readyButton.onclick = async () => toggleReady(room);

        const leaveButton = document.createElement("button");
        leaveButton.className = "join-btn secondary";
        leaveButton.textContent = "Leave";
        leaveButton.onclick = async () => leaveRoom(room.id);

        if (room.status === "waiting") {
            actionSection.appendChild(readyButton);
        }
        actionSection.appendChild(leaveButton);
    }
    
    // Check if redirect is needed
    if (room.status === "starting" || room.status === "inGame") {
        redirectToGame(room.id, room.players);
    }

    // Only append rooms that should be visible in the lobby
    if (room.status === "waiting" || room.status === "starting") {
        roomsList.appendChild(div);
    } 
}

// === Game Start Logic ===

async function toggleReady(room) {
    const newReady = !room.players[playerId].ready;
    await update(ref(window.db, `rooms/${room.id}/players/${playerId}`), { ready: newReady });

    const snap = await get(ref(window.db, `rooms/${room.id}/players`));
    const playersData = snap.exists() ? snap.val() : {};
    const playerKeys = Object.keys(playersData);
    
    const allReady = playerKeys.length === 2 && Object.values(playersData).every((p) => p.ready);

    if (allReady) {
        await update(ref(window.db, `rooms/${room.id}`), { status: "starting", countdown: 5 }); 
        // Only the host (P1) manages the timer interval
        if (room.host.id === playerId) { 
            startCountdown(room.id);
        }
    } else if (room.status === "starting" && !allReady) {
        // If someone un-readies, stop the countdown
        await update(ref(window.db, `rooms/${room.id}`), { status: "waiting", countdown: null });
    }
}

function startCountdown(roomId) {
    let seconds = 5;
    const interval = setInterval(async () => {
        seconds--;
        if (seconds < 0) {
            clearInterval(interval);
            // Final update to set status to inGame
            await update(ref(window.db, `rooms/${roomId}`), { status: "inGame", countdown: null });
        } else {
            await update(ref(window.db, `rooms/${roomId}`), { countdown: seconds });
        }
    }, 1000);
}

function redirectToGame(roomId, players) {
    // Check if the current player is one of the two players and the game is starting/inGame
    if (players[playerId]) {
         const statusRef = ref(window.db, `rooms/${roomId}/status`);
         // Listen for the final 'inGame' status
         onValue(statusRef, (snap) => {
             if (snap.exists() && snap.val() === "inGame") {
                 // **CRITICAL FIX:** Clear currentRoomId before redirecting.
                 // This prevents the 'beforeunload' listener from calling leaveRoom 
                 // and deleting the room when navigating to game.html.
                 currentRoomId = null; 
                 
                 window.location.href = `game.html?room=${roomId}&player=${playerId}`;
             }
         }, { onlyOnce: true });
    }
}
