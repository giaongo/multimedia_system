'use strict';
//
// CS-E4265 A3.2 signaling service.
//
// Deploy this as it is. You do not need to change anything in this file -- the assignment is
// about the peer connection, not about signaling. It is here, rather than hosted for you, so
// that you can see what a signaling channel actually has to do: pair two peers into a room and
// pass opaque messages between them. Note that it never looks inside a message. Offers,
// answers and ICE candidates are just strings to it.
//
// It also serves whatever is in public/, so you can open the deployed URL in two browser tabs
// and test your own client against your own service.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const ROOM = 'foo';
const MAX_PEERS = 2;

const server = http.createServer((req, res) => {
  const name = (req.url === '/' ? '/index.html' : req.url).split('?')[0];
  const file = path.join(__dirname, 'public', path.normalize(name).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const type = file.endsWith('.js') ? 'application/javascript'
               : file.endsWith('.css') ? 'text/css' : 'text/html';
    res.writeHead(200, {'Content-Type': type});
    res.end(body);
  });
});

const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  socket.on('create or join', (room) => {
    const clients = io.sockets.adapter.rooms.get(room) || new Set();
    if (clients.size >= MAX_PEERS) {
      // Evict the oldest peer rather than refusing. A room that fills up and never empties is
      // why the 2025 version of this assignment told students to delete their App Engine
      // instance between attempts. A browser that closes without saying goodbye leaves its
      // socket in the room until the ping timeout expires, which is most of a minute, so
      // without this a second attempt would land in a full room.
      const oldest = clients.values().next().value;
      io.sockets.sockets.get(oldest)?.disconnect(true);
    }
    socket.join(room);

    // Roles are (re-)assigned from the room's current membership, not from the order peers
    // happened to arrive in. That matters because of the eviction above: if a stale peer was
    // still in the room when the first real one joined, that first peer was told 'joined' --
    // and once the stale one is evicted, both real peers would be waiting for the other to
    // make the offer, and nothing would ever happen. Telling both peers their role each time
    // the room settles makes these events current rather than historical.
    const members = [...(io.sockets.adapter.rooms.get(room) || new Set())];
    if (members.length < MAX_PEERS) {
      socket.emit('created', room);
      return;
    }
    const first = io.sockets.sockets.get(members[0]);
    const second = io.sockets.sockets.get(members[1]);
    first?.emit('created', room);       // you were here first: you make the offer
    second?.emit('joined', room);       // you arrived second: you answer
    first?.emit('join', room);          // someone joined the room you are in
    io.in(room).emit('ready');          // both are present; negotiation can start
  });
  socket.on('message', (m) => socket.to(ROOM).emit('message', m));
});

server.listen(process.env.PORT || 8080, () => console.log('signaling on 8080'));
