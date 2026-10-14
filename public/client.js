// SigmaChat Client - Discord-like chat application
const socket = io();

let username = null;
let isAppInitialized = false;
let currentServer = 'sigmachat';
let currentChannel = 'general';
let currentDM = null;
const typingUsers = new Map();
let onlineUsers = [];
let dmHistories = {};
let isAdmin = false;
let isServerAdmin = false;
let bannedUsers = new Set();
let notificationsEnabled = true;
let allowDMs = true;
let desktopNotifications = true;
let dataUsage = true;
let servers = {};

// Check localStorage immediately for incognito mode to prevent flash
let incognitoMode = localStorage.getItem('incognitoMode') === 'true';
let unreadMessages = 0;

// Apply incognito immediately if set in localStorage
if (incognitoMode) {
  document.title = 'Home';
  // Update favicon as soon as DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon) favicon.href = '/incognito_favicon.ico';
  });
}

// Load user preferences from server
function loadUserPreferences() {
  return fetch('/api/user-settings')
    .then(response => response.json())
    .then(settings => {
      allowDMs = settings.allowDMs !== false;
      desktopNotifications = settings.desktopNotifications !== false;
      dataUsage = settings.dataUsage !== false;
      unreadMessages = 0; // Reset on load
      notificationsEnabled = settings.messageSounds !== false;
      incognitoMode = settings.incognitoMode === true;
      // Store in localStorage for persistence across page reloads
      localStorage.setItem('incognitoMode', incognitoMode.toString());
      updateIncognito();
      // Sync checkbox state
      const checkbox = document.getElementById('incognito-mode');
      if (checkbox) checkbox.checked = incognitoMode;
      return settings;
    })
    .catch(error => {
      console.error('Error loading user preferences:', error);
    });
}

function updateIncognito() {
  updateFavicon();
  updateTitle();
}

function updateFavicon() {
  const favicon = document.querySelector('link[rel="icon"]');
  if (!favicon) return;

  if (incognitoMode) {
    favicon.href = '/incognito_favicon.ico';
  } else {
    if (unreadMessages > 0) {
      favicon.href = '/unread_favicon.png';
    } else {
      favicon.href = '/favicon.png';
    }
  }
}

function updateTitle() {
  if (incognitoMode) {
    document.title = 'Home';
  } else {
    const baseTitle = currentDM ? `@${currentDM}` : (currentChannel ? `#${currentChannel}` : 'Sigmachat');
    document.title = unreadMessages > 0 ? `(${unreadMessages}) ${baseTitle} | Sigmachat` : `${baseTitle} | Sigmachat`;
  }
}

// Add these to catch any state changes
window.addEventListener('load', () => {
  loadUserPreferences();
});

function openYouTube() {
  window.open("https://www.youtube.com/", "_blank");
}

// Block user functionality
function blockUser(targetUser) {
  if (targetUser === username) {
    showNotification("You can't block yourself", 'warning');
    return;
  }
  showConfirmNotification(`Are you sure you want to block ${targetUser}? They won't be able to send you direct messages.`, () => {
    socket.emit('block-user', targetUser);
  }, 'Block User');
}

function unblockUser(targetUser) {
  socket.emit('unblock-user', targetUser);
}

socket.on('user-blocked', (targetUser) => {
  showNotification(`${targetUser} has been blocked`, 'success');
  // Refresh UI if needed
});

socket.on('user-unblocked', (targetUser) => {
  showNotification(`${targetUser} has been unblocked`, 'success');
});


function playNotificationSound() {
  if (!notificationsEnabled) return;
  try {
    const audio = new Audio('/notification.wav');
    audio.volume = 0.5;
    audio.play().catch(() => {});
  } catch (e) {}
}

function showNotification(message, type = 'info', title = '') {
  const container = document.getElementById('notification-container');
  if (!container) return;

  const notification = document.createElement('div');
  notification.className = `notification-toast ${type}`;
  const titleText = title || (type === 'error' ? 'Error' : type === 'success' ? 'Success' : type === 'warning' ? 'Warning' : 'Notification');

  notification.innerHTML = `
    <div class="notification-content">
      <div class="notification-title">${titleText}</div>
      <div class="notification-message">${message}</div>
    </div>
    <button class="notification-close">&times;</button>
  `;

  container.appendChild(notification);
  const closeBtn = notification.querySelector('.notification-close');
  closeBtn.addEventListener('click', () => {
    notification.classList.add('closing');
    setTimeout(() => notification.remove(), 300);
  });

  setTimeout(() => {
    if (notification.parentElement) {
      notification.classList.add('closing');
      setTimeout(() => notification.remove(), 300);
    }
  }, 5000);
}

// Add focus listener to reset unread count
window.addEventListener('focus', () => {
  if (unreadMessages > 0) {
    unreadMessages = 0;
    updateFavicon();
    updateTitle();
  }
});

function showConfirmNotification(message, onConfirm, title = 'Confirm') {
  const overlay = document.getElementById('confirm-notification-overlay');
  const modal = document.getElementById('confirm-notification');
  const titleEl = document.getElementById('confirm-title');
  const messageEl = document.getElementById('confirm-message');
  const okBtn = document.getElementById('confirm-ok-btn');

  titleEl.textContent = title;
  messageEl.textContent = message;
  
  overlay.style.display = 'flex';
  modal.style.display = 'block';

  okBtn.onclick = () => {
    closeConfirmNotification();
    onConfirm();
  };
}

function closeConfirmNotification() {
  const overlay = document.getElementById('confirm-notification-overlay');
  const modal = document.getElementById('confirm-notification');
  overlay.style.display = 'none';
  modal.style.display = 'none';
}

let isSuperAdmin = false;
let isGlobalAdmin = false;

// Initialize application
fetch('/api/user')
  .then(response => response.json())
  .then(data => {
    if (data.username) {
      username = data.username;
      isAdmin = data.username === 'thatswitchguy' || data.username === 'ikhan';
      loadUserPreferences();
      // Fetch global admin status
      fetch('/api/admin/status')
        .then(r => r.json())
        .then(adminData => {
          isSuperAdmin = adminData.isSuperAdmin;
          isGlobalAdmin = adminData.isGlobalAdmin;
          if (isGlobalAdmin) isAdmin = true;
          initializeApp();
        })
        .catch(() => {
          initializeApp();
        });
    } else {
      window.location.href = '/login';
    }
  })
  .catch(() => {
    window.location.href = '/login';
  });

function initializeApp() {
  updateUserPanel();
  loadServers();
  loadOnlineUsers();
  setupEventListeners();
  setupChannelEditHandler();
  isAppInitialized = true;
  joinSocketRoom();
  
  // Show admin control button for super admin
  if (isSuperAdmin) {
    const adminBtn = document.getElementById('admin-control-btn');
    if (adminBtn) adminBtn.style.display = 'block';
  }
}

function joinSocketRoom() {
  if (!isAppInitialized || !username || !socket.connected) return;
  const room = typeof currentRoom === 'string' && currentRoom.includes(':')
    ? currentRoom
    : `${currentServer}:${currentChannel || currentRoom || 'general'}`;
  socket.emit('join', { username, room });
  if (!currentDM) socket.emit('stream:list');
}

socket.on('connect', () => {
  if (isAppInitialized) joinSocketRoom();
});

function updateUserPanel() {
  const userAvatar = document.getElementById('user-avatar');
  const userNameDisplay = document.getElementById('user-name-display');
  
  if (userNameDisplay) userNameDisplay.textContent = username;
  if (userAvatar) {
    fetch('/api/profile-picture')
      .then(r => r.json())
      .then(data => {
        if (data.profilePicture) {
          userAvatar.innerHTML = `<img src="${data.profilePicture}" alt="${username}" onerror="this.style.display='none'; this.parentElement.textContent='${username.charAt(0).toUpperCase()}';">`;
        } else {
          userAvatar.textContent = username.charAt(0).toUpperCase();
        }
      })
      .catch(() => {
        userAvatar.textContent = username.charAt(0).toUpperCase();
      });
  }
}

// Server management
function loadServers() {
  fetch('/api/servers')
    .then(response => response.json())
    .then(data => {
      servers = data;
      renderServerList();
      if (servers[currentServer]) {
        selectServer(currentServer);
      } else {
        const firstServer = Object.keys(servers)[0];
        if (firstServer) selectServer(firstServer);
      }
    })
    .catch(error => {
      console.error('Error loading servers:', error);
    });
}

function renderServerList() {
  const serverListItems = document.getElementById('server-list-items');
  if (!serverListItems) return;
  
  serverListItems.innerHTML = '';
  
  Object.values(servers).forEach(server => {
    const serverIcon = document.createElement('div');
    serverIcon.className = `server-icon ${server.id === currentServer ? 'active' : ''}`;
    serverIcon.title = server.name;
    serverIcon.dataset.serverId = server.id;
    
    if (server.icon) {
      serverIcon.innerHTML = `<img src="${server.icon}" alt="${server.name}" onerror="this.parentElement.innerHTML='<span>${server.name.charAt(0).toUpperCase()}</span>'">`;
    } else {
      serverIcon.innerHTML = `<span>${server.name.charAt(0).toUpperCase()}</span>`;
    }
    
    serverIcon.onclick = () => selectServer(server.id);
    serverListItems.appendChild(serverIcon);
  });
}

function selectServer(serverId) {
  currentServer = serverId;
  currentDM = null;
  
  document.querySelectorAll('.server-icon').forEach(icon => {
    icon.classList.toggle('active', icon.dataset.serverId === serverId);
  });
  
  fetch(`/api/servers/${serverId}`)
    .then(response => response.json())
    .then(server => {
      isServerAdmin = server.isAdmin || server.isOwner;
      document.getElementById('server-name').textContent = server.name;
      
      const settingsBtn = document.getElementById('server-settings-btn');
      const addChannelBtn = document.getElementById('add-channel-btn');
      
      const canManage = isServerAdmin || isGlobalAdmin;
      
      if (settingsBtn) settingsBtn.style.display = canManage ? 'block' : 'none';
      if (addChannelBtn) addChannelBtn.style.display = canManage ? 'block' : 'none';
      
      renderChannelList(server.channels);
      
      const firstChannel = Object.keys(server.channels)[0];
      if (firstChannel) {
        selectChannel(firstChannel);
      } else {
        const messagesContainer = document.getElementById('messages');
        if (messagesContainer) messagesContainer.innerHTML = '<div class="message system"><span class="content">No channels available in this server.</span></div>';
        const currentRoom = document.getElementById('current-room');
        if (currentRoom) currentRoom.textContent = 'No Channels';
      }
    })
    .catch(error => {
      console.error('Error loading server:', error);
    });
}

function renderChannelList(channels) {
  const channelList = document.getElementById('channel-list');
  if (!channelList) return;
  
  channelList.innerHTML = '';
  
  const protectedChannels = ['general', 'suggestions', 'tech-support'];
  const canManage = isServerAdmin || isGlobalAdmin;
  
  Object.entries(channels || {}).forEach(([channelId, channel]) => {
    const channelItem = document.createElement('div');
    channelItem.className = `channel-item ${channelId === currentChannel ? 'active' : ''}`;
    channelItem.dataset.channelId = channelId;
    
    let actions = '';
    const isProtected = protectedChannels.includes(channelId) && currentServer === 'sigmachat';
    
    if (canManage && !isProtected) {
      actions = `
        <div class="channel-actions">
          <button class="channel-edit" onclick="event.stopPropagation(); openEditChannelModal('${channelId}', '${channel.name}')" title="Edit Channel">
            <img src="https://cdn-icons-png.freepik.com/512/10337/10337031.png" alt="Edit">
          </button>
          <button class="channel-delete" onclick="event.stopPropagation(); deleteChannel('${channelId}')" title="Delete Channel">×</button>
        </div>
      `;
    }
    
    channelItem.innerHTML = `
      <div class="channel-content">
        <span class="channel-hash">#</span>
        <span class="channel-name">${channel.name || channelId}</span>
      </div>
      ${actions}
    `;
    channelItem.onclick = () => selectChannel(channelId);
    channelList.appendChild(channelItem);
  });
}

let editingChannelId = null;

function openEditChannelModal(channelId, currentName) {
  editingChannelId = channelId;
  const input = document.getElementById('edit-channel-name-input');
  if (input) input.value = currentName;
  openModal('edit-channel-modal');
}

// Update the submit handler in setupEventListeners or add it here
function setupChannelEditHandler() {
  const submitBtn = document.getElementById('edit-channel-submit');
  if (submitBtn) {
    submitBtn.onclick = () => {
      const newName = document.getElementById('edit-channel-name-input').value.trim();
      if (!newName) {
        showNotification('Please enter a channel name', 'warning');
        return;
      }

      fetch(`/api/servers/${currentServer}/channels/${editingChannelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          closeModal();
          showNotification('Channel updated', 'success');
          // Refresh servers and re-select the current one to update UI
          loadServers();
        } else {
          showNotification(data.error || 'Failed to update channel', 'error');
        }
      })
      .catch(() => showNotification('Failed to update channel', 'error'));
    };
  }
}

function selectChannel(channelId) {
  stopTypingActivity();
  clearTypingIndicator();
  currentChannel = channelId;
  currentDM = null;
  unreadMessages = 0;
  updateFavicon();
  updateTitle();
  
  document.querySelectorAll('.channel-item').forEach(item => {
    item.classList.toggle('active', item.dataset.channelId === channelId);
  });
  
  document.getElementById('current-room').textContent = `#${channelId}`;
  document.getElementById('input').placeholder = `Message #${channelId}`;
  
  const messages = document.getElementById('messages');
  messages.innerHTML = '';
  
  socket.emit('switch room', { room: `${currentServer}:${channelId}` });
  
  loadChannelMessages(currentServer, channelId);
}

function loadChannelMessages(serverId, channelId) {
  fetch(`/api/servers/${serverId}/channels/${channelId}/messages`)
    .then(response => response.json())
    .then(messageList => {
      const messagesContainer = document.getElementById('messages');
      messagesContainer.innerHTML = '';
      
      messageList.forEach((msg, index) => {
        appendMessage(msg, index, 'channel');
      });
      
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      // Mark as scrolled to bottom since we just scrolled
      isScrolledToBottom = true;
      checkScrollPosition();
    })
    .catch(error => {
      console.error('Error loading messages:', error);
    });
}

// Global poll update handler
socket.on('poll updated', (data) => {
  const { messageId, pollData } = data;
  const pollElement = document.querySelector(`.message[data-message-id="${messageId}"] .poll-container`);
  if (pollElement) {
    const totalVotes = pollData.options.reduce((sum, opt) => sum + opt.votes.length, 0);
    const currentUser = document.getElementById('user-name-display')?.textContent || '';
    
    let optionsHtml = '';
    pollData.options.forEach((opt, i) => {
      const percentage = totalVotes === 0 ? 0 : Math.round((opt.votes.length / totalVotes) * 100);
      const hasVoted = opt.votes.includes(currentUser);
      optionsHtml += `
        <div class="poll-option ${hasVoted ? 'voted' : ''}" onclick="votePoll('${messageId}', ${i})">
          <div class="poll-progress" style="width: ${percentage}%"></div>
          <div class="poll-option-header">
            <span class="poll-option-text">${opt.text}</span>
            <div style="display: flex; align-items: center;">
              <span class="poll-vote-count">${opt.votes.length} votes</span>
              <span class="poll-percentage">${percentage}%</span>
            </div>
          </div>
        </div>
      `;
    });
    pollElement.innerHTML = `
      <div class="poll-question">${pollData.question}</div>
      ${optionsHtml}
    `;
  }
});

function showMessageActions(element) {
  const actions = element.querySelector('.message-actions');
  if (actions) actions.style.display = 'flex';
}

function hideMessageActions(element) {
  const actions = element.querySelector('.message-actions');
  if (actions) actions.style.display = 'none';
}

function appendMessage(messageData, index, type) {
  const messagesContainer = document.getElementById('messages');
  const messageDiv = document.createElement('div');
  messageDiv.className = messageData.username === 'System' ? 'message system' : 'message';
  messageDiv.dataset.messageId = messageData.id;

  if (messageData.username === 'System' || !messageData.username) {
    messageDiv.innerHTML = `<span class="content">${messageData.message}</span>`;
    messagesContainer.appendChild(messageDiv);
    return;
  }

  let processedMessage = messageData.message || '';
  
  // Check for poll
  if (processedMessage.startsWith('{"type":"poll"')) {
    try {
      const pollData = JSON.parse(processedMessage);
      appendPoll(messageData, pollData);
      return;
    } catch (e) {}
  }

  if (processedMessage.includes('@')) {
    processedMessage = processedMessage.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
  }

  const urls = [];
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  let match;
  
  // First, find all URLs and their types
  const processedParts = [];
  let lastIndex = 0;
  
  while ((match = urlRegex.exec(processedMessage)) !== null) {
    // Add text before the URL
    processedParts.push(processedMessage.substring(lastIndex, match.index));
    
    let url = match[0];
    // Clean up trailing punctuation that might be caught in the regex
    const trailingPunctuation = /[.,!?;:]+$/;
    const punctuationMatch = url.match(trailingPunctuation);
    let punctuation = '';
    if (punctuationMatch) {
      punctuation = punctuationMatch[0];
      url = url.substring(0, url.length - punctuation.length);
    }

    const youtubeMatch = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
    const isImage = url.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?$/i);
    const isVideo = url.match(/\.(mp4|webm|mov|avi|mkv|ogg)(\?[^\s]*)?$/i);
    
    if (youtubeMatch) {
      const videoId = youtubeMatch[1];
      const fullUrl = url.startsWith('http') ? url : `https://${url}`;
      processedParts.push(`<div class="youtube-embed" ondblclick="window.open('${fullUrl}', '_blank')">
        <iframe src="https://www.youtube.com/embed/${videoId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
      </div>${punctuation}`);
    } else if (isVideo) {
      processedParts.push(`<video src="${url}" class="message-video" controls preload="metadata"></video>${punctuation}`);
    } else if (isImage) {
      processedParts.push(`<img src="${url}" alt="Image" class="message-image" onclick="openImageModal('${url}')">${punctuation}`);
    } else {
      processedParts.push(`<a href="${url}" target="_blank" class="message-link">${url}</a>${punctuation}`);
    }
    
    lastIndex = match.index + url.length + punctuation.length;
    urlRegex.lastIndex = lastIndex;
  }
  
  // Add remaining text
  processedParts.push(processedMessage.substring(lastIndex));
  processedMessage = processedParts.join('');

  const date = messageData.date || '';
  const time = messageData.time || '';
  const messageId = messageData.id;
  const editedIndicator = messageData.edited ? ` <span class="edited">(edited)</span>` : '';

  fetch(`/api/user-profile/${messageData.username}`)
    .then(r => r.json())
    .then(profile => {
      let avatar;
      if (profile.profilePicture) {
        avatar = `<img src="${profile.profilePicture}" alt="${messageData.username}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; margin-right: 8px;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                  <div style="display: none; width: 32px; height: 32px; border-radius: 50%; background-color: #5865f2; align-items: center; justify-content: center; color: white; font-weight: bold; margin-right: 8px;">${messageData.username.charAt(0).toUpperCase()}</div>`;
      } else {
        avatar = `<div style="width: 32px; height: 32px; border-radius: 50%; background-color: #5865f2; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; margin-right: 8px;">${messageData.username.charAt(0).toUpperCase()}</div>`;
      }

      const messageActions = messageData.username === username ? `
        <div class="message-actions" style="display: none; margin-left: 8px;">
          <button class="edit-btn" onclick="editMessage('${currentServer}', '${currentChannel}', '${messageId}', 'room')">Edit</button>
          <button class="delete-btn" onclick="deleteMessage('${currentServer}', '${currentChannel}', '${messageId}', 'room')">Delete</button>
        </div>
      ` : '';

      messageDiv.innerHTML = `
        <div style="display: flex; align-items: flex-start;">
          ${avatar}
          <div style="flex: 1;">
            ${date ? `<div class="message-date">${date}</div>` : ''}
            <span class="timestamp">[${time}]</span>
            <span class="username">${messageData.username}:</span>
            <span class="content">${processedMessage}</span>
            ${editedIndicator}
          </div>
          ${messageActions}
        </div>
      `;
    })
    .catch(() => {
      const messageActions = messageData.username === username ? `
        <div class="message-actions" style="display: none; margin-left: 8px;">
          <button class="edit-btn" onclick="editMessage('${currentServer}', '${currentChannel}', '${messageId}', 'room')">Edit</button>
          <button class="delete-btn" onclick="deleteMessage('${currentServer}', '${currentChannel}', '${messageId}', 'room')">Delete</button>
        </div>
      ` : '';

      messageDiv.innerHTML = `
        <div style="display: flex; align-items: flex-start;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background-color: #5865f2; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; margin-right: 8px;">${messageData.username.charAt(0).toUpperCase()}</div>
          <div style="flex: 1;">
            ${date ? `<div class="message-date">${date}</div>` : ''}
            <span class="timestamp">[${time}]</span>
            <span class="username">${messageData.username}:</span>
            <span class="content">${processedMessage}</span>
            ${editedIndicator}
          </div>
          ${messageActions}
        </div>
      `;
    });

  messagesContainer.appendChild(messageDiv);
}

function appendPoll(messageData, pollData) {
  const messagesContainer = document.getElementById('messages');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message';
  messageDiv.dataset.messageId = messageData.id;

  const date = messageData.date || '';
  const time = messageData.time || '';
  const totalVotes = pollData.options.reduce((sum, opt) => sum + opt.votes.length, 0);

  // Get current username from the user panel
  const currentUser = document.getElementById('user-name-display')?.textContent || '';

  fetch(`/api/user-profile/${messageData.username}`)
    .then(r => r.json())
    .then(profile => {
      let avatar;
      if (profile.profilePicture) {
        avatar = `<img src="${profile.profilePicture}" alt="${messageData.username}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; margin-right: 8px;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                  <div style="display: none; width: 32px; height: 32px; border-radius: 50%; background-color: #5865f2; align-items: center; justify-content: center; color: white; font-weight: bold; margin-right: 8px;">${messageData.username.charAt(0).toUpperCase()}</div>`;
      } else {
        avatar = `<div style="width: 32px; height: 32px; border-radius: 50%; background-color: #5865f2; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; margin-right: 8px;">${messageData.username.charAt(0).toUpperCase()}</div>`;
      }

      let optionsHtml = '';
      pollData.options.forEach((opt, i) => {
        const percentage = totalVotes === 0 ? 0 : Math.round((opt.votes.length / totalVotes) * 100);
        const hasVoted = opt.votes.includes(currentUser);
        optionsHtml += `
          <div class="poll-option ${hasVoted ? 'voted' : ''}" onclick="votePoll('${messageData.id}', ${i})">
            <div class="poll-progress" style="width: ${percentage}%"></div>
            <div class="poll-option-header">
              <span class="poll-option-text">${opt.text}</span>
              <div style="display: flex; align-items: center;">
                <span class="poll-vote-count">${opt.votes.length} votes</span>
                <span class="poll-percentage">${percentage}%</span>
              </div>
            </div>
          </div>
        `;
      });

      const pollActions = messageData.username === username ? `
        <div class="message-actions" style="display: none; margin-left: 8px;">
          <button class="delete-btn" onclick="deleteMessage('${currentServer}', '${currentChannel}', '${messageData.id}', 'room')">Delete</button>
        </div>
      ` : '';

      messageDiv.innerHTML = `
        <div style="display: flex; align-items: flex-start;">
          ${avatar}
          <div style="flex: 1;">
            ${date ? `<div class="message-date">${date}</div>` : ''}
            <span class="timestamp">[${time}]</span>
            <span class="username">${messageData.username}:</span>
            <div class="poll-container">
              <div class="poll-question">${pollData.question}</div>
              ${optionsHtml}
            </div>
          </div>
          ${pollActions}
        </div>
      `;
    });

  messagesContainer.appendChild(messageDiv);
}

function votePoll(messageId, optionIndex) {
  fetch(`/api/servers/${currentServer}/channels/${currentChannel}/messages/${messageId}/poll/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ optionIndex })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      loadChannelMessages(currentServer, currentChannel);
    } else {
      showNotification(data.error || 'Failed to vote', 'error');
    }
  });
}

function deleteMessage(serverId, channelId, messageId, type) {
  const url = type === 'dm' ? `/api/dm/${serverId}/messages/${messageId}` : `/api/servers/${serverId}/channels/${channelId}/messages/${messageId}`;
  fetch(url, { method: 'DELETE' })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification('Message deleted', 'success');
        // If DM, the roomId (serverId) is actually the target username
        if (type === 'dm') openDM(serverId);
        else loadChannelMessages(serverId, channelId);
      } else {
        showNotification(data.error || 'Failed to delete message', 'error');
      }
    })
    .catch(() => showNotification('Failed to delete message', 'error'));
}

function editMessage(serverId, channelId, messageId, type) {
  const newMessage = prompt('Edit your message:');
  if (newMessage !== null && newMessage.trim() !== '') {
    const url = type === 'dm' ? `/api/dm/${serverId}/messages/${messageId}` : `/api/servers/${serverId}/channels/${channelId}/messages/${messageId}`;
    fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newMessage })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification('Message updated', 'success');
        if (type === 'dm') openDM(serverId);
        else loadChannelMessages(serverId, channelId);
      } else {
        showNotification(data.error || 'Failed to edit message', 'error');
      }
    })
    .catch(() => showNotification('Failed to edit message', 'error'));
  }
}

function deleteChannel(channelId) {
  showConfirmNotification(`Delete channel #${channelId}?`, () => {
    fetch(`/api/servers/${currentServer}/channels/${channelId}`, { method: 'DELETE' })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          showNotification('Channel deleted', 'success');
          selectServer(currentServer);
        } else {
          showNotification(data.error || 'Failed to delete channel', 'error');
        }
      })
      .catch(error => {
        showNotification('Failed to delete channel', 'error');
      });
  }, 'Delete Channel');
}

// Expand/Collapse Sidebar
function setupSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const expandBtn = document.getElementById('expand-sidebar-btn');
  const collapseBtn = document.getElementById('collapse-sidebar-btn');

  if (collapseBtn && expandBtn && sidebar) {
    collapseBtn.onclick = () => {
      sidebar.classList.add('collapsed');
      expandBtn.style.display = 'block';
    };

    expandBtn.onclick = () => {
      sidebar.classList.remove('collapsed');
      expandBtn.style.display = 'none';
    };
  }
}

// Plus button toggle
function setupPlusBtn() {
  const plusBtn = document.getElementById('plus-btn');
  const plusOptions = document.getElementById('plus-options');
  
  if (plusBtn && plusOptions) {
    plusBtn.onclick = (e) => {
      e.stopPropagation();
      plusOptions.style.display = plusOptions.style.display === 'flex' ? 'none' : 'flex';
      plusBtn.classList.toggle('active');
    };

    document.addEventListener('click', () => {
      plusOptions.style.display = 'none';
      plusBtn.classList.remove('active');
    });
  }
}

function setupAuraHandler() {
    if (document.getElementById('aura-handler-init')) return;
    
    const auraBtn = document.getElementById('aura-btn');
    if (auraBtn) {
        const handleAuraClick = () => {
            const sidebar = document.getElementById('sidebar');
            const mainChat = document.getElementById('main-chat');
            const auraEmbed = document.getElementById('aura-embed-container');
            const expandSidebarBtn = document.getElementById('expand-sidebar-btn');

            if (sidebar) sidebar.style.display = 'none';
            if (mainChat) mainChat.style.display = 'none';
            if (expandSidebarBtn) expandSidebarBtn.style.display = 'none';
            if (auraEmbed) auraEmbed.style.display = 'flex';

            document.querySelectorAll('.server-icon').forEach(icon => icon.classList.remove('active'));
            auraBtn.classList.add('active');
        };

        auraBtn.addEventListener('click', handleAuraClick);
        
        // Handle G key press
        document.addEventListener('keydown', (e) => {
            // Don't trigger if user is typing in an input or textarea
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            if (e.key.toLowerCase() === 'g') {
                handleAuraClick();
            }
        });
        
        const marker = document.createElement('div');
        marker.id = 'aura-handler-init';
        marker.style.display = 'none';
        document.body.appendChild(marker);
    }

    // Restore view when other server icons are clicked
    document.addEventListener('click', (e) => {
        const serverIcon = e.target.closest('.server-icon:not(#aura-btn)');
        if (serverIcon) {
            const sidebar = document.getElementById('sidebar');
            const mainChat = document.getElementById('main-chat');
            const auraEmbed = document.getElementById('aura-embed-container');
            
            if (sidebar) sidebar.style.display = 'flex';
            if (mainChat) mainChat.style.display = 'flex';
            if (auraEmbed) auraEmbed.style.display = 'none';
            if (auraBtn) auraBtn.classList.remove('active');
        }
    });
}

function getCurrentTypingRoom() {
  if (currentDM) return null;
  return `${currentServer || 'sigmachat'}:${currentChannel || currentRoom || 'general'}`;
}

function renderTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  const text = document.getElementById('typing-indicator-text');
  if (!indicator || !text) return;

  const room = getCurrentTypingRoom();
  const names = Array.from(typingUsers.entries())
    .filter(([, activeRoom]) => activeRoom === room)
    .map(([activeUsername]) => activeUsername);

  if (names.length === 0) {
    indicator.hidden = true;
    text.textContent = '';
    return;
  }

  indicator.hidden = false;
  if (names.length === 1) {
    text.textContent = `${names[0]} is typing...`;
  } else if (names.length === 2) {
    text.textContent = `${names[0]} and ${names[1]} are typing...`;
  } else {
    text.textContent = `${names[0]}, ${names[1]}, and ${names.length - 2} others are typing...`;
  }
}

function clearTypingIndicator() {
  typingUsers.clear();
  renderTypingIndicator();
}

function stopTypingActivity() {
  if (socket.connected) socket.emit('typing:stop');
}

function setupMessageComposer() {
  const inputEl = document.getElementById('input');
  if (!inputEl || inputEl.dataset.composerBound === 'true') return;
  inputEl.dataset.composerBound = 'true';

  inputEl.addEventListener('input', function() {
    this.style.height = '40px';
    const newHeight = Math.min(this.scrollHeight, 100);
    this.style.height = (this.value === '' ? 40 : newHeight) + 'px';
    this.style.overflowY = this.scrollHeight > 100 ? 'auto' : 'hidden';
    if (!currentDM) {
      socket.emit(this.value.trim() ? 'typing:start' : 'typing:stop');
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const form = inputEl.closest('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        inputEl.style.height = '40px';
        inputEl.style.overflowY = 'hidden';
      }
    }
  });
}

function setupEventListeners() {
    setupAuraHandler();
  setupMessageComposer();
  setupSidebarToggle();
  
  const uploadBtn = document.getElementById('direct-upload-btn');
  const pollBtn = document.getElementById('direct-poll-btn');
  
  if (uploadBtn) {
    uploadBtn.onclick = () => document.getElementById('image-upload').click();
  }
  
  if (pollBtn) {
    pollBtn.onclick = () => openModal('poll-modal');
  }

  // Collapse sidebar button - toggles both ways
  document.getElementById('collapse-sidebar-btn')?.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const mainChat = document.getElementById('main-chat');
    const expandBtn = document.getElementById('expand-sidebar-btn');
    const isCollapsed = sidebar.classList.contains('collapsed');
    
    if (isCollapsed) {
      sidebar.classList.remove('collapsed');
      mainChat.classList.remove('expanded');
      if (expandBtn) expandBtn.style.display = 'none';
    } else {
      sidebar.classList.add('collapsed');
      mainChat.classList.add('expanded');
      if (expandBtn) expandBtn.style.display = 'block';
    }
  });

  // Expand sidebar button (alternative way to expand)
  document.getElementById('expand-sidebar-btn')?.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const mainChat = document.getElementById('main-chat');
    const expandBtn = document.getElementById('expand-sidebar-btn');
    sidebar.classList.remove('collapsed');
    mainChat.classList.remove('expanded');
    if (expandBtn) expandBtn.style.display = 'none';
  });

  // Create server button - redirect to server creation page
  document.getElementById('add-server-btn')?.addEventListener('click', () => {
    window.location.href = '/server-create.html';
  });

  // Add channel button
  document.getElementById('add-channel-btn')?.addEventListener('click', () => {
    openModal('create-channel-modal');
  });

  // Server settings button
  document.getElementById('server-settings-btn')?.addEventListener('click', () => {
    const server = servers[currentServer];
    if (server) {
      document.getElementById('edit-server-name').value = server.name;
      document.getElementById('edit-server-icon').value = server.icon || '';
      openModal('server-settings-modal');
    }
  });

  document.getElementById('add-poll-option-btn')?.addEventListener('click', () => {
    const container = document.getElementById('poll-options-container');
    const inputGroup = document.createElement('div');
    inputGroup.className = 'poll-option-input-group';
    inputGroup.innerHTML = `
      <input type="text" class="poll-option-input" placeholder="Option ${container.children.length + 1}" maxlength="50">
      <button type="button" class="remove-poll-option">×</button>
    `;
    container.appendChild(inputGroup);
    
    inputGroup.querySelector('.remove-poll-option').addEventListener('click', () => {
      inputGroup.remove();
    });
  });

  document.getElementById('poll-submit')?.addEventListener('click', () => {
    const question = document.getElementById('poll-question-input').value.trim();
    const optionInputs = document.querySelectorAll('.poll-option-input');
    const options = Array.from(optionInputs).map(i => i.value.trim()).filter(o => o !== '');

    if (!question) {
      showNotification('Please enter a question', 'warning');
      return;
    }
    if (options.length < 2) {
      showNotification('At least 2 options are required', 'warning');
      return;
    }

    const pollData = {
      type: 'poll',
      question,
      options: options.map(o => ({ text: o, votes: [] }))
    };

    const message = JSON.stringify(pollData);
    const input = document.getElementById('input');
    input.value = message;
    document.querySelector('#form form').dispatchEvent(new Event('submit'));
    input.value = '';
    closeModal();
    
    // Reset modal
    document.getElementById('poll-question-input').value = '';
    const container = document.getElementById('poll-options-container');
    container.innerHTML = `
      <div class="poll-option-input-group">
        <input type="text" class="poll-option-input" placeholder="Option 1" maxlength="50">
      </div>
      <div class="poll-option-input-group">
        <input type="text" class="poll-option-input" placeholder="Option 2" maxlength="50">
      </div>
    `;
  });

  // Create server submit
  document.getElementById('create-server-submit')?.addEventListener('click', () => {
    const name = document.getElementById('new-server-name').value.trim();
    const icon = document.getElementById('new-server-icon').value.trim();
    
    if (!name) {
      showNotification('Please enter a server name', 'warning');
      return;
    }
    
    fetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, icon: icon || null })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        closeModal();
        document.getElementById('new-server-name').value = '';
        document.getElementById('new-server-icon').value = '';
        loadServers();
        setTimeout(() => selectServer(data.serverId), 300);
        showNotification('Server created!', 'success');
      } else {
        showNotification(data.error || 'Failed to create server', 'error');
      }
    })
    .catch(() => showNotification('Failed to create server', 'error'));
  });

  // Create channel submit
  document.getElementById('create-channel-submit')?.addEventListener('click', () => {
    const name = document.getElementById('new-channel-name').value.trim();
    
    if (!name) {
      showNotification('Please enter a channel name', 'warning');
      return;
    }
    
    fetch(`/api/servers/${currentServer}/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        closeModal();
        document.getElementById('new-channel-name').value = '';
        selectServer(currentServer);
        showNotification('Channel created!', 'success');
      } else {
        showNotification(data.error || 'Failed to create channel', 'error');
      }
    })
    .catch(() => showNotification('Failed to create channel', 'error'));
  });

  // Save server settings
  document.getElementById('save-server-settings')?.addEventListener('click', () => {
    const name = document.getElementById('edit-server-name').value.trim();
    const icon = document.getElementById('edit-server-icon').value.trim();
    
    fetch(`/api/servers/${currentServer}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, icon: icon || null })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        closeModal();
        loadServers();
        showNotification('Server updated!', 'success');
      } else {
        showNotification(data.error || 'Failed to update server', 'error');
      }
    })
    .catch(() => showNotification('Failed to update server', 'error'));
  });

  // Delete server
  document.getElementById('delete-server-btn')?.addEventListener('click', () => {
    showConfirmNotification('Are you sure you want to delete this server? This cannot be undone.', () => {
      fetch(`/api/servers/${currentServer}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            closeModal();
            loadServers();
            showNotification('Server deleted', 'success');
          } else {
            showNotification(data.error || 'Failed to delete server', 'error');
          }
        })
        .catch(() => showNotification('Failed to delete server', 'error'));
    }, 'Delete Server');
  });

  // Leave server
  document.getElementById('leave-server-btn')?.addEventListener('click', () => {
    showConfirmNotification('Are you sure you want to leave this server?', () => {
      fetch(`/api/servers/${currentServer}/leave`, { method: 'POST' })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            closeModal();
            loadServers();
            showNotification('Left server', 'success');
          } else {
            showNotification(data.error || 'Failed to leave server', 'error');
          }
        })
        .catch(() => showNotification('Failed to leave server', 'error'));
    }, 'Leave Server');
  });

  // Handle server icon upload
  document.getElementById('server-icon-upload')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('icon', file);

    fetch(`/api/servers/${currentServer}/icon/upload`, {
      method: 'POST',
      body: formData
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        document.getElementById('edit-server-icon').value = data.icon;
        showNotification('Server icon uploaded', 'success');
        loadServers();
      } else {
        showNotification(data.error || 'Upload failed', 'error');
      }
    })
    .catch(() => showNotification('Upload failed', 'error'));
  });

  // Modal close buttons
  document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
    btn.addEventListener('click', closeModal);
  });

  // Modal overlay click to close
  document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });

  // Admin control button (super admin only)
  document.getElementById('admin-control-btn')?.addEventListener('click', () => {
    window.location.href = '/admin-control.html';
  });

  // Account button
  document.getElementById('account-btn')?.addEventListener('click', () => {
    window.location.href = '/account';
  });

  // Incognito toggle
  const incognitoCheckbox = document.getElementById('incognito-mode');
  if (incognitoCheckbox) {
    incognitoCheckbox.addEventListener('change', () => {
      incognitoMode = incognitoCheckbox.checked;
      localStorage.setItem('incognitoMode', incognitoMode.toString());
      updateIncognito();
      fetch('/api/user-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incognitoMode })
      }).catch(() => {});
    });
  }

  // Logout button
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    fetch('/logout', { method: 'POST' })
      .then(() => window.location.href = '/login')
      .catch(() => window.location.href = '/login');
  });
}

function openModal(modalId) {
  document.getElementById('modal-overlay').style.display = 'flex';
  document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  document.getElementById(modalId).style.display = 'block';
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
}

// Keep legacy variable for compatibility
let currentRoom = 'general';

const input = document.getElementById('input');
const messages = document.getElementById('messages');
const scrollDownBtn = document.getElementById('scroll-down-btn');

// Scroll tracking
let isScrolledToBottom = true;

// Function to check if scrolled to bottom
function checkScrollPosition() {
  const threshold = 50; // Allow 50px tolerance
  isScrolledToBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < threshold;

  if (isScrolledToBottom) {
    scrollDownBtn.classList.remove('show');
  } else {
    scrollDownBtn.classList.add('show');
  }
}

// Function to auto-scroll if user was at bottom
function autoScrollIfAtBottom() {
  if (isScrolledToBottom) {
    messages.scrollTop = messages.scrollHeight;
  }
}

// Listen to scroll events
messages.addEventListener('scroll', checkScrollPosition);

// Click handler for scroll button
scrollDownBtn.addEventListener('click', () => {
  messages.scrollTop = messages.scrollHeight;
  isScrolledToBottom = true;
  scrollDownBtn.classList.remove('show');
});

// Function to handle create room button click - redirect to room creation page
function openCreateRoom() {
  window.location.href = '/room-create.html';
}

// Load available rooms
function loadRooms() {
  const roomList = document.getElementById('room-list');
  const defaultRooms = ['general', 'suggestions', 'tech-support'];

  // Always show default rooms first
  roomList.innerHTML = '';

  defaultRooms.forEach(roomId => {
    const roomDiv = document.createElement('div');
    roomDiv.className = `room-item ${roomId === currentRoom ? 'active' : ''} default-room`;
    roomDiv.innerHTML = `<span class="room-hash">#</span>${roomId}`;
    roomDiv.onclick = () => switchRoom(roomId);

    // Add right-click context menu
    roomDiv.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e, roomId, true);
      return false;
    };

    roomList.appendChild(roomDiv);
  });

  // Then load additional rooms from server
  fetch('/api/rooms')
    .then(response => {
      if (!response.ok) {
        throw new Error('Failed to fetch rooms');
      }
      return response.json();
    })
    .then(rooms => {
      // Count additional rooms (non-default)
      additionalRoomsCreated = 0;
      Object.keys(rooms).forEach(roomId => {
        if (!defaultRooms.includes(roomId)) {
          additionalRoomsCreated++;
        }
      });

      // Add custom rooms
      Object.keys(rooms).forEach(roomId => {
        if (!defaultRooms.includes(roomId)) {
          const roomDiv = document.createElement('div');
          roomDiv.className = `room-item ${roomId === currentRoom ? 'active' : ''}`;
          roomDiv.innerHTML = `<span class="room-hash">#</span>${roomId}`;
          roomDiv.onclick = () => switchRoom(roomId);

          // Add right-click context menu
          roomDiv.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e, roomId, false);
            return false;
          };

          roomList.appendChild(roomDiv);
        }
      });

      updateRoomCount();
    })
    .catch(error => {
      console.error('Error loading rooms:', error);
      // Default rooms are already shown, just reset counter
      additionalRoomsCreated = 0;
      updateRoomCount();
    });
}

function updateRoomCount() {
  const roomCountElement = document.getElementById('room-count');
  const createRoomBtn = document.getElementById('create-room-btn');

  roomCountElement.textContent = `${additionalRoomsCreated}/${maxAdditionalRooms} additional rooms created`;

  if (additionalRoomsCreated >= maxAdditionalRooms) {
    createRoomBtn.disabled = true;
    createRoomBtn.textContent = 'Max Rooms Reached';
  } else {
    createRoomBtn.disabled = false;
    createRoomBtn.textContent = 'Create Room';
  }
}

function renderMessages(messagesToRender, container) {
  container.innerHTML = '';
  messagesToRender.forEach((msg, index) => {
    const messageDiv = document.createElement('div');
    messageDiv.className = msg.username === 'System' ? 'message system' : 'message';
    const messageId = msg.id || `legacy-${index}`;
    messageDiv.dataset.messageId = messageId;
    
    // ... rest of rendering logic ...
  });
}

function loadRoomMessages(roomId) {
  fetch(`/api/servers/${currentServer}/channels/${roomId}/messages`)
    .then(response => response.json())
    .then(roomMessages => {
      messages.innerHTML = '';
      roomMessages.forEach((messageData, index) => {
        const messageDiv = document.createElement('div');
        messageDiv.className = messageData.username === 'System' ? 'message system' : 'message';
        const messageId = messageData.id || `legacy-${index}`;
        messageDiv.dataset.messageId = messageId;
        messageDiv.dataset.serverId = currentServer;
        messageDiv.dataset.channelId = roomId;

        if (messageData.username === 'System' || !messageData.username) {
          messageDiv.innerHTML = `<span class="content">${messageData.message}</span>`;
          messages.appendChild(messageDiv);
        } else {
          // Process mentions, links, and images in the message
          let processedMessage = messageData.message;
          if (processedMessage.includes('@')) {
            processedMessage = processedMessage.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
          }

          processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?)/gi, '<img src="$1" alt="Image" class="message-image" onclick="openImageModal(\'$1\')">');
          processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+\.(mp4|webm|mov|avi|mkv|ogg)(\?[^\s]*)?)/gi, '<video src="$1" class="message-video" controls preload="metadata"></video>');

          processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+)/g, function(match) {
            if (match.match(/\.(jpg|jpeg|png|gif|webp|svg|mp4|webm|mov|avi|mkv|ogg)/i)) {
              return match;
            }
            return '<a href="' + match + '" target="_blank" class="message-link">' + match + '</a>';
          });

          // Get user's profile picture
          fetch(`/api/user-profile/${messageData.username}`)
            .then(response => response.json())
            .then(profileData => {
              let avatarContent;
              if (profileData.profilePicture) {
                avatarContent = `<img src="${profileData.profilePicture}" alt="${messageData.username}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; margin-right: 8px;">`;
              } else {
                avatarContent = `<div style="width: 32px; height: 32px; border-radius: 50%; background-color: #5865f2; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; margin-right: 8px;">${messageData.username.charAt(0).toUpperCase()}</div>`;
              }

              const editedIndicator = messageData.edited ? ` <span class="edited">(edited at ${messageData.editedAt})</span>` : '';
              const messageActions = messageData.username === username ? `
                <div class="message-actions" style="display: none; margin-left: 8px;">
                  <button class="edit-btn" onclick="editMessage('${currentServer}', '${roomId}', '${messageId}', 'room')">Edit</button>
                  <button class="delete-btn" onclick="deleteMessage('${currentServer}', '${roomId}', '${messageId}', 'room')">Delete</button>
                </div>
              ` : '';

              const date = messageData.date || '';
              const time = messageData.time || '';
              messageDiv.innerHTML = `
                <div style="display: flex; align-items: center;">
                  ${avatarContent}
                  <div style="flex: 1;">
                    ${date ? `<div class="message-date">${date}</div>` : ''}
                    <span class="timestamp">[${time}]</span>
                    <span class="username">${messageData.username}:</span>
                    <span class="content">${processedMessage}</span>
                    ${editedIndicator}
                  </div>
                  ${messageActions}
                </div>
              `;
            })
            .catch(() => {
              const editedIndicator = messageData.edited ? ` <span class="edited">(edited at ${messageData.editedAt})</span>` : '';
              const messageActions = messageData.username === username ? `
                <div class="message-actions" style="display: none; margin-left: 8px;">
                  <button class="edit-btn" onclick="editMessage('${currentServer}', '${roomId}', '${messageId}', 'room')">Edit</button>
                  <button class="delete-btn" onclick="deleteMessage('${currentServer}', '${roomId}', '${messageId}', 'room')">Delete</button>
                </div>
              ` : '';

              const date = messageData.date || '';
              const time = messageData.time || '';
              messageDiv.innerHTML = `
                <div style="display: flex; align-items: center;">
                  <div style="flex: 1;">
                    ${date ? `<div class="message-date">${date}</div>` : ''}
                    <span class="timestamp">[${time}]</span>
                    <span class="username">${messageData.username}:</span>
                    <span class="content">${processedMessage}</span>
                    ${editedIndicator}
                  </div>
                  ${messageActions}
                </div>
              `;
            });
          messages.appendChild(messageDiv);
        }
      });
      autoScrollIfAtBottom();
    })
    .catch(error => {
      console.error('Error loading channel messages:', error);
    });
}

function loadOnlineUsers() {
  const onlineUserList = document.getElementById('online-user-list');
  // NO clearing here yet, we will clear once we have the data to avoid flickering or partial states

  // Load all users for DM capability
  fetch('/api/users')
    .then(response => {
      if (!response.ok) {
        throw new Error('Failed to fetch users');
      }
      return response.json();
    })
    .then(allUsers => {
      // Clear the list only right before rendering to prevent duplicates if called multiple times rapidly
      onlineUserList.innerHTML = '';

      // Filter out banned users and current user - use Set to avoid duplicates
      const visibleUsersSet = new Set(allUsers.filter(user => !bannedUsers.has(user) && user !== username));
      const visibleUsers = Array.from(visibleUsersSet);

      if (visibleUsers.length === 0) {
        const noUsersDiv = document.createElement('div');
        noUsersDiv.className = 'online-user';
        noUsersDiv.innerHTML = '<span class="user-name" style="color: #72767d; font-style: italic;">No other users available</span>';
        onlineUserList.appendChild(noUsersDiv);
        return;
      }

      visibleUsers.forEach(user => {
        const isOnline = onlineUsers.includes(user);
        const userDiv = document.createElement('div');
        userDiv.className = 'online-user';

        let banButton = '';
        if (isAdmin && user !== username) {
          banButton = `<button class="ban-btn" onclick="showBanOptions('${user}')">Ban</button>`;
        }

        // Set initial content with fallback
        userDiv.innerHTML = `
          <div class="user-avatar ${isOnline ? 'online' : 'offline'}">${user.charAt(0).toUpperCase()}</div>
          <span class="user-name">${user} ${isOnline ? '(online)' : '(offline)'}</span>
          <button class="dm-btn" onclick="startDM('${user}')">DM</button>
          ${banButton}
        `;
        onlineUserList.appendChild(userDiv);

        // Get user's profile picture and update
        fetch(`/api/user-profile/${user}`)
          .then(response => response.json())
          .then(profileData => {
            // Check if user div still exists in the list (in case list was cleared)
            if (!onlineUserList.contains(userDiv)) return;

            let avatarContent;
            if (profileData.profilePicture) {
              avatarContent = `<img src="${profileData.profilePicture}" alt="${user}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">`;
            } else {
              avatarContent = user.charAt(0).toUpperCase();
            }

            userDiv.querySelector('.user-avatar').innerHTML = avatarContent;
          })
          .catch(() => {
            // Already has fallback, do nothing
          });
      });
    })
    .catch(error => {
      console.error('Error loading users:', error);
      // Fallback to showing only online users - use Set to avoid duplicates
      const visibleOnlineUsersSet = new Set(onlineUsers.filter(user => !bannedUsers.has(user) && user !== username));
      const visibleOnlineUsers = Array.from(visibleOnlineUsersSet);

      if (visibleOnlineUsers.length === 0) {
        const noUsersDiv = document.createElement('div');
        noUsersDiv.className = 'online-user';
        noUsersDiv.innerHTML = '<span class="user-name" style="color: #72767d; font-style: italic;">No other users available</span>';
        onlineUserList.appendChild(noUsersDiv);
        return;
      }

      visibleOnlineUsers.forEach(user => {
        const userDiv = document.createElement('div');
        userDiv.className = 'online-user';
        userDiv.innerHTML = `
          <div class="user-avatar online">${user.charAt(0).toUpperCase()}</div>
          <span class="user-name">${user} (online)</span>
          <button class="dm-btn" onclick="startDM('${user}')">DM</button>
        `;
        onlineUserList.appendChild(userDiv);
      });
    });
}

function startDM(targetUser) {
  if (!allowDMs) {
    showNotification('The user has disabled direct messages from DMs from other server members', 'warning');
    return;
  }

  if (watchingStreamId) stopWatchingStream();
  if (localScreenStream) stopLocalScreenShare();
  stopTypingActivity();
  clearTypingIndicator();

  currentDM = targetUser;
  currentChannel = null;
  unreadMessages = 0;
  updateFavicon();
  updateTitle();
  
  document.querySelectorAll('.online-user-item').forEach(item => {
    item.classList.toggle('active', item.dataset.username === targetUser);
  });
  
  document.getElementById('current-room').textContent = `@${targetUser}`;
  document.getElementById('input').placeholder = `Message @${targetUser}`;
  
  const messagesContainer = document.getElementById('messages');
  messagesContainer.innerHTML = '';
  
  socket.emit('switch room', { room: `dm:${targetUser}` });

  // Load DM history
  fetch(`/api/dm/${targetUser}`)
    .then(response => response.json())
    .then(dmMessages => {
      dmHistories[targetUser] = dmMessages;
      dmMessages.forEach((messageData, index) => {
        appendMessage(messageData, index, 'dm');
      });
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      isScrolledToBottom = true;
    })
    .catch(error => {
      console.error('Error loading DM history:', error);
    });
}

function createRoom(roomName) {
  fetch('/api/rooms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `roomName=${encodeURIComponent(roomName)}`
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      loadRooms();
      document.getElementById('create-room-input').value = '';
    } else {
      showNotification(data.error || 'Failed to create room', 'error');
    }
  })
  .catch(error => {
    console.error('Error creating room:', error);
    showNotification('Failed to create room', 'error');
  });
}

function showContextMenu(event, roomId, isDefault) {
  // Remove existing context menu
  const existingMenu = document.querySelector('.context-menu');
  if (existingMenu) {
    existingMenu.remove();
  }

  // Don't show context menu for default/protected rooms
  const protectedRooms = ['general', 'suggestions', 'tech-support'];
  if (protectedRooms.includes(roomId)) {
    return;
  }

  const contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu';

  // Position the menu, ensuring it stays within viewport
  const x = Math.min(event.clientX, window.innerWidth - 150);
  const y = Math.min(event.clientY, window.innerHeight - 150);

  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.style.position = 'fixed';
  contextMenu.style.zIndex = '9999';

  const editItem = document.createElement('div');
  editItem.className = 'context-menu-item';
  editItem.textContent = 'Edit Room';
  editItem.addEventListener('click', (e) => {
    e.stopPropagation();
    contextMenu.remove();
    openEditRoom(roomId);
  });

  const renameItem = document.createElement('div');
  renameItem.className = 'context-menu-item';
  renameItem.textContent = 'Rename Room';
  renameItem.addEventListener('click', (e) => {
    e.stopPropagation();
    contextMenu.remove();
    startRename(roomId);
  });

  const deleteItem = document.createElement('div');
  deleteItem.className = 'context-menu-item danger';
  deleteItem.textContent = 'Delete Room';
  deleteItem.addEventListener('click', (e) => {
    e.stopPropagation();
    contextMenu.remove();
    showConfirmNotification(`Are you sure you want to delete room #${roomId}?`, () => {
      deleteRoom(roomId);
    }, 'Delete Room');
  });

  contextMenu.appendChild(editItem);
  contextMenu.appendChild(renameItem);
  contextMenu.appendChild(deleteItem);
  document.body.appendChild(contextMenu);

  // Close menu when clicking elsewhere
  const closeMenu = (e) => {
    if (!contextMenu.contains(e.target)) {
      contextMenu.remove();
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('contextmenu', closeMenu);
    }
  };

  // Add slight delay to prevent immediate closure
  setTimeout(() => {
    document.addEventListener('click', closeMenu);
    document.addEventListener('contextmenu', closeMenu);
  }, 50);
}

function startRename(roomId) {
  const roomItems = document.querySelectorAll('.room-item');
  const roomItem = Array.from(roomItems).find(item => item.textContent.includes(`#${roomId}`));

  if (roomItem) {
    const currentName = roomId;
    const input = document.createElement('input');
    input.className = 'rename-input';
    input.type = 'text';
    input.value = currentName;
    input.maxLength = 20;
    input.minLength = 3;

    roomItem.innerHTML = '';
    roomItem.appendChild(input);
    input.focus();
    input.select();

    const finishRename = () => {
      const newName = input.value.trim();
      if (newName && newName.length >= 3 && newName !== currentName) {
        renameRoom(roomId, newName);
      } else {
        loadRooms(); // Revert changes
      }
    };

    input.onblur = finishRename;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        finishRename();
      } else if (e.key === 'Escape') {
        loadRooms(); // Revert changes
      }
    };
  }
}

function renameRoom(roomId, newName) {
  fetch(`/api/rooms/${roomId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `newName=${encodeURIComponent(newName)}`
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      loadRooms();
    } else {
      showNotification(data.error || 'Failed to rename room', 'error');
      loadRooms();
    }
  })
  .catch(error => {
    console.error('Error renaming room:', error);
    showNotification('Failed to rename room', 'error');
    loadRooms();
  });
}

function deleteRoom(roomId) {
  // Show confirmation notification
  showNotification(`Deleting room "#${roomId}"...`, 'warning', 'Confirm Delete');

  fetch(`/api/rooms/${roomId}`, {
    method: 'DELETE'
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      // If we're in the deleted room, switch to general
      if (currentRoom === roomId) {
        switchRoom('general');
      }
      loadRooms();
      showNotification(`Room "#${roomId}" deleted successfully`, 'success');
    } else {
      showNotification(data.error || 'Failed to delete room', 'error');
    }
  })
  .catch(error => {
    console.error('Error deleting room:', error);
    showNotification('Failed to delete room', 'error');
  });
}

function openEditRoom(roomId) {
  // Create modal overlay and content
  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'edit-room-modal-overlay';
  
  const modalContent = document.createElement('div');
  modalContent.className = 'edit-room-modal';
  
  // Create close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'edit-room-close';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => modalOverlay.remove();
  
  // Title
  const title = document.createElement('h2');
  title.textContent = `Edit Room: #${roomId}`;
  
  // User search input
  const searchLabel = document.createElement('label');
  searchLabel.textContent = 'Search Users';
  searchLabel.style.display = 'block';
  searchLabel.style.marginBottom = '8px';
  searchLabel.style.color = '#b5bac1';
  searchLabel.style.fontSize = '12px';
  searchLabel.style.fontWeight = '600';
  
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search username...';
  searchInput.className = 'edit-room-search';
  
  // Users list
  const usersListLabel = document.createElement('label');
  usersListLabel.textContent = 'Room Members';
  usersListLabel.style.display = 'block';
  usersListLabel.style.marginTop = '16px';
  usersListLabel.style.marginBottom = '8px';
  usersListLabel.style.color = '#b5bac1';
  usersListLabel.style.fontSize = '12px';
  usersListLabel.style.fontWeight = '600';
  
  const usersList = document.createElement('div');
  usersList.className = 'edit-room-users-list';
  
  let allUsers = [];
  let currentMembers = new Set();
  
  // Fetch room members and all users
  Promise.all([
    fetch(`/api/room/${roomId}/members`).then(r => r.json()).catch(() => ({})),
    fetch('/api/users').then(r => r.json()).catch(() => [])
  ]).then(([memberData, users]) => {
    currentMembers = new Set(memberData.members || []);
    allUsers = users.filter(u => u !== username);
    
    function renderUsersList(usersToShow) {
      usersList.innerHTML = '';
      usersToShow.forEach(user => {
        const userDiv = document.createElement('div');
        userDiv.className = 'edit-room-user-item';
        const isMember = currentMembers.has(user);
        
        userDiv.innerHTML = `
          <input type="checkbox" id="user-${user}" ${isMember ? 'checked' : ''} class="user-checkbox">
          <label for="user-${user}">${user}</label>
        `;
        
        const checkbox = userDiv.querySelector('.user-checkbox');
        checkbox.onchange = () => {
          if (checkbox.checked) {
            currentMembers.add(user);
          } else {
            currentMembers.delete(user);
          }
        };
        
        usersList.appendChild(userDiv);
      });
    }
    
    renderUsersList(allUsers);
    
    searchInput.addEventListener('input', (e) => {
      const search = e.target.value.toLowerCase();
      const filtered = allUsers.filter(u => u.toLowerCase().includes(search));
      renderUsersList(filtered);
    });
  });
  
  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.className = 'edit-room-save-btn';
  saveBtn.textContent = 'Save Changes';
  saveBtn.onclick = () => {
    const selectedUsers = Array.from(currentMembers);
    
    fetch(`/api/rooms/${roomId}/members`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: selectedUsers })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification(`Room "#${roomId}" updated successfully`, 'success');
        modalOverlay.remove();
        loadRooms();
      } else {
        showNotification(data.error || 'Failed to update room', 'error');
      }
    })
    .catch(error => {
      console.error('Error updating room:', error);
      showNotification('Failed to update room', 'error');
    });
  };
  
  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'edit-room-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => modalOverlay.remove();
  
  // Add elements to modal
  modalContent.appendChild(closeBtn);
  modalContent.appendChild(title);
  modalContent.appendChild(searchLabel);
  modalContent.appendChild(searchInput);
  modalContent.appendChild(usersListLabel);
  modalContent.appendChild(usersList);
  
  const buttonGroup = document.createElement('div');
  buttonGroup.className = 'edit-room-button-group';
  buttonGroup.appendChild(cancelBtn);
  buttonGroup.appendChild(saveBtn);
  modalContent.appendChild(buttonGroup);
  
  modalOverlay.appendChild(modalContent);
  
  // Close modal on overlay click
  modalOverlay.onclick = (e) => {
    if (e.target === modalOverlay) {
      modalOverlay.remove();
    }
  };
  
  document.body.appendChild(modalOverlay);
}

function switchRoom(roomId) {
  if (roomId !== currentRoom || currentDM) {
    if (watchingStreamId) stopWatchingStream();
    stopTypingActivity();
    clearTypingIndicator();
    socket.emit('switch room', { room: `${currentServer}:${roomId}` });
    currentRoom = roomId;
    currentChannel = roomId;
    currentDM = null; // Clear DM state when switching to room
    messages.innerHTML = '';

    // Load room messages for default rooms
    if (['general', 'suggestions', 'tech-support'].includes(roomId)) {
      loadRoomMessages(roomId);
    }

    // Update active room styling
    document.querySelectorAll('.room-item').forEach(item => {
      item.classList.remove('active');
    });

    // Find the correct room item to mark as active
    const roomItems = document.querySelectorAll('.room-item');
    roomItems.forEach(item => {
      if (item.textContent.includes(`#${roomId}`)) {
        item.classList.add('active');
      }
    });

    // Update header
    document.getElementById('current-room').textContent = `#${roomId}`;
    document.getElementById('input').placeholder = `Message #${roomId}`;
  }
}

document.querySelector('#form form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (input.value.trim()) {
    const message = input.value.trim();
    stopTypingActivity();

    if (message.toLowerCase() === '/stream') {
      input.value = '';
      if (currentDM) {
        showNotification('Screen sharing is only available in a chat channel.', 'warning');
      } else {
        startScreenShare();
      }
      return;
    }

    if (currentDM) {
      // Send DM
      socket.emit('dm message', {
        targetUser: currentDM,
        message: message
      });
    } else if (!processMessageForDM(message)) {
      // Send room message only if it wasn't processed as a DM
      socket.emit('chat message', message);
    }
    input.value = '';
    // Always scroll to bottom when the user sends a message
    messages.scrollTop = messages.scrollHeight;
    isScrolledToBottom = true;
    scrollDownBtn.classList.remove('show');
  }
});

// Create room form - now just redirects to room creation page
const createRoomForm = document.getElementById('create-room-form');
if (createRoomForm) {
  createRoomForm.addEventListener('submit', (e) => {
    e.preventDefault();
    openCreateRoom();
  });
}

socket.on('typing:update', (data = {}) => {
  if (!data.username || data.username === username || !data.room) return;
  if (data.room !== getCurrentTypingRoom()) return;

  if (data.active) {
    typingUsers.set(data.username, data.room);
  } else if (typingUsers.get(data.username) === data.room) {
    typingUsers.delete(data.username);
  }
  renderTypingIndicator();
});

socket.on('disconnect', clearTypingIndicator);

socket.on('chat message', (data) => {
  if (currentDM) return;
  const isCurrentRoomMessage = !data.room || data.room === getClientRoomName();
  if (!isCurrentRoomMessage) return;

  // Update unread count if user is not in the room or tab is not focused
  if ((!isCurrentRoomMessage || !document.hasFocus()) && data.username !== username && data.username !== 'System') {
    unreadMessages++;
    updateFavicon();
    updateTitle();
  }

  // Play notification sound only if user is NOT currently in this room and message is from another user
  if (!isCurrentRoomMessage && data.username !== username && data.username !== 'System') {
    playNotificationSound();
  }

  const messageDiv = document.createElement('div');
  messageDiv.className = data.username === 'System' ? 'message system' : 'message';

  // Get the current number of messages to set the index
  const messageIndex = messages.children.length;
  messageDiv.dataset.messageIndex = messageIndex;
  messageDiv.dataset.roomId = data.room || getClientRoomName();

  if (data.username === 'System') {
    messageDiv.innerHTML = `<span class="content">${data.message}</span>`;
  } else {
    // Process mentions, links, and images in the message
    let processedMessage = data.message;
    if (processedMessage.includes('@')) {
      processedMessage = processedMessage.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
    }

    // Process images FIRST (before links to prevent double wrapping)
    // Match image URLs with common extensions (with or without query parameters)
    processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?)/gi, '<img src="$1" alt="Image" class="message-image" onclick="openImageModal(\'$1\')">');
    processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+\.(mp4|webm|mov|avi|mkv|ogg)(\?[^\s]*)?)/gi, '<video src="$1" class="message-video" controls preload="metadata"></video>');

    // Process remaining links (that aren't already images)
    processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+)/g, function(match) {
      // Don't link if it's already an image or video
      if (match.match(/\.(jpg|jpeg|png|gif|webp|svg|mp4|webm|mov|avi|mkv|ogg)/i)) {
        return match;
      }
      return '<a href="' + match + '" target="_blank" class="message-link">' + match + '</a>';
    });

    // Get user's profile picture
    fetch(`/api/user-profile/${data.username}`)
      .then(response => response.json())
      .then(profileData => {
        let avatarContent;
        if (profileData.profilePicture) {
          avatarContent = `<img src="${profileData.profilePicture}" alt="${data.username}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; margin-right: 8px;">`;
        } else {
          avatarContent = `<div style="width: 32px; height: 32px; border-radius: 50%; background-color: #5865f2; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; margin-right: 8px;">${data.username.charAt(0).toUpperCase()}</div>`;
        }

        const messageActions = data.username === username ? `
          <div class="message-actions" style="display: none; margin-left: 8px;">
            <button class="edit-btn" onclick="editMessage('${currentServer}', '${currentChannel}', ${messageIndex}, 'room')">Edit</button>
            <button class="delete-btn" onclick="deleteMessage('${currentServer}', '${currentChannel}', ${messageIndex}, 'room')">Delete</button>
          </div>
        ` : '';

        const msgDate = data.date || '';
        const msgTime = data.time || '';
        messageDiv.innerHTML = `
          <div style="display: flex; align-items: center;">
            ${avatarContent}
            <div style="flex: 1;">
              ${msgDate ? `<div class="message-date">${msgDate}</div>` : ''}
              <span class="timestamp">[${msgTime}]</span>
              <span class="username">${data.username}:</span>
              <span class="content">${processedMessage}</span>
            </div>
            ${messageActions}
          </div>
        `;
      })
      .catch(() => {
        // Fallback without profile picture
        const messageActions = data.username === username ? `
          <div class="message-actions" style="display: none; margin-left: 8px;">
            <button class="edit-btn" onclick="editMessage('${currentServer}', '${currentChannel}', ${messageIndex}, 'room')">Edit</button>
            <button class="delete-btn" onclick="deleteMessage('${currentServer}', '${currentChannel}', ${messageIndex}, 'room')">Delete</button>
          </div>
        ` : '';

        const msgDate2 = data.date || '';
        const msgTime2 = data.time || '';
        messageDiv.innerHTML = `
          <div style="display: flex; align-items: center;">
            <div style="flex: 1;">
              ${msgDate2 ? `<div class="message-date">${msgDate2}</div>` : ''}
              <span class="timestamp">[${msgTime2}]</span>
              <span class="username">${data.username}:</span>
              <span class="content">${processedMessage}</span>
            </div>
            ${messageActions}
          </div>
        `;
      });
  }

  messages.appendChild(messageDiv);
  autoScrollIfAtBottom();
});

socket.on('room switched', (room) => {
  if (watchingStreamId && room !== getClientRoomName()) {
    stopWatchingStream();
  }
  currentRoom = room;
  renderTypingIndicator();
  socket.emit('stream:list');
});

socket.on('dm message', (data) => {
  const dmUser = data.from === username ? data.to : data.from;

  // Play notification sound if user is NOT currently viewing this DM and message is from the other user
  const isCurrentDM = (currentDM === data.from && data.to === username) || (currentDM === data.to && data.from === username);
  if (!isCurrentDM && data.from !== username) {
    playNotificationSound();
  }

  // Only show if we're in the DM with this user
  if (isCurrentDM) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message dm-message';
    messageDiv.dataset.messageId = data.id;

    // Process mentions, links, and images in DM messages
    let processedMessage = data.message;
    if (processedMessage.includes('@')) {
      processedMessage = processedMessage.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
    }
    processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?)/gi, '<img src="$1" alt="Image" class="message-image" onclick="openImageModal(\'$1\')">');
    processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+\.(mp4|webm|mov|avi|mkv|ogg)(\?[^\s]*)?)/gi, '<video src="$1" class="message-video" controls preload="metadata"></video>');
    processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+)/g, function(match) {
      if (match.match(/\.(jpg|jpeg|png|gif|webp|svg|mp4|webm|mov|avi|mkv|ogg)/i)) return match;
      return '<a href="' + match + '" target="_blank" class="message-link">' + match + '</a>';
    });

    const dmMsgDate = data.date || '';
    const dmMsgTime = data.time || '';
    const dmMessageActions = data.from === username ? `
      <div class="message-actions" style="display: none; margin-left: 8px;">
        <button class="delete-btn" onclick="deleteMessage('${data.from}', null, '${data.id}', 'dm')">Delete</button>
      </div>
    ` : '';

    fetch(`/api/user-profile/${data.from}`)
      .then(r => r.json())
      .then(profile => {
        let avatar;
        if (profile.profilePicture) {
          avatar = `<img src="${profile.profilePicture}" alt="${data.from}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; margin-right: 8px;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div style="display: none; width: 32px; height: 32px; border-radius: 50%; background-color: #5865f2; align-items: center; justify-content: center; color: white; font-weight: bold; margin-right: 8px;">${data.from.charAt(0).toUpperCase()}</div>`;
        } else {
          avatar = `<div style="width: 32px; height: 32px; border-radius: 50%; background-color: #5865f2; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; margin-right: 8px;">${data.from.charAt(0).toUpperCase()}</div>`;
        }
        messageDiv.innerHTML = `
          <div style="display: flex; align-items: flex-start;">
            ${avatar}
            <div style="flex: 1;">
              ${dmMsgDate ? `<div class="message-date">${dmMsgDate}</div>` : ''}
              <span class="timestamp">[${dmMsgTime}]</span>
              <span class="username">${data.from}:</span>
              <span class="content">${processedMessage}</span>
            </div>
            ${dmMessageActions}
          </div>
        `;
      })
      .catch(() => {
        messageDiv.innerHTML = `
          <div style="display: flex; align-items: flex-start;">
            <div style="width: 32px; height: 32px; border-radius: 50%; background-color: #5865f2; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; margin-right: 8px;">${data.from.charAt(0).toUpperCase()}</div>
            <div style="flex: 1;">
              ${dmMsgDate ? `<div class="message-date">${dmMsgDate}</div>` : ''}
              <span class="timestamp">[${dmMsgTime}]</span>
              <span class="username">${data.from}:</span>
              <span class="content">${processedMessage}</span>
            </div>
            ${dmMessageActions}
          </div>
        `;
      });

    messages.appendChild(messageDiv);
    autoScrollIfAtBottom();
  }

  // Update DM history
  if (!dmHistories[dmUser]) {
    dmHistories[dmUser] = [];
  }
  dmHistories[dmUser].push(data);
});

socket.on('user online', (users) => {
  onlineUsers = users.filter(user => user !== username);
  loadOnlineUsers();
});

socket.on('user banned', (data) => {
  bannedUsers.add(data.bannedUser);

  // Remove from online users
  onlineUsers = onlineUsers.filter(user => user !== data.bannedUser);

  // If currently in DM with banned user, close it
  if (currentDM === data.bannedUser) {
    currentDM = null;
    messages.innerHTML = '';
    document.getElementById('current-room').textContent = '#general';
    document.getElementById('input').placeholder = 'Message #general';
  }

  // Clear the user list before reloading to prevent duplicates
  const onlineUserList = document.getElementById('online-user-list');
  if (onlineUserList) {
    onlineUserList.innerHTML = '';
  }
  loadOnlineUsers();

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message system';
  messageDiv.innerHTML = `<span class="content">${data.bannedUser} was banned by ${data.byAdmin}</span>`;
  messages.appendChild(messageDiv);
  autoScrollIfAtBottom();
});

socket.on('banned', (data) => {
  showNotification(data.message, 'error', 'Account Banned');
  setTimeout(() => {
    window.location.href = '/login';
  }, 3000);
});

// Navigation button functionality
document.addEventListener('DOMContentLoaded', () => {
  // General button functionality
  const generalBtn = document.getElementById('general-btn');
  if (generalBtn) {
    generalBtn.addEventListener('click', () => {
      switchRoom('general');
      currentDM = null; // Clear any DM state
    });
  }

  // Account button functionality
  const accountBtn = document.getElementById('account-btn');
  if (accountBtn) {
    accountBtn.addEventListener('click', () => {
      window.location.href = '/account';
    });
  }

  // Logout functionality
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      fetch('/logout', { method: 'POST' })
        .then(() => {
          window.location.href = '/login';
        })
        .catch(err => {
          console.error('Logout failed:', err);
        });
    });
  }

  // Create room button - redirect to room creation page
  const createRoomBtn = document.getElementById('create-room-btn');
  if (createRoomBtn) {
    createRoomBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openCreateRoom();
    });
  }

  const createRoomForm = document.getElementById('create-room-form');
  if (createRoomForm) {
    createRoomForm.addEventListener('submit', (e) => {
      e.preventDefault();
      openCreateRoom();
    });
  }
});

// Show ban options with duration prompt (admin only)
function showBanOptions(targetUser) {
  if (!isAdmin) {
    showNotification('You do not have permission to ban users.', 'error');
    return;
  }

  // Create and show ban modal
  const existingModal = document.getElementById('ban-modal');
  if (existingModal) {
    existingModal.remove();
  }

  const modal = document.createElement('div');
  modal.id = 'ban-modal';
  modal.className = 'ban-modal';
  modal.innerHTML = `
    <div class="ban-modal-content">
      <h2>Ban User: ${targetUser}</h2>
      <p>Select an action for this user:</p>

      <div class="ban-options">
        <div class="ban-option">
          <label>Temporary Ban (minutes):</label>
          <div class="ban-time-options">
            <button class="ban-time-btn" data-minutes="5">5 min</button>
            <button class="ban-time-btn" data-minutes="15">15 min</button>
            <button class="ban-time-btn" data-minutes="30">30 min</button>
            <button class="ban-time-btn" data-minutes="60">1 hour</button>
            <button class="ban-time-btn" data-minutes="1440">24 hours</button>
          </div>
          <div class="custom-time">
            <input type="number" id="custom-ban-time" placeholder="Custom minutes" min="1" max="10080">
            <button class="ban-time-btn custom" id="custom-ban-btn">Apply</button>
          </div>
        </div>

        <div class="ban-divider"></div>

        <div class="ban-option danger">
          <button class="permanent-ban-btn" id="permanent-ban-btn">Permanent Ban</button>
          <p class="warning-text">User will be banned forever and cannot access the chat.</p>
        </div>

        <div class="ban-divider"></div>

        <div class="ban-option danger">
          <button class="delete-user-btn" id="delete-user-btn">Delete User Account</button>
          <p class="warning-text">This will permanently delete the user's account and ban them.</p>
        </div>
      </div>

      <div class="ban-modal-footer">
        <button class="cancel-btn" id="cancel-ban-btn">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add event listeners
  const timeBtns = modal.querySelectorAll('.ban-time-btn:not(.custom)');
  timeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const minutes = parseInt(btn.dataset.minutes);
      banUser(targetUser, minutes);
      modal.remove();
    });
  });

  document.getElementById('custom-ban-btn').addEventListener('click', () => {
    const customTime = parseInt(document.getElementById('custom-ban-time').value);
    if (customTime && customTime > 0) {
      banUser(targetUser, customTime);
      modal.remove();
    } else {
      showNotification('Please enter a valid number of minutes', 'error');
    }
  });

  document.getElementById('permanent-ban-btn').addEventListener('click', () => {
    showConfirmNotification(`Are you sure you want to PERMANENTLY ban ${targetUser}? This cannot be undone.`, () => {
      banUser(targetUser, 0);
      modal.remove();
    }, 'Permanent Ban');
  });

  document.getElementById('delete-user-btn').addEventListener('click', () => {
    showConfirmNotification(`Are you sure you want to DELETE ${targetUser}'s account? This will permanently remove them.`, () => {
      banUser(targetUser, 0);
      modal.remove();
    }, 'Delete User');
  });

  document.getElementById('cancel-ban-btn').addEventListener('click', () => {
    modal.remove();
  });

  // Close on click outside
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// Ban user function (admin only)
function banUser(targetUser, banMinutes) {
  if (!isAdmin) {
    showNotification('You do not have permission to ban users.', 'error');
    return;
  }

  const banMessage = banMinutes === 0 ? 'permanently' : `for ${banMinutes} minutes`;
  socket.emit('ban user', { targetUser: targetUser, banMinutes: banMinutes });
  bannedUsers.add(targetUser);
  showNotification(`${targetUser} has been banned ${banMessage}.`, 'success', 'User Banned');
}

// Process @username mentions for DM
function processMessageForDM(message) {
  const dmPattern = /@(\w+)\s+(.*)/;
  const match = message.match(dmPattern);

  if (match) {
    const targetUser = match[1];
    const dmMessage = match[2];

    if (dmMessage.trim()) {
      // Send DM
      socket.emit('dm message', {
        targetUser: targetUser,
        message: dmMessage
      });

      // Show in chat that DM was sent
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message';
      const nowDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const nowTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      messageDiv.innerHTML = `
        <div class="message-date">${nowDate}</div>
        <span class="timestamp">[${nowTime}]</span>
        <span class="username">${username}:</span>
        <span class="content">Sent DM to <span class="dm-highlight">@${targetUser}</span>: ${dmMessage}</span>
      `;
      messages.appendChild(messageDiv);
      autoScrollIfAtBottom();

      return true; // Message was processed as DM
    }
  }

  return false; // Not a DM message
}

// Image modal functions
function openImageModal(imageUrl) {
  // Remove existing modal
  const existingModal = document.getElementById('image-modal');
  if (existingModal) {
    existingModal.remove();
  }

  // Create modal
  const modal = document.createElement('div');
  modal.id = 'image-modal';
  modal.className = 'image-modal';
  modal.innerHTML = `
    <div class="image-modal-content">
      <span class="image-modal-close" onclick="closeImageModal()">&times;</span>
      <img src="${imageUrl}" alt="Full size image" class="image-modal-img">
      <div class="image-modal-caption">
        <a href="${imageUrl}" target="_blank" class="image-modal-link">Open in new tab</a>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close modal when clicking outside
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeImageModal();
    }
  });

  // Close modal on escape key
  document.addEventListener('keydown', function escapeHandler(e) {
    if (e.key === 'Escape') {
      closeImageModal();
      document.removeEventListener('keydown', escapeHandler);
    }
  });
}

function closeImageModal() {
  const modal = document.getElementById('image-modal');
  if (modal) {
    modal.remove();
  }
}

// Image upload functionality
const imageUploadInput = document.getElementById('image-upload');

if (imageUploadInput) {
  imageUploadInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;


    // Check file type
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      showNotification('Only image and video files are allowed', 'error');
      imageUploadInput.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('image', file);
    formData.append('serverId', currentServer);

    try {
      const response = await fetch('/api/upload-image', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (data.success) {
        // Send the file URL as a message
        const fileUrl = window.location.origin + data.imageUrl;
        socket.emit('chat message', fileUrl);
        showNotification('File uploaded successfully!', 'success');
      } else {
        showNotification('Failed to upload file: ' + data.error, 'error');
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      showNotification('Failed to upload image', 'error');
    }

    // Clear the input
    imageUploadInput.value = '';
  });
}

// Focus input on page load
window.addEventListener('load', () => {
  if (input) {
    input.focus();
  }
});

// Message actions functions
function showMessageActions(messageElement) {
  const actions = messageElement.querySelector('.message-actions');
  if (actions) {
    actions.style.display = 'flex';
  }
}

function hideMessageActions(messageElement) {
  const actions = messageElement.querySelector('.message-actions');
  if (actions) {
    actions.style.display = 'none';
  }
}

function editMessage(serverId, channelId, messageId, type) {
  const messageDiv = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!messageDiv) return;

  const contentSpan = messageDiv.querySelector('.content');
  const currentText = contentSpan.textContent;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentText;
  input.className = 'edit-input';
  input.style.cssText = 'background: #40444b; border: 1px solid #202225; color: #dcddde; padding: 4px 8px; border-radius: 4px; font-size: 14px; width: 200px;';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.className = 'save-btn';
  saveBtn.style.cssText = 'margin-left: 8px; padding: 4px 8px; background: #3ba55c; color: white; border: none; border-radius: 4px; cursor: pointer;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'cancel-btn';
  cancelBtn.style.cssText = 'margin-left: 4px; padding: 4px 8px; background: #ed4245; color: white; border: none; border-radius: 4px; cursor: pointer;';

  const editContainer = document.createElement('div');
  editContainer.style.display = 'flex';
  editContainer.style.alignItems = 'center';
  editContainer.appendChild(input);
  editContainer.appendChild(saveBtn);
  editContainer.appendChild(cancelBtn);

  contentSpan.style.display = 'none';
  contentSpan.parentNode.appendChild(editContainer);

  input.focus();
  input.select();

  function saveEdit() {
    const newMessage = input.value.trim();
    if (newMessage && newMessage !== currentText) {
      let url;
      if (type === 'room') {
        url = `/api/servers/${serverId}/channels/${channelId}/messages/${messageId}`;
      } else {
        url = `/api/dm/${serverId}/messages/${messageId}`;
      }

      fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ newMessage })
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          contentSpan.textContent = newMessage;
          contentSpan.style.display = 'inline';
          editContainer.remove();

          // Add edited indicator if not already present
          if (!messageDiv.querySelector('.edited')) {
            const editedSpan = document.createElement('span');
            editedSpan.className = 'edited';
            editedSpan.textContent = ' (edited)';
            editedSpan.style.color = '#72767d';
            editedSpan.style.fontSize = '12px';
            contentSpan.parentNode.appendChild(editedSpan);
          }
        } else {
          showNotification(data.error || 'Failed to edit message', 'error');
          cancelEdit();
        }
      })
      .catch(error => {
        console.error('Error editing message:', error);
        showNotification('Failed to edit message', 'error');
        cancelEdit();
      });
    } else {
      cancelEdit();
    }
  }

  function cancelEdit() {
    contentSpan.style.display = 'inline';
    editContainer.remove();
  }

  saveBtn.onclick = saveEdit;
  cancelBtn.onclick = cancelEdit;

  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  };
}

function deleteMessage(serverId, channelId, messageId, type) {
  let url;
  if (type === 'room') {
    url = `/api/servers/${serverId}/channels/${channelId}/messages/${messageId}`;
  } else {
    // For DMs, roomOrUser is the targetUser
    url = `/api/dm/${serverId}/messages/${messageId}`;
  }

  fetch(url, {
    method: 'DELETE'
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      const messageDiv = document.querySelector(`[data-message-id="${messageId}"]`);
      if (messageDiv) {
        messageDiv.remove();
        showNotification('Message deleted', 'success');
      }
    } else {
      showNotification(data.error || 'Failed to delete message', 'error');
    }
  })
  .catch(error => {
    console.error('Error deleting message:', error);
    showNotification('Failed to delete message', 'error');
  });
}

function updateMessageIndices() {
  const messageElements = messages.querySelectorAll('[data-message-index]');
  messageElements.forEach((element, index) => {
    element.dataset.messageIndex = index;
  });
}

// Socket handlers for message editing and deletion
socket.on('message edited', (data) => {
  const messageDiv = document.querySelector(`[data-message-id="${data.messageId}"]`);
  if (messageDiv) {
    const contentSpan = messageDiv.querySelector('.content');
    if (contentSpan) {
      contentSpan.textContent = data.newMessage;

      // Add or update edited indicator
      let editedSpan = messageDiv.querySelector('.edited');
      if (!editedSpan) {
        editedSpan = document.createElement('span');
        editedSpan.className = 'edited';
        editedSpan.style.color = '#72767d';
        editedSpan.style.fontSize = '12px';
        contentSpan.parentNode.appendChild(editedSpan);
      }
      editedSpan.textContent = ` (edited at ${data.editedAt})`;
    }
  }
});

socket.on('message deleted', (data) => {
  const messageDiv = document.querySelector(`[data-message-id="${data.messageId}"]`);
  if (messageDiv) {
    messageDiv.remove();
  }
});

socket.on('dm message edited', (data) => {
  const messageDiv = document.querySelector(`[data-message-id="${data.messageId}"]`);
  if (messageDiv) {
    const contentSpan = messageDiv.querySelector('.content');
    if (contentSpan) {
      contentSpan.textContent = data.newMessage;

      // Add or update edited indicator
      let editedSpan = messageDiv.querySelector('.edited');
      if (!editedSpan) {
        editedSpan = document.createElement('span');
        editedSpan.className = 'edited';
        editedSpan.style.color = '#72767d';
        editedSpan.style.fontSize = '12px';
        contentSpan.parentNode.appendChild(editedSpan);
      }
      editedSpan.textContent = ` (edited at ${data.editedAt})`;
    }
  }
});

socket.on('dm message deleted', (data) => {
  const messageDiv = document.querySelector(`[data-message-id="${data.messageId}"]`);
  if (messageDiv) {
    messageDiv.remove();
  }
});
// ============== MESSAGE CONTEXT MENU (right-click / long-press) ==============

function showMessageContextMenu(x, y, editBtn, deleteBtn) {
  const existing = document.getElementById('msg-context-menu');
  if (existing) existing.remove();

  if (!editBtn && !deleteBtn) return;

  const menu = document.createElement('div');
  menu.id = 'msg-context-menu';
  menu.className = 'context-menu';
  menu.style.zIndex = '10000';

  if (editBtn) {
    const editItem = document.createElement('div');
    editItem.className = 'context-menu-item';
    editItem.textContent = 'Edit Message';
    editItem.onclick = () => { menu.remove(); editBtn.click(); };
    menu.appendChild(editItem);
  }

  if (deleteBtn) {
    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item danger';
    deleteItem.textContent = 'Delete Message';
    deleteItem.onclick = () => { menu.remove(); deleteBtn.click(); };
    menu.appendChild(deleteItem);
  }

  menu.style.left = '0px';
  menu.style.top = '-9999px';
  document.body.appendChild(menu);
  const menuW = menu.offsetWidth;
  const menuH = menu.offsetHeight;
  const left = x + menuW > window.innerWidth ? x - menuW : x;
  const top = y + menuH > window.innerHeight ? y - menuH : y;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('mousedown', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', closeMenu), 0);
}

const messagesEl = document.getElementById('messages');
if (messagesEl) {
  messagesEl.addEventListener('click', function(e) {
    if (!e.shiftKey) return;
    const messageDiv = e.target.closest('.message');
    const actions = messageDiv && messageDiv.querySelector('.message-actions');
    if (!actions) return;
    const editBtn = actions.querySelector('.edit-btn');
    const deleteBtn = actions.querySelector('.delete-btn');
    if (!editBtn && !deleteBtn) return;
    e.preventDefault();
    showMessageContextMenu(e.clientX, e.clientY, editBtn, deleteBtn);
  });

  messagesEl.addEventListener('contextmenu', function(e) {
    const messageDiv = e.target.closest('.message');
    if (!messageDiv) return;
    const actions = messageDiv.querySelector('.message-actions');
    if (!actions) return;
    const editBtn = actions.querySelector('.edit-btn');
    const deleteBtn = actions.querySelector('.delete-btn');
    if (!editBtn && !deleteBtn) return;
    e.preventDefault();
    showMessageContextMenu(e.clientX, e.clientY, editBtn, deleteBtn);
  });

  let longPressTimer = null;
  messagesEl.addEventListener('touchstart', function(e) {
    const messageDiv = e.target.closest('.message');
    if (!messageDiv) return;
    longPressTimer = setTimeout(() => {
      const actions = messageDiv.querySelector('.message-actions');
      if (!actions) return;
      const editBtn = actions.querySelector('.edit-btn');
      const deleteBtn = actions.querySelector('.delete-btn');
      if (!editBtn && !deleteBtn) return;
      const touch = e.touches[0];
      showMessageContextMenu(touch.clientX, touch.clientY, editBtn, deleteBtn);
    }, 500);
  }, { passive: true });

  messagesEl.addEventListener('touchend', function() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  }, { passive: true });

  messagesEl.addEventListener('touchmove', function() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  }, { passive: true });
}
