const streamIceServers = [
  { urls: 'stun:stun.l.google.com:19302' }
];
const availableStreams = new Map();
const broadcasterPeers = new Map();
const viewerPeers = new Map();
const pendingStreamIce = new Map();
let localScreenStream = null;
let localStreamId = null;
let watchingStreamId = null;
let streamConnectTimer = null;

function getClientRoomName() {
  if (typeof currentRoom === 'string' && currentRoom.includes(':')) return currentRoom;
  return `${currentServer || 'sigmachat'}:${currentRoom || currentChannel || 'general'}`;
}

function createStreamCard(stream) {
  if (!stream || !stream.streamId || stream.room !== getClientRoomName()) return;
  availableStreams.set(stream.streamId, stream);

  const container = document.getElementById('messages');
  if (!container) return;
  let card = Array.from(container.querySelectorAll('.stream-card'))
    .find(element => element.dataset.streamId === stream.streamId);

  if (!card) {
    card = document.createElement('article');
    card.className = 'stream-card';
    card.dataset.streamId = stream.streamId;

    const details = document.createElement('div');
    details.className = 'stream-card-details';
    const live = document.createElement('span');
    live.className = 'stream-live-indicator';
    live.textContent = 'LIVE';
    const title = document.createElement('strong');
    title.className = 'stream-card-title';
    const subtitle = document.createElement('span');
    subtitle.className = 'stream-card-subtitle';
    details.append(live, title, subtitle);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'stream-card-action';
    card.append(details, action);
    container.appendChild(card);
  }

  const isOwnStream = stream.username === username;
  card.querySelector('.stream-card-title').textContent = isOwnStream
    ? 'You are sharing your screen'
    : `${stream.username} is sharing their screen`;
  card.querySelector('.stream-card-subtitle').textContent = 'HD screen share · Live in this channel';

  const action = card.querySelector('.stream-card-action');
  action.textContent = isOwnStream ? 'Stop sharing' : 'Join stream';
  action.classList.toggle('stream-stop-action', isOwnStream);
  action.onclick = isOwnStream
    ? stopLocalScreenShare
    : () => watchStream(stream.streamId);
}

function removeStreamCard(streamId) {
  availableStreams.delete(streamId);
  const card = Array.from(document.querySelectorAll('.stream-card'))
    .find(element => element.dataset.streamId === streamId);
  if (card) card.remove();
}

function clearStreamCards() {
  document.querySelectorAll('.stream-card').forEach(card => card.remove());
  availableStreams.clear();
}

function addPendingIce(key, candidate) {
  if (!pendingStreamIce.has(key)) pendingStreamIce.set(key, []);
  pendingStreamIce.get(key).push(candidate);
}

async function flushPendingIce(key, peer) {
  const candidates = pendingStreamIce.get(key) || [];
  pendingStreamIce.delete(key);
  for (const candidate of candidates) {
    try {
      await peer.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.warn('Could not apply a queued screen-share network candidate:', error);
    }
  }
}

function setStreamStatus(message) {
  const status = document.getElementById('stream-viewer-status');
  if (status) status.textContent = message;
}

function setStreamConnectionError(message) {
  setStreamStatus(message);
  const subtitle = document.getElementById('stream-viewer-subtitle');
  const placeholder = document.getElementById('stream-video-placeholder');
  if (subtitle) subtitle.textContent = 'Could not connect to the live stream';
  if (placeholder) {
    placeholder.textContent = message;
    placeholder.hidden = false;
  }
}

function clearStreamConnectTimer() {
  if (streamConnectTimer) {
    clearTimeout(streamConnectTimer);
    streamConnectTimer = null;
  }
}

function updateStreamVideoState(isConnected) {
  const placeholder = document.getElementById('stream-video-placeholder');
  if (placeholder) placeholder.hidden = isConnected;
}

function requestScreenShareQuality(sender) {
  try {
    const parameters = sender.getParameters();
    if (!parameters.encodings || !parameters.encodings.length) parameters.encodings = [{}];
    parameters.encodings[0].maxBitrate = 8000000;
    parameters.encodings[0].maxFramerate = 30;
    parameters.degradationPreference = 'maintain-resolution';
    sender.setParameters(parameters).catch(error => {
      console.warn('The browser could not apply the preferred screen-share quality:', error);
    });
  } catch (error) {
    console.warn('The browser could not configure preferred screen-share quality:', error);
  }
}

async function startScreenShare() {
  if (localScreenStream) {
    showNotification('You are already sharing your screen.', 'warning');
    return;
  }
  if (!socket.connected) {
    showNotification('The chat connection is offline. Reconnect before starting a screen share.', 'error');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    showNotification('Screen sharing is not supported by this browser. Open the chat in a secure, up-to-date browser.', 'error');
    return;
  }

  try {
    const capturedStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });

    const videoTrack = capturedStream.getVideoTracks()[0];
    if (!videoTrack) {
      capturedStream.getTracks().forEach(track => track.stop());
      throw new Error('No screen video was selected.');
    }

    try {
      await videoTrack.applyConstraints({
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      });
    } catch (constraintError) {
      console.warn('The browser kept its default screen capture resolution:', constraintError);
    }

    videoTrack.contentHint = 'detail';
    localScreenStream = capturedStream;
    localStreamId = socket.id;
    videoTrack.addEventListener('ended', stopLocalScreenShare, { once: true });
    socket.emit('stream:start');
  } catch (error) {
    localScreenStream = null;
    localStreamId = null;
    if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
      showNotification('Screen sharing was cancelled.', 'warning');
    } else {
      console.error('Unable to start screen sharing:', {
        name: error.name || 'UnknownError',
        message: error.message || String(error)
      });
      const detail = error.message ? ` ${error.message}` : '';
      showNotification(`Unable to start screen sharing.${detail} Try opening the chat in a new tab and allow screen capture.`, 'error');
    }
  }
}

function stopLocalScreenShare() {
  const streamId = localStreamId;
  const capturedStream = localScreenStream;
  localStreamId = null;
  localScreenStream = null;

  if (streamId) {
    if (socket.connected) socket.emit('stream:stop');
    removeStreamCard(streamId);
  }
  broadcasterPeers.forEach(peer => peer.close());
  broadcasterPeers.clear();
  if (capturedStream) {
    capturedStream.getTracks().forEach(track => {
      track.onended = null;
      track.stop();
    });
  }
}

function openStreamViewer(stream) {
  const overlay = document.getElementById('stream-viewer-overlay');
  const title = document.getElementById('stream-viewer-title');
  const subtitle = document.getElementById('stream-viewer-subtitle');
  const video = document.getElementById('stream-remote-video');
  if (!overlay || !video) return;

  watchingStreamId = stream.streamId;
  title.textContent = `${stream.username}'s screen`;
  subtitle.textContent = 'Connecting to live screen share…';
  setStreamStatus(`Watching ${stream.username}'s screen`);
  updateStreamVideoState(false);
  video.srcObject = null;
  video.muted = true;
  const audioToggle = document.getElementById('stream-audio-toggle');
  if (audioToggle) audioToggle.textContent = 'Unmute';
  overlay.hidden = false;
}

async function watchStream(streamId) {
  const stream = availableStreams.get(streamId);
  if (!stream) {
    showNotification('This screen share is no longer available.', 'warning');
    return;
  }
  if (streamId === localStreamId) return;
  if (watchingStreamId) stopWatchingStream();

  openStreamViewer(stream);
  const peer = new RTCPeerConnection({ iceServers: streamIceServers });
  viewerPeers.set(streamId, peer);

  peer.onicecandidate = event => {
    if (event.candidate) {
      socket.emit('stream:ice', {
        streamId,
        to: streamId,
        candidate: event.candidate
      });
    }
  };
  peer.ontrack = event => {
    const video = document.getElementById('stream-remote-video');
    const streamSubtitle = document.getElementById('stream-viewer-subtitle');
    if (!video) return;
    const remoteStream = event.streams[0] || new MediaStream([event.track]);
    if (!video.srcObject) video.srcObject = remoteStream;
    else if (event.track && !video.srcObject.getTracks().some(track => track.id === event.track.id)) {
      video.srcObject.addTrack(event.track);
    }
    if (event.track.kind === 'video') {
      clearStreamConnectTimer();
      video.play().catch(() => {});
      updateStreamVideoState(true);
      if (streamSubtitle) streamSubtitle.textContent = 'Live screen share';
      setStreamStatus(`Watching ${stream.username}'s screen`);
    }
  };
  peer.onconnectionstatechange = () => {
    if (watchingStreamId === streamId && peer.connectionState === 'failed') {
      clearStreamConnectTimer();
      setStreamConnectionError('Could not connect. Your network may be blocking the stream; try again or use another network.');
    }
  };
  peer.oniceconnectionstatechange = () => {
    if (watchingStreamId === streamId && peer.iceConnectionState === 'failed') {
      clearStreamConnectTimer();
      setStreamConnectionError('Could not establish a network path to this stream. Try again or use another network.');
    }
  };

  streamConnectTimer = setTimeout(() => {
    if (watchingStreamId === streamId && !document.getElementById('stream-remote-video')?.srcObject) {
      setStreamConnectionError('Still unable to connect. The host may be offline, or the network may be blocking WebRTC.');
    }
  }, 15000);

  try {
    peer.addTransceiver('video', { direction: 'recvonly' });
    peer.addTransceiver('audio', { direction: 'recvonly' });
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.timeout(8000).emit('stream:offer', {
      streamId,
      description: peer.localDescription
    }, (error, response) => {
      if (error || !response?.ok) {
        clearStreamConnectTimer();
        setStreamConnectionError(response?.message || 'Could not reach the stream host. Leave and try joining again.');
      }
    });
  } catch (error) {
    console.error('Unable to connect to screen share:', error);
    clearStreamConnectTimer();
    setStreamConnectionError('Could not connect to this screen share.');
  }
}

function stopWatchingStream(notifyServer = true) {
  const streamId = watchingStreamId;
  clearStreamConnectTimer();
  if (streamId && notifyServer && socket.connected) socket.emit('stream:leave', { streamId });
  watchingStreamId = null;

  if (streamId) {
    const peer = viewerPeers.get(streamId);
    if (peer) peer.close();
    viewerPeers.delete(streamId);
  }

  const overlay = document.getElementById('stream-viewer-overlay');
  const video = document.getElementById('stream-remote-video');
  if (video) video.srcObject = null;
  if (overlay) overlay.hidden = true;
  updateStreamVideoState(false);
}

async function handleStreamOffer({ streamId, from, description } = {}) {
  if (!localScreenStream || localStreamId !== streamId || !from || !description) return;
  const previousPeer = broadcasterPeers.get(from);
  if (previousPeer) previousPeer.close();

  const peer = new RTCPeerConnection({ iceServers: streamIceServers });
  broadcasterPeers.set(from, peer);
  peer.onicecandidate = event => {
    if (event.candidate) {
      socket.emit('stream:ice', {
        streamId,
        to: from,
        candidate: event.candidate
      });
    }
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'closed' || peer.connectionState === 'failed') {
      if (broadcasterPeers.get(from) === peer) broadcasterPeers.delete(from);
      peer.close();
    }
  };

  try {
    await peer.setRemoteDescription(new RTCSessionDescription(description));
    await flushPendingIce(`${streamId}:${from}`, peer);
    localScreenStream.getTracks().forEach(track => {
      const sender = peer.addTrack(track, localScreenStream);
      if (track.kind === 'video') requestScreenShareQuality(sender);
    });
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit('stream:answer', {
      streamId,
      to: from,
      description: peer.localDescription
    });
  } catch (error) {
    console.error('Unable to negotiate screen-share connection:', error);
    peer.close();
    broadcasterPeers.delete(from);
  }
}

socket.on('stream:list', streams => {
  clearStreamCards();
  (Array.isArray(streams) ? streams : []).forEach(createStreamCard);
});

socket.on('stream:available', createStreamCard);

socket.on('stream:started', stream => {
  localStreamId = stream.streamId;
  createStreamCard(stream);
});

socket.on('stream:error', data => {
  stopLocalScreenShare();
  showNotification(data.message || 'Unable to start screen sharing.', 'error');
});

socket.on('stream:ended', ({ streamId, username: streamerName } = {}) => {
  if (!streamId) return;
  removeStreamCard(streamId);
  const peer = viewerPeers.get(streamId);
  if (peer) {
    peer.close();
    viewerPeers.delete(streamId);
  }

  if (watchingStreamId === streamId) {
    stopWatchingStream(false);
    showNotification(`${streamerName || 'The streamer'} ended their screen share.`, 'info');
  }
  if (localStreamId === streamId) {
    stopLocalScreenShare();
  }
});

socket.on('stream:offer', handleStreamOffer);

socket.on('stream:answer', async ({ streamId, from, description } = {}) => {
  const peer = viewerPeers.get(streamId);
  if (!peer || watchingStreamId !== streamId || from !== streamId || !description) return;
  try {
    await peer.setRemoteDescription(new RTCSessionDescription(description));
    await flushPendingIce(`${streamId}:${from}`, peer);
  } catch (error) {
    console.error('Unable to apply the screen-share answer:', error);
    clearStreamConnectTimer();
    setStreamConnectionError('The stream host could not complete the connection. Leave and try joining again.');
  }
});

socket.on('stream:ice', async ({ streamId, from, candidate } = {}) => {
  if (!streamId || !from || !candidate) return;
  const peer = socket.id === streamId
    ? broadcasterPeers.get(from)
    : viewerPeers.get(streamId);
  const key = `${streamId}:${from}`;
  if (!peer || !peer.remoteDescription) {
    addPendingIce(key, candidate);
    return;
  }
  try {
    await peer.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (error) {
    console.warn('Could not apply a screen-share network candidate:', error);
  }
});

socket.on('stream:viewer-left', ({ viewerId } = {}) => {
  const peer = broadcasterPeers.get(viewerId);
  if (peer) peer.close();
  broadcasterPeers.delete(viewerId);
});

socket.on('disconnect', () => {
  if (localScreenStream) stopLocalScreenShare();
  if (watchingStreamId) stopWatchingStream(false);
  clearStreamCards();
});

document.getElementById('stream-viewer-close')?.addEventListener('click', () => stopWatchingStream());
document.getElementById('stream-leave-btn')?.addEventListener('click', () => stopWatchingStream());
document.getElementById('stream-viewer-overlay')?.addEventListener('click', event => {
  if (event.target.id === 'stream-viewer-overlay') stopWatchingStream();
});
document.getElementById('stream-audio-toggle')?.addEventListener('click', () => {
  const video = document.getElementById('stream-remote-video');
  const button = document.getElementById('stream-audio-toggle');
  if (!video || !button) return;
  video.muted = !video.muted;
  button.textContent = video.muted ? 'Unmute' : 'Mute';
});
document.getElementById('stream-fullscreen-btn')?.addEventListener('click', async () => {
  const stage = document.getElementById('stream-video-stage');
  if (!stage) return;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await stage.requestFullscreen();
  } catch (error) {
    showNotification('Fullscreen is unavailable in this browser.', 'warning');
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && watchingStreamId) stopWatchingStream();
});

window.addEventListener('beforeunload', () => {
  if (localStreamId && socket.connected) socket.emit('stream:stop');
  if (watchingStreamId && socket.connected) socket.emit('stream:leave', { streamId: watchingStreamId });
  if (localScreenStream) localScreenStream.getTracks().forEach(track => track.stop());
});
