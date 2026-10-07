import { SignalingService } from './supabase';
import { ScreenSharePreset } from './types';

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
          } catch {}
        });
      });
    }
  } catch {}

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
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  const envTurnUrl = import.meta.env.VITE_TURN_URL;
  const rawTurnUrls = (envTurnUrl || 'turn:openrelay.metered.ca:80,turn:openrelay.metered.ca:443,turns:openrelay.metered.ca:443?transport=tcp')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

  if (rawTurnUrls.length > 0) {
    servers.push({
      urls: rawTurnUrls.length === 1 ? rawTurnUrls[0] : rawTurnUrls,
      username: import.meta.env.VITE_TURN_USERNAME || 'openrelayproject',
      credential: import.meta.env.VITE_TURN_CREDENTIAL || 'openrelayproject',
    });
  }

  return servers;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: buildIceServers(),
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
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
  private audioMeterInterval: any = null;
  private onAudioLevelChange?: (level: number) => void;
  private onScreenShareEnded?: () => void;
  private isNoiseCancellationEnabled: boolean = true;
  private screenSharePreset: ScreenSharePreset = 'low';

  constructor(
    signaling: SignalingService,
    myId: string,
    onRemoteStreamUpdate: (peerId: string, stream: MediaStream | null) => void,
    noiseCancellation: boolean = true,
    screenSharePreset: ScreenSharePreset = 'low'
  ) {
    this.signaling = signaling;
    this.myId = myId;
    this.onRemoteStreamUpdate = onRemoteStreamUpdate;
    this.isNoiseCancellationEnabled = noiseCancellation;
    this.screenSharePreset = screenSharePreset;
  }

  public setScreenSharePreset(preset: ScreenSharePreset) {
    this.screenSharePreset = preset;
    if (this.screenStream) {
      const track = this.screenStream.getVideoTracks()[0];
      if (track && track.readyState === 'live') {
        const frameRate = preset === 'low' ? { ideal: 15, max: 15 } : { ideal: 30, max: 30 };
        const width = preset === 'high' ? { ideal: 1920 } : { ideal: 1280 };
        const height = preset === 'high' ? { ideal: 1080 } : { ideal: 720 };
        track.applyConstraints({ width, height, frameRate }).catch((e) => console.warn('Could not apply track constraints:', e));
      }
    }
    this.peerConnections.forEach((pc) => {
      this.applySenderParameters(pc);
    });
  }

  public getScreenSharePreset(): ScreenSharePreset {
    return this.screenSharePreset;
  }

  public applySenderParameters(pc: RTCPeerConnection) {
    if (pc.signalingState === 'closed') return;
    try {
      pc.getSenders().forEach((sender) => {
        if (!sender.track) return;
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        if (sender.track.kind === 'audio') {
          // 32kbps Opus constraint for crystal clear voice + ultra-low data
          params.encodings[0].maxBitrate = 32000;
        } else if (sender.track.kind === 'video' && this.screenStream) {
          const preset = this.screenSharePreset;
          params.encodings[0].maxBitrate =
            preset === 'low' ? 450000 : preset === 'high' ? 2500000 : 1200000;
          params.encodings[0].maxFramerate = preset === 'low' ? 15 : 30;
        }
        sender.setParameters(params).catch(() => {});
      });
    } catch (e) {
      console.warn('Error setting sender parameters:', e);
    }
  }

  public setNoiseCancellation(enabled: boolean) {
    this.isNoiseCancellationEnabled = enabled;
    const audioTrack = this.localStream?.getAudioTracks()[0];
    if (audioTrack && audioTrack.readyState === 'live') {
      audioTrack
        .applyConstraints({
          echoCancellation: enabled,
          noiseSuppression: enabled,
          autoGainControl: enabled,
        })
        .catch((err) => {
          console.warn('Could not dynamically apply noise cancellation constraints:', err);
        });
    }
  }

  public getNoiseCancellation(): boolean {
    return this.isNoiseCancellationEnabled;
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
      const nc = this.isNoiseCancellationEnabled;
      const constraints: MediaStreamConstraints = {
        audio: audio
          ? audioDeviceId
            ? { deviceId: { exact: audioDeviceId }, echoCancellation: nc, noiseSuppression: nc, autoGainControl: nc }
            : { echoCancellation: nc, noiseSuppression: nc, autoGainControl: nc }
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
      const nc = this.isNoiseCancellationEnabled;
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: nc, noiseSuppression: nc, autoGainControl: nc },
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

  /**
   * Sync local audio/video/screen tracks to all peer connections.
   * Uses replaceTrack (no renegotiation) when a transceiver already exists.
   * Finds transceivers by mid label convention set during createPeerConnection.
   * BUG-FIX: Previous code filtered tracks by readyState==='live', which
   * excluded disabled (muted) tracks — replaceTrack(null) silences without
   * removing the transceiver, so the remote side sees muted state correctly.
   */
  public syncLocalTracksToPeers() {
    // Audio: send the track even if disabled (track.enabled=false still sends silence frames)
    const micTrack = this.localStream?.getAudioTracks()[0] || null;
    const camTrack = this.localStream?.getVideoTracks()[0] || null;

    // Screen share takes priority over camera for the video transceiver
    const screenVideoTrack = this.screenStream?.getVideoTracks()[0] || null;
    const activeVideoTrack = screenVideoTrack || camTrack;

    this.peerConnections.forEach((pc) => {
      if (pc.signalingState === 'closed') return;

      const senders = pc.getSenders();
      const audioSender = senders.find((s) => s.track?.kind === 'audio' || (!s.track && pc.getTransceivers().find((t) => t.sender === s && t.mid !== null && t.receiver?.track?.kind === 'audio')));
      const videoSender = senders.find((s) => s.track?.kind === 'video' || (!s.track && pc.getTransceivers().find((t) => t.sender === s && t.mid !== null && t.receiver?.track?.kind === 'video')));

      // Audio sender
      if (audioSender) {
        if (audioSender.track !== micTrack) {
          audioSender.replaceTrack(micTrack).catch((e) => console.warn('replaceTrack audio error:', e));
        }
      } else if (micTrack && this.localStream) {
        try { pc.addTrack(micTrack, this.localStream); } catch (e) {}
      }

      // Video sender
      if (videoSender) {
        if (videoSender.track !== activeVideoTrack) {
          videoSender.replaceTrack(activeVideoTrack || null).catch((e) => console.warn('replaceTrack video error:', e));
        }
      } else if (activeVideoTrack && (this.screenStream || this.localStream)) {
        try { pc.addTrack(activeVideoTrack, this.screenStream || this.localStream!); } catch (e) {}
      }
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
        } catch {}
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

      this.audioMeterInterval = setInterval(() => {
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
    // No syncLocalTracksToPeers needed: track.enabled=false sends silence
    // frames automatically — the transceiver stays intact.
  }

  public toggleVideo(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }
    // Same as audio: enabled=false sends black frames, no renegotiation.
  }

  public async startScreenShare(): Promise<MediaStream> {
    try {
      const preset = this.screenSharePreset;
      const frameRate = preset === 'low' ? { ideal: 15, max: 15 } : { ideal: 30, max: 30 };
      const width = preset === 'high' ? { ideal: 1920 } : { ideal: 1280 };
      const height = preset === 'high' ? { ideal: 1080 } : { ideal: 720 };

      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
          width,
          height,
          frameRate,
        },
        audio: true,
      });

      this.screenStream = screenStream;
      const screenTrack = screenStream.getVideoTracks()[0];

      if (screenTrack) {
        // Replace the video track on all peer connections with the screen track
        this.peerConnections.forEach((pc) => {
          if (pc.signalingState === 'closed') return;
          const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(screenTrack).catch((e) => console.warn('Error replacing screen track:', e));
          } else {
            try { pc.addTrack(screenTrack, screenStream); } catch (e) {}
          }
          this.applySenderParameters(pc);
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
      if (existing.signalingState !== 'closed') {
        const alreadyNegotiated =
          Boolean(existing.currentRemoteDescription) ||
          existing.connectionState === 'connected' ||
          existing.connectionState === 'connecting';

        if (initiator && existing.signalingState === 'stable' && !alreadyNegotiated && !this.negotiating.has(targetPeerId)) {
          void this.initiateOffer(targetPeerId, existing);
        }
        return existing;
      }
      this.peerConnections.delete(targetPeerId);
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peerConnections.set(targetPeerId, pc);

    const audioTrack = this.localStream?.getAudioTracks()[0] || null;
    const screenVideoTrack = this.screenStream?.getVideoTracks()[0] || null;
    const camVideoTrack = this.localStream?.getVideoTracks()[0] || null;
    const activeVideoTrack = screenVideoTrack || camVideoTrack || null;
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

    this.applySenderParameters(pc);

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

    // Automatic renegotiation when tracks are added/removed
    pc.onnegotiationneeded = () => {
      if (initiator && !this.negotiating.has(targetPeerId) && pc.signalingState === 'stable') {
        void this.initiateOffer(targetPeerId, pc, true);
      }
    };

    // Remote Track Handler
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Received remote track from ${targetPeerId}:`, event.track.kind);
      const incomingStream = event.streams[0];
      let currentStream = this.remoteStreams.get(targetPeerId);

      if (!currentStream) {
        currentStream = incomingStream ? new MediaStream(incomingStream.getTracks()) : new MediaStream([event.track]);
        this.remoteStreams.set(targetPeerId, currentStream);
      } else {
        if (!currentStream.getTracks().some((t) => t.id === event.track.id)) {
          currentStream.addTrack(event.track);
        }
      }

      event.track.onended = () => {
        if (currentStream) {
          currentStream.removeTrack(event.track);
          this.onRemoteStreamUpdate(targetPeerId, new MediaStream(currentStream.getTracks()));
        }
      };

      this.onRemoteStreamUpdate(targetPeerId, new MediaStream(currentStream.getTracks()));
    };

    let restartAttempts = 0;
    let disconnectTimer: any = null;

    const isCurrent = () => this.peerConnections.get(targetPeerId) === pc;

    const handleConnectionDrop = () => {
      if (!isCurrent()) return;
      const state = pc.connectionState;
      const iceState = pc.iceConnectionState;
      console.log(`[WebRTC] Peer ${targetPeerId} state - conn: ${state}, ice: ${iceState}`);

      if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
        if (disconnectTimer !== null) {
          clearTimeout(disconnectTimer);
          disconnectTimer = null;
        }
        restartAttempts = 0;
        return;
      }

      if (state === 'failed' || iceState === 'failed' || state === 'disconnected' || iceState === 'disconnected') {
        if (restartAttempts < 3) {
          restartAttempts += 1;
          console.log(`[WebRTC] Attempting ICE restart for ${targetPeerId} (attempt ${restartAttempts})...`);
          try {
            pc.restartIce();
            if (initiator || this.myId > targetPeerId) {
              void this.initiateOffer(targetPeerId, pc, true);
            }
          } catch (e) {
            console.warn('ICE restart trigger failed:', e);
          }
        }

        if (disconnectTimer === null) {
          // Allow 15 seconds grace period for ICE restart & auto-reconnect before closing peer
          disconnectTimer = setTimeout(() => {
            disconnectTimer = null;
            if (isCurrent()) {
              const currentConn = pc.connectionState;
              const currentIce = pc.iceConnectionState;
              if (currentConn === 'failed' || currentConn === 'disconnected' || currentIce === 'failed' || currentIce === 'disconnected') {
                console.warn(`[WebRTC] Peer ${targetPeerId} failed to reconnect after 15s. Closing peer.`);
                this.closePeer(targetPeerId);
              }
            }
          }, 15000);
        }
        return;
      }

      if (state === 'closed' || iceState === 'closed') {
        this.closePeer(targetPeerId);
      }
    };

    pc.onconnectionstatechange = handleConnectionDrop;
    pc.oniceconnectionstatechange = handleConnectionDrop;

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
      pc.oniceconnectionstatechange = null;
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onnegotiationneeded = null;
      try {
        pc.close();
      } catch {}
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
      } catch {}
      this.audioSource = null;
    }
    this.audioAnalyser = null;
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {}
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
      } catch {}
    });
    this.peerConnections.clear();
    this.iceQueues.clear();
    this.remoteStreams.clear();
    this.negotiating.clear();
  }
}
