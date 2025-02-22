import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

// Connect to the server
const socket = io('http://localhost:5000', {
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000
});

function App() {
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [name, setName] = useState('');
  const [role, setRole] = useState('student');
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [room, setRoom] = useState('general');
  const [roomsInfo, setRoomsInfo] = useState({});
  const [connected, setConnected] = useState(socket.connected);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState({});
  const [showFileStorage, setShowFileStorage] = useState(false);
  const messagesEndRef = useRef(null);
  const notificationSound = useRef(null);

  // Initialize notification sound with error handling
  useEffect(() => {
    try {
      notificationSound.current = new Audio('/notification.mp3');
      notificationSound.current.load(); // Preload the sound file
    } catch (error) {
      console.log('Error initializing notification sound:', error);
    }
  }, []);

  // Auto-scroll to the bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Setup browser notifications
  useEffect(() => {
    // Request notification permission
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  }, []);

  // Get files for the file storage page
  const getFiles = () => {
    return messages.filter(msg => msg.isFile);
  };

  // Play notification sound with better error handling
  const playNotificationSound = () => {
    if (!notificationSound.current) return;
    
    try {
      const playPromise = notificationSound.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => console.log('Error playing sound:', e));
      }
    } catch (error) {
      console.log('Error playing notification sound:', error);
    }
  };

  // Show browser notification
  const showBrowserNotification = (title, body) => {
    if (Notification.permission === 'granted' && document.hidden) {
      try {
        new Notification(title, {
          body: body,
          icon: '/favicon.ico'
        });
      } catch (error) {
        console.log('Error showing notification:', error);
      }
    }
  };

  // Socket event listeners for connection status
  useEffect(() => {
    // Handle connection status
    socket.on('connect', () => {
      console.log('Connected to server');
      setConnected(true);
      
      // If user was already logged in, try to reconnect
      if (user) {
        socket.emit('reconnect', {
          name: user.name,
          role: user.role,
          id: user.id
        });
      }
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      setConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.log('Connection error:', error.message);
      setConnected(false);
    });

    // Handle reconnection success
    socket.on('reconnected', (data) => {
      console.log('Reconnected successfully');
    });

    // Handle room info
    socket.on('roomsInfo', (rooms) => {
      setRoomsInfo(rooms);
    });

    // Handle server ping to keep connection alive
    socket.on('ping', () => {
      socket.emit('pong');
    });

    // Handle errors
    socket.on('error', (error) => {
      alert(error.message);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('reconnected');
      socket.off('roomsInfo');
      socket.off('ping');
      socket.off('error');
    };
  }, [user]);

  // Handle message history loading
  useEffect(() => {
    // Handle previous messages from server when reconnecting or logging in
    socket.on('previousMessages', (messagesData) => {
      console.log('Received previous messages:', messagesData.length);
      
      setMessages(prevMessages => {
        // Filter out duplicates by messageId
        const existingIds = new Set(prevMessages.map(m => m.messageId));
        const newMessages = messagesData.filter(m => !existingIds.has(m.messageId));
        
        // Combine existing and new messages, then sort by timestamp
        const combinedMessages = [...prevMessages, ...newMessages];
        return combinedMessages.sort((a, b) => 
          new Date(a.timestamp) - new Date(b.timestamp)
        );
      });
    });

    return () => {
      socket.off('previousMessages');
    };
  }, []);

  // Messaging and notifications socket events
  useEffect(() => {
    // Handle incoming messages
    socket.on('message', (messageData) => {
      console.log('Received message:', messageData);
      
      // Use functional form of setState to ensure working with the latest state
      setMessages(prevMessages => {
        // Check if this message already exists (avoid duplicates)
        if (messageData.messageId && prevMessages.some(msg => msg.messageId === messageData.messageId)) {
          return prevMessages;
        }
        return [...prevMessages, messageData];
      });
      
      // Update unread count
      if (messageData.room === room || 
         (messageData.senderId === selectedUser?.id && messageData.recipientId === socket.id) ||
         (messageData.recipientId === selectedUser?.id && messageData.senderId === socket.id)) {
        // Reset unread count for current chat
        setUnreadCount(prev => ({
          ...prev,
          [messageData.room || messageData.senderId]: 0
        }));
      } else if (messageData.senderId !== socket.id) {
        // Increment unread count for other chats
        const key = messageData.room || messageData.senderId;
        setUnreadCount(prev => ({
          ...prev,
          [key]: (prev[key] || 0) + 1
        }));
      }
    });

    // Handle file sharing
    socket.on('fileShared', (fileData) => {
      console.log('Received file shared event:', fileData);
      
      // Only process if it's meant for this user
      if (fileData.recipientId && fileData.recipientId !== socket.id) return;
      if (fileData.room && fileData.room !== room && fileData.senderId !== socket.id) return;
      
      // For direct messages sent by the current user, we've already added them locally
      if (fileData.confirmation && fileData.senderId === socket.id) return;
      
      // Ensure file data is properly formatted
      const fileMessage = {
        text: `Shared file: ${fileData.name}`,
        sender: fileData.sender,
        senderId: fileData.senderId,
        role: fileData.role || 'unknown',
        timestamp: fileData.timestamp || new Date().toISOString(),
        isFile: true,
        messageId: fileData.messageId,
        fileData: {
          name: fileData.name,
          type: fileData.type || 'application/octet-stream',
          size: fileData.size || 0,
          data: fileData.data
        }
      };
      
      if (fileData.recipientId) {
        fileMessage.recipientId = fileData.recipientId;
        fileMessage.recipientName = fileData.recipientName;
      } else {
        fileMessage.room = fileData.room;
      }
      
      // Check if this message already exists
      setMessages(prevMessages => {
        if (fileData.messageId && prevMessages.some(msg => msg.messageId === fileData.messageId)) {
          return prevMessages;
        }
        console.log('Adding file message to state:', fileMessage.text);
        return [...prevMessages, fileMessage];
      });
      
      // Update unread count for other chats
      if (fileData.senderId !== socket.id && 
         ((fileData.room && fileData.room !== room) || 
          (fileData.senderId && selectedUser?.id !== fileData.senderId))) {
        const key = fileData.room || fileData.senderId;
        setUnreadCount(prev => ({
          ...prev,
          [key]: (prev[key] || 0) + 1
        }));
      }
    });

    // Handle notifications
    socket.on('notification', (notification) => {
      // Don't show notifications for the current room or selected user
      if (notification.room && notification.room === room) return;
      if (notification.from === selectedUser?.name) return;
      
      // Add to notifications list with required fields
      setNotifications(prev => [
        ...prev, 
        { 
          ...notification, 
          id: notification.id || Date.now(),
          preview: notification.preview || 'New notification'
        }
      ]);
      
      // Play sound for all notifications
      playNotificationSound();
      
      // Show browser notification based on type
      switch (notification.type) {
        case 'newMessage':
          showBrowserNotification(
            `New message from ${notification.from}`,
            notification.preview || 'New message'
          );
          break;
        case 'newRoomMessage':
          showBrowserNotification(
            `New message in ${notification.room}`,
            `${notification.from}: ${notification.preview || 'New message'}`
          );
          break;
        case 'newFile':
          showBrowserNotification(
            `New file from ${notification.from}`,
            `Shared file: ${notification.fileName || 'File'}`
          );
          break;
        case 'newRoomFile':
          showBrowserNotification(
            `New file in ${notification.room}`,
            `${notification.from} shared file: ${notification.fileName || 'File'}`
          );
          break;
        default:
          break;
      }
    });

    // Handle receiving user list
    socket.on('usersList', (usersList) => {
      setUsers(usersList);
    });

    // Handle user joining
    socket.on('userJoined', (userData) => {
      setUsers(prevUsers => {
        // Check if user already exists
        const exists = prevUsers.some(u => u.id === userData.id);
        if (!exists) {
          return [...prevUsers, userData];
        }
        return prevUsers;
      });
      
      // Only add system message if it's for the correct room
      setMessages(prevMessages => [
        ...prevMessages,
        {
          system: true,
          text: `${userData.name} joined the chat`,
          timestamp: new Date().toISOString(),
          room: userData.room || 'general' // Use the room from userData
        }
      ]);
    });

    // Handle user going offline
    socket.on('userOffline', (userData) => {
      setUsers(prevUsers => {
        return prevUsers.map(user => {
          if (user.id === userData.id) {
            return { ...user, offline: true };
          }
          return user;
        });
      });
      
      setMessages(prevMessages => [
        ...prevMessages,
        {
          system: true,
          text: `${userData.name} went offline`,
          timestamp: new Date().toISOString(),
          room: 'general'
        }
      ]);
    });

    // Handle user leaving
    socket.on('userLeft', (userData) => {
      setUsers(prevUsers => prevUsers.filter(u => u.id !== userData.id));
      
      // Only add system message if it's for the correct room
      setMessages(prevMessages => [
        ...prevMessages,
        {
          system: true,
          text: `${userData.name || 'A user'} left the chat`,
          timestamp: new Date().toISOString(),
          room: userData.room || 'general' // Use the room from userData
        }
      ]);
      
      // Clear selected user if they left
      if (selectedUser && selectedUser.id === userData.id) {
        setSelectedUser(null);
        setRoom('general');
      }
    });

    // Clean up on unmount
    return () => {
      socket.off('message');
      socket.off('fileShared');
      socket.off('notification');
      socket.off('usersList');
      socket.off('userJoined');
      socket.off('userOffline');
      socket.off('userLeft');
    };
  }, [selectedUser, room, socket.id]);

  // Reset unread count when changing room or selected user
  useEffect(() => {
    if (room) {
      setUnreadCount(prev => ({
        ...prev,
        [room]: 0
      }));
    } else if (selectedUser) {
      setUnreadCount(prev => ({
        ...prev,
        [selectedUser.id]: 0
      }));
    }
  }, [room, selectedUser]);

  // Handle joining the chat
  const handleJoin = (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    // Join the chat
    const userData = { name, role };
    socket.emit('join', userData);
    setUser({ ...userData, id: socket.id });
    
    // Join general room by default
    handleJoinRoom('general');
  };

  // Handle joining a room
  const handleJoinRoom = (roomName) => {
    socket.emit('joinRoom', roomName);
    setRoom(roomName);
    setSelectedUser(null);
  };

  // Handle selecting a user for direct message
  const handleSelectUser = (selectedUser) => {
    setSelectedUser(selectedUser);
    setRoom(null);
  };

  // Handle sending messages
  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!message.trim() || !user) return;
    
    // Check if user has permission to post in this room
    if (room && roomsInfo[room] && 
        roomsInfo[room].postingRoles && 
        !roomsInfo[room].postingRoles.includes(role)) {
      alert(`Only ${roomsInfo[room].postingRoles.join(', ')} can post in ${roomsInfo[room].name}`);
      return;
    }

    // Prepare message data
    const messageData = {
      text: message,
      sender: user.name,
      senderId: socket.id,
      role: user.role,
      timestamp: new Date().toISOString(),
      messageId: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9)
    };

    // Add recipient or room information
    if (selectedUser) {
      messageData.recipientId = selectedUser.id;
      messageData.recipientName = selectedUser.name;
    } else {
      messageData.room = room;
    }

    // Send the message
    socket.emit('message', messageData);
    
    // Also add it immediately to our local state for better responsiveness
    setMessages(prevMessages => [...prevMessages, messageData]);
    
    // Clear the input
    setMessage('');
  };
  
  // Handle file upload
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Check if user has permission to post in this room
    if (room && roomsInfo[room] && 
        roomsInfo[room].postingRoles && 
        !roomsInfo[room].postingRoles.includes(role)) {
      alert(`Only ${roomsInfo[room].postingRoles.join(', ')} can post in ${roomsInfo[room].name}`);
      return;
    }
    
    // Limit file size to 5MB
    if (file.size > 5 * 1024 * 1024) {
      alert('File size exceeds 5MB limit');
      return;
    }
    
    // Create a reader to read the file
    const reader = new FileReader();
    
    reader.onload = (event) => {
      // Generate a unique message ID to track this upload
      const messageId = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
      
      // File metadata to share with others
      const fileData = {
        name: file.name,
        size: file.size,
        type: file.type,
        sender: user.name,
        senderId: socket.id,
        role: user.role,
        timestamp: new Date().toISOString(),
        messageId: messageId // Add a unique ID
      };
      
      // Add recipient or room information
      if (selectedUser) {
        fileData.recipientId = selectedUser.id;
        fileData.recipientName = selectedUser.name;
      } else {
        fileData.room = room;
      }
      
      // Create a downloadable link for the file (base64 encoded)
      const base64Data = event.target.result;
      fileData.data = base64Data;
      
      // Send file notification through socket
      socket.emit('fileShared', fileData);
      
      // Add file message to local messages
      const fileMessage = {
        text: `Shared file: ${file.name}`,
        sender: user.name,
        senderId: socket.id,
        role: user.role,
        timestamp: new Date().toISOString(),
        isFile: true,
        messageId: messageId,
        fileData: {
          name: file.name,
          type: file.type,
          size: file.size,
          data: base64Data
        }
      };
      
      if (selectedUser) {
        fileMessage.recipientId = selectedUser.id;
        fileMessage.recipientName = selectedUser.name;
      } else {
        fileMessage.room = room;
      }
      
      setMessages(prevMessages => [...prevMessages, fileMessage]);
    };
    
    // Read file as data URL (base64)
    reader.readAsDataURL(file);
  };

  // Handle file download
  const handleFileDownload = (fileData) => {
    // Create a link element
    const link = document.createElement('a');
    link.href = fileData.data;
    link.download = fileData.name;
    
    // Append to body, click, and remove
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Dismiss a notification
  const dismissNotification = (id) => {
    setNotifications(prev => prev.filter(notification => notification.id !== id));
  };

  // Clear all notifications
  const clearAllNotifications = () => {
    setNotifications([]);
  };

  // Handle reconnect button click
  const handleReconnect = () => {
    if (!connected) {
      socket.connect();
      if (user) {
        socket.once('connect', () => {
          socket.emit('reconnect', {
            name: user.name,
            role: user.role,
            id: user.id
          });
        });
      }
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Secure Chat Application</h1>
        {user && (
          <div className="user-info-header">
            <span className="welcome-text">Hello, {user.name} ({user.role})</span>
            {!showFileStorage && (
              <button 
                className="file-storage-button"
                onClick={() => setShowFileStorage(true)}
              >
                File Storage
              </button>
            )}
            {showFileStorage && (
              <button 
                className="file-storage-button back"
                onClick={() => setShowFileStorage(false)}
              >
                Back to Chat
              </button>
            )}
            <button 
              className="logout-button"
              onClick={() => {
                // Send logout notification to server
                if (socket.connected) {
                  socket.emit('userLogout');
                }
                // Clear user data
                setUser(null);
                setMessages([]);
                setUsers([]);
                setSelectedUser(null);
                setRoom(null);
                setNotifications([]);
                setUnreadCount({});
                setShowFileStorage(false);
              }}
            >
              Logout
            </button>
          </div>
        )}
        {!connected && user && (
          <div className="connection-status offline" onClick={handleReconnect}>
            Disconnected - Click to reconnect
          </div>
        )}
        {notifications.length > 0 && (
          <div className="notifications-dropdown">
            <button className="notifications-button">
              Notifications ({notifications.length})
            </button>
            <div className="notifications-content">
              <div className="notifications-header">
                <h3>Notifications</h3>
                <button onClick={clearAllNotifications} className="clear-notifications">
                  Clear All
                </button>
              </div>
              {notifications.length === 0 ? (
                <div className="notification-item">No new notifications</div>
              ) : (
                notifications.map(notification => (
                  <div key={notification.id} className="notification-item">
                    {notification.type === 'newMessage' && (
                      <div>
                        <strong>{notification.from}:</strong> {notification.preview}
                      </div>
                    )}
                    {notification.type === 'newRoomMessage' && (
                      <div>
                        <strong>{notification.room}:</strong> {notification.from}: {notification.preview}
                      </div>
                    )}
                    {(notification.type === 'newFile' || notification.type === 'newRoomFile') && (
                      <div>
                        <strong>{notification.type === 'newFile' ? notification.from : notification.room}:</strong> 
                        {notification.from} shared file: {notification.fileName}
                      </div>
                    )}
                    <button 
                      onClick={() => dismissNotification(notification.id)}
                      className="dismiss-notification"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </header>

      {!user ? (
        // Login form
        <div className="login-container">
          <form onSubmit={handleJoin} className="login-form">
            <h2>Join the Chat</h2>
            <input
              type="text"
              placeholder="Enter your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <select 
              value={role} 
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="student">Student</option>
              <option value="lecturer">Lecturer</option>
            </select>
            <button type="submit">Join</button>
          </form>
        </div>
      ) : showFileStorage ? (
        // File storage view
        <div className="file-storage-container">
          <h2>My Files</h2>
          
          <div className="file-storage-tabs">
            <button 
              className={`file-tab ${selectedUser === null && room === null ? 'active' : ''}`}
              onClick={() => {
                setSelectedUser(null);
                setRoom(null);
              }}
            >
              All Files
            </button>
            {Object.entries(roomsInfo).map(([roomKey, roomData]) => (
              <button 
                key={roomKey}
                className={`file-tab ${room === roomKey ? 'active' : ''}`}
                onClick={() => {
                  setRoom(roomKey);
                  setSelectedUser(null);
                }}
              >
                {roomData.name || roomKey}
              </button>
            ))}
          </div>
          
          <div className="file-list">
            {getFiles()
              .filter(file => {
                if (!room && !selectedUser) return true; // All files
                if (room && file.room === room) return true; // Files from specific room
                if (selectedUser && 
                    ((file.senderId === selectedUser.id && file.recipientId === socket.id) || 
                     (file.recipientId === selectedUser.id && file.senderId === socket.id))) {
                  return true; // Files from specific user chat
                }
                return false;
              })
              .map((file, index) => (
                <div key={index} className="file-item">
                  <div className="file-item-info">
                    <span className="file-item-name">{file.fileData.name}</span>
                    <div className="file-item-meta">
                      <span className="file-item-size">{Math.round(file.fileData.size / 1024)} KB</span>
                      <span className="file-item-from">
                        {file.room 
                          ? `Shared in ${file.room}`
                          : file.senderId === socket.id 
                            ? `Sent to ${file.recipientName}`
                            : `Received from ${file.sender}`
                        }
                      </span>
                      <span className="file-item-date">
                        {new Date(file.timestamp).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <button 
                    className="download-button"
                    onClick={() => handleFileDownload(file.fileData)}
                  >
                    Download
                  </button>
                </div>
              ))}
            {getFiles().filter(file => {
              if (!room && !selectedUser) return true;
              if (room && file.room === room) return true;
              if (selectedUser && 
                  ((file.senderId === selectedUser.id && file.recipientId === socket.id) || 
                   (file.recipientId === selectedUser.id && file.senderId === socket.id))) {
                return true;
              }
              return false;
            }).length === 0 && (
              <div className="no-files">No files found</div>
            )}
          </div>
        </div>
      ) : (
        // Chat interface
        <div className="chat-container">
          {/* Sidebar for users and rooms */}
          <div className="sidebar">
            <div className="rooms-section">
              <h3>Rooms</h3>
              <div className="rooms-list">
                {Object.entries(roomsInfo).length > 0 ? 
                  Object.entries(roomsInfo).map(([roomKey, roomData]) => 
                    // Only show rooms user has access to
                    roomData.allowedRoles && roomData.allowedRoles.includes(role) && (
                      <div 
                        key={roomKey}
                        className={`room ${room === roomKey ? 'active' : ''}`}
                        onClick={() => handleJoinRoom(roomKey)}
                      >
                        <span className="room-name">
                          {roomData.name || roomKey}
                          {unreadCount[roomKey] > 0 && (
                            <span className="unread-badge">{unreadCount[roomKey]}</span>
                          )}
                        </span>
                        {roomData.postingRoles && !roomData.postingRoles.includes(role) && (
                          <span className="read-only-label">Read-only</span>
                        )}
                      </div>
                    )
                  ) : (
                    // Fallback for when roomsInfo is not available yet
                    <>
                      <div 
                        className={`room ${room === 'general' ? 'active' : ''}`}
                        onClick={() => handleJoinRoom('general')}
                      >
                        General
                        {unreadCount['general'] > 0 && (
                          <span className="unread-badge">{unreadCount['general']}</span>
                        )}
                      </div>
                      <div 
                        className={`room ${room === 'assignments' ? 'active' : ''}`}
                        onClick={() => handleJoinRoom('assignments')}
                      >
                        Assignments
                        {unreadCount['assignments'] > 0 && (
                          <span className="unread-badge">{unreadCount['assignments']}</span>
                        )}
                      </div>
                      <div 
                        className={`room ${room === 'announcements' ? 'active' : ''}`}
                        onClick={() => handleJoinRoom('announcements')}
                      >
                        Announcements
                        {unreadCount['announcements'] > 0 && (
                          <span className="unread-badge">{unreadCount['announcements']}</span>
                        )}
                        {role !== 'lecturer' && role !== 'admin' && (
                          <span className="read-only-label">Read-only</span>
                        )}
                      </div>
                    </>
                  )
                }
              </div>
            </div>

            <div className="users-section">
              <h3>Users</h3>
              <div className="users-list">
                {users.filter(u => u.id !== socket.id).map(u => (
                  <div 
                    key={u.id}
                    className={`user ${selectedUser?.id === u.id ? 'active' : ''} ${u.offline ? 'offline' : ''}`}
                    onClick={() => handleSelectUser(u)}
                  >
                    <div className="user-info">
                      <span className="user-name">{u.name}</span>
                      <span className="user-role">{u.role}</span>
                    </div>
                    <div className="user-status">
                      {unreadCount[u.id] > 0 && (
                        <span className="unread-badge">{unreadCount[u.id]}</span>
                      )}
                      {u.offline && (
                        <span className="offline-indicator">Offline</span>
                      )}
                    </div>
                  </div>
                ))}
                {users.length <= 1 && (
                  <div className="no-users">No other users online</div>
                )}
              </div>
            </div>
          </div>

          {/* Main chat area */}
          <div className="main-chat">
            <div className="chat-header">
              {selectedUser ? (
                <h2>
                  Chat with {selectedUser.name}
                  {selectedUser.offline && <span className="user-offline-status"> (Offline)</span>}
                </h2>
              ) : (
                <h2>
                  Room: {roomsInfo[room]?.name || room}
                  {room && roomsInfo[room]?.postingRoles && !roomsInfo[room].postingRoles.includes(role) && (
                    <span className="read-only-header"> (Read-only)</span>
                  )}
                </h2>
              )}
            </div>

            <div className="messages-container">
              {messages
                .filter(msg => {
                  // Filter messages based on current view (direct or room)
                  if (selectedUser) {
                    return (msg.senderId === selectedUser.id && msg.recipientId === socket.id) || 
                           (msg.recipientId === selectedUser.id && msg.senderId === socket.id);
                  } else {
                    // System messages should only show in the specified room
                    if (msg.system) {
                      return msg.room === room;
                    }
                    return msg.room === room;
                  }
                })
                .map((msg, index) => (
                  <div 
                    key={index} 
                    className={`message ${msg.system ? 'system-message' : 
                      msg.senderId === socket.id ? 'my-message' : 'other-message'}`}
                  >
                    {!msg.system && (
                      <div className="message-header">
                        <span className="sender">{msg.sender}</span>
                        <span className="role">{msg.role}</span>
                        <span className="time">
                          {new Date(msg.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    )}
                    
                    {/* Check if it's a file message or regular message */}
                    {!msg.system && msg.isFile ? (
                      <div className="file-attachment">
                        <div className="file-info">
                          <span className="file-name">{msg.text}</span>
                          <span className="file-size">
                            {Math.round(msg.fileData.size / 1024)} KB
                          </span>
                        </div>
                        <button 
                          className="download-button"
                          onClick={() => handleFileDownload(msg.fileData)}
                        >
                          Download
                        </button>
                      </div>
                    ) : (
                      <div className="message-text">{msg.text}</div>
                    )}
                  </div>
                ))}
              <div ref={messagesEndRef} />
            </div>
          
            <form onSubmit={handleSendMessage} className="message-form">
              <div className="attachment-button">
                <label 
                  htmlFor="file-upload" 
                  className={`file-label ${!connected || (room && roomsInfo[room]?.postingRoles && !roomsInfo[room].postingRoles.includes(role)) ? 'disabled' : ''}`}
                >
                  📎
                  <input
                    id="file-upload"
                    type="file"
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                    disabled={!connected || (room && roomsInfo[room]?.postingRoles && !roomsInfo[room].postingRoles.includes(role))}
                  />
                </label>
              </div>
              <input
                type="text"
                placeholder={
                  !connected ? "Reconnecting..." : 
                  (room && roomsInfo[room]?.postingRoles && !roomsInfo[room].postingRoles.includes(role)) ?
                  "Read-only channel" : 
                  `Message ${selectedUser ? selectedUser.name : room}...`
                }
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={!connected || (room && roomsInfo[room]?.postingRoles && !roomsInfo[room].postingRoles.includes(role))}
              />
              <button 
                type="submit"
                disabled={!connected || !message.trim() || (room && roomsInfo[room]?.postingRoles && !roomsInfo[room].postingRoles.includes(role))}
                className={!connected || !message.trim() || (room && roomsInfo[room]?.postingRoles && !roomsInfo[room].postingRoles.includes(role)) ? 'disabled' : ''}
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;