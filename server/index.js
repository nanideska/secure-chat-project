// server/index.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
app.use(cors());

const server = http.createServer(app);

// Improve server performance with adjusted settings
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 10 * 1024 * 1024, // 10MB for larger files
  pingTimeout: 30000, // Reduced from 60000 for better connection management
  pingInterval: 10000 // Reduced from 25000 for more frequent connection checks
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/secure-chat', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.log('MongoDB connection error:', err));

// Define message schema for database
const messageSchema = new mongoose.Schema({
  messageId: { type: String, required: true, unique: true },
  text: String,
  sender: String,
  senderId: String,
  role: String,
  timestamp: { type: Date, default: Date.now },
  room: String,
  recipientId: String,
  recipientName: String,
  isFile: Boolean,
  fileData: {
    name: String,
    type: String,
    size: Number,
    data: String
  }
});

// Define user schema for database
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  role: { type: String, required: true },
  lastLogin: { type: Date, default: Date.now },
  socketIds: [String]
});

const Message = mongoose.model('Message', messageSchema);
const User = mongoose.model('User', userSchema);

// Store active users in memory
const users = new Map();

// Room definitions with permissions
const rooms = {
  'general': { 
    name: 'General', 
    allowedRoles: ['student', 'lecturer', 'admin'],
    systemMessages: true // Only show join/leave messages here
  },
  'assignments': { 
    name: 'Assignments', 
    allowedRoles: ['student', 'lecturer', 'admin'],
    systemMessages: false
  },
  'announcements': { 
    name: 'Announcements', 
    allowedRoles: ['student', 'lecturer', 'admin'], // All can view
    postingRoles: ['lecturer', 'admin'], // Only lecturers/admins can post
    systemMessages: false
  }
};

// Socket connection handler
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // Ping to keep connection alive
  const pingInterval = setInterval(() => {
    socket.emit('ping');
  }, 10000); // Send ping every 10 seconds
  
  // Handle user joining
  socket.on('join', async (userData) => {
    // Save or update user in database
    try {
      await User.findOneAndUpdate(
        { name: userData.name, role: userData.role },
        { 
          $set: { lastLogin: new Date() },
          $addToSet: { socketIds: socket.id }
        },
        { upsert: true, new: true }
      );
    } catch (err) {
      console.error('Error saving user to database:', err);
    }

    // Store user data in memory
    users.set(socket.id, {
      id: socket.id,
      name: userData.name,
      role: userData.role,
      lastActive: Date.now()
    });
    
    console.log(`User ${userData.name} joined as ${userData.role}`);
    
    // Join general room by default
    socket.join('general');
    
    // Send room definitions to the client
    socket.emit('roomsInfo', rooms);
    
    // Send current users list to new user
    const usersList = Array.from(users.values());
    socket.emit('usersList', usersList);

    // Load and send previous messages for this user
    try {
      const messages = await Message.find({
        $or: [
          { room: { $exists: true } },
          { senderId: userData.name },
          { recipientId: userData.name },
          { sender: userData.name },
          { recipientName: userData.name }
        ]
      }).sort({ timestamp: 1 }).limit(100); // Limit to 100 most recent messages

      if (messages.length > 0) {
        socket.emit('previousMessages', messages);
      }
    } catch (err) {
      console.error('Error retrieving previous messages:', err);
    }
    
    // Only broadcast join message to the general room
    io.to('general').emit('userJoined', {
      id: socket.id,
      name: userData.name,
      role: userData.role,
      room: 'general' // Specify room for this system message
    });
  });
  
  // Handle pong response
  socket.on('pong', () => {
    if (users.has(socket.id)) {
      const userData = users.get(socket.id);
      userData.lastActive = Date.now();
      users.set(socket.id, userData);
    }
  });
  
  // Handle joining a room
  socket.on('joinRoom', (roomName) => {
    // Check if room exists
    if (!rooms[roomName]) {
      socket.emit('error', { message: `Room ${roomName} does not exist` });
      return;
    }
    
    // Check if user has permission to join this room
    const userData = users.get(socket.id);
    if (!userData) return;
    
    const roomData = rooms[roomName];
    if (!roomData.allowedRoles.includes(userData.role)) {
      socket.emit('error', { message: `You don't have permission to join ${roomData.name}` });
      return;
    }
    
    // Leave all rooms first (except socket's own room)
    const socketRooms = Array.from(socket.rooms);
    socketRooms.forEach(r => {
      if (r !== socket.id) socket.leave(r);
    });
    
    // Join new room
    socket.join(roomName);
    console.log(`User ${socket.id} joined room: ${roomName}`);
    
    // Notify the user
    socket.emit('roomJoined', { room: roomName });
  });
  
  // Handle chat messages
  socket.on('message', async (messageData) => {
    console.log(`Message received:`, messageData);
    
    // Add sender info if not present
    if (!messageData.senderId) {
      messageData.senderId = socket.id;
    }
    
    // Get user data
    const userData = users.get(socket.id);
    if (!userData) return;
    
    // Add messageId if not present for tracking
    if (!messageData.messageId) {
      messageData.messageId = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
    }
    
    // Ensure timestamp is consistent
    messageData.timestamp = new Date().toISOString();
    
    // Check posting permissions for restricted rooms
    if (messageData.room && rooms[messageData.room] && 
        rooms[messageData.room].postingRoles && 
        !rooms[messageData.room].postingRoles.includes(userData.role)) {
      socket.emit('error', { 
        message: `Only ${rooms[messageData.room].postingRoles.join(', ')} can post in ${rooms[messageData.room].name}` 
      });
      return;
    }
    
    // Update user's last active timestamp
    userData.lastActive = Date.now();
    users.set(socket.id, userData);
    
    // Make sure message has proper sender info
    messageData.sender = userData.name;
    messageData.role = userData.role;

    // Save message to database
    try {
      const message = new Message({
        messageId: messageData.messageId,
        text: messageData.text,
        sender: messageData.sender,
        senderId: messageData.senderId,
        role: messageData.role,
        timestamp: messageData.timestamp,
        room: messageData.room,
        recipientId: messageData.recipientId,
        recipientName: messageData.recipientName,
        isFile: false
      });
      
      await message.save();
    } catch (err) {
      console.error('Error saving message to database:', err);
    }
    
    // If it's a direct message
    if (messageData.recipientId) {
      // Send notification to recipient
      io.to(messageData.recipientId).emit('notification', {
        type: 'newMessage',
        from: userData.name,
        preview: messageData.text.substring(0, 50),
        timestamp: messageData.timestamp,
        id: Date.now() // Add unique ID for notification
      });
      
      // Send to recipient
      io.to(messageData.recipientId).emit('message', {
        ...messageData,
        isDirect: true
      });
      
      // Also send back to sender for confirmation
      socket.emit('message', {
        ...messageData,
        isDirect: true,
        confirmation: true
      });
    } 
    // If it's a room message
    else if (messageData.room) {
      // Log for debugging
      console.log(`Broadcasting message to room ${messageData.room}:`, messageData.text);
      
      // Send notification to others in the room
      socket.to(messageData.room).emit('notification', {
        type: 'newRoomMessage',
        room: messageData.room,
        from: userData.name,
        preview: messageData.text.substring(0, 50),
        timestamp: messageData.timestamp,
        id: Date.now() // Add unique ID for notification
      });
      
      // Broadcast to everyone in the room (including sender)
      io.in(messageData.room).emit('message', messageData);
    } 
    // Broadcast to everyone (fallback)
    else {
      io.emit('message', messageData);
    }
  });
  
  // Handle file sharing
  socket.on('fileShared', async (fileData) => {
    console.log(`File shared by ${fileData.sender}: ${fileData.name}, Size: ${Math.round(fileData.size / 1024)} KB`);
    
    // Get user data
    const userData = users.get(socket.id);
    if (!userData) return;
    
    // Check posting permissions for restricted rooms
    if (fileData.room && rooms[fileData.room] && 
        rooms[fileData.room].postingRoles && 
        !rooms[fileData.room].postingRoles.includes(userData.role)) {
      socket.emit('error', { 
        message: `Only ${rooms[fileData.room].postingRoles.join(', ')} can post in ${rooms[fileData.room].name}` 
      });
      return;
    }
    
    // Add a unique message ID if not present
    if (!fileData.messageId) {
      fileData.messageId = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
    }
    
    // Add timestamp if not present
    if (!fileData.timestamp) {
      fileData.timestamp = new Date().toISOString();
    }
    
    // Normalize data URL format if it's not consistent (for mobile-to-web compatibility)
    if (fileData.data && !fileData.data.startsWith('data:')) {
      // Try to guess mime type from file extension if not provided
      let mimeType = fileData.type || 'application/octet-stream';
      fileData.data = `data:${mimeType};base64,${fileData.data}`;
    }
    
    // Update user's last active timestamp
    userData.lastActive = Date.now();
    users.set(socket.id, userData);

    // Save file to database
    try {
      const message = new Message({
        messageId: fileData.messageId,
        text: `Shared file: ${fileData.name}`,
        sender: fileData.sender,
        senderId: fileData.senderId,
        role: fileData.role,
        timestamp: fileData.timestamp,
        room: fileData.room,
        recipientId: fileData.recipientId,
        recipientName: fileData.recipientName,
        isFile: true,
        fileData: {
          name: fileData.name,
          type: fileData.type,
          size: fileData.size,
          data: fileData.data
        }
      });
      
      await message.save();
    } catch (err) {
      console.error('Error saving file to database:', err);
    }
    
    // If it's a direct file share
    if (fileData.recipientId) {
      // Send notification to recipient
      io.to(fileData.recipientId).emit('notification', {
        type: 'newFile',
        from: userData.name,
        fileName: fileData.name,
        timestamp: fileData.timestamp,
        id: Date.now() // Add unique ID
      });
      
      // Send to recipient
      io.to(fileData.recipientId).emit('fileShared', fileData);
      
      // Always send confirmation back to sender
      socket.emit('fileShared', {
        ...fileData,
        confirmation: true,
        sender: userData.name, // Ensure sender data is consistent
        senderId: socket.id
      });
    } 
    // If it's a room file share
    else if (fileData.room) {
      // Send notification to others in the room
      socket.to(fileData.room).emit('notification', {
        type: 'newRoomFile',
        room: fileData.room,
        from: userData.name,
        fileName: fileData.name,
        timestamp: fileData.timestamp,
        id: Date.now() // Add unique ID
      });
      
      // Send to everyone in the room including sender
      io.to(fileData.room).emit('fileShared', {
        ...fileData,
        sender: userData.name, // Ensure sender data is consistent
        senderId: socket.id
      });
    } 
    // Broadcast to everyone (fallback)
    else {
      io.emit('fileShared', {
        ...fileData,
        sender: userData.name,
        senderId: socket.id
      });
    }
  });
  
  // Handle user logout
  socket.on('userLogout', () => {
    console.log('User logging out:', socket.id);
    
    // Get user data before removing
    const userData = users.get(socket.id);
    
    if (userData) {
      // Notify others that user is logging out
      io.to('general').emit('userLeft', { 
        id: socket.id, 
        name: userData.name,
        room: 'general' 
      });
      
      // Remove from users map
      users.delete(socket.id);
    }
  });
  
  // Handle reconnection attempts
  socket.on('reconnect', async (userData) => {
    if (!userData || !userData.name) return;
    
    console.log('Reconnection attempt from:', userData.name, userData.role);
    
    // Remove any existing user entry with this name
    for (let [id, user] of users.entries()) {
      if (user.name === userData.name && user.role === userData.role) {
        console.log(`Found existing user ${userData.name}, removing old entry`);
        users.delete(id);
        break;
      }
    }
    
    // Add new user entry
    users.set(socket.id, {
      id: socket.id,
      name: userData.name,
      role: userData.role,
      lastActive: Date.now()
    });
    
    // Update user in database
    try {
      await User.findOneAndUpdate(
        { name: userData.name, role: userData.role },
        { 
          $set: { lastLogin: new Date() },
          $addToSet: { socketIds: socket.id }
        },
        { upsert: true, new: true }
      );
    } catch (err) {
      console.error('Error updating user on reconnect:', err);
    }
    
    console.log(`User ${userData.name} reconnected as ${userData.role}`);
    
    // Join general room by default
    socket.join('general');
    
    // Send current state
    socket.emit('reconnected', { success: true });
    socket.emit('roomsInfo', rooms);
    
    // Send updated user list to everyone
    const usersList = Array.from(users.values());
    io.emit('usersList', usersList);
    
    // Load and send previous messages for this user
    try {
      const messages = await Message.find({
        $or: [
          { room: { $exists: true } },
          { senderId: userData.name },
          { recipientId: userData.name },
          { sender: userData.name },
          { recipientName: userData.name }
        ]
      }).sort({ timestamp: 1 }).limit(100);

      if (messages.length > 0) {
        socket.emit('previousMessages', messages);
      }
    } catch (err) {
      console.error('Error retrieving messages on reconnect:', err);
    }
    
    // Notify others of reconnection
    io.to('general').emit('userJoined', {
      id: socket.id,
      name: userData.name,
      role: userData.role,
      room: 'general'
    });
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Get user data before removing
    const userData = users.get(socket.id);
    
    // Clear ping interval
    clearInterval(pingInterval);
    
    // Don't immediately remove the user - they might reconnect
    // Instead, mark them as inactive and remove after a timeout
    if (userData) {
      userData.inactive = true;
      userData.lastActive = Date.now();
      users.set(socket.id, userData);
      
      // Notify others that user is offline
      io.emit('userOffline', { id: socket.id, name: userData.name });
      
      // Only send the left message to general room
      io.to('general').emit('userLeft', { 
        id: socket.id, 
        name: userData.name,
        room: 'general' // Specify room for this system message
      });
      
      // Set timeout to remove user if they don't reconnect
      setTimeout(() => {
        // Check if user is still marked inactive
        const currentData = users.get(socket.id);
        if (currentData && currentData.inactive) {
          users.delete(socket.id);
        }
      }, 60000); // 1 minute timeout
    }
  });
});

// API endpoint to retrieve messages
app.get('/api/messages', async (req, res) => {
  try {
    const { room, recipientId, senderId, isFile } = req.query;
    
    const query = {};
    if (room) query.room = room;
    if (recipientId && senderId) {
      query.$or = [
        { recipientId, senderId },
        { recipientId: senderId, senderId: recipientId }
      ];
    }
    if (isFile === 'true') query.isFile = true;
    
    const messages = await Message.find(query).sort({ timestamp: 1 }).limit(50);
    res.json(messages);
  } catch (err) {
    console.error('Error retrieving messages:', err);
    res.status(500).json({ error: 'Failed to retrieve messages' });
  }
});

// API endpoint to retrieve files
app.get('/api/files', async (req, res) => {
  try {
    const files = await Message.find({ isFile: true }).sort({ timestamp: -1 }).limit(50);
    res.json(files);
  } catch (err) {
    console.error('Error retrieving files:', err);
    res.status(500).json({ error: 'Failed to retrieve files' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Regularly check for inactive users
setInterval(() => {
  const now = Date.now();
  for (let [id, user] of users.entries()) {
    // If user hasn't been active for more than 2 minutes
    if (now - user.lastActive > 120000) {
      console.log(`User ${user.name} timed out due to inactivity`);
      users.delete(id);
      io.to('general').emit('userLeft', { 
        id, 
        name: user.name,
        room: 'general'
      });
    }
  }
}, 60000); // Check every minute

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));