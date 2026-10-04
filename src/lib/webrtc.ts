import { SignalingService } from './supabase';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
};

export class WebRTCManager {
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private remoteStreams: Map<string, MediaStream> = new Map();
  private signaling: SignalingService;
  private myId: string;
  private onRemoteStreamUpdate: (peerId: string, stream: MediaStream | null) => void;
  private audioAnalyser: AnalyserNode | null = null;
  private audioContext: AudioContext | null = null;
  private audioMeterInterval: number | null = null;
  private onAudioLevelChange?: (level: number) => void;

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

  public async getLocalMedia(audio: boolean = true, video: boolean = true, audioDeviceId?: string, videoDeviceId?: string): Promise<MediaStream> {
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
      return stream;
    } catch (err) {
      console.warn('Could not get requested user media constraints, falling back to minimal', err);
      const fallbackStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.localStream = fallbackStream;
      this.setupAudioAnalysis(fallbackStream);
      return fallbackStream;
    }
  }

  public setupAudioAnalysis(stream: MediaStream) {
    try {
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) return;

      if (!this.audioContext) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioCtx();
      }

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
  }

  public async startScreenShare(): Promise<MediaStream> {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
          frameRate: { max: 30 },
        },
        audio: true,
      });

      this.screenStream = screenStream;
      const screenTrack = screenStream.getVideoTracks()[0];

      // Replace video track in all active peer connections
      this.peerConnections.forEach((pc) => {
        const senders = pc.getSenders();
        const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
        if (videoSender && screenTrack) {
          videoSender.replaceTrack(screenTrack);
        }
      });

      screenTrack.onended = () => {
        this.stopScreenShare();
      };

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

    // Restore camera video track to peer connections
    const camTrack = this.localStream?.getVideoTracks()[0] || null;
    this.peerConnections.forEach((pc) => {
      const senders = pc.getSenders();
      const videoSender = senders.find((s) => s.track === null || s.track?.kind === 'video');
      if (videoSender && camTrack) {
        videoSender.replaceTrack(camTrack);
      }
    });
  }

  public createPeerConnection(targetPeerId: string, initiator: boolean): RTCPeerConnection {
    if (this.peerConnections.has(targetPeerId)) {
      return this.peerConnections.get(targetPeerId)!;
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peerConnections.set(targetPeerId, pc);

    // Add local tracks (or screen share if currently sharing)
    const currentVideoStream = this.screenStream || this.localStream;
    if (currentVideoStream) {
      currentVideoStream.getTracks().forEach((track) => {
        pc.addTrack(track, currentVideoStream);
      });
    } else if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    // ICE Candidate handler
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.send({
          type: 'ice-candidate',
          targetId: targetPeerId,
          payload: event.candidate,
        });
      }
    };

    // Remote track handler
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      this.remoteStreams.set(targetPeerId, remoteStream);
      this.onRemoteStreamUpdate(targetPeerId, remoteStream);
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Peer ${targetPeerId} connection state:`, pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.closePeer(targetPeerId);
      }
    };

    // If initiator, create and send offer
    if (initiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.signaling.send({
            type: 'offer',
            targetId: targetPeerId,
            payload: offer,
          });
        } catch (err) {
          console.error('Error creating offer:', err);
        }
      };
    }

    return pc;
  }

  public async handleOffer(senderId: string, offer: RTCSessionDescriptionInit) {
    const pc = this.createPeerConnection(senderId, false);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.signaling.send({
      type: 'answer',
      targetId: senderId,
      payload: answer,
    });
  }

  public async handleAnswer(senderId: string, answer: RTCSessionDescriptionInit) {
    const pc = this.peerConnections.get(senderId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  public async handleIceCandidate(senderId: string, candidate: RTCIceCandidateInit) {
    const pc = this.peerConnections.get(senderId);
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Error adding received ice candidate:', err);
      }
    }
  }

  public closePeer(peerId: string) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }
    this.remoteStreams.delete(peerId);
    this.onRemoteStreamUpdate(peerId, null);
  }

  public cleanup() {
    if (this.audioMeterInterval) {
      clearInterval(this.audioMeterInterval);
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
    }
    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();
    this.remoteStreams.clear();
  }
}
