// server/index.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Socket connection handler
io.on('connection', (socket) => {
  console.log('New client connected');
  
  // Handle joining a chat room
  socket.on('join', (userData) => {
    console.log(`User ${userData.name} joined`);
    socket.join(userData.room);
    
    // Notify others in the room
    socket.to(userData.room).emit('userJoined', userData);
  });
  
  // Handle chat messages
  socket.on('message', (messageData) => {
    console.log(`Message in ${messageData.room}: ${messageData.text}`);
    io.to(messageData.room).emit('message', {
      ...messageData,
      timestamp: new Date().toISOString()
    });
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));