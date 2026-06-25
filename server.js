const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" } // Lejon Netlify ose çdo pajisje të lidhet pa bllokim CORS
});

// Ruajtja e të dhënave në memorien e serverit
let usersOnline = {};
let matchmakingQueue = [];
let bannedUsers = ['user_troll', 'troller99']; 

io.on('connection', (socket) => {
    console.log(`Përdorues i ri u lidh: ${socket.id}`);

    // Kur përdoruesi klikon "Vazhdo" nga Login Form
    socket.on('user-login', (data) => {
        if (bannedUsers.includes(data.username.toLowerCase())) {
            socket.emit('banned-status', true);
            return;
        }

        // Regjistrojmë përdoruesin zyrtarisht në server
        usersOnline[socket.id] = {
            socketId: socket.id,
            username: data.username,
            city: data.city || 'Kosovë',
            peerId: null,
            currentPartner: null
        };

        // Përditësojmë numrin e saktë të njerëzve online te të gjithë klientët active
        io.emit('update-counter', Object.keys(usersOnline).length);
    });

    // Ruajmë ID-në e PeerJS (Kamerës) kur hapet lidhja në frontend
    socket.on('register-peer-id', (peerId) => {
        if (usersOnline[socket.id]) {
            usersOnline[socket.id].peerId = peerId;
        }
    });

    // Kur përdoruesi shtyp SKIP ose kërkon një person të ri
    socket.on('find-match', () => {
        let user = usersOnline[socket.id];
        if (!user || !user.peerId) return;

        // Nëse ishte i lidhur me dikë më parë, njoftojmë partnerin e vjetër që ky bëri SKIP
        if (user.currentPartner) {
            io.to(user.currentPartner).emit('partner-disconnected');
            if (usersOnline[user.currentPartner]) {
                usersOnline[user.currentPartner].currentPartner = null;
            }
            user.currentPartner = null;
        }

        // Pastrojmë radhën nga ky ID për siguri
        matchmakingQueue = matchmakingQueue.filter(id => id !== socket.id);

        // Algoritmi i Matchmaking: Kërkojmë dikë që po pret dhe që ka kamerë aktive
        let availableOpponentId = matchmakingQueue.find(id => id !== socket.id && usersOnline[id] && usersOnline[id].peerId);

        if (availableOpponentId) {
            // Heqim personin që gjetëm nga lista e pritjes
            matchmakingQueue = matchmakingQueue.filter(id => id !== availableOpponentId);

            let opponent = usersOnline[availableOpponentId];

            // I lidhim të dy në server
            user.currentPartner = availableOpponentId;
            opponent.currentPartner = socket.id;

            // U dërgojmë ID-të e PeerJS reciproke që kamerat të lidhen direkt (P2P)
            socket.emit('match-found', { peerId: opponent.peerId, username: opponent.username, city: opponent.city });
            io.to(availableOpponentId).emit('match-found', { peerId: user.peerId, username: user.username, city: user.city });
        } else {
            // Nuk ka askush të lirë, e fusim këtë përdorues në radhë të presë partnerin e radhës
            matchmakingQueue.push(socket.id);
        }
    });

    // Sistemi i BAN-it në kohë reale nga Admini (Florian)
    socket.on('admin-ban-user', (targetUsername) => {
        let nameToBan = targetUsername.toLowerCase().trim();
        if (!bannedUsers.includes(nameToBan)) {
            bannedUsers.push(nameToBan);
        }

        // Gjejmë nëse ky troll është online tani dhe e përzëmë në sekondë
        for (let sId in usersOnline) {
            if (usersOnline[sId].username.toLowerCase() === nameToBan) {
                io.to(sId).emit('banned-status', true);
                io.sockets.sockets.get(sId)?.disconnect();
            }
        }
    });

    // Kur dikush mbyll faqen ose shkëputet nga rrjeti
    socket.on('disconnect', () => {
        let user = usersOnline[socket.id];
        if (user && user.currentPartner) {
            io.to(user.currentPartner).emit('partner-disconnected');
            if (usersOnline[user.currentPartner]) {
                usersOnline[user.currentPartner].currentPartner = null;
            }
        }
        matchmakingQueue = matchmakingQueue.filter(id => id !== socket.id);
        delete usersOnline[socket.id];
        io.emit('update-counter', Object.keys(usersOnline).length);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Serveri Backend po ruan në portin ${PORT}`));
