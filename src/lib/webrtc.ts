import { SignalingService } from './supabase';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
  iceCandidatePoolSize: 10,
};

export class WebRTCManager {
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private remoteStreams: Map<string, MediaStream> = new Map();
  private iceQueues: Map<string, RTCIceCandidateInit[]> = new Map();
  private signaling: SignalingService;
  private myId: string;
  private onRemoteStreamUpdate: (peerId: string, stream: MediaStream | null) => void;
  private audioAnalyser: AnalyserNode | null = null;
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

  public async getLocalMedia(
    audio: boolean = true,
    video: boolean = true,
    audioDeviceId?: string,
    videoDeviceId?: string
  ): Promise<MediaStream> {
    try {
      const constraints: MediaStreamConstraints = {
        audio: audio
          ? audioDeviceId
            ? { deviceId: { exact: audioDeviceId }, echoCancellation: true, noiseSuppression: true }
            : { echoCancellation: true, noiseSuppression: true }
          : false,
        video: video
          ? videoDeviceId
            ? { deviceId: { exact: videoDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { width: { ideal: 1280 }, height: { ideal: 720 } }
          : false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.localStream = stream;
      this.setupAudioAnalysis(stream);

      // If peer connections exist and camera was replaced/switched, update video senders
      const newVideoTrack = stream.getVideoTracks()[0];
      const newAudioTrack = stream.getAudioTracks()[0];

      this.peerConnections.forEach((pc) => {
        const senders = pc.getSenders();
        if (newVideoTrack && !this.screenStream) {
          const videoSender = senders.find((s) => s.track && s.track.kind === 'video') ||
                              senders.find((s) => s.track === null);
          if (videoSender) {
            videoSender.replaceTrack(newVideoTrack).catch((e) => console.warn('replaceTrack video error:', e));
          }
        }
        if (newAudioTrack) {
          const audioSender = senders.find((s) => s.track && s.track.kind === 'audio');
          if (audioSender) {
            audioSender.replaceTrack(newAudioTrack).catch((e) => console.warn('replaceTrack audio error:', e));
          }
        }
      });

      return stream;
    } catch (err) {
      console.warn('Could not get requested user media constraints, falling back to audio only', err);
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        this.localStream = fallbackStream;
        this.setupAudioAnalysis(fallbackStream);
        return fallbackStream;
      } catch (audioErr) {
        console.warn('Microphone access also failed:', audioErr);
        // Create an empty dummy stream to allow peer connections without hardware
        const emptyStream = new MediaStream();
        this.localStream = emptyStream;
        return emptyStream;
      }
    }
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
        this.audioContext.resume();
      }

      const source = this.audioContext.createMediaStreamSource(stream);
      this.audioAnalyser = this.audioContext.createAnalyser();
      this.audioAnalyser.fftSize = 256;
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
      }, 100);
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

    // If not sharing screen, update senders
    if (!this.screenStream) {
      const camTrack = enabled ? this.localStream?.getVideoTracks()[0] || null : null;
      this.peerConnections.forEach((pc) => {
        const senders = pc.getSenders();
        const videoSender = senders.find((s) => s.track?.kind === 'video' || s.track === null);
        if (videoSender) {
          videoSender.replaceTrack(camTrack).catch((e) => console.warn('Error toggling video track:', e));
        }
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
        // Replace video track in all active peer connections
        this.peerConnections.forEach((pc) => {
          const senders = pc.getSenders();
          const videoSender = senders.find((s) => s.track?.kind === 'video' || s.track === null);
          if (videoSender) {
            videoSender.replaceTrack(screenTrack).catch((e) => console.warn('Error replacing screen track:', e));
          } else {
            // If peer connection had no video sender, add the track
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

    // Restore camera video track to peer connections if camera is enabled
    const camTrack = this.localStream?.getVideoTracks().find((t) => t.readyState === 'live') || null;
    this.peerConnections.forEach((pc) => {
      const senders = pc.getSenders();
      const videoSender = senders.find((s) => s.track?.kind === 'video' || s.track === null);
      if (videoSender) {
        videoSender.replaceTrack(camTrack).catch((e) => console.warn('Error restoring camera track:', e));
      }
    });
  }

  public createPeerConnection(targetPeerId: string, initiator: boolean): RTCPeerConnection {
    if (this.peerConnections.has(targetPeerId)) {
      const existing = this.peerConnections.get(targetPeerId)!;
      if (initiator && existing.signalingState === 'stable') {
        this.initiateOffer(targetPeerId, existing);
      }
      return existing;
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peerConnections.set(targetPeerId, pc);

    // 1. ALWAYS add microphone audio track if available
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        pc.addTrack(audioTrack, this.localStream);
      }
    }

    // 2. Add video track: either screen track (if screen sharing) or camera track
    const activeVideoTrack = this.screenStream
      ? this.screenStream.getVideoTracks()[0]
      : this.localStream?.getVideoTracks()[0];

    const activeVideoStream = this.screenStream || this.localStream;

    if (activeVideoTrack && activeVideoStream) {
      pc.addTrack(activeVideoTrack, activeVideoStream);
    } else {
      // Add a video transceiver in sendrecv mode so video can be activated later seamlessly
      try {
        pc.addTransceiver('video', { direction: 'sendrecv' });
      } catch (e) {
        console.warn('Could not add video transceiver:', e);
      }
    }

    // 3. ICE Candidate Handler
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.send({
          type: 'ice-candidate',
          targetId: targetPeerId,
          payload: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
        });
      }
    };

    // 4. Remote Track Handler
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Received remote track from ${targetPeerId}:`, event.track.kind);
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      
      // Merge all tracks from this peer into a unified remote stream
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

      event.track.onended = () => {
        const stream = this.remoteStreams.get(targetPeerId);
        if (stream) {
          this.onRemoteStreamUpdate(targetPeerId, stream);
        }
      };
    };

    // 5. Connection State
    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Peer ${targetPeerId} connection state:`, pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.closePeer(targetPeerId);
      }
    };

    // 6. If initiator, create and send initial offer
    if (initiator) {
      this.initiateOffer(targetPeerId, pc);
    }

    return pc;
  }

  private async initiateOffer(targetPeerId: string, pc: RTCPeerConnection) {
    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pc.setLocalDescription(offer);
      this.signaling.send({
        type: 'offer',
        targetId: targetPeerId,
        payload: offer,
      });
    } catch (err) {
      console.error(`Error creating offer for ${targetPeerId}:`, err);
    }
  }

  public async handleOffer(senderId: string, offer: RTCSessionDescriptionInit) {
    try {
      const pc = this.createPeerConnection(senderId, false);

      // Handle glare: if we made an offer and received an offer
      if (pc.signalingState !== 'stable') {
        // Rollback if possible
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
        payload: answer,
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
      // Buffer until remote description is set
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
      pc.close();
      this.peerConnections.delete(peerId);
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
      } catch (e) {}
    });
    this.peerConnections.clear();
    this.iceQueues.clear();
    this.remoteStreams.clear();
  }
}
