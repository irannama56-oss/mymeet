import { SignalingService } from './supabase';
import { ScreenSharePreset } from './types';

/**
 * High-availability STUN & TURN server configuration
 */
function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302',
      ],
    },
    {
      urls: [
        'stun:stun.cloudflare.com:3478',
        'stun:stun.services.mozilla.com:3478',
        'stun:stun.1und1.de:3478',
      ],
    },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443?transport=tcp',
      ],
      username: import.meta.env.VITE_TURN_USERNAME || 'openrelayproject',
      credential: import.meta.env.VITE_TURN_CREDENTIAL || 'openrelayproject',
    },
  ];

  const envTurnUrl = import.meta.env.VITE_TURN_URL;
  if (envTurnUrl) {
    const rawTurnUrls = envTurnUrl
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);

    if (rawTurnUrls.length > 0) {
      servers.push({
        urls: rawTurnUrls,
        username: import.meta.env.VITE_TURN_USERNAME || 'openrelayproject',
        credential: import.meta.env.VITE_TURN_CREDENTIAL || 'openrelayproject',
      });
    }
  }

  return servers;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: buildIceServers(),
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

interface PeerState {
  pc: RTCPeerConnection;
  isPolite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
}

export class WebRTCManager {
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private peerStates: Map<string, PeerState> = new Map();
  private remoteStreams: Map<string, MediaStream> = new Map();
  private iceQueues: Map<string, RTCIceCandidateInit[]> = new Map();
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
    this.peerStates.forEach(({ pc }) => {
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
        if (sender.track.kind === 'video' && this.screenStream) {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          const preset = this.screenSharePreset;
          params.encodings[0].maxBitrate =
            preset === 'low' ? 450000 : preset === 'high' ? 2500000 : 1200000;
          params.encodings[0].maxFramerate = preset === 'low' ? 15 : 30;
          sender.setParameters(params).catch(() => {});
        }
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
   * Acquire camera and microphone media with flexible fallbacks
   */
  public async getLocalMedia(
    audio: boolean = true,
    video: boolean = true,
    audioDeviceId?: string,
    videoDeviceId?: string
  ): Promise<MediaStream> {
    // Cleanly stop any existing tracks to prevent hardware lock
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    if (!audio && !video) {
      const empty = new MediaStream();
      this.localStream = empty;
      this.syncLocalTracksToPeers();
      return empty;
    }

    const nc = this.isNoiseCancellationEnabled;

    const audioConstraints: MediaTrackConstraints | boolean = audio
      ? audioDeviceId
        ? { deviceId: { ideal: audioDeviceId }, echoCancellation: nc, noiseSuppression: nc, autoGainControl: nc }
        : { echoCancellation: nc, noiseSuppression: nc, autoGainControl: nc }
      : false;

    const videoConstraints: MediaTrackConstraints | boolean = video
      ? videoDeviceId
        ? { deviceId: { ideal: videoDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
      : false;

    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: videoConstraints,
      });
    } catch (err) {
      console.warn('[WebRTC] Preferred getUserMedia failed, retrying with flexible constraints:', err);
      // Fallback 1: retry without deviceId
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audio ? { echoCancellation: nc, noiseSuppression: nc, autoGainControl: nc } : false,
          video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
        });
      } catch (err2) {
        console.warn('[WebRTC] Flexible getUserMedia failed:', err2);
        // Fallback 2: try audio-only if video caused the failure
        if (audio) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch (audioErr) {
            console.warn('[WebRTC] Microphone access failed completely:', audioErr);
          }
        }
      }
    }

    if (!stream) {
      stream = new MediaStream();
    }

    // Set enabled state on tracks
    stream.getAudioTracks().forEach((t) => { t.enabled = audio; });
    stream.getVideoTracks().forEach((t) => { t.enabled = video; });

    this.localStream = stream;

    if (stream.getAudioTracks().length > 0) {
      this.setupAudioAnalysis(stream);
    }

    // Synchronize tracks into all peer connections
    this.syncLocalTracksToPeers();

    return stream;
  }

  public async ensureAudioTrack(audioDeviceId?: string): Promise<MediaStream | null> {
    if (!this.localStream) {
      this.localStream = new MediaStream();
    }
    const existing = this.localStream.getAudioTracks().find((t) => t.readyState === 'live');
    if (existing) {
      existing.enabled = true;
      this.syncLocalTracksToPeers();
      return this.localStream;
    }

    try {
      const nc = this.isNoiseCancellationEnabled;
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: audioDeviceId
          ? { deviceId: { ideal: audioDeviceId }, echoCancellation: nc, noiseSuppression: nc, autoGainControl: nc }
          : { echoCancellation: nc, noiseSuppression: nc, autoGainControl: nc },
      });
      const track = mic.getAudioTracks()[0];
      if (track) {
        track.enabled = true;
        this.localStream.addTrack(track);
        this.setupAudioAnalysis(this.localStream);
        this.syncLocalTracksToPeers();
      }
    } catch (e) {
      console.warn('[WebRTC] Could not re-acquire microphone:', e);
    }
    return this.localStream;
  }

  public async ensureVideoTrack(videoDeviceId?: string): Promise<MediaStream | null> {
    if (!this.localStream) {
      this.localStream = new MediaStream();
    }
    const existing = this.localStream.getVideoTracks().find((t) => t.readyState === 'live');
    if (existing) {
      existing.enabled = true;
      this.syncLocalTracksToPeers();
      return this.localStream;
    }

    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: videoDeviceId
          ? { deviceId: { ideal: videoDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });
      const track = cam.getVideoTracks()[0];
      if (track) {
        track.enabled = true;
        this.localStream.addTrack(track);
        this.syncLocalTracksToPeers();
      }
    } catch (e) {
      console.warn('[WebRTC] Could not re-acquire camera:', e);
    }
    return this.localStream;
  }

  /**
   * Sync local audio/video/screen tracks to all peer connections.
   */
  public syncLocalTracksToPeers() {
    const micTrack = this.localStream?.getAudioTracks().find((t) => t.readyState === 'live') || null;
    const camTrack = this.localStream?.getVideoTracks().find((t) => t.readyState === 'live') || null;

    // Screen share takes priority over camera for video transceiver
    const screenVideoTrack = this.screenStream?.getVideoTracks().find((t) => t.readyState === 'live') || null;
    const activeVideoTrack = screenVideoTrack || camTrack;

    this.peerStates.forEach(({ pc }) => {
      if (pc.signalingState === 'closed') return;

      // 1. Audio Transceiver / Sender
      const audioTransceiver = pc.getTransceivers().find(
        (t) => t.sender.track?.kind === 'audio' || t.receiver.track?.kind === 'audio'
      );

      if (audioTransceiver) {
        if (audioTransceiver.sender.track !== micTrack) {
          audioTransceiver.sender.replaceTrack(micTrack).catch((e) => console.warn('[WebRTC] replaceTrack audio error:', e));
        }
        if (micTrack && audioTransceiver.direction !== 'sendrecv') {
          audioTransceiver.direction = 'sendrecv';
        }
      } else if (micTrack && this.localStream) {
        try {
          pc.addTrack(micTrack, this.localStream);
        } catch (e) {
          console.warn('[WebRTC] addTrack audio error:', e);
        }
      }

      // 2. Video Transceiver / Sender
      const videoTransceiver = pc.getTransceivers().find(
        (t) => t.sender.track?.kind === 'video' || t.receiver.track?.kind === 'video'
      );

      if (videoTransceiver) {
        if (videoTransceiver.sender.track !== activeVideoTrack) {
          videoTransceiver.sender.replaceTrack(activeVideoTrack || null).catch((e) => console.warn('[WebRTC] replaceTrack video error:', e));
        }
        if (activeVideoTrack && videoTransceiver.direction !== 'sendrecv') {
          videoTransceiver.direction = 'sendrecv';
        }
      } else if (activeVideoTrack && (this.screenStream || this.localStream)) {
        try {
          pc.addTrack(activeVideoTrack, this.screenStream || this.localStream!);
        } catch (e) {
          console.warn('[WebRTC] addTrack video error:', e);
        }
      }
    });
  }

  public setupAudioAnalysis(stream: MediaStream) {
    try {
      const audioTrack = stream.getAudioTracks().find((t) => t.readyState === 'live');
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
  }

  public toggleVideo(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }
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
        // Replace the video track on all peer connections with screen track
        this.peerStates.forEach(({ pc }) => {
          if (pc.signalingState === 'closed') return;
          const videoTransceiver = pc.getTransceivers().find(
            (t) => t.sender.track?.kind === 'video' || t.receiver.track?.kind === 'video'
          );
          if (videoTransceiver) {
            videoTransceiver.sender.replaceTrack(screenTrack).catch((e) => console.warn('Error replacing screen track:', e));
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

  /**
   * Get or create a peer state implementing W3C Perfect Negotiation
   */
  public getOrCreatePeer(targetPeerId: string): PeerState {
    if (this.peerStates.has(targetPeerId)) {
      const state = this.peerStates.get(targetPeerId)!;
      if (state.pc.signalingState !== 'closed') {
        return state;
      }
      this.peerStates.delete(targetPeerId);
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    const isPolite = this.myId < targetPeerId;

    const state: PeerState = {
      pc,
      isPolite,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
    };

    this.peerStates.set(targetPeerId, state);

    // Initial tracks / transceivers setup
    const audioTrack = this.localStream?.getAudioTracks().find((t) => t.readyState === 'live') || null;
    const screenVideoTrack = this.screenStream?.getVideoTracks().find((t) => t.readyState === 'live') || null;
    const camVideoTrack = this.localStream?.getVideoTracks().find((t) => t.readyState === 'live') || null;
    const activeVideoTrack = screenVideoTrack || camVideoTrack || null;
    const activeVideoStream = this.screenStream || this.localStream;

    try {
      if (audioTrack && this.localStream) {
        pc.addTrack(audioTrack, this.localStream);
      } else {
        pc.addTransceiver('audio', { direction: 'sendrecv' });
      }
    } catch (e) {
      console.warn('Could not add audio transceiver:', e);
    }

    try {
      if (activeVideoTrack && activeVideoStream) {
        pc.addTrack(activeVideoTrack, activeVideoStream);
      } else {
        pc.addTransceiver('video', { direction: 'sendrecv' });
      }
    } catch (e) {
      console.warn('Could not add video transceiver:', e);
    }

    this.applySenderParameters(pc);

    // ICE Candidate handler
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

    // Perfect Negotiation onnegotiationneeded
    pc.onnegotiationneeded = async () => {
      try {
        state.makingOffer = true;
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);
        this.signaling.send({
          type: 'offer',
          targetId: targetPeerId,
          payload: {
            type: pc.localDescription?.type,
            sdp: pc.localDescription?.sdp,
          },
        });
      } catch (err) {
        console.error(`[WebRTC] Perfect Negotiation error with ${targetPeerId}:`, err);
      } finally {
        state.makingOffer = false;
      }
    };

    // Remote Track Handler
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Received remote track from ${targetPeerId}: kind=${event.track.kind}, id=${event.track.id}`);
      event.track.enabled = true;

      let currentStream = this.remoteStreams.get(targetPeerId);

      if (!currentStream) {
        currentStream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream();
      }

      if (!currentStream.getTracks().some((t) => t.id === event.track.id)) {
        currentStream.addTrack(event.track);
      }
      this.remoteStreams.set(targetPeerId, currentStream);

      const streamWrapper = new MediaStream(currentStream.getTracks());

      event.track.onended = () => {
        if (currentStream) {
          currentStream.removeTrack(event.track);
          const remaining = currentStream.getTracks();
          this.onRemoteStreamUpdate(targetPeerId, remaining.length > 0 ? new MediaStream(remaining) : null);
        }
      };

      this.onRemoteStreamUpdate(targetPeerId, streamWrapper);
    };

    let restartAttempts = 0;
    let disconnectTimer: any = null;

    const isCurrent = () => this.peerStates.get(targetPeerId)?.pc === pc;

    const handleConnectionDrop = () => {
      if (!isCurrent()) return;
      const connState = pc.connectionState;
      const iceState = pc.iceConnectionState;
      console.log(`[WebRTC] Peer ${targetPeerId} - conn: ${connState}, ice: ${iceState}`);

      if (connState === 'connected' || iceState === 'connected' || iceState === 'completed') {
        if (disconnectTimer !== null) {
          clearTimeout(disconnectTimer);
          disconnectTimer = null;
        }
        restartAttempts = 0;
        return;
      }

      if (connState === 'failed' || iceState === 'failed' || connState === 'disconnected' || iceState === 'disconnected') {
        if (restartAttempts < 3) {
          restartAttempts += 1;
          console.log(`[WebRTC] Attempting ICE restart for ${targetPeerId} (attempt ${restartAttempts})...`);
          try {
            pc.restartIce();
          } catch (e) {
            console.warn('ICE restart trigger failed:', e);
          }
        }

        if (disconnectTimer === null) {
          disconnectTimer = setTimeout(() => {
            disconnectTimer = null;
            if (isCurrent()) {
              const curConn = pc.connectionState;
              const curIce = pc.iceConnectionState;
              if (curConn === 'failed' || curConn === 'disconnected' || curIce === 'failed' || curIce === 'disconnected') {
                console.warn(`[WebRTC] Peer ${targetPeerId} disconnected after grace period.`);
                this.closePeer(targetPeerId);
              }
            }
          }, 15000);
        }
        return;
      }

      if (connState === 'closed' || iceState === 'closed') {
        this.closePeer(targetPeerId);
      }
    };

    pc.onconnectionstatechange = handleConnectionDrop;
    pc.oniceconnectionstatechange = handleConnectionDrop;

    return state;
  }

  public createPeerConnection(targetPeerId: string, initiator: boolean = false): RTCPeerConnection {
    const state = this.getOrCreatePeer(targetPeerId);
    return state.pc;
  }

  public async handleOffer(senderId: string, offer: RTCSessionDescriptionInit) {
    try {
      const state = this.getOrCreatePeer(senderId);
      const { pc, isPolite } = state;

      const offerCollision = state.makingOffer || pc.signalingState !== 'stable';
      state.ignoreOffer = !isPolite && offerCollision;

      if (state.ignoreOffer) {
        console.warn(`[WebRTC] Collision: Impolite peer ${this.myId} ignoring colliding offer from ${senderId}`);
        return;
      }

      if (offerCollision) {
        console.log(`[WebRTC] Collision: Polite peer ${this.myId} rolling back local offer`);
        await pc.setLocalDescription({ type: 'rollback' });
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
      console.error(`[WebRTC] Error handling offer from ${senderId}:`, err);
    }
  }

  public async handleAnswer(senderId: string, answer: RTCSessionDescriptionInit) {
    try {
      const state = this.peerStates.get(senderId);
      if (!state || state.ignoreOffer) return;
      const pc = state.pc;
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        this.drainIceQueue(senderId, pc);
      }
    } catch (err) {
      console.error(`[WebRTC] Error handling answer from ${senderId}:`, err);
    }
  }

  public async handleIceCandidate(senderId: string, candidate: RTCIceCandidateInit) {
    const state = this.peerStates.get(senderId);
    if (!state || !state.pc.remoteDescription || !state.pc.remoteDescription.type) {
      if (!this.iceQueues.has(senderId)) {
        this.iceQueues.set(senderId, []);
      }
      this.iceQueues.get(senderId)!.push(candidate);
      return;
    }

    try {
      await state.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      if (!state.ignoreOffer) {
        console.error(`[WebRTC] Error adding ice candidate for ${senderId}:`, err);
      }
    }
  }

  private drainIceQueue(peerId: string, pc: RTCPeerConnection) {
    const queue = this.iceQueues.get(peerId);
    if (queue && queue.length > 0) {
      queue.forEach((candidate) => {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) => {
          console.warn(`[WebRTC] Error draining ice candidate for ${peerId}:`, err);
        });
      });
      this.iceQueues.delete(peerId);
    }
  }

  public closePeer(peerId: string) {
    const state = this.peerStates.get(peerId);
    if (state) {
      const pc = state.pc;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onnegotiationneeded = null;
      try {
        pc.close();
      } catch {}
      this.peerStates.delete(peerId);
    }
    this.iceQueues.delete(peerId);
    this.remoteStreams.delete(peerId);
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
    this.peerStates.forEach(({ pc }) => {
      try {
        pc.close();
      } catch {}
    });
    this.peerStates.clear();
    this.iceQueues.clear();
    this.remoteStreams.clear();
  }
}
