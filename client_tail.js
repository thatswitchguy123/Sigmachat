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