import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  Pressable, 
  ScrollView, 
  KeyboardAvoidingView, 
  Platform, 
  SafeAreaView, 
  FlatList,
  TouchableOpacity,
  Alert,
  AppState
} from 'react-native';
import io from 'socket.io-client';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Notifications from 'expo-notifications';

// Configure socket with reconnection settings
// Replace with your actual IP address!
const socket = io('http://192.168.0.18:5000', {
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000
});

// Configure notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function HomeScreen() {
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [name, setName] = useState('');
  const [role, setRole] = useState('student');
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [room, setRoom] = useState('general');
  const [showSidebar, setShowSidebar] = useState(false);
  const [roomsInfo, setRoomsInfo] = useState({});
  const [connected, setConnected] = useState(socket.connected);
  const [reconnecting, setReconnecting] = useState(false);
  const [unreadCount, setUnreadCount] = useState({});
  const [showFileStorage, setShowFileStorage] = useState(false);
  const scrollViewRef = useRef();
  const appState = useRef(AppState.currentState);

  // Handle app state changes (background/foreground)
  useEffect(() => {
    const subscription = AppState.addEventListener("change", nextAppState => {
      if (appState.current === "background" && nextAppState === "active" && user) {
        console.log("App has come to the foreground - attempting reconnect");
        tryReconnect();
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [user]);

  // Try to reconnect to the server
  const tryReconnect = () => {
    if (!user) return;
    
    setReconnecting(true);
    
    // If socket is not connected, try to reconnect
    if (!socket.connected) {
      // Force socket reconnection
      socket.connect();
      
      // Send reconnection data after connection
      socket.once('connect', () => {
        socket.emit('reconnect', {
          name: user.name,
          role: user.role,
          id: user.id
        });
      });
    } else {
      // If socket is already connected, just send reconnect data
      socket.emit('reconnect', {
        name: user.name,
        role: user.role,
        id: user.id
      });
    }
  };

  // Get files for the file storage page
  const getFiles = () => {
    return messages.filter(msg => msg.isFile);
  };

  // Show notification
  const showNotification = (title, body, data = {}) => {
    // Only show notifications if we have permission
    Notifications.getPermissionsAsync().then(({ status }) => {
      if (status === 'granted') {
        Notifications.scheduleNotificationAsync({
          content: {
            title,
            body,
            data,
          },
          trigger: null, // Show immediately
        });
      } else if (Platform.OS === 'android') {
        // For Android, try to show a toast notification
        if (Platform.OS === 'android' && ToastAndroid) {
          ToastAndroid.show(`${title}: ${body}`, ToastAndroid.SHORT);
        }
      }
    });
  };

  // Handle socket connection events
  useEffect(() => {
    // Request notification permissions
    Notifications.requestPermissionsAsync();

    // Connect to server
    if (!socket.connected) {
      socket.connect();
    }

    // Handle connection status
    socket.on('connect', () => {
      console.log('Connected to server');
      setConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      setConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.log('Connection error:', error.message);
      setConnected(false);
    });

    // Handle server ping to keep connection alive
    socket.on('ping', () => {
      socket.emit('pong');
    });

    // Handle reconnection success
    socket.on('reconnected', (data) => {
      console.log('Reconnected successfully');
      setReconnecting(false);
      
      // Show confirmation
      if (Platform.OS === 'android' && ToastAndroid) {
        ToastAndroid.show('Reconnected to chat', ToastAndroid.SHORT);
      }
    });

    // Handle room info
    socket.on('roomsInfo', (rooms) => {
      setRoomsInfo(rooms);
    });

    // Handle room joined confirmation
    socket.on('roomJoined', (data) => {
      setRoom(data.room);
    });

    // Handle errors
    socket.on('error', (error) => {
      Alert.alert('Error', error.message);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('ping');
      socket.off('reconnected');
      socket.off('roomsInfo');
      socket.off('roomJoined');
      socket.off('error');
    };
  }, []);

  // Socket messaging events
  useEffect(() => {
    // Handle incoming messages
    socket.on('message', (messageData) => {
      setMessages(prevMessages => [...prevMessages, messageData]);
      
      // Increment unread count for other users or rooms
      if (messageData.senderId !== socket.id) {
        if ((messageData.room && messageData.room !== room) || 
            (messageData.senderId && selectedUser?.id !== messageData.senderId)) {
          const key = messageData.room || messageData.senderId;
          setUnreadCount(prev => ({
            ...prev,
            [key]: (prev[key] || 0) + 1
          }));
        }
      }
    });

    // Handle file sharing
    socket.on('fileShared', (fileData) => {
      // If it's a confirmation of our own file send, we can ignore it
      // We've already added the file to messages in handleFilePick
      if (fileData.confirmation && fileData.senderId === socket.id) {
        console.log('Received confirmation for file:', fileData.name);
        return;
      }
      
      // Only process if it's meant for this user
      if (fileData.recipientId && fileData.recipientId !== socket.id) return;
      if (fileData.room && fileData.room !== room) return;
      
      // Ensure fileData has the proper structure
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
      } else if (fileData.room) {
        fileMessage.room = fileData.room;
      }
      
      // Check if we already have this message
      setMessages(prevMessages => {
        if (fileData.messageId && prevMessages.some(msg => msg.messageId === fileData.messageId)) {
          return prevMessages;
        }
        return [...prevMessages, fileMessage];
      });
      
      // Increment unread count
      if (fileData.senderId !== socket.id) {
        if ((fileData.room && fileData.room !== room) || 
            (fileData.senderId && selectedUser?.id !== fileData.senderId)) {
          const key = fileData.room || fileData.senderId;
          setUnreadCount(prev => ({
            ...prev,
            [key]: (prev[key] || 0) + 1
          }));
        }
      }
    });

    // Handle notifications
    socket.on('notification', (notification) => {
      // Don't show notifications for the current room or selected user
      if (notification.room && notification.room === room) return;
      if (notification.from === selectedUser?.name) return;
      
      switch (notification.type) {
        case 'newMessage':
          showNotification(
            `New message from ${notification.from}`,
            notification.preview || 'New message'
          );
          break;
        case 'newRoomMessage':
          showNotification(
            `New message in ${notification.room}`,
            `${notification.from}: ${notification.preview || 'New message'}`
          );
          break;
        case 'newFile':
          showNotification(
            `New file from ${notification.from}`,
            `Shared file: ${notification.fileName || 'File'}`
          );
          break;
        case 'newRoomFile':
          showNotification(
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
      
      setMessages(prevMessages => [
        ...prevMessages,
        {
          system: true,
          text: `${userData.name} joined the chat`,
          timestamp: new Date().toISOString(),
          room: userData.room || 'general'
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
      
      setMessages(prevMessages => [
        ...prevMessages,
        {
          system: true,
          text: `${userData.name || 'A user'} left the chat`,
          timestamp: new Date().toISOString(),
          room: userData.room || 'general'
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

  // Auto-scroll to the bottom of messages
  useEffect(() => {
    if (scrollViewRef.current) {
      setTimeout(() => {
        scrollViewRef.current.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  // Handle joining the chat
  const handleJoin = () => {
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
    setShowSidebar(false);
  };

  // Handle selecting a user for direct message
  const handleSelectUser = (user) => {
    setSelectedUser(user);
    setRoom(null);
    setShowSidebar(false);
  };

  // Handle sending messages
  const handleSendMessage = () => {
    if (!message.trim() || !user) return;
    
    // Check if user has permission to post in this room
    if (room && roomsInfo[room] && 
        roomsInfo[room].postingRoles && 
        !roomsInfo[room].postingRoles.includes(role)) {
      Alert.alert('Permission Denied', `Only ${roomsInfo[room].postingRoles.join(', ')} can post in ${roomsInfo[room].name}`);
      return;
    }

    // Prepare message data
    const messageId = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
    const messageData = {
      text: message,
      sender: user.name,
      senderId: socket.id,
      role: user.role,
      timestamp: new Date().toISOString(),
      messageId: messageId
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
    setMessage('');
  };

  // Handle file picking
  const handleFilePick = async () => {
    try {
      // Check connection
      if (!connected) {
        Alert.alert('Not Connected', 'You are currently offline. Please reconnect to send files.');
        return;
      }
      
      // Check if user has permission to post in this room
      if (room && roomsInfo[room] && 
          roomsInfo[room].postingRoles && 
          !roomsInfo[room].postingRoles.includes(role)) {
        Alert.alert('Permission Denied', 
          `Only ${roomsInfo[room].postingRoles.join(', ')} can post in ${roomsInfo[room].name}`);
        return;
      }
      
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*', // All file types
        copyToCacheDirectory: true
      });
      
      if (result.canceled === false && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        
        // Check file size (limit to 5MB)
        if (file.size > 5 * 1024 * 1024) {
          Alert.alert('File Too Large', 'Please select a file smaller than 5MB');
          return;
        }
        
        // Generate a unique message ID
        const messageId = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
        
        // Show sending indicator
        if (Platform.OS === 'android' && ToastAndroid) {
          ToastAndroid.show('Sending file...', ToastAndroid.SHORT);
        } else {
          Alert.alert('Sending', 'The file is being sent...');
        }
        
        try {
          // Read the file as base64
          const base64Data = await FileSystem.readAsStringAsync(file.uri, {
            encoding: FileSystem.EncodingType.Base64
          });
          
          // Create file data object - construct proper data URL
          const mimeType = file.mimeType || 'application/octet-stream';
          const fileData = {
            name: file.name,
            size: file.size,
            type: mimeType,
            sender: user.name,
            senderId: socket.id,
            role: user.role,
            timestamp: new Date().toISOString(),
            messageId: messageId,
            data: `data:${mimeType};base64,${base64Data}` // Properly formatted data URL
          };
          
          // Add recipient or room information
          if (selectedUser) {
            fileData.recipientId = selectedUser.id;
            fileData.recipientName = selectedUser.name;
          } else {
            fileData.room = room;
          }
          
          // Send file through socket
          socket.emit('fileShared', fileData);
          
          // Always add message to local state to show the sent file immediately
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
              type: mimeType,
              size: file.size,
              data: `data:${mimeType};base64,${base64Data}`
            }
          };
          
          if (selectedUser) {
            fileMessage.recipientId = selectedUser.id;
            fileMessage.recipientName = selectedUser.name;
          } else {
            fileMessage.room = room;
          }
          
          // Add to messages state
          setMessages(prevMessages => [...prevMessages, fileMessage]);
          
        } catch (readError) {
          console.error('Error reading file:', readError);
          Alert.alert('Error', 'Failed to read the file');
        }
      }
    } catch (error) {
      console.error('Error picking document:', error);
      Alert.alert('Error', 'Failed to pick document');
    }
  };

  // Handle file download/sharing
  const handleFileShare = async (fileData) => {
    try {
      // Create a temporary file
      const fileUri = FileSystem.cacheDirectory + fileData.name;
      
      // Extract base64 data and write to the file
      const base64Data = fileData.data.split(',')[1];
      await FileSystem.writeAsStringAsync(fileUri, base64Data, {
        encoding: FileSystem.EncodingType.Base64
      });
      
      // Check if sharing is available
      const isSharingAvailable = await Sharing.isAvailableAsync();
      
      if (isSharingAvailable) {
        // Open share dialog
        await Sharing.shareAsync(fileUri);
      } else {
        Alert.alert('Sharing Not Available', 'Sharing is not available on this device');
      }
    } catch (error) {
      console.error('Error sharing file:', error);
      Alert.alert('Error', 'Failed to share file');
    }
  };

  // Logout handler
  const handleLogout = () => {
    // Send logout notification to server
    if (socket.connected) {
      socket.emit('userLogout');
    }
    
    // Clear all states
    setUser(null);
    setMessages([]);
    setUsers([]);
    setSelectedUser(null);
    setRoom(null);
    setUnreadCount({});
    setShowFileStorage(false);
    setShowSidebar(false);
  };

  // Render login screen
  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerText}>Secure Chat App</Text>
        </View>
        
        <View style={styles.loginContainer}>
          <Text style={styles.title}>Join the Chat</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your name"
            value={name}
            onChangeText={setName}
          />
          <View style={styles.roleContainer}>
            <Text>Select Role: </Text>
            <View style={styles.roleButtons}>
              <Pressable
                style={[styles.roleButton, role === 'student' && styles.activeRole]}
                onPress={() => setRole('student')}
              >
                <Text style={role === 'student' ? styles.activeRoleText : styles.roleText}>Student</Text>
              </Pressable>
              <Pressable
                style={[styles.roleButton, role === 'lecturer' && styles.activeRole]}
                onPress={() => setRole('lecturer')}
              >
                <Text style={role === 'lecturer' ? styles.activeRoleText : styles.roleText}>Lecturer</Text>
              </Pressable>
            </View>
          </View>
          <Pressable style={styles.joinButton} onPress={handleJoin}>
            <Text style={styles.joinButtonText}>Join</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Show reconnecting indicator
  if (reconnecting) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerText}>Secure Chat App</Text>
        </View>
        <View style={styles.reconnectingContainer}>
          <Text style={styles.reconnectingText}>Reconnecting...</Text>
          <Pressable style={styles.joinButton} onPress={tryReconnect}>
            <Text style={styles.joinButtonText}>Try Again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Render chat interface
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => setShowSidebar(true)} style={styles.menuButton}>
          <Text style={styles.menuButtonText}>☰</Text>
        </Pressable>
        <Text style={styles.headerText}>
          {showFileStorage ? "File Storage" : 
           (selectedUser ? `Chat with ${selectedUser.name}` : `Room: ${room}`)}
        </Text>
        <View style={styles.headerButtons}>
          <Text style={styles.welcomeText}>Hello, {user.name}</Text>
          <TouchableOpacity 
            style={styles.fileStorageButton}
            onPress={() => setShowFileStorage(!showFileStorage)}
          >
            <Text style={styles.buttonText}>{showFileStorage ? "Back" : "Files"}</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.logoutButton}
            onPress={handleLogout}
          >
            <Text style={styles.buttonText}>Logout</Text>
          </TouchableOpacity>
          {!connected && (
            <TouchableOpacity style={styles.offlineIndicator} onPress={tryReconnect}>
              <Text style={styles.offlineText}>⚠️ Offline</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Sidebar for rooms and users */}
      {showSidebar && (
        <View style={styles.sidebar}>
          <View style={styles.sidebarHeader}>
            <Text style={styles.sidebarTitle}>Chat</Text>
            <Pressable onPress={() => setShowSidebar(false)} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </Pressable>
          </View>
          
          <View style={styles.roomsSection}>
            <Text style={styles.sectionTitle}>Rooms</Text>
            {Object.entries(roomsInfo).length > 0 ? 
              Object.entries(roomsInfo).map(([roomKey, roomData]) => 
                // Only show rooms user has access to
                roomData.allowedRoles && roomData.allowedRoles.includes(role) && (
                  <Pressable 
                    key={roomKey}
                    style={[styles.roomItem, room === roomKey && styles.activeItem]}
                    onPress={() => handleJoinRoom(roomKey)}
                  >
                    <Text style={room === roomKey ? styles.activeItemText : styles.itemText}>
                      {roomData.name || roomKey}
                    </Text>
                    <View style={styles.roomItemRight}>
                      {unreadCount[roomKey] > 0 && (
                        <View style={styles.badgeContainer}>
                          <Text style={styles.badgeText}>{unreadCount[roomKey]}</Text>
                        </View>
                      )}
                      {roomData.postingRoles && !roomData.postingRoles.includes(role) && (
                        <Text style={styles.readOnlyText}>Read-only</Text>
                      )}
                    </View>
                  </Pressable>
                )
              ) : (
                // Fallback for when roomsInfo is not available yet
                <>
                  <Pressable 
                    style={[styles.roomItem, room === 'general' && styles.activeItem]}
                    onPress={() => handleJoinRoom('general')}
                  >
                    <Text style={room === 'general' ? styles.activeItemText : styles.itemText}>General</Text>
                    {unreadCount['general'] > 0 && (
                      <View style={styles.badgeContainer}>
                        <Text style={styles.badgeText}>{unreadCount['general']}</Text>
                      </View>
                    )}
                  </Pressable>
                  <Pressable 
                    style={[styles.roomItem, room === 'assignments' && styles.activeItem]}
                    onPress={() => handleJoinRoom('assignments')}
                  >
                    <Text style={room === 'assignments' ? styles.activeItemText : styles.itemText}>Assignments</Text>
                    {unreadCount['assignments'] > 0 && (
                      <View style={styles.badgeContainer}>
                        <Text style={styles.badgeText}>{unreadCount['assignments']}</Text>
                      </View>
                    )}
                  </Pressable>
                  <Pressable 
                    style={[styles.roomItem, room === 'announcements' && styles.activeItem]}
                    onPress={() => handleJoinRoom('announcements')}
                  >
                    <Text style={room === 'announcements' ? styles.activeItemText : styles.itemText}>
                      Announcements
                    </Text>
                    <View style={styles.roomItemRight}>
                      {unreadCount['announcements'] > 0 && (
                        <View style={styles.badgeContainer}>
                          <Text style={styles.badgeText}>{unreadCount['announcements']}</Text>
                        </View>
                      )}
                      {role !== 'lecturer' && role !== 'admin' && (
                        <Text style={styles.readOnlyText}> (Read-only)</Text>
                      )}
                    </View>
                  </Pressable>
                </>
              )
            }
          </View>
          
          <View style={styles.usersSection}>
            <Text style={styles.sectionTitle}>Users</Text>
            <FlatList
              data={users.filter(u => u.id !== socket.id)}
              keyExtractor={item => item.id}
              renderItem={({item}) => (
                <Pressable 
                  style={[
                    styles.userItem, 
                    selectedUser?.id === item.id && styles.activeItem,
                    item.offline && styles.offlineUser
                  ]}
                  onPress={() => handleSelectUser(item)}
                >
                  <Text style={selectedUser?.id === item.id ? styles.activeItemText : styles.itemText}>
                    {item.name} {item.offline ? "(offline)" : ""}
                  </Text>
                  <View style={styles.userItemRight}>
                    {unreadCount[item.id] > 0 && (
                      <View style={styles.badgeContainer}>
                        <Text style={styles.badgeText}>{unreadCount[item.id]}</Text>
                      </View>
                    )}
                    <Text style={selectedUser?.id === item.id ? styles.activeRoleText : styles.roleText}>
                      {item.role}
                    </Text>
                  </View>
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyListText}>No other users online</Text>
              }
            />
          </View>
        </View>
      )}

      {showFileStorage ? (
        // File storage view
        <View style={styles.fileStorageContainer}>
          <View style={styles.fileTabsContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <TouchableOpacity 
                style={[styles.fileTab, !room && !selectedUser && styles.activeFileTab]}
                onPress={() => {
                  setRoom(null);
                  setSelectedUser(null);
                }}
              >
                <Text style={[styles.fileTabText, !room && !selectedUser && styles.activeFileTabText]}>
                  All Files
                </Text>
              </TouchableOpacity>
              
              {Object.entries(roomsInfo).length > 0 ? 
                Object.entries(roomsInfo).map(([roomKey, roomData]) => 
                  roomData.allowedRoles && roomData.allowedRoles.includes(role) && (
                    <TouchableOpacity 
                      key={roomKey}
                      style={[styles.fileTab, room === roomKey && styles.activeFileTab]}
                      onPress={() => {
                        setRoom(roomKey);
                        setSelectedUser(null);
                      }}
                    >
                      <Text style={[styles.fileTabText, room === roomKey && styles.activeFileTabText]}>
                        {roomData.name || roomKey}
                      </Text>
                    </TouchableOpacity>
                  )
                ) : (
                  <>
                    <TouchableOpacity 
                      style={[styles.fileTab, room === 'general' && styles.activeFileTab]}
                      onPress={() => {
                        setRoom('general');
                        setSelectedUser(null);
                      }}
                    >
                      <Text style={[styles.fileTabText, room === 'general' && styles.activeFileTabText]}>
                        General
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.fileTab, room === 'assignments' && styles.activeFileTab]}
                      onPress={() => {
                        setRoom('assignments');
                        setSelectedUser(null);
                      }}
                    >
                      <Text style={[styles.fileTabText, room === 'assignments' && styles.activeFileTabText]}>
                        Assignments
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.fileTab, room === 'announcements' && styles.activeFileTab]}
                      onPress={() => {
                        setRoom('announcements');
                        setSelectedUser(null);
                      }}
                    >
                      <Text style={[styles.fileTabText, room === 'announcements' && styles.activeFileTabText]}>
                        Announcements
                      </Text>
                    </TouchableOpacity>
                  </>
                )
              }
            </ScrollView>
          </View>
          
          <FlatList
            data={getFiles().filter(file => {
              if (!room && !selectedUser) return true; // All files
              if (room && file.room === room) return true; // Files from specific room
              if (selectedUser && 
                  ((file.senderId === selectedUser.id && file.recipientId === socket.id) || 
                  (file.recipientId === selectedUser.id && file.senderId === socket.id))) {
                return true; // Files from specific user chat
              }
              return false;
            })}
            keyExtractor={(_, index) => index.toString()}
            ListEmptyComponent={
              <Text style={styles.noFilesText}>No files found</Text>
            }
            renderItem={({item}) => (
              <View style={styles.fileItem}>
                <View style={styles.fileItemInfo}>
                  <Text style={styles.fileItemName}>{item.fileData.name}</Text>
                  <View style={styles.fileItemMeta}>
                    <Text style={styles.fileItemSize}>{Math.round(item.fileData.size / 1024)} KB</Text>
                    <Text style={styles.fileItemFrom}>
                      {item.room 
                        ? `In ${item.room}`
                        : item.senderId === socket.id 
                          ? `To ${item.recipientName}`
                          : `From ${item.sender}`
                      }
                    </Text>
                  </View>
                </View>
                <TouchableOpacity 
                  style={styles.downloadButton}
                  onPress={() => handleFileShare(item.fileData)}
                >
                  <Text style={styles.downloadButtonText}>Share</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        </View>
      ) : (
        // Chat view
        <View style={styles.chatContainer}>
          <ScrollView
            style={styles.messagesContainer}
            ref={scrollViewRef}
            contentContainerStyle={{ paddingBottom: 20 }}
          >
            {messages
              .filter(msg => {
                // Filter messages based on current view (direct or room)
                if (selectedUser) {
                  return (msg.senderId === selectedUser.id && msg.recipientId === socket.id) || 
                        (msg.recipientId === selectedUser.id && msg.senderId === socket.id);
                } else {
                  // System messages should only appear in their designated room
                  if (msg.system) {
                    return msg.room === room;
                  }
                  return msg.room === room;
                }
              })
              .map((msg, index) => (
                <View
                  key={index}
                  style={[
                    styles.message,
                    msg.system ? styles.systemMessage :
                      msg.senderId === socket.id ? styles.myMessage : styles.otherMessage
                  ]}
                >
                  {!msg.system && (
                    <View style={styles.messageHeader}>
                      <Text style={styles.sender}>{msg.sender}</Text>
                      <Text style={styles.role}>{msg.role}</Text>
                      <Text style={styles.time}>
                        {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </Text>
                    </View>
                  )}
                  
                  {/* Display file message or regular text message */}
                  {!msg.system && msg.isFile ? (
                    <View style={styles.fileAttachment}>
                      <View style={styles.fileInfo}>
                        <Text style={styles.fileName}>{msg.text}</Text>
                        <Text style={styles.fileSize}>
                          {Math.round(msg.fileData.size / 1024)} KB
                        </Text>
                      </View>
                      <TouchableOpacity 
                        style={styles.downloadButton}
                        onPress={() => handleFileShare(msg.fileData)}
                      >
                        <Text style={styles.downloadButtonText}>Share</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <Text style={styles.messageText}>{msg.text}</Text>
                  )}
                </View>
              ))}
          </ScrollView>

          <View style={styles.messageForm}>
            <TouchableOpacity 
              onPress={handleFilePick} 
              style={[styles.attachmentButton, (!connected || 
                (room && roomsInfo[room]?.postingRoles && !roomsInfo[room].postingRoles.includes(role))) && 
                styles.disabledAttachment]}
              disabled={!connected || (room && roomsInfo[room]?.postingRoles && !roomsInfo[room].postingRoles.includes(role))}
            >
              <Text style={styles.attachmentButtonText}>📎</Text>
            </TouchableOpacity>
            
            <TextInput
              style={styles.messageInput}
              placeholder={
                !connected ? "Reconnecting..." : 
                (room && roomsInfo[room]?.postingRoles && !roomsInfo[room].postingRoles.includes(role)) ?
                "Read-only channel" : 
                `Message ${selectedUser ? selectedUser.name : room}...`
              }
              value={message}
              onChangeText={setMessage}
              editable={connected && !(room && roomsInfo[room]?.postingRoles && !roomsInfo[room].postingRoles.includes(role))}
            />
            <Pressable 
              style={[styles.sendButton, (!connected || !message.trim() || 
                (room && roomsInfo[room]?.postingRoles && !roomsInfo[room].postingRoles.includes(role))) && 
                styles.disabledSend]}
              onPress={handleSendMessage}
              disabled={!connected || !message.trim() || (room && roomsInfo[room]?.postingRoles && !roomsInfo[room].postingRoles.includes(role))}
            >
              <Text style={styles.sendButtonText}>Send</Text>
            </Pressable>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    backgroundColor: '#282c34',
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  welcomeText: {
    color: 'white',
    fontSize: 12,
    marginRight: 10,
  },
  menuButton: {
    padding: 5,
  },
  menuButtonText: {
    color: 'white',
    fontSize: 20,
  },
  offlineIndicator: {
    backgroundColor: '#ff6b6b',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    marginLeft: 5,
  },
  offlineText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  fileStorageButton: {
    backgroundColor: '#2196F3',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 4,
    marginRight: 5,
  },
  logoutButton: {
    backgroundColor: '#f44336',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 4,
  },
  buttonText: {
    color: 'white',
    fontSize: 12,
  },
  reconnectingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  reconnectingText: {
    fontSize: 20,
    marginBottom: 20,
  },
  loginContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    marginBottom: 20,
  },
  input: {
    width: '100%',
    padding: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    marginBottom: 10,
  },
  roleContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  roleButtons: {
    flexDirection: 'row',
    marginTop: 10,
  },
  roleButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 4,
    backgroundColor: '#f1f1f1',
    marginHorizontal: 5,
  },
  activeRole: {
    backgroundColor: '#4CAF50',
  },
  roleText: {
    color: '#333',
  },
  activeRoleText: {
    color: 'white',
  },
  joinButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 4,
    width: '100%',
    alignItems: 'center',
  },
  joinButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  sidebar: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '80%',
    height: '100%',
    backgroundColor: 'white',
    zIndex: 10,
    elevation: 5,
    borderRightWidth: 1,
    borderColor: '#ddd',
  },
  sidebarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#282c34',
  },
  sidebarTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 5,
  },
  closeButtonText: {
    color: 'white',
    fontSize: 20,
  },
  roomsSection: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  usersSection: {
    padding: 15,
    flex: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  roomItem: {
    padding: 10,
    marginBottom: 5,
    borderRadius: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roomItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badgeContainer: {
    backgroundColor: '#ff4d4f',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 5,
  },
  badgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    paddingHorizontal: 5,
  },
  userItem: {
    padding: 10,
    marginBottom: 5,
    borderRadius: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  userItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activeItem: {
    backgroundColor: '#4CAF50',
  },
  offlineUser: {
    opacity: 0.5,
  },
  itemText: {
    color: '#333',
  },
  activeItemText: {
    color: 'white',
    fontWeight: 'bold',
  },
  readOnlyText: {
    fontSize: 10,
    color: '#999',
    fontStyle: 'italic',
  },
  roleText: {
    color: '#777',
    fontSize: 12,
    marginLeft: 5,
  },
  activeRoleText: {
    color: '#eee',
    fontSize: 12,
    marginLeft: 5,
  },
  emptyListText: {
    fontStyle: 'italic',
    color: '#999',
    textAlign: 'center',
    padding: 10,
  },
  // Chat container
  chatContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  messagesContainer: {
    flex: 1,
    padding: 10,
  },
  message: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 5,
    maxWidth: '80%',
  },
  myMessage: {
    backgroundColor: '#dcf8c6',
    alignSelf: 'flex-end',
  },
  otherMessage: {
    backgroundColor: '#f1f0f0',
    alignSelf: 'flex-start',
  },
  systemMessage: {
    backgroundColor: '#e6e6e6',
    alignSelf: 'center',
    fontStyle: 'italic',
    fontSize: 12,
    padding: 5,
  },
  messageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
    flexWrap: 'wrap',
  },
  sender: {
    fontWeight: 'bold',
    fontSize: 12,
    marginRight: 5,
  },
  role: {
    color: '#666',
    fontSize: 10,
  },
  time: {
    color: '#666',
    fontSize: 10,
  },
  messageText: {
    fontSize: 14,
  },
  messageForm: {
    flexDirection: 'row',
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#ddd',
    backgroundColor: 'white',
  },
  messageInput: {
    flex: 1,
    padding: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    marginRight: 10,
    backgroundColor: 'white',
  },
  sendButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 4,
    justifyContent: 'center',
  },
  disabledSend: {
    backgroundColor: '#cccccc',
  },
  sendButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  // File sharing styles
  attachmentButton: {
    padding: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledAttachment: {
    opacity: 0.5,
  },
  attachmentButtonText: {
    fontSize: 20,
  },
  fileAttachment: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#eee',
    padding: 5,
    borderRadius: 4,
    marginTop: 5,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontWeight: 'bold',
    fontSize: 12,
  },
  fileSize: {
    color: '#666',
    fontSize: 10,
  },
  downloadButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 4,
    marginLeft: 10,
  },
  downloadButtonText: {
    color: 'white',
    fontSize: 12,
  },
  // File storage styles
  fileStorageContainer: {
    flex: 1,
  },
  fileTabsContainer: {
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  fileTab: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  activeFileTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#4CAF50',
  },
  fileTabText: {
    color: '#666',
  },
  activeFileTabText: {
    color: '#4CAF50',
    fontWeight: 'bold',
  },
  fileItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  fileItemInfo: {
    flex: 1,
  },
  fileItemName: {
    fontWeight: 'bold',
    marginBottom: 5,
  },
  fileItemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileItemSize: {
    fontSize: 12,
    color: '#666',
    marginRight: 10,
  },
  fileItemFrom: {
    fontSize: 12,
    color: '#666',
  },
  noFilesText: {
    textAlign: 'center',
    padding: 40,
    color: '#999',
    fontStyle: 'italic',
  }
});