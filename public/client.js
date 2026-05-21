const socket = io();

const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const playerNameInput = document.getElementById('player-name');
const joinGameIdInput = document.getElementById('join-game-id');
const playerCountSelect = document.getElementById('player-count');
const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');
const btnDistribute = document.getElementById('btn-distribute');
const displayRoomId = document.getElementById('display-room-id');
const creatorControls = document.getElementById('creator-controls');
const playersList = document.getElementById('players-list');
const myCardsContainer = document.getElementById('my-cards');
const centerBoard = document.getElementById('center-board');

let currentRoomId = null;
let isGameCreator = false;
let myId = null;
let currentHand = [];

btnCreate.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    const count = playerCountSelect.value;
    if (!name) return alert('Please enter your name.');
    socket.emit('createRoom', { playerName: name, playerCount: count });
});

btnJoin.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    const roomId = joinGameIdInput.value.trim().toUpperCase();
    if (!name || !roomId) return alert('Fill in all fields.');
    socket.emit('joinRoom', { playerName: name, roomId });
});

btnDistribute.addEventListener('click', () => {
    if (currentRoomId) socket.emit('distributeCards', currentRoomId);
});

// Added a prompt to ask for points
function declareWinner(playerId, playerName) {
    if (isGameCreator && currentRoomId) {
        const pointsStr = prompt(`How many points did ${playerName} win in this round?`, "10");
        
        // If the creator clicks 'Cancel' on the prompt, it returns null. We only proceed if they don't cancel.
        if (pointsStr !== null) {
            const points = parseInt(pointsStr) || 0;
            socket.emit('declareWinner', { roomId: currentRoomId, winnerId: playerId, points });
        }
    }
}

function renderHand() {
    myCardsContainer.innerHTML = '';
    
    currentHand.forEach((card, index) => {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card';
        cardDiv.textContent = card;
        cardDiv.draggable = true;
        
        if (card.includes('♥') || card.includes('♦')) {
            cardDiv.classList.add('red-suit');
        }
        
        cardDiv.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', index);
            cardDiv.style.opacity = '0.5';
        });

        cardDiv.addEventListener('dragend', () => {
            cardDiv.style.opacity = '1';
        });
        
        cardDiv.addEventListener('dragover', (e) => {
            e.preventDefault(); 
        });
        
        cardDiv.addEventListener('drop', (e) => {
            e.preventDefault();
            const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
            const toIndex = index;
            
            if (fromIndex !== toIndex && !isNaN(fromIndex)) {
                const [movedCard] = currentHand.splice(fromIndex, 1);
                currentHand.splice(toIndex, 0, movedCard);
                
                if (currentRoomId) {
                    socket.emit('reorderHand', { roomId: currentRoomId, newHand: currentHand });
                }
                
                renderHand(); 
            }
        });

        cardDiv.addEventListener('click', () => {
            if (currentRoomId) {
                socket.emit('playCard', { roomId: currentRoomId, card });
            }
        });
        
        myCardsContainer.appendChild(cardDiv);
    });
}

socket.on('gameJoined', ({ roomId, isCreator, maxPlayers, playerId }) => {
    currentRoomId = roomId;
    isGameCreator = isCreator;
    myId = playerId; 
    
    lobbyScreen.classList.remove('active');
    lobbyScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    gameScreen.classList.add('active');
    displayRoomId.textContent = `${roomId} (${maxPlayers} players)`;
    
    if (isCreator) creatorControls.classList.remove('hidden');
});

// Updated to display player scores next to their names
socket.on('updatePlayers', (players) => {
    playersList.innerHTML = '';
    players.forEach(player => {
        const li = document.createElement('li');
        li.textContent = `${player.name} (Score: ${player.score})`; // Shows the score dynamically
        
        if (isGameCreator) {
            li.style.cursor = 'pointer';
            li.title = 'Click to declare round winner & assign points';
            // Passing the name so the prompt can mention who is getting the points
            li.addEventListener('click', () => declareWinner(player.id, player.name));
        }
        playersList.appendChild(li);
    });
});

socket.on('handUpdated', (cards) => {
    currentHand = cards;
    renderHand();
});

socket.on('boardUpdated', (boardCards) => {
    centerBoard.innerHTML = '';
    if (boardCards.length === 0) {
        centerBoard.innerHTML = '<p class="placeholder">Center Board</p>';
        return;
    }

    boardCards.forEach(item => {
        const cardWrapper = document.createElement('div');
        cardWrapper.className = 'board-card-wrapper';
        
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card';
        cardDiv.textContent = item.card;
        if (item.card.includes('♥') || item.card.includes('♦')) {
            cardDiv.classList.add('red-suit');
        }

        const label = document.createElement('small');
        label.textContent = item.playerName;

        cardWrapper.appendChild(cardDiv);
        cardWrapper.appendChild(label);

        if (item.playerId === myId) {
            const undoBtn = document.createElement('div');
            undoBtn.className = 'undo-btn';
            undoBtn.textContent = '⟲ Undo';
            undoBtn.addEventListener('click', () => {
                socket.emit('undoCard', currentRoomId);
            });
            cardWrapper.appendChild(undoBtn);
        }

        centerBoard.appendChild(cardWrapper);
    });
});

socket.on('sysMessage', (msg) => alert(msg));
socket.on('errorMsg', (msg) => alert(msg));