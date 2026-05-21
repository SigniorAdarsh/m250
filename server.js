const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

function generateDeck(playerCount) {
    const suits = ['♠', '♥', '♦', '♣'];
    const allRanks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const ranks = playerCount === 5 ? allRanks.slice(3) : allRanks.slice(1);
    
    let deck = [];
    for (let suit of suits) {
        for (let rank of ranks) {
            deck.push(`${rank}${suit}`);
        }
    }
    
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

io.on('connection', (socket) => {
    
    socket.on('createRoom', ({ playerName, playerCount }) => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        rooms[roomId] = {
            id: roomId,
            creatorId: socket.id,
            maxPlayers: parseInt(playerCount),
            players: [{ id: socket.id, name: playerName, hand: [], score: 0 }],
            deck: generateDeck(parseInt(playerCount)),
            board: [],
            distributionPhase: 0 
        };

        socket.join(roomId);
        socket.emit('gameJoined', { roomId, isCreator: true, maxPlayers: rooms[roomId].maxPlayers, playerId: socket.id });
        io.to(roomId).emit('updatePlayers', rooms[roomId].players);
    });

    socket.on('joinRoom', ({ playerName, roomId }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'Room not found.');
        if (room.players.length >= room.maxPlayers) return socket.emit('errorMsg', 'Room is full.');

        room.players.push({ id: socket.id, name: playerName, hand: [], score: 0 });
        socket.join(roomId);
        
        socket.emit('gameJoined', { roomId, isCreator: false, maxPlayers: room.maxPlayers, playerId: socket.id });
        io.to(roomId).emit('updatePlayers', room.players);
    });

    socket.on('distributeCards', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.creatorId !== socket.id) return;
        
        if (room.distributionPhase === 2) {
            room.deck = generateDeck(room.maxPlayers);
            room.distributionPhase = 0;
            room.players.forEach(p => p.hand = []);
        }

        if (room.distributionPhase === 0) {
            room.players.forEach(p => p.score = 0);
            io.to(roomId).emit('updatePlayers', room.players); 
        }

        room.players.forEach(player => {
            const dealtCards = room.deck.splice(0, 4);
            player.hand.push(...dealtCards);
            io.to(player.id).emit('handUpdated', player.hand);
        });

        room.distributionPhase++;
    });

    socket.on('playCard', ({ roomId, card }) => {
        const room = rooms[roomId];
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        const existingBoardIndex = room.board.findIndex(b => b.playerId === player.id);
        
        // --- NEW: SUIT ENFORCEMENT LOGIC ---
        let leadingSuit = null;
        // If there are cards on the board, and this player isn't the first player swapping their card
        if (room.board.length > 0 && existingBoardIndex !== 0) {
            // The suit is always the last character of the card string (e.g., '10♠' -> '♠')
            leadingSuit = room.board[0].card.slice(-1);
        }

        const playedSuit = card.slice(-1);

        if (leadingSuit && playedSuit !== leadingSuit) {
            // Create a temporary array of the player's hand + their currently played card (if they are swapping)
            let handToCheck = [...player.hand];
            if (existingBoardIndex > -1) {
                handToCheck.push(room.board[existingBoardIndex].card);
            }
            
            // Check if they possess any card of the leading suit
            const hasSuit = handToCheck.some(c => c.slice(-1) === leadingSuit);
            
            if (hasSuit) {
                // Reject the play and send an alert to the client
                return socket.emit('errorMsg', `You must play a ${leadingSuit} since it is the leading suit this round.`);
            }
        }
        // ------------------------------------

        // Remove old card if they are swapping
        if (existingBoardIndex > -1) {
            const oldCard = room.board[existingBoardIndex].card;
            player.hand.push(oldCard); 
            room.board.splice(existingBoardIndex, 1); 
        }

        // Play the new card
        const cardIndex = player.hand.indexOf(card);
        if (cardIndex > -1) {
            player.hand.splice(cardIndex, 1);
            
            // If they swapped, put the new card in their exact previous position to preserve turn order
            if (existingBoardIndex > -1) {
                room.board.splice(existingBoardIndex, 0, { card, playerName: player.name, playerId: player.id });
            } else {
                room.board.push({ card, playerName: player.name, playerId: player.id });
            }
            
            io.to(player.id).emit('handUpdated', player.hand);
            io.to(roomId).emit('boardUpdated', room.board);
        }
    });

    socket.on('undoCard', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        const existingBoardIndex = room.board.findIndex(b => b.playerId === player.id);
        if (existingBoardIndex > -1) {
            const oldCard = room.board[existingBoardIndex].card;
            player.hand.push(oldCard);
            room.board.splice(existingBoardIndex, 1);
            
            io.to(player.id).emit('handUpdated', player.hand);
            io.to(roomId).emit('boardUpdated', room.board);
        }
    });

    socket.on('reorderHand', ({ roomId, newHand }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        
        if (player.hand.length === newHand.length) {
            player.hand = newHand;
        }
    });

    socket.on('declareWinner', ({ roomId, winnerId, points }) => {
        const room = rooms[roomId];
        if (!room || room.creatorId !== socket.id) return;

        const winner = room.players.find(p => p.id === winnerId);
        if (winner) {
            winner.score += parseInt(points) || 0; 

            room.board = []; 
            io.to(roomId).emit('boardUpdated', room.board);
            io.to(roomId).emit('updatePlayers', room.players); 
            io.to(roomId).emit('sysMessage', `${winner.name} won the round and got ${points} points!`);
        }
    });

    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (playerIndex > -1) {
                room.players.splice(playerIndex, 1);
                io.to(roomId).emit('updatePlayers', room.players);
                
                if (room.players.length === 0) {
                    delete rooms[roomId];
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));