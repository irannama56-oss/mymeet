import { SignalingService } from './supabase';
import { ScreenSharePreset } from './types';

/**
 * ICE configuration with reliable STUN and TURN relays
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
   * Matches senders and transceivers reliably by track kind without mid requirements.
   */
  public syncLocalTracksToPeers() {
    const micTrack = this.localStream?.getAudioTracks().find((t) => t.readyState === 'live') || null;
    const camTrack = this.localStream?.getVideoTracks().find((t) => t.readyState === 'live') || null;

    // Screen share takes priority over camera for video transceiver
    const screenVideoTrack = this.screenStream?.getVideoTracks().find((t) => t.readyState === 'live') || null;
    const activeVideoTrack = screenVideoTrack || camTrack;

    this.peerConnections.forEach((pc) => {
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
        this.peerConnections.forEach((pc) => {
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
      if (!this.negotiating.has(targetPeerId) && pc.signalingState === 'stable') {
        void this.initiateOffer(targetPeerId, pc, true);
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

      // Create a fresh wrapper to ensure React components trigger state update
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
