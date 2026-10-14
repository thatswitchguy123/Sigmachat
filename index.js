const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const PORT = process.env.PORT || 5000;

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let uploadDir = path.join(__dirname, 'public', 'uploads');
    
    // Check if it's a server-specific upload
    if (req.body.serverId) {
      uploadDir = path.join(uploadDir, 'servers', req.body.serverId);
    }
    
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|webm|mov|avi|mkv|ogg/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const isImage = file.mimetype.startsWith('image/');
    const isVideo = file.mimetype.startsWith('video/');
    
    if ((isImage || isVideo) && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image and video files are allowed!'));
    }
  }
});

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// ============== BLOCKED USERS SYSTEM ==============
let blockedUsers = {};
const blockedUsersFile = path.join(__dirname, 'blocked_users.json');

try {
  if (fs.existsSync(blockedUsersFile)) {
    blockedUsers = JSON.parse(fs.readFileSync(blockedUsersFile, 'utf8'));
  }
} catch (error) {
  console.error('Error loading blocked users:', error);
}

function saveBlockedUsers() {
  try {
    fs.writeFileSync(blockedUsersFile, JSON.stringify(blockedUsers, null, 2));
  } catch (error) {
    console.error('Error saving blocked users:', error);
  }
}

// Session middleware for Socket.IO
const sessionMiddleware = session({
  secret: 'secret-key-change-in-production',
  resave: true,
  saveUninitialized: true,
  cookie: { secure: false }
});

app.use(sessionMiddleware);
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, error => {
    if (error) return next(error);
    const authenticatedUser = socket.request.session && socket.request.session.username;
    if (!authenticatedUser) return next(new Error('Authentication required'));
    if (isUserBanned(authenticatedUser)) return next(new Error('Account is unavailable'));
    socket.username = authenticatedUser;
    next();
  });
});

// File paths for persistent storage
const usersFile = path.join(__dirname, 'users.json');
const roomsFile = path.join(__dirname, 'rooms.json');
const generalMessagesFile = path.join(__dirname, 'general_messages.json');
const bannedUsersFile = path.join(__dirname, 'banned_users.json');
const serversFile = path.join(__dirname, 'servers.json');
const adminRolesFile = path.join(__dirname, 'admin_roles.json');

// ============== ADMIN ROLES SYSTEM ==============
let adminRoles = { superAdmin: 'thatswitchguy', coAdmins: [] };

try {
  if (fs.existsSync(adminRolesFile)) {
    adminRoles = JSON.parse(fs.readFileSync(adminRolesFile, 'utf8'));
  } else {
    fs.writeFileSync(adminRolesFile, JSON.stringify(adminRoles, null, 2));
  }
} catch (error) {
  console.error('Error loading admin roles:', error);
}

function saveAdminRoles() {
  try {
    fs.writeFileSync(adminRolesFile, JSON.stringify(adminRoles, null, 2));
  } catch (error) {
    console.error('Error saving admin roles:', error);
  }
}

function isSuperAdmin(username) {
  return username === adminRoles.superAdmin;
}

function isGlobalAdmin(username) {
  return username === adminRoles.superAdmin || adminRoles.coAdmins.includes(username);
}

// ============== SERVER SYSTEM ==============
// Servers structure: { serverId: { name, icon, owner, admins: [], members: [], channels: { channelId: { name, type } } } }
let servers = {};

// Load servers from file
try {
  if (fs.existsSync(serversFile)) {
    const serverData = fs.readFileSync(serversFile, 'utf8');
    servers = JSON.parse(serverData);
    // Ensure all servers have invite codes
    let updated = false;
    Object.keys(servers).forEach(id => {
    });
    if (updated) saveServers();
  } else {
    // Create default server
    servers = {
      'sigmachat': {
        id: 'sigmachat',
        name: 'SigmaChat',
        icon: null,
        owner: 'system',
        admins: ['ikhan', 'thatswitchguy'],
        members: [],
        channels: {
          'general': { name: 'general', type: 'text' },
          'suggestions': { name: 'suggestions', type: 'text' },
          'tech-support': { name: 'tech-support', type: 'text' }
        },
        createdAt: new Date().toISOString()
      }
    };
    saveServers();
  }
} catch (error) {
  console.error('Error loading servers:', error);
  servers = {};
}

// Server messages: { serverId: { channelId: [] } }
let serverMessages = {};

// Ensure uploads/servers directory exists
const serversUploadDir = path.join(__dirname, 'public', 'uploads', 'servers');
if (!fs.existsSync(serversUploadDir)) {
  fs.mkdirSync(serversUploadDir, { recursive: true });
}

function saveServers() {
  try {
    fs.writeFileSync(serversFile, JSON.stringify(servers, null, 2));
  } catch (error) {
    console.error('Error saving servers:', error);
  }
}

function getServerMessagesFile(serverId, channelId) {
  return path.join(__dirname, `server_${serverId}_${channelId}_messages.json`);
}

function loadServerMessages(serverId, channelId) {
  const file = getServerMessagesFile(serverId, channelId);
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (error) {
    console.error(`Error loading messages for ${serverId}/${channelId}:`, error);
  }
  return [];
}

function saveServerMessages(serverId, channelId, messages) {
  const file = getServerMessagesFile(serverId, channelId);
  try {
    const messagesToSave = messages.slice(-500);
    fs.writeFileSync(file, JSON.stringify(messagesToSave, null, 2));
  } catch (error) {
    console.error(`Error saving messages for ${serverId}/${channelId}:`, error);
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function isServerAdmin(serverId, username) {
  const server = servers[serverId];
  if (!server) return false;
  return server.owner === username || (server.admins && server.admins.includes(username));
}

function isServerMember(serverId, username) {
  const server = servers[serverId];
  if (!server) return false;
  // Default server is accessible to everyone
  if (serverId === 'sigmachat') return true;
  return server.owner === username || 
         (server.admins && server.admins.includes(username)) || 
         (server.members && server.members.includes(username));
}

// Load users from file or use empty object
let users = {};
try {
  if (fs.existsSync(usersFile)) {
    const userData = fs.readFileSync(usersFile, 'utf8');
    users = JSON.parse(userData);
  }
} catch (error) {
  console.error('Error loading users:', error);
  users = {};
}

// Load rooms from file or use defaults
const defaultRooms = {
  'general': { name: 'General Discussion', members: null },
  'suggestions': { name: 'Suggestions', members: null },
  'tech-support': { name: 'Tech Support', members: null }
};
let rooms = { ...defaultRooms };
let roomMembers = {};
let additionalRoomsCreated = 0;

// Track room memberships (who can access which rooms)
const roomMembersFile = path.join(__dirname, 'room_members.json');

// First load room members from file
try {
  if (fs.existsSync(roomMembersFile)) {
    const memberData = fs.readFileSync(roomMembersFile, 'utf8');
    roomMembers = JSON.parse(memberData);
  }
} catch (error) {
  console.error('Error loading room members:', error);
  roomMembers = {};
}

// Then load rooms and merge member info
try {
  if (fs.existsSync(roomsFile)) {
    const roomData = fs.readFileSync(roomsFile, 'utf8');
    const loadedRooms = JSON.parse(roomData);
    const customRooms = loadedRooms.rooms || {};
    Object.keys(customRooms).forEach(roomId => {
      const room = customRooms[roomId];
      if (typeof room === 'object' && room !== null) {
        rooms[roomId] = room;
        if (room.members && Array.isArray(room.members) && room.members.length > 0) {
          roomMembers[roomId] = room.members;
        }
      } else if (typeof room === 'string') {
        rooms[roomId] = { name: room, members: [] };
      }
    });
    additionalRoomsCreated = loadedRooms.additionalRoomsCreated || 0;
  }
} catch (error) {
  console.error('Error loading rooms:', error);
  rooms = { ...defaultRooms };
}

const maxAdditionalRooms = 3;

function saveRoomMembers() {
  try {
    fs.writeFileSync(roomMembersFile, JSON.stringify(roomMembers, null, 2));
  } catch (error) {
    console.error('Error saving room members:', error);
  }
}

// Load messages for all default rooms
let roomMessages = {
  general: [],
  suggestions: [],
  'tech-support': []
};

// Load general room messages from file
try {
  if (fs.existsSync(generalMessagesFile)) {
    const messageData = fs.readFileSync(generalMessagesFile, 'utf8');
    roomMessages.general = JSON.parse(messageData);
  }
} catch (error) {
  console.error('Error loading general messages:', error);
  roomMessages.general = [];
}

// Load suggestions room messages
const suggestionsMessagesFile = path.join(__dirname, 'suggestions_messages.json');
try {
  if (fs.existsSync(suggestionsMessagesFile)) {
    const messageData = fs.readFileSync(suggestionsMessagesFile, 'utf8');
    roomMessages.suggestions = JSON.parse(messageData);
  }
} catch (error) {
  console.error('Error loading suggestions messages:', error);
  roomMessages.suggestions = [];
}

// Load tech-support room messages
const techSupportMessagesFile = path.join(__dirname, 'tech_support_messages.json');
try {
  if (fs.existsSync(techSupportMessagesFile)) {
    const messageData = fs.readFileSync(techSupportMessagesFile, 'utf8');
    roomMessages['tech-support'] = JSON.parse(messageData);
  }
} catch (error) {
  console.error('Error loading tech-support messages:', error);
  roomMessages['tech-support'] = [];
}

// File path for profile pictures
const profilePicturesFile = path.join(__dirname, 'profile_pictures.json');

// Load profile pictures from file
let profilePictures = {};
try {
  if (fs.existsSync(profilePicturesFile)) {
    const pictureData = fs.readFileSync(profilePicturesFile, 'utf8');
    profilePictures = JSON.parse(pictureData);
  }
} catch (error) {
  console.error('Error loading profile pictures:', error);
  profilePictures = {};
}

// File path for user settings
const userSettingsFile = path.join(__dirname, 'user_settings.json');

// Load user settings from file
let userSettings = {};
try {
  if (fs.existsSync(userSettingsFile)) {
    const settingsData = fs.readFileSync(userSettingsFile, 'utf8');
    userSettings = JSON.parse(settingsData);
  }
} catch (error) {
  console.error('Error loading user settings:', error);
  userSettings = {};
}

// Save user settings to file
function saveUserSettings() {
  try {
    fs.writeFileSync(userSettingsFile, JSON.stringify(userSettings, null, 2));
  } catch (error) {
    console.error('Error saving user settings:', error);
  }
}

// Load banned users with expiration times
let bannedUsers = {};
try {
  if (fs.existsSync(bannedUsersFile)) {
    const bannedData = fs.readFileSync(bannedUsersFile, 'utf8');
    bannedUsers = JSON.parse(bannedData);
    // Clean up expired bans on load
    const now = Date.now();
    Object.keys(bannedUsers).forEach(user => {
      if (bannedUsers[user].expiresAt && bannedUsers[user].expiresAt < now) {
        delete bannedUsers[user];
      }
    });
    saveBannedUsers();
  }
} catch (error) {
  console.error('Error loading banned users:', error);
  bannedUsers = {};
}

// Save users to file
function saveUsers() {
  try {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error('Error saving users:', error);
  }
}

// Save room messages to file
function saveRoomMessages(roomId) {
  try {
    let fileName;
    switch(roomId) {
      case 'general':
        fileName = generalMessagesFile;
        break;
      case 'suggestions':
        fileName = path.join(__dirname, 'suggestions_messages.json');
        break;
      case 'tech-support':
        fileName = path.join(__dirname, 'tech_support_messages.json');
        break;
      default:
        return;
    }

    const messagesToSave = roomMessages[roomId].slice(-500);
    fs.writeFileSync(fileName, JSON.stringify(messagesToSave, null, 2));
  } catch (error) {
    console.error(`Error saving ${roomId} messages:`, error);
  }
}

// Save DM messages between two users
function saveDMMessages(user1, user2, messages) {
  try {
    const dmKey = [user1, user2].sort().join('_');
    const dmFile = path.join(__dirname, `dm_${dmKey}.json`);
    const messagesToSave = messages.slice(-500);
    fs.writeFileSync(dmFile, JSON.stringify(messagesToSave, null, 2));
  } catch (error) {
    console.error('Error saving DM messages:', error);
  }
}

// Save profile pictures to file
function saveProfilePictures() {
  try {
    fs.writeFileSync(profilePicturesFile, JSON.stringify(profilePictures, null, 2));
  } catch (error) {
    console.error('Error saving profile pictures:', error);
  }
}

// Save banned users to file
function saveBannedUsers() {
  try {
    fs.writeFileSync(bannedUsersFile, JSON.stringify(bannedUsers, null, 2));
  } catch (error) {
    console.error('Error saving banned users:', error);
  }
}

// Track online users
let onlineUsers = new Set();
const adminUsers = new Set(['ikhan', 'thatswitchguy']);

// Check if user is banned
function isUserBanned(username) {
  if (!bannedUsers[username]) return false;
  
  const ban = bannedUsers[username];
  if (!ban.expiresAt) return true; // Permanent ban
  
  if (ban.expiresAt < Date.now()) {
    delete bannedUsers[username];
    saveBannedUsers();
    return false;
  }
  
  return true;
}

// Get ban information for display
function getBanInfo(username) {
  const banRecord = bannedUsers[username];
  if (!banRecord) {
    return null;
  }

  if (!banRecord.expiresAt) {
    return { type: 'permanent' };
  }

  const remainingMs = banRecord.expiresAt - Date.now();
  if (remainingMs <= 0) {
    return null;
  }

  const remainingMinutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;

  return {
    type: 'temporary',
    remainingMinutes,
    hours,
    minutes,
    expiresAt: banRecord.expiresAt
  };
}

// Save rooms to file
async function saveRooms() {
  try {
    const defaultRoomIds = ['general', 'suggestions', 'tech-support'];
    const customRooms = {};
    Object.keys(rooms).forEach(roomId => {
      if (!defaultRoomIds.includes(roomId)) {
        const roomData = { ...rooms[roomId] };
        if (roomMembers[roomId]) {
          roomData.members = roomMembers[roomId];
        }
        customRooms[roomId] = roomData;
      }
    });

    const roomData = {
      rooms: customRooms,
      additionalRoomsCreated: additionalRoomsCreated
    };
    fs.writeFileSync(roomsFile, JSON.stringify(roomData, null, 2));
    
    // We treat rooms as a special type of "server" or just skip for now as requested 
    // "server updated or added" covers the main server structure.
  } catch (error) {
    console.error('Error saving rooms:', error);
  }
}

app.use((req, res, next) => {
  if (req.session && req.session.username) {
    req.username = req.session.username;
  }
  next();
});

// Home route
app.get('/', (req, res) => {
  if (req.username) {
    res.redirect('/chat');
  } else {
    res.redirect('/login');
  }
});

// Chat route
app.get('/chat', (req, res) => {
  if (req.username) {
    if (isUserBanned(req.username)) {
      req.session.destroy();
      return res.send('You have been banned. <a href="/login">Return to login</a>');
    }
    res.sendFile(__dirname + '/public/index.html');
  } else {
    res.redirect('/login');
  }
});

// Embedded chat route (simplified version for embedding)
app.get('/embed', (req, res) => {
  if (req.username) {
    if (isUserBanned(req.username)) {
      req.session.destroy();
      return res.send('You have been banned. <a href="/login">Return to login</a>');
    }
    res.sendFile(__dirname + '/public/embed.html');
  } else {
    res.redirect('/login');
  }
});

// Login page
app.get('/login', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    res.sendFile(__dirname + '/public/login.html');
  });
});

// Register page
app.get('/register', (req, res) => {
  res.sendFile(__dirname + '/public/register.html');
});

// Iframe embed page
app.get('/iframe', (req, res) => {
  res.sendFile(__dirname + '/public/iframe.html');
});

// Server create page
app.get('/server-create.html', (req, res) => {
  if (req.username) {
    res.sendFile(__dirname + '/public/server-create.html');
  } else {
    res.redirect('/login');
  }
});

// Admin control page (super admin only)
app.get('/admin-control.html', (req, res) => {
  if (req.username && isSuperAdmin(req.username)) {
    res.sendFile(__dirname + '/public/admin-control.html');
  } else {
    res.status(403).send('Access denied. Only the super admin can access this page. <a href="/chat">Back to chat</a>');
  }
});

// API: Get co-admins list
app.get('/api/admin/co-admins', (req, res) => {
  if (!req.username || !isSuperAdmin(req.username)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  res.json({ coAdmins: adminRoles.coAdmins });
});

// API: Add co-admin
app.post('/api/admin/co-admins', (req, res) => {
  // Use session username for authentication, not request body
  if (!req.username || !isSuperAdmin(req.username)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  const targetUsername = req.body.username;
  
  if (!targetUsername || typeof targetUsername !== 'string') {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  const sanitizedUsername = targetUsername.trim();
  
  if (!users[sanitizedUsername]) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  if (sanitizedUsername === adminRoles.superAdmin) {
    return res.status(400).json({ error: 'Cannot add super admin as co-admin' });
  }
  
  if (adminRoles.coAdmins.includes(sanitizedUsername)) {
    return res.status(400).json({ error: 'User is already a co-admin' });
  }
  
  adminRoles.coAdmins.push(sanitizedUsername);
  saveAdminRoles();
  
  res.json({ success: true });
});

// API: Remove co-admin
app.delete('/api/admin/co-admins', (req, res) => {
  // Use session username for authentication, not request body
  if (!req.username || !isSuperAdmin(req.username)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  const targetUsername = req.body.username;
  
  if (!targetUsername || typeof targetUsername !== 'string') {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  const sanitizedUsername = targetUsername.trim();
  
  adminRoles.coAdmins = adminRoles.coAdmins.filter(admin => admin !== sanitizedUsername);
  saveAdminRoles();
  
  res.json({ success: true });
});

// API: Check if user is global admin
app.get('/api/admin/status', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({ 
    isSuperAdmin: isSuperAdmin(req.username),
    isGlobalAdmin: isGlobalAdmin(req.username)
  });
});

// Registration endpoint
app.post('/register', async (req, res) => {
  const { username, password, confirmPassword } = req.body;

  if (!username || !password || !confirmPassword) {
    return res.send('All fields are required. <a href="/register">Try again</a>.');
  }

  if (username.length < 3) {
    return res.send('Username must be at least 3 characters. <a href="/register">Try again</a>.');
  }

  if (password.length < 6) {
    return res.send('Password must be at least 6 characters. <a href="/register">Try again</a>.');
  }

  if (password !== confirmPassword) {
    return res.send('Passwords do not match. <a href="/register">Try again</a>.');
  }

  if (users[username]) {
    return res.send('Username already exists. <a href="/register">Try again</a> or <a href="/login">Login</a>.');
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    users[username] = {
      username: username,
      password: hashedPassword,
      createdAt: new Date()
    };

    saveUsers();
    req.session.username = username;
    res.redirect('/chat');
  } catch (error) {
    console.error('Registration error:', error);
    res.send('Registration failed. <a href="/register">Try again</a>.');
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.send('Username and password are required. <a href="/login">Try again</a>.');
  }

  if (isUserBanned(username)) {
    const banInfo = getBanInfo(username);
    const banType = banInfo?.type === 'permanent' ? 'permanent' : 'temporary';
    const expiresAt = banInfo?.type === 'temporary' ? banInfo.expiresAt : '';
    return res.redirect(`/banned.html?type=${banType}&expiresAt=${expiresAt}`);
  }

  const user = users[username];
  if (!user) {
    return res.sendFile(__dirname + '/public/invalid-credentials.html');
  }

  try {
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.sendFile(__dirname + '/public/invalid-credentials.html');
    }

    req.session.username = username;
    res.redirect('/chat');
  } catch (error) {
    console.error('Login error:', error);
    res.send('Login failed. <a href="/login">Try again</a>.');
  }
});

// API to get logged-in user
app.get('/api/user', (req, res) => {
  if (req.session && req.session.username) {
    res.json({ username: req.session.username });
  } else {
    res.status(401).json({ error: 'Not logged in' });
  }
});

// API to get rooms - filter by user access
app.get('/api/rooms', (req, res) => {
  const currentUser = req.username;
  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const filteredRooms = {};
  const defaultRoomIds = ['general', 'suggestions', 'tech-support'];
  
  // Always ensure default rooms exist in the rooms object
  defaultRoomIds.forEach(id => {
    if (!rooms[id]) {
      rooms[id] = { name: id.charAt(0).toUpperCase() + id.slice(1).replace('-', ' ') };
    }
  });

  Object.keys(rooms).forEach(roomId => {
    // Always include default rooms
    if (defaultRoomIds.includes(roomId)) {
      filteredRooms[roomId] = rooms[roomId].name || rooms[roomId];
    } else {
      // For custom rooms, only include if user is a member
      const members = roomMembers[roomId] || [];
      if (members.includes(currentUser)) {
        filteredRooms[roomId] = rooms[roomId].name || rooms[roomId];
      }
    }
  });

  res.json(filteredRooms);
});

// API to get room messages - check access
app.get('/api/:roomId/messages', (req, res) => {
  const { roomId } = req.params;
  const currentUser = req.username;
  const defaultRoomIds = ['general', 'suggestions', 'tech-support'];
  
  // Check if user has access to this room
  const hasAccess = defaultRoomIds.includes(roomId) || 
                    (roomMembers[roomId] && roomMembers[roomId].includes(currentUser));
  
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied to this room' });
  }
  
  if (roomMessages[roomId]) {
    res.json(roomMessages[roomId]);
  } else {
    res.json([]);
  }
});

// ============== SERVER API ENDPOINTS ==============

// Get all servers the user has access to
app.get('/api/servers', (req, res) => {
  const currentUser = req.username;
  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const userServers = {};
  
  // Always include default server
  if (servers['sigmachat']) {
    userServers['sigmachat'] = {
      id: 'sigmachat',
      name: servers['sigmachat'].name,
      icon: servers['sigmachat'].icon,
      isAdmin: isServerAdmin('sigmachat', currentUser),
      isOwner: servers['sigmachat'].owner === currentUser,
      channelCount: Object.keys(servers['sigmachat'].channels || {}).length
    };
  }

  Object.keys(servers).forEach(serverId => {
    if (serverId === 'sigmachat') return;
    
    const server = servers[serverId];
    if (isServerMember(serverId, currentUser)) {
      userServers[serverId] = {
        id: serverId,
        name: server.name,
        icon: server.icon,
        isAdmin: isServerAdmin(serverId, currentUser),
        isOwner: server.owner === currentUser,
        channelCount: Object.keys(server.channels || {}).length
      };
    }
  });

  res.json(userServers);
});

// Get a specific server's details
app.get('/api/servers/:serverId', (req, res) => {
  const { serverId } = req.params;
  const currentUser = req.username;

  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  let server = servers[serverId];
  
  // If not found by ID, check if it's an invite code
  if (!server) {
    server = Object.values(servers).find(s => s.inviteCode === serverId);
  }

  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }

  if (!isServerMember(server.id, currentUser)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json({
    id: server.id,
    name: server.name,
    icon: server.icon,
    channels: server.channels || {},
    isAdmin: isServerAdmin(server.id, currentUser),
    isOwner: server.owner === currentUser,
    memberCount: (server.members || []).length + (server.admins || []).length + 1,
    inviteCode: server.inviteCode || server.id
  });
});

// API to generate/get invite link
app.get('/api/servers/:serverId/invite', (req, res) => {
  const { serverId } = req.params;
  const currentUser = req.username;

  if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });
  
  const server = servers[serverId];
  if (!server) return res.status(404).json({ error: 'Server not found' });

  if (!server.inviteCode) {
    server.inviteCode = Math.random().toString(36).substring(2, 10);
    saveServers();
  }

  res.json({ inviteCode: server.inviteCode });
});

// Create a new server
app.post('/api/servers', (req, res) => {
  const { name, icon, invitedUsers } = req.body;
  const currentUser = req.username;

  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!name || name.length < 2 || name.length > 50) {
    return res.status(400).json({ error: 'Server name must be between 2 and 50 characters' });
  }

  const serverId = generateId();
  
  // Process invited users - only include valid users
  let members = [];
  if (invitedUsers && Array.isArray(invitedUsers)) {
    members = invitedUsers.filter(u => typeof u === 'string' && users[u.trim()] && u.trim() !== currentUser);
  }
  
  servers[serverId] = {
    id: serverId,
    name: name,
    icon: icon || null,
    owner: currentUser,
    admins: [],
    members: members,
    channels: {
      'general': { name: 'general', type: 'text' },
      'welcome': { name: 'welcome', type: 'text' }
    },
    createdAt: new Date().toISOString()
  };

  saveServers();
  res.json({ success: true, serverId, server: servers[serverId] });
});

// Update server settings
app.put('/api/servers/:serverId', (req, res) => {
  const { serverId } = req.params;
  const { name, icon } = req.body;
  const currentUser = req.username;

  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const server = servers[serverId];
  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }

  if (!isGlobalAdmin(currentUser) && !isServerAdmin(serverId, currentUser)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  if (name) server.name = name;
  if (icon !== undefined) server.icon = icon;

  saveServers();
  res.json({ success: true });
});

// Delete a server
app.delete('/api/servers/:serverId', (req, res) => {
  const { serverId } = req.params;
  const currentUser = req.username;

  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const server = servers[serverId];
  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }

  if (server.owner !== currentUser && !isGlobalAdmin(currentUser)) {
    return res.status(403).json({ error: 'Only the owner or a global admin can delete the server' });
  }

  if (serverId === 'sigmachat') {
    return res.status(400).json({ error: 'Cannot delete the default server' });
  }

  // Delete all message files for this server's channels
  if (server.channels) {
    Object.keys(server.channels).forEach(channelId => {
      const messageFile = getServerMessagesFile(serverId, channelId);
      try {
        if (fs.existsSync(messageFile)) {
          fs.unlinkSync(messageFile);
        }
      } catch (err) {
        console.error(`Error deleting message file ${messageFile}:`, err);
      }
    });
  }

  // Delete server folder if it exists
  const serverDir = path.join(__dirname, 'public', 'uploads', 'servers', serverId);
  try {
    if (fs.existsSync(serverDir)) {
      fs.rmSync(serverDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`Error deleting server directory ${serverDir}:`, err);
  }

  delete servers[serverId];
  saveServers();
  res.json({ success: true });
});

// Get server channels
app.get('/api/servers/:serverId/channels', (req, res) => {
  const { serverId } = req.params;
  const currentUser = req.username;

  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const server = servers[serverId];
  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }

  if (!isServerMember(serverId, currentUser)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json(server.channels || {});
});

// Create a channel in a server
app.post('/api/servers/:serverId/channels', (req, res) => {
  const { serverId } = req.params;
  const { name, type } = req.body;
  const currentUser = req.username;

  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const server = servers[serverId];
  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }

  if (!isGlobalAdmin(currentUser) && !isServerAdmin(serverId, currentUser)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  if (!name || name.length < 1 || name.length > 30) {
    return res.status(400).json({ error: 'Channel name must be between 1 and 30 characters' });
  }

  const channelId = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  
  if (!server.channels) server.channels = {};
  
  if (server.channels[channelId]) {
    return res.status(400).json({ error: 'Channel already exists' });
  }

  server.channels[channelId] = {
    name: name.toLowerCase(),
    type: type || 'text'
  };

  saveServers();
  res.json({ success: true, channelId });
});

// Update a channel
app.put('/api/servers/:serverId/channels/:channelId', (req, res) => {
  const { serverId, channelId } = req.params;
  const { name } = req.body;
  const currentUser = req.username;

  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const server = servers[serverId];
  if (!server || !server.channels || !server.channels[channelId]) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  const protectedChannels = ['general', 'suggestions', 'tech-support'];
  if (protectedChannels.includes(channelId) && serverId === 'sigmachat') {
    return res.status(400).json({ error: 'Cannot edit protected channel' });
  }

  server.channels[channelId].name = name.toLowerCase();
  saveServers();
  res.json({ success: true });
});

// Delete a channel
app.delete('/api/servers/:serverId/channels/:channelId', (req, res) => {
  const { serverId, channelId } = req.params;
  const currentUser = req.username;

  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const server = servers[serverId];
  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }

  if (!isGlobalAdmin(currentUser) && !isServerAdmin(serverId, currentUser)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  if (!server.channels || !server.channels[channelId]) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  const protectedChannels = ['general', 'suggestions', 'tech-support'];
  if (protectedChannels.includes(channelId) && serverId === 'sigmachat') {
    return res.status(400).json({ error: 'Cannot delete protected channel' });
  }

  delete server.channels[channelId];
  saveServers();
  res.json({ success: true });
});

// Get channel messages
app.get('/api/servers/:serverId/channels/:channelId/messages', (req, res) => {
  const { serverId, channelId } = req.params;
  const currentUser = req.username;

  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!isServerMember(serverId, currentUser)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const messages = loadServerMessages(serverId, channelId);
  res.json(messages);
});

// API to vote on a poll
app.post('/api/servers/:serverId/channels/:channelId/messages/:messageId/poll/vote', (req, res) => {
  const { serverId, channelId, messageId } = req.params;
  const { optionIndex } = req.body;
  const currentUser = req.username;

  if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });

  let messages = loadServerMessages(serverId, channelId);
  const index = messages.findIndex(m => m.id === messageId);

  if (index === -1) return res.status(404).json({ error: 'Poll not found' });

  try {
    const pollData = JSON.parse(messages[index].message);
    if (pollData.type !== 'poll') throw new Error('Not a poll');

    // Remove vote from all options first (single vote system)
    pollData.options.forEach(opt => {
      opt.votes = opt.votes.filter(v => v !== currentUser);
    });

    // Add new vote
    if (optionIndex >= 0 && optionIndex < pollData.options.length) {
      pollData.options[optionIndex].votes.push(currentUser);
    }

    messages[index].message = JSON.stringify(pollData);
    saveServerMessages(serverId, channelId, messages);

    io.to(`${serverId}:${channelId}`).emit('poll updated', {
      messageId,
      pollData
    });

    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: 'Invalid poll data' });
  }
});

// Server icon upload endpoint
app.post('/api/servers/:serverId/icon/upload', upload.single('icon'), (req, res) => {
  const { serverId } = req.params;
  const currentUser = req.username;

  if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });
  if (!isServerAdmin(serverId, currentUser) && !isGlobalAdmin(currentUser)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const iconUrl = `/uploads/${req.file.filename}`;
  const server = servers[serverId];
  if (server) {
    server.icon = iconUrl;
    saveServers();
    res.json({ success: true, icon: iconUrl });
  } else {
    res.status(404).json({ error: 'Server not found' });
  }
});

// Join a server (via invite or public)
app.post('/api/servers/:serverId/join', (req, res) => {
  const { serverId } = req.params;
  const currentUser = req.username;

  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const server = servers[serverId];
  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }

  if (isServerMember(serverId, currentUser)) {
    return res.status(400).json({ error: 'Already a member' });
  }

  if (!server.members) server.members = [];
  server.members.push(currentUser);
  saveServers();

  res.json({ success: true });
});

// Leave a server
app.post('/api/servers/:serverId/leave', (req, res) => {
  const { serverId } = req.params;
  const currentUser = req.username;

  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const server = servers[serverId];
  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }

  if (server.owner === currentUser) {
    return res.status(400).json({ error: 'Owner cannot leave. Transfer ownership or delete the server.' });
  }

  if (serverId === 'sigmachat') {
    return res.status(400).json({ error: 'Cannot leave the default server' });
  }

  server.members = (server.members || []).filter(m => m !== currentUser);
  server.admins = (server.admins || []).filter(a => a !== currentUser);
  saveServers();

  res.json({ success: true });
});

// Manage server members (add admin, remove member, etc.)
app.put('/api/servers/:serverId/members/:targetUser', (req, res) => {
  const { serverId, targetUser } = req.params;
  const { action } = req.body;
  const currentUser = req.username;

  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const server = servers[serverId];
  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }

  if (!isServerAdmin(serverId, currentUser)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  if (!server.members) server.members = [];
  if (!server.admins) server.admins = [];

  switch (action) {
    case 'promote':
      if (!server.admins.includes(targetUser)) {
        server.admins.push(targetUser);
        server.members = server.members.filter(m => m !== targetUser);
      }
      break;
    case 'demote':
      if (server.owner === currentUser) {
        server.admins = server.admins.filter(a => a !== targetUser);
        if (!server.members.includes(targetUser)) {
          server.members.push(targetUser);
        }
      } else {
        return res.status(403).json({ error: 'Only owner can demote admins' });
      }
      break;
    case 'kick':
      server.members = server.members.filter(m => m !== targetUser);
      server.admins = server.admins.filter(a => a !== targetUser);
      break;
    default:
      return res.status(400).json({ error: 'Invalid action' });
  }

  saveServers();
  res.json({ success: true });
});

// Account page
app.get('/account', (req, res) => {
  if (req.username) {
    res.sendFile(__dirname + '/public/account.html');
  } else {
    res.redirect('/login');
  }
});

// API to get all users for DM list
app.get('/api/users', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const userList = Object.keys(users).filter(user => user !== req.username);
  res.json(userList);
});

// API to get DM history between two users
app.get('/api/dm/:targetUser', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { targetUser } = req.params;
  const dmKey = [req.username, targetUser].sort().join('_');
  const dmFile = path.join(__dirname, `dm_${dmKey}.json`);

  try {
    if (fs.existsSync(dmFile)) {
      const dmData = fs.readFileSync(dmFile, 'utf8');
      res.json(JSON.parse(dmData));
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('Error loading DM history:', error);
    res.json([]);
  }
});

// API to create a new room
app.post('/api/rooms', (req, res) => {
  const { roomName, selectedUsers } = req.body;
  const currentUser = req.username;

  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!roomName || roomName.length < 3 || roomName.length > 20) {
    return res.status(400).json({ error: 'Room name must be between 3 and 20 characters' });
  }

  if (rooms[roomName.toLowerCase()]) {
    return res.status(400).json({ error: 'Room already exists' });
  }

  if (additionalRoomsCreated >= maxAdditionalRooms) {
    return res.status(400).json({ error: 'Maximum number of additional rooms reached (3)' });
  }

  const roomId = roomName.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (roomId.length < 3) {
    return res.status(400).json({ error: 'Room name must contain at least 3 alphanumeric characters' });
  }

  // Store room with members list
  rooms[roomId] = { name: roomName };
  roomMembers[roomId] = selectedUsers && Array.isArray(selectedUsers) ? 
    [...new Set([currentUser, ...selectedUsers])] : [currentUser];
  
  additionalRoomsCreated++;
  saveRooms();

  res.json({ roomId, roomName, success: true });
});

// API to rename a room
app.put('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const { newName } = req.body;
  const currentUser = req.username;

  if (!newName || newName.length < 3 || newName.length > 20) {
    return res.status(400).json({ error: 'Room name must be between 3 and 20 characters' });
  }

  if (!rooms[roomId]) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const defaultRoomIds = ['general', 'suggestions', 'tech-support'];
  if (defaultRoomIds.includes(roomId)) {
    return res.status(400).json({ error: 'Cannot rename default rooms' });
  }

  // Check if user has access to this room
  const members = roomMembers[roomId] || [];
  if (!members.includes(currentUser)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const roomData = typeof rooms[roomId] === 'object' ? rooms[roomId] : { name: rooms[roomId] };
  rooms[roomId] = { ...roomData, name: newName };
  saveRooms();
  res.json({ roomId, roomName: newName, success: true });
});

// API to delete a room
app.delete('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const currentUser = req.username;

  if (!rooms[roomId]) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const defaultRoomIds = ['general', 'suggestions', 'tech-support'];
  if (defaultRoomIds.includes(roomId)) {
    return res.status(400).json({ error: 'Cannot delete default rooms' });
  }

  // Check if user has access to this room
  const members = roomMembers[roomId] || [];
  if (!members.includes(currentUser)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  delete rooms[roomId];
  delete roomMembers[roomId];
  additionalRoomsCreated--;
  saveRooms();

  res.json({ success: true });
});

// API to get room members
app.get('/api/room/:roomId/members', (req, res) => {
  const { roomId } = req.params;
  const currentUser = req.username;

  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const members = roomMembers[roomId] || [];
  
  // Check if user has access to this room
  const defaultRoomIds = ['general', 'suggestions', 'tech-support'];
  if (!defaultRoomIds.includes(roomId) && !members.includes(currentUser)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json({ members: members });
});

// API to update room members
app.put('/api/rooms/:roomId/members', (req, res) => {
  const { roomId } = req.params;
  const { members } = req.body;
  const currentUser = req.username;

  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!rooms[roomId]) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const defaultRoomIds = ['general', 'suggestions', 'tech-support'];
  if (defaultRoomIds.includes(roomId)) {
    return res.status(400).json({ error: 'Cannot edit default rooms' });
  }

  // Check if user has access to this room
  const currentMembers = roomMembers[roomId] || [];
  if (!currentMembers.includes(currentUser)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Validate members array
  if (!Array.isArray(members)) {
    return res.status(400).json({ error: 'Members must be an array' });
  }

  // Ensure the creator stays in the room
  const updatedMembers = [...new Set([currentUser, ...members])];
  
  roomMembers[roomId] = updatedMembers;
  saveRoomMembers();
  saveRooms();

  res.json({ success: true });
});

// API to get user's profile picture
app.get('/api/profile-picture', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const profilePicture = profilePictures[req.username];
  res.json({ profilePicture: profilePicture || null });
});

// API to update user's profile picture
app.post('/api/profile-picture', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { profilePicture } = req.body;

  if (!profilePicture || typeof profilePicture !== 'string') {
    return res.status(400).json({ error: 'Invalid profile picture URL' });
  }

  // Allow data URLs (base64) and standard http/https URLs
  if (!profilePicture.startsWith('data:image/') && !profilePicture.startsWith('http')) {
    try {
      new URL(profilePicture);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid image format or URL' });
    }
  }

  profilePictures[req.username] = profilePicture;
  saveProfilePictures();

  res.json({ success: true });
});

// API to delete user's profile picture
app.delete('/api/profile-picture', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  delete profilePictures[req.username];
  saveProfilePictures();

  res.json({ success: true });
});

// Profile picture upload endpoint
app.post('/api/profile-picture/upload', upload.single('profilePicture'), (req, res) => {
  if (!req.username) return res.status(401).json({ error: 'Not authenticated' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const profilePicUrl = `/uploads/${req.file.filename}`;
  profilePictures[req.username] = profilePicUrl;
  saveProfilePictures();
  res.json({ success: true, profilePicture: profilePicUrl });
});

// API to get any user's profile picture
app.get('/api/user-profile/:username', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { username } = req.params;
  const profilePicture = profilePictures[username];
  res.json({ profilePicture: profilePicture || null });
});

// API to edit a room message
app.put('/api/servers/:serverId/channels/:channelId/messages/:messageId', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { serverId, channelId, messageId } = req.params;
  const { newMessage } = req.body;

  let messages = loadServerMessages(serverId, channelId);
  const index = messages.findIndex(m => m.id === messageId || m.timestamp === messageId);

  if (index === -1) {
    return res.status(404).json({ error: 'Message not found, try refreshing the page' });
  }

  const message = messages[index];
  if (message.username !== req.username) {
    return res.status(403).json({ error: 'Can only edit your own messages' });
  }

  if (!newMessage || newMessage.trim().length === 0) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  messages[index].message = newMessage.trim();
  messages[index].edited = true;
  messages[index].editedAt = new Date().toLocaleTimeString();

  saveServerMessages(serverId, channelId, messages);

  io.to(`${serverId}:${channelId}`).emit('message edited', {
    serverId,
    channelId,
    messageId: message.id || message.timestamp,
    newMessage: newMessage.trim(),
    edited: true,
    editedAt: messages[index].editedAt
  });

  res.json({ success: true });
});

// API to delete a room message
app.delete('/api/servers/:serverId/channels/:channelId/messages/:messageId', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { serverId, channelId, messageId } = req.params;

  let messages = loadServerMessages(serverId, channelId);
  const index = messages.findIndex(m => m.id === messageId || m.timestamp === messageId);

  if (index === -1) {
    return res.status(404).json({ error: 'Message not found, try refreshing the page' });
  }

  const message = messages[index];
  
  if (message.username !== req.username && !isServerAdmin(serverId, req.username)) {
    return res.status(403).json({ error: 'Can only delete your own messages or be an admin' });
  }

  messages.splice(index, 1);
  saveServerMessages(serverId, channelId, messages);

  io.to(`${serverId}:${channelId}`).emit('message deleted', {
    serverId,
    channelId,
    messageId: message.id || message.timestamp
  });

  res.json({ success: true });
});

// API to edit a DM message
app.put('/api/dm/:targetUser/messages/:messageId', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { targetUser, messageId } = req.params;
  const { newMessage } = req.body;

  const dmKey = [req.username, targetUser].sort().join('_');
  const dmFile = path.join(__dirname, `dm_${dmKey}.json`);

  let dmHistory = [];
  try {
    if (fs.existsSync(dmFile)) {
      const dmData = fs.readFileSync(dmFile, 'utf8');
      dmHistory = JSON.parse(dmData);
    }
  } catch (error) {
    console.error('Error loading DM history:', error);
    return res.status(500).json({ error: 'Error loading DM history' });
  }

  const index = dmHistory.findIndex(m => m.id === messageId || m.timestamp === messageId);
  if (index === -1) {
    return res.status(404).json({ error: 'Message not found, try refreshing the page' });
  }

  const message = dmHistory[index];
  if (message.from !== req.username) {
    return res.status(403).json({ error: 'Can only edit your own messages' });
  }

  if (!newMessage || newMessage.trim().length === 0) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  dmHistory[index].message = newMessage.trim();
  dmHistory[index].edited = true;
  dmHistory[index].editedAt = new Date().toLocaleTimeString();

  saveDMMessages(req.username, targetUser, dmHistory);

  const targetSocket = Array.from(io.sockets.sockets.values())
    .find(s => s.username === targetUser);
  const senderSocket = Array.from(io.sockets.sockets.values())
    .find(s => s.username === req.username);

  const editData = {
    targetUser,
    messageId: message.id || message.timestamp,
    newMessage: newMessage.trim(),
    edited: true,
    editedAt: dmHistory[index].editedAt
  };

  if (targetSocket) {
    targetSocket.emit('dm message edited', editData);
  }
  if (senderSocket) {
    senderSocket.emit('dm message edited', editData);
  }

  res.json({ success: true });
});

// API to delete a DM message
app.delete('/api/dm/:targetUser/messages/:messageId', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { targetUser, messageId } = req.params;

  const dmKey = [req.username, targetUser].sort().join('_');
  const dmFile = path.join(__dirname, `dm_${dmKey}.json`);

  let dmHistory = [];
  try {
    if (fs.existsSync(dmFile)) {
      const dmData = fs.readFileSync(dmFile, 'utf8');
      dmHistory = JSON.parse(dmData);
    }
  } catch (error) {
    console.error('Error loading DM history:', error);
    return res.status(500).json({ error: 'Error loading DM history' });
  }

  const index = dmHistory.findIndex(m => m.id === messageId || m.timestamp === messageId);
  if (index === -1) {
    return res.status(404).json({ error: 'Message not found, try refreshing the page' });
  }

  const message = dmHistory[index];
  if (message.from !== req.username) {
    return res.status(403).json({ error: 'Can only delete your own messages' });
  }

  dmHistory.splice(index, 1);
  saveDMMessages(req.username, targetUser, dmHistory);

  const targetSocket = Array.from(io.sockets.sockets.values())
    .find(s => s.username === targetUser);
  const senderSocket = Array.from(io.sockets.sockets.values())
    .find(s => s.username === req.username);

  const deleteData = {
    targetUser,
    messageId: message.id || message.timestamp
  };

  if (targetSocket) {
    targetSocket.emit('dm message deleted', deleteData);
  }
  if (senderSocket) {
    senderSocket.emit('dm message deleted', deleteData);
  }

  res.json({ success: true });
});

// API to change username
app.post('/api/change-username', async (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { newUsername } = req.body;

  if (!newUsername || newUsername.length < 3 || newUsername.length > 20) {
    return res.status(400).json({ error: 'Username must be between 3 and 20 characters' });
  }

  if (users[newUsername]) {
    return res.status(400).json({ error: 'Username already exists' });
  }

  if (newUsername === req.username) {
    return res.status(400).json({ error: 'New username must be different from current username' });
  }

  try {
    const userData = users[req.username];
    delete users[req.username];
    users[newUsername] = {
      ...userData,
      username: newUsername
    };

    if (profilePictures[req.username]) {
      profilePictures[newUsername] = profilePictures[req.username];
      delete profilePictures[req.username];
      saveProfilePictures();
    }

    saveUsers();

    const userSocket = Array.from(io.sockets.sockets.values())
      .find(s => s.username === req.username);
    if (userSocket) {
      userSocket.disconnect();
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error changing username:', error);
    res.status(500).json({ error: 'Failed to change username' });
  }
});

// API to change password
app.post('/api/change-password', async (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const user = users[req.username];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  try {
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    users[req.username].password = hashedNewPassword;

    saveUsers();

    res.json({ success: true });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Helper function to format timestamp with date and time (no seconds)
function formatTimestamp() {
  const now = new Date();
  const date = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return { date, time, id: generateId() };
}

// Active screen shares are temporary and are scoped to the authenticated chat room.
const activeStreams = new Map();
const TYPING_TIMEOUT_MS = 20_000;
const typingByRoom = new Map();

function broadcastTypingUpdate(room, username, active) {
  io.to(room).emit('typing:update', { room, username, active });
}

function clearSocketTyping(room, username, socketId) {
  const roomTyping = typingByRoom.get(room);
  const userTyping = roomTyping?.get(username);
  if (!userTyping) return;

  const timer = userTyping.timers.get(socketId);
  if (timer) clearTimeout(timer);
  userTyping.timers.delete(socketId);

  if (userTyping.timers.size === 0) {
    roomTyping.delete(username);
    if (roomTyping.size === 0) typingByRoom.delete(room);
    broadcastTypingUpdate(room, username, false);
  }
}

function markSocketTyping(room, username, socketId) {
  let roomTyping = typingByRoom.get(room);
  if (!roomTyping) {
    roomTyping = new Map();
    typingByRoom.set(room, roomTyping);
  }

  let userTyping = roomTyping.get(username);
  if (!userTyping) {
    userTyping = { timers: new Map() };
    roomTyping.set(username, userTyping);
  }

  const wasAlreadyTyping = userTyping.timers.size > 0;
  const previousTimer = userTyping.timers.get(socketId);
  if (previousTimer) clearTimeout(previousTimer);

  userTyping.timers.set(socketId, setTimeout(() => {
    clearSocketTyping(room, username, socketId);
  }, TYPING_TIMEOUT_MS));

  if (!wasAlreadyTyping) broadcastTypingUpdate(room, username, true);
}

function sendTypingSnapshot(socket, room) {
  const roomTyping = typingByRoom.get(room);
  if (!roomTyping) return;
  for (const username of roomTyping.keys()) {
    socket.emit('typing:update', { room, username, active: true });
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  const user = socket.username;
  if (!user) {
    socket.disconnect(true);
    return;
  }

  let currentRoom = 'sigmachat:general';
  let currentServerId = 'sigmachat';
  let currentChannelId = 'general';
  let hasJoinedRoom = false;
  let typingRoom = null;

  function stopSocketTyping() {
    if (!typingRoom) return;
    clearSocketTyping(typingRoom, user, socket.id);
    typingRoom = null;
  }

  function startSocketTyping() {
    if (!hasJoinedRoom || !currentRoom || currentRoom.startsWith('dm:')) return;
    if (typingRoom && typingRoom !== currentRoom) stopSocketTyping();
    typingRoom = currentRoom;
    markSocketTyping(currentRoom, user, socket.id);
  }

  function stopOwnStream() {
    const stream = activeStreams.get(socket.id);
    if (!stream) return;
    activeStreams.delete(socket.id);
    io.to(stream.room).emit('stream:ended', {
      streamId: socket.id,
      username: user,
      room: stream.room
    });
  }

  // Parse room format: "serverId:channelId" or plain "channelId" (legacy)
  function parseRoom(roomStr) {
    if (!roomStr) return { serverId: 'sigmachat', channelId: 'general' };
    if (roomStr.includes(':')) {
      const [serverId, channelId] = roomStr.split(':');
      return { serverId, channelId };
    }
    // Legacy format - treat as default server channel
    return { serverId: 'sigmachat', channelId: roomStr };
  }

  socket.on('block-user', (targetUser) => {
    if (!user || !targetUser || user === targetUser) return;
    if (!blockedUsers[user]) blockedUsers[user] = [];
    if (!blockedUsers[user].includes(targetUser)) {
      blockedUsers[user].push(targetUser);
      saveBlockedUsers();
      socket.emit('user-blocked', targetUser);
    }
  });

  socket.on('unblock-user', (targetUser) => {
    if (!user || !targetUser) return;
    if (blockedUsers[user]) {
      blockedUsers[user] = blockedUsers[user].filter(u => u !== targetUser);
      saveBlockedUsers();
      socket.emit('user-unblocked', targetUser);
    }
  });

  socket.on('join', (data) => {
    stopSocketTyping();
    let requestedRoom = (data && data.room) || 'sigmachat:general';
    
    const { serverId, channelId } = parseRoom(requestedRoom);
    
    // Never trust a username supplied by the browser for socket identity.
    const server = servers[serverId];
    if (!isServerMember(serverId, user) || !server || !server.channels || !server.channels[channelId]) {
      currentServerId = 'sigmachat';
      currentChannelId = 'general';
    } else {
      currentServerId = serverId;
      currentChannelId = channelId;
    }
    
    currentRoom = `${currentServerId}:${currentChannelId}`;
    socket.username = user;
    socket.join(currentRoom);
    hasJoinedRoom = true;
    sendTypingSnapshot(socket, currentRoom);

    onlineUsers.add(user);
    // Send only unique usernames
    io.emit('user online', Array.from(onlineUsers));
  });

  socket.on('switch room', (data) => {
    const newRoomStr = typeof data === 'string' ? data : data.room;
    const { serverId, channelId } = parseRoom(newRoomStr);
    
    // Verify user has access to the server
    if (!isServerMember(serverId, user)) {
      socket.emit('error', { message: 'You do not have access to this server' });
      return;
    }
    
    // Verify channel exists in server
    const server = servers[serverId];
    if (!server || !server.channels || !server.channels[channelId]) {
      socket.emit('error', { message: 'Channel not found' });
      return;
    }

    stopOwnStream();
    stopSocketTyping();
    socket.leave(currentRoom);

    currentServerId = serverId;
    currentChannelId = channelId;
    currentRoom = `${serverId}:${channelId}`;
    socket.join(currentRoom);
    sendTypingSnapshot(socket, currentRoom);

    socket.emit('room switched', currentRoom);
  });

  socket.on('typing:start', startSocketTyping);
  socket.on('typing:stop', stopSocketTyping);

  socket.on('chat message', (msg) => {
    if (!user || !hasJoinedRoom || typeof msg !== 'string') return;
    msg = msg.trim();
    if (!msg || msg.length > 2000) return;
    stopSocketTyping();
    const ts = formatTimestamp();
    const messageData = {
      id: ts.id,
      username: user,
      message: msg,
      date: ts.date,
      time: ts.time,
      room: currentRoom
    };

    // Save to server channel messages
    const messages = loadServerMessages(currentServerId, currentChannelId);
    messages.push(messageData);
    saveServerMessages(currentServerId, currentChannelId, messages);

    io.to(currentRoom).emit('chat message', messageData);
  });

  socket.on('stream:list', () => {
    if (!hasJoinedRoom) return;
    const streams = Array.from(activeStreams.values())
      .filter(stream => stream.room === currentRoom)
      .map(({ streamId, username: streamUsername, room, startedAt }) => ({
        streamId, username: streamUsername, room, startedAt
      }));
    socket.emit('stream:list', streams);
  });

  socket.on('stream:start', () => {
    if (!hasJoinedRoom || currentRoom.startsWith('dm:')) {
      socket.emit('stream:error', { message: 'Screen sharing is only available in a chat channel.' });
      return;
    }
    if (activeStreams.has(socket.id)) return;

    const stream = {
      streamId: socket.id,
      username: user,
      room: currentRoom,
      startedAt: Date.now()
    };
    activeStreams.set(socket.id, stream);
    io.to(currentRoom).emit('stream:available', stream);
    socket.emit('stream:started', stream);
  });

  socket.on('stream:stop', stopOwnStream);

  socket.on('stream:offer', (payload, acknowledge) => {
    if (!payload || typeof payload !== 'object') payload = {};
    const { streamId, description } = payload;
    const stream = activeStreams.get(streamId);
    if (!stream || stream.room !== currentRoom || !socket.rooms.has(stream.room) ||
        !description || typeof description !== 'object') {
      if (typeof acknowledge === 'function') {
        acknowledge({ ok: false, message: 'The stream is no longer available in this channel.' });
      }
      return;
    }
    io.to(streamId).emit('stream:offer', {
      streamId,
      from: socket.id,
      username: user,
      description
    });
    if (typeof acknowledge === 'function') acknowledge({ ok: true });
  });

  socket.on('stream:answer', (payload = {}) => {
    if (!payload || typeof payload !== 'object') return;
    const { streamId, to, description } = payload;
    const stream = activeStreams.get(streamId);
    const viewer = io.sockets.sockets.get(to);
    if (!stream || socket.id !== streamId || !viewer ||
        !viewer.rooms.has(stream.room) || !description || typeof description !== 'object') return;
    viewer.emit('stream:answer', { streamId, from: socket.id, description });
  });

  socket.on('stream:ice', (payload = {}) => {
    if (!payload || typeof payload !== 'object') return;
    const { streamId, to, candidate } = payload;
    const stream = activeStreams.get(streamId);
    if (!stream || stream.room !== currentRoom || !socket.rooms.has(stream.room) ||
        !candidate || typeof candidate !== 'object') return;

    const viewer = io.sockets.sockets.get(to);
    if (!viewer || !viewer.rooms.has(stream.room)) return;
    if (socket.id !== streamId && to !== streamId) return;
    viewer.emit('stream:ice', { streamId, from: socket.id, candidate });
  });

  socket.on('stream:leave', (payload = {}) => {
    if (!payload || typeof payload !== 'object') return;
    const { streamId } = payload;
    const stream = activeStreams.get(streamId);
    if (!stream || stream.room !== currentRoom || socket.id === streamId) return;
    io.to(streamId).emit('stream:viewer-left', { streamId, viewerId: socket.id });
  });

  socket.on('dm message', (data) => {
    const { targetUser, message } = data;
    const ts = formatTimestamp();
    const messageData = {
      id: ts.id,
      from: user,
      to: targetUser,
      message: message,
      date: ts.date,
      time: ts.time
    };

    const dmKey = [user, targetUser].sort().join('_');
    const dmFile = path.join(__dirname, `dm_${dmKey}.json`);

    // Check if recipient has blocked the sender
    if (blockedUsers[targetUser] && blockedUsers[targetUser].includes(user)) {
      return; // Silently drop message if sender is blocked by recipient
    }

    let dmHistory = [];

    try {
      if (fs.existsSync(dmFile)) {
        const dmData = fs.readFileSync(dmFile, 'utf8');
        dmHistory = JSON.parse(dmData);
      }
    } catch (error) {
      console.error('Error loading DM history:', error);
    }

    dmHistory.push(messageData);
    saveDMMessages(user, targetUser, dmHistory);

    const targetSocket = Array.from(io.sockets.sockets.values())
      .find(s => s.username === targetUser);

    if (targetSocket) {
      targetSocket.emit('dm message', messageData);
    } else {
      // Fallback: If not found by username, try to find in the entire io.sockets.sockets map
      // sometimes socket.username might not be set correctly on all instances
      for (const [id, s] of io.sockets.sockets) {
        if (s.username === targetUser) {
          s.emit('dm message', messageData);
          break;
        }
      }
    }

    socket.emit('dm message', messageData);
  });

  socket.on('ban user', (data) => {
    if (adminUsers.has(user)) {
      const { targetUser, banMinutes } = data;
      
      const banData = {
        bannedBy: user,
        bannedAt: Date.now()
      };
      
      if (banMinutes === 0) {
        banData.expiresAt = null; // Permanent ban
        // Delete user account permanently if permanent ban
        if (users[targetUser]) {
          // Delete user messages from all possible locations
          
          // 1. Delete from default rooms
          const roomsToClean = ['general', 'suggestions', 'tech-support'];
          roomsToClean.forEach(roomId => {
            if (roomMessages[roomId]) {
              roomMessages[roomId] = roomMessages[roomId].filter(m => m.username !== targetUser);
              saveRoomMessages(roomId);
            }
          });

          // 2. Delete from servers and their channels
          Object.keys(servers).forEach(serverId => {
            const server = servers[serverId];
            if (server.channels) {
              Object.keys(server.channels).forEach(channelId => {
                let messages = loadServerMessages(serverId, channelId);
                const originalLength = messages.length;
                messages = messages.filter(m => m.username !== targetUser);
                if (messages.length !== originalLength) {
                  saveServerMessages(serverId, channelId, messages);
                }
              });
            }
          });

          // 3. Delete DM files related to this user
          const files = fs.readdirSync(__dirname);
          files.forEach(file => {
            if (file.startsWith('dm_') && file.endsWith('.json') && file.includes(targetUser)) {
              try {
                fs.unlinkSync(path.join(__dirname, file));
              } catch (err) {
                console.error(`Error deleting DM file ${file}:`, err);
              }
            }
          });

          delete users[targetUser];
          fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
        }
      } else {
        banData.expiresAt = Date.now() + (banMinutes * 60 * 1000);
      }
      
      bannedUsers[targetUser] = banData;
      saveBannedUsers();

      const targetSocket = Array.from(io.sockets.sockets.values())
        .find(s => s.username === targetUser);

      if (targetSocket) {
        const banMessage = banMinutes === 0 
          ? 'You have been permanently banned from the chat.'
          : `You have been banned for ${banMinutes} minutes.`;
        targetSocket.emit('banned', { message: banMessage });
        targetSocket.disconnect();
      }

      io.emit('user banned', { bannedUser: targetUser, byAdmin: user });
    }
  });

  socket.on('disconnect', () => {
    stopOwnStream();
    stopSocketTyping();
    if (user) {
      onlineUsers.delete(user);
      io.emit('user online', Array.from(onlineUsers));
    }
  });
});

// API to upload images
app.post('/api/upload-image', upload.single('image'), (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const serverId = req.body.serverId;
  let imageUrl;
  if (serverId && serverId !== 'sigmachat') {
    imageUrl = `/uploads/servers/${serverId}/${req.file.filename}`;
  } else {
    imageUrl = `/uploads/${req.file.filename}`;
  }
  
  res.json({ success: true, imageUrl: imageUrl });
});

// API to get user settings
app.get('/api/user-settings', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!userSettings[req.username]) {
    userSettings[req.username] = {
      allowDMs: true,
      dataUsage: true,
      desktopNotifications: true,
      messageSounds: true
    };
  }

  res.json(userSettings[req.username]);
});

// API to update user settings
app.post('/api/user-settings', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { allowDMs, dataUsage, desktopNotifications, messageSounds, incognitoMode } = req.body;

  if (!userSettings[req.username]) {
    userSettings[req.username] = {};
  }

  if (typeof allowDMs === 'boolean') userSettings[req.username].allowDMs = allowDMs;
  if (typeof dataUsage === 'boolean') userSettings[req.username].dataUsage = dataUsage;
  if (typeof desktopNotifications === 'boolean') userSettings[req.username].desktopNotifications = desktopNotifications;
  if (typeof messageSounds === 'boolean') userSettings[req.username].messageSounds = messageSounds;
  if (typeof incognitoMode === 'boolean') userSettings[req.username].incognitoMode = incognitoMode;

  saveUserSettings();
  res.json({ success: true, settings: userSettings[req.username] });
});

// Start the server
// API to vote on a poll
app.post('/api/servers/:serverId/channels/:channelId/messages/:messageId/poll/vote', (req, res) => {
  const { serverId, channelId, messageId } = req.params;
  const { optionIndex } = req.body;
  const currentUser = req.username;

  if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });

  const messages = loadServerMessages(serverId, channelId);
  const messageIndex = messages.findIndex(m => m.id === messageId);

  if (messageIndex === -1) return res.status(404).json({ error: 'Message not found, try refreshing the page' });

  try {
    const pollData = JSON.parse(messages[messageIndex].message);
    if (pollData.type !== 'poll') return res.status(400).json({ error: 'Not a poll' });

    // Remove vote from other options and toggle on current option
    pollData.options.forEach((opt, i) => {
      const voteIdx = opt.votes.indexOf(currentUser);
      if (voteIdx !== -1) {
        opt.votes.splice(voteIdx, 1);
      }
      if (i === optionIndex && voteIdx === -1) {
        opt.votes.push(currentUser);
      }
    });

    messages[messageIndex].message = JSON.stringify(pollData);
    saveServerMessages(serverId, channelId, messages);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: 'Invalid poll data' });
  }
});

http.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`Access your app via the Replit webview`);
});
