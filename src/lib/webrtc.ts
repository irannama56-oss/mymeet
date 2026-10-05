import { SignalingService } from './supabase';

function createSyntheticStream(userName: string = 'User'): MediaStream {
  if (typeof document === 'undefined') return new MediaStream();
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');

  let frame = 0;
  let rafId = 0;
  function draw() {
    if (!ctx) return;
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.beginPath();
    ctx.arc(320, 240, 75 + Math.sin(frame * 0.08) * 6, 0, Math.PI * 2);
    ctx.fillStyle = '#6366f1';
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 54px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(userName.charAt(0).toUpperCase() || 'U', 320, 240);

    frame++;
    rafId = requestAnimationFrame(draw);
  }
  draw();

  const stream = canvas.captureStream(20);

  const stopDrawing = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };
  stream.getVideoTracks().forEach((t) => {
    t.addEventListener('ended', stopDrawing);
  });

  // Add silent audio track so negotiation has audio
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      const actx = new AudioCtx();
      const osc = actx.createOscillator();
      const gain = actx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      const dest = actx.createMediaStreamDestination();
      gain.connect(dest);
      osc.start();
      const audioTrack = dest.stream.getAudioTracks()[0];
      if (audioTrack) {
        stream.addTrack(audioTrack);
      }
      stream.getAudioTracks().forEach((t) => {
        t.addEventListener('ended', () => {
          try {
            osc.stop();
            actx.close();
          } catch {
            /* already closed */
          }
        });
      });
    }
  } catch {
    /* audio is optional for synthetic fallback */
  }

  return stream;
}

/**
 * ICE configuration with STUN and TURN relays
 */
function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  const turnUrls = (import.meta.env.VITE_TURN_URL || 'turn:openrelay.metered.ca:80')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

  if (turnUrls.length > 0) {
    servers.push({
      urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls,
      username: import.meta.env.VITE_TURN_USERNAME || 'openrelayproject',
      credential: import.meta.env.VITE_TURN_CREDENTIAL || 'openrelayproject',
    });
  }

  return servers;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: buildIceServers(),
  iceCandidatePoolSize: 10,
};

export class WebRTCManager {
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private remoteStreams: Map<string, MediaStream> = new Map();
  private iceQueues: Map<string, RTCIceCandidateInit[]> = new Map();
  private negotiating: Set<string> = new Set();
  private signaling: SignalingService;
  private myId: string;
  private onRemoteStreamUpdate: (peerId: string, stream: MediaStream | null) => void;
  private audioAnalyser: AnalyserNode | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private audioContext: AudioContext | null = null;
  private audioMeterInterval: number | null = null;
  private onAudioLevelChange?: (level: number) => void;
  private onScreenShareEnded?: () => void;

  constructor(
    signaling: SignalingService,
    myId: string,
    onRemoteStreamUpdate: (peerId: string, stream: MediaStream | null) => void
  ) {
    this.signaling = signaling;
    this.myId = myId;
    this.onRemoteStreamUpdate = onRemoteStreamUpdate;
  }

  public setAudioLevelCallback(callback: (level: number) => void) {
    this.onAudioLevelChange = callback;
  }

  public setScreenShareEndedCallback(callback: () => void) {
    this.onScreenShareEnded = callback;
  }

  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  public getScreenStream(): MediaStream | null {
    return this.screenStream;
  }

  /**
   * Acquire camera/mic with retry and fallback
   */
  public async getLocalMedia(
    audio: boolean = true,
    video: boolean = true,
    audioDeviceId?: string,
    videoDeviceId?: string
  ): Promise<MediaStream> {
    if (!audio && !video) {
      const empty = new MediaStream();
      if (this.localStream && this.localStream !== empty) {
        this.localStream.getTracks().forEach((t) => t.stop());
      }
      this.localStream = empty;
      this.syncLocalTracksToPeers();
      return empty;
    }

    const attempt = async (): Promise<MediaStream> => {
      const constraints: MediaStreamConstraints = {
        audio: audio
          ? audioDeviceId
            ? { deviceId: { exact: audioDeviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            : { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          : false,
        video: video
          ? videoDeviceId
            ? { deviceId: { exact: videoDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
            : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
          : false,
      };
      return navigator.mediaDevices.getUserMedia(constraints);
    };

    let stream: MediaStream | null = null;

    try {
      stream = await attempt();
    } catch (err) {
      const name = (err as DOMException)?.name;
      const retryable = name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError';
      if (retryable) {
        await new Promise((r) => setTimeout(r, 400));
        try {
          stream = await attempt();
        } catch (retryErr) {
          console.warn('Retry of user media failed:', retryErr);
        }
      } else {
        console.warn('Could not get requested user media constraints:', err);
      }
    }

    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (audioErr) {
        console.warn('Hardware media access failed, falling back to synthetic stream:', audioErr);
        stream = createSyntheticStream('User');
      }
    }

    if (this.localStream && this.localStream !== stream) {
      this.localStream.getTracks().forEach((t) => t.stop());
    }

    this.localStream = stream;
    this.setupAudioAnalysis(stream);

    // Push tracks into all peer connections
    this.syncLocalTracksToPeers();

    return stream;
  }

  public async ensureAudioTrack(): Promise<MediaStream | null> {
    if (!this.localStream) return null;
    const existing = this.localStream.getAudioTracks().find((t) => t.readyState === 'live');
    if (existing) {
      existing.enabled = true;
      this.syncLocalTracksToPeers();
      return this.localStream;
    }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const track = mic.getAudioTracks()[0];
      if (track) {
        this.localStream.addTrack(track);
        this.setupAudioAnalysis(this.localStream);
        this.syncLocalTracksToPeers();
      }
    } catch (e) {
      console.warn('Could not re-acquire microphone:', e);
    }
    return this.localStream;
  }

  public async ensureVideoTrack(videoDeviceId?: string): Promise<MediaStream | null> {
    if (!this.localStream) return null;
    const existing = this.localStream.getVideoTracks().find((t) => t.readyState === 'live');
    if (existing) {
      existing.enabled = true;
      this.syncLocalTracksToPeers();
      return this.localStream;
    }
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: videoDeviceId
          ? { deviceId: { exact: videoDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });
      const track = cam.getVideoTracks()[0];
      if (track) {
        this.localStream.addTrack(track);
        this.syncLocalTracksToPeers();
      }
    } catch (e) {
      console.warn('Could not re-acquire camera:', e);
    }
    return this.localStream;
  }

  public syncLocalTracksToPeers() {
    const micTrack = this.localStream?.getAudioTracks().find((t) => t.readyState === 'live' && t.enabled) || null;
    const camTrack = this.localStream?.getVideoTracks().find((t) => t.readyState === 'live' && t.enabled) || null;
    const videoTrack = this.screenStream?.getVideoTracks().find((t) => t.readyState === 'live') || camTrack;

    this.peerConnections.forEach((pc) => {
      if (pc.signalingState === 'closed') return;
      pc.getTransceivers().forEach((transceiver) => {
        const kind = transceiver.receiver?.track?.kind;
        if (!transceiver.sender) return;
        if (kind === 'audio') {
          transceiver.sender.replaceTrack(micTrack).catch((e) => console.warn('replaceTrack audio error:', e));
        } else if (kind === 'video') {
          transceiver.sender.replaceTrack(videoTrack).catch((e) => console.warn('replaceTrack video error:', e));
        }
      });
    });
  }

  public setupAudioAnalysis(stream: MediaStream) {
    try {
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) return;

      if (!this.audioContext) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          this.audioContext = new AudioCtx();
        }
      }

      if (!this.audioContext) return;

      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }

      if (this.audioSource) {
        try {
          this.audioSource.disconnect();
        } catch {
          /* already detached */
        }
        this.audioSource = null;
      }

      const source = this.audioContext.createMediaStreamSource(stream);
      this.audioSource = source;
      this.audioAnalyser = this.audioContext.createAnalyser();
      this.audioAnalyser.fftSize = 256;
      this.audioAnalyser.smoothingTimeConstant = 0.4;
      source.connect(this.audioAnalyser);

      const bufferLength = this.audioAnalyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      if (this.audioMeterInterval) {
        clearInterval(this.audioMeterInterval);
      }

      this.audioMeterInterval = window.setInterval(() => {
        if (!this.audioAnalyser || !this.onAudioLevelChange) return;
        this.audioAnalyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const normalized = Math.min(100, Math.round((average / 128) * 100));
        this.onAudioLevelChange(normalized);
      }, 80);
    } catch (e) {
      console.warn('Audio analysis setup error:', e);
    }
  }

  public toggleAudio(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }
    this.syncLocalTracksToPeers();
  }

  public toggleVideo(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }

    if (!this.screenStream) {
      const camTrack = enabled ? this.localStream?.getVideoTracks().find((t) => t.readyState === 'live' && t.enabled) || null : null;
      this.peerConnections.forEach((pc) => {
        if (pc.signalingState === 'closed') return;
        pc.getTransceivers().forEach((transceiver) => {
          if (transceiver.receiver?.track?.kind !== 'video' || !transceiver.sender) return;
          transceiver.sender.replaceTrack(camTrack).catch((e) => console.warn('Error toggling video track:', e));
        });
      });
    }
  }

  public async startScreenShare(): Promise<MediaStream> {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
          frameRate: { ideal: 30 },
        },
        audio: true,
      });

      this.screenStream = screenStream;
      const screenTrack = screenStream.getVideoTracks()[0];

      if (screenTrack) {
        this.peerConnections.forEach((pc) => {
          if (pc.signalingState === 'closed') return;
          const videoTransceiver = pc
            .getTransceivers()
            .find((t) => t.receiver?.track?.kind === 'video' && t.sender);

          if (videoTransceiver?.sender) {
            videoTransceiver.sender.replaceTrack(screenTrack).catch((e) => console.warn('Error replacing screen track:', e));
          } else {
            try {
              pc.addTrack(screenTrack, screenStream);
            } catch (e) {
              console.warn('Error adding screen track to peer:', e);
            }
          }
        });

        screenTrack.onended = () => {
          this.stopScreenShare();
          if (this.onScreenShareEnded) {
            this.onScreenShareEnded();
          }
        };
      }

      return screenStream;
    } catch (err) {
      console.error('Error starting screen share:', err);
      throw err;
    }
  }

  public stopScreenShare() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
    this.syncLocalTracksToPeers();
  }

  public createPeerConnection(targetPeerId: string, initiator: boolean): RTCPeerConnection {
    if (this.peerConnections.has(targetPeerId)) {
      const existing = this.peerConnections.get(targetPeerId)!;
      const alreadyNegotiated =
        Boolean(existing.currentRemoteDescription) ||
        existing.connectionState === 'connected' ||
        existing.connectionState === 'connecting';

      if (initiator && existing.signalingState === 'stable' && !alreadyNegotiated && !this.negotiating.has(targetPeerId)) {
        void this.initiateOffer(targetPeerId, existing);
      }
      return existing;
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peerConnections.set(targetPeerId, pc);

    const audioTrack = this.localStream?.getAudioTracks().find((t) => t.readyState === 'live' && t.enabled) || null;
    const activeVideoTrack = this.screenStream
      ? this.screenStream.getVideoTracks()[0]
      : this.localStream?.getVideoTracks().find((t) => t.readyState === 'live' && t.enabled) || null;
    const activeVideoStream = this.screenStream || this.localStream;

    try {
      if (audioTrack && this.localStream) {
        pc.addTrack(audioTrack, this.localStream);
      } else {
        pc.addTransceiver('audio', { direction: 'sendrecv' });
      }
    } catch (e) {
      console.warn('Could not add audio to peer:', e);
    }

    try {
      if (activeVideoTrack && activeVideoStream) {
        pc.addTrack(activeVideoTrack, activeVideoStream);
      } else {
        pc.addTransceiver('video', { direction: 'sendrecv' });
      }
    } catch (e) {
      console.warn('Could not add video to peer:', e);
    }

    // ICE Candidate Handler
    pc.onicecandidate = (event) => {
      if (event.candidate && event.candidate.candidate) {
        this.signaling.send({
          type: 'ice-candidate',
          targetId: targetPeerId,
          payload: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          },
        });
      }
    };

    // Remote Track Handler
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Received remote track from ${targetPeerId}:`, event.track.kind);
      const remoteStream = event.streams[0] || new MediaStream([event.track]);

      const currentStream = this.remoteStreams.get(targetPeerId);
      if (currentStream) {
        if (!currentStream.getTracks().some((t) => t.id === event.track.id)) {
          currentStream.addTrack(event.track);
        }
        this.onRemoteStreamUpdate(targetPeerId, currentStream);
      } else {
        this.remoteStreams.set(targetPeerId, remoteStream);
        this.onRemoteStreamUpdate(targetPeerId, remoteStream);
      }
    };

    let restartAttempts = 0;
    let disconnectTimer: number | null = null;

    const isCurrent = () => this.peerConnections.get(targetPeerId) === pc;

    pc.onconnectionstatechange = () => {
      if (!isCurrent()) return;
      const state = pc.connectionState;
      console.log(`[WebRTC] Peer ${targetPeerId} connection state:`, state);

      if (state === 'connected') {
        if (disconnectTimer !== null) {
          window.clearTimeout(disconnectTimer);
          disconnectTimer = null;
        }
        restartAttempts = 0;
        return;
      }

      if (state === 'failed') {
        if (restartAttempts < 2) {
          restartAttempts += 1;
          try {
            pc.restartIce();
            if (initiator) {
              void this.initiateOffer(targetPeerId, pc, true);
              return;
            }
          } catch (e) {
            console.warn('ICE restart failed:', e);
          }
        }
        this.closePeer(targetPeerId);
        return;
      }

      if (state === 'disconnected') {
        if (disconnectTimer === null) {
          disconnectTimer = window.setTimeout(() => {
            disconnectTimer = null;
            if (isCurrent() && (pc.connectionState === 'disconnected' || pc.connectionState === 'failed')) {
              this.closePeer(targetPeerId);
            }
          }, 5000);
        }
        return;
      }

      if (state === 'closed') {
        this.closePeer(targetPeerId);
      }
    };

    if (initiator) {
      this.initiateOffer(targetPeerId, pc);
    }

    return pc;
  }

  private async initiateOffer(targetPeerId: string, pc: RTCPeerConnection, force: boolean = false) {
    if (this.negotiating.has(targetPeerId)) return;
    this.negotiating.add(targetPeerId);
    try {
      if (pc.signalingState !== 'stable') return;
      if (pc.currentRemoteDescription && !force) return;
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pc.setLocalDescription(offer);
      this.signaling.send({
        type: 'offer',
        targetId: targetPeerId,
        payload: {
          type: offer.type,
          sdp: offer.sdp,
        },
      });
    } catch (err) {
      console.error(`Error creating offer for ${targetPeerId}:`, err);
    } finally {
      this.negotiating.delete(targetPeerId);
    }
  }

  public async handleOffer(senderId: string, offer: RTCSessionDescriptionInit) {
    try {
      const pc = this.createPeerConnection(senderId, false);

      if (pc.signalingState !== 'stable') {
        try {
          await pc.setLocalDescription({ type: 'rollback' });
        } catch (e) {
          console.warn('Rollback warning:', e);
        }
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      this.drainIceQueue(senderId, pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.signaling.send({
        type: 'answer',
        targetId: senderId,
        payload: {
          type: answer.type,
          sdp: answer.sdp,
        },
      });
    } catch (err) {
      console.error(`Error handling offer from ${senderId}:`, err);
    }
  }

  public async handleAnswer(senderId: string, answer: RTCSessionDescriptionInit) {
    try {
      const pc = this.peerConnections.get(senderId);
      if (pc && pc.signalingState !== 'closed') {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          this.drainIceQueue(senderId, pc);
        }
      }
    } catch (err) {
      console.error(`Error handling answer from ${senderId}:`, err);
    }
  }

  public async handleIceCandidate(senderId: string, candidate: RTCIceCandidateInit) {
    const pc = this.peerConnections.get(senderId);
    if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
      if (!this.iceQueues.has(senderId)) {
        this.iceQueues.set(senderId, []);
      }
      this.iceQueues.get(senderId)!.push(candidate);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error(`Error adding ice candidate for ${senderId}:`, err);
    }
  }

  private drainIceQueue(peerId: string, pc: RTCPeerConnection) {
    const queue = this.iceQueues.get(peerId);
    if (queue && queue.length > 0) {
      queue.forEach((candidate) => {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) => {
          console.warn(`Error draining ice candidate for ${peerId}:`, err);
        });
      });
      this.iceQueues.delete(peerId);
    }
  }

  public closePeer(peerId: string) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
      this.peerConnections.delete(peerId);
    }
    this.iceQueues.delete(peerId);
    this.remoteStreams.delete(peerId);
    this.negotiating.delete(peerId);
    this.onRemoteStreamUpdate(peerId, null);
  }

  public cleanup() {
    if (this.audioMeterInterval) {
      clearInterval(this.audioMeterInterval);
      this.audioMeterInterval = null;
    }
    if (this.audioSource) {
      try {
        this.audioSource.disconnect();
      } catch {
        /* already detached */
      }
      this.audioSource = null;
    }
    this.audioAnalyser = null;
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
    this.peerConnections.forEach((pc) => {
      try {
        pc.close();
      } catch {
        /* already closed */
      }
    });
    this.peerConnections.clear();
    this.iceQueues.clear();
    this.remoteStreams.clear();
    this.negotiating.clear();
  }
}
