import { wsManager } from '../../realtime/websocket';
import { useCallStore } from './store';
import { logger } from '../../core/logger/logger';
import type { Contact } from '../contacts/types';
import { createRoom, getTurnServers, sendRoomInvite } from './api';
import { ICE_MODE } from '../../config/env';
import { lookupPeer } from '../phonebook/api';
import { useTurnStore } from '../../hooks/useTurnMode';
import { ToastNotification } from '../../components/ToastNotification';

// Safely import WebRTC components for Expo Go compatibility
let RTCPeerConnection: any;
let RTCIceCandidate: any;
let RTCSessionDescription: any;
let mediaDevices: any;
let MediaStream: any;

try {
  const WebRTC = require('react-native-webrtc');
  RTCPeerConnection = WebRTC.RTCPeerConnection;
  RTCIceCandidate = WebRTC.RTCIceCandidate;
  RTCSessionDescription = WebRTC.RTCSessionDescription;
  mediaDevices = WebRTC.mediaDevices;
  MediaStream = WebRTC.MediaStream;
} catch (e) {
  logger.warn('WebRTC native module not found. Calling features will be disabled in this environment.');
}

const fallbackIceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

class WebRTCManager {
  private pc: any = null;
  private localStream: any = null;
  private incomingOffer: any = null;
  private acceptWhenOfferArrives = false;
  private pendingRemoteCandidates: any[] = [];
  private localCandidateVersions = new Set<'IPv4' | 'IPv6' | 'relay'>();

  private async createPeerConnection() {
    this.localCandidateVersions.clear();

    if (ICE_MODE === 'ipv6-direct') {
      logger.info('Creating peer connection in IPv6 direct mode');
      return new RTCPeerConnection({
        iceServers: [],
      });
    }

    if (ICE_MODE === 'stun') {
      logger.info('Creating peer connection in STUN mode');
      return new RTCPeerConnection({
        iceServers: fallbackIceServers,
      });
    }

    const turnServers = await getTurnServers().catch((error) => {
      logger.warn('Failed to load TURN credentials, using STUN fallback', error);
      return [];
    });
    logger.info('Creating peer connection in TURN mode');
    return new RTCPeerConnection({
      iceServers: turnServers.length > 0 ? turnServers : fallbackIceServers,
    });
  }

  setIncomingOffer(offer: any) {
    this.incomingOffer = offer;
    if (this.acceptWhenOfferArrives) {
      this.acceptWhenOfferArrives = false;
      this.acceptCall();
    }
  }

  async acceptCall() {
    const from = useCallStore.getState().remoteUser;
    if (from && this.incomingOffer) {
      useCallStore.getState().setCallState('connecting');
      await this.handleOffer(from, this.incomingOffer);
      this.incomingOffer = null;
      return;
    }

    this.acceptWhenOfferArrives = true;
    useCallStore.getState().setCallState('connecting');
  }

  async startCall(contact: Contact) {
    try {
      lookupPeer(contact.username).then((peer) => {
        if (peer?.ipv6_address) {
          logger.info('Peer has IPv6 phonebook address', peer.ipv6_address);
        } else {
          logger.warn('Peer does not have an IPv6 phonebook address. IPv6-direct calls may fail across networks.');
        }
      }).catch((error) => {
        logger.warn('Failed to resolve peer phonebook address', error);
      });

      const roomID = await createRoom();
      useCallStore.getState().setRemoteUser(contact.username);
      useCallStore.getState().setCallState('calling');

      wsManager.connect(roomID);
      await wsManager.waitFor('open');
      const peerReady = wsManager.waitFor('peer-joined', 30000);
      await sendRoomInvite(contact.id, roomID, 'call');
      await peerReady;

      this.pc = await this.createPeerConnection();
      this._setupListeners();

      this.localStream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      this.localStream.getTracks().forEach((track: any) => {
        track.enabled = true;
        this.pc?.addTrack(track, this.localStream!);
      });

      useCallStore.getState().setLocalStream(this.localStream);

      const offer = await this.pc.createOffer({});
      await this.pc.setLocalDescription(offer);

      wsManager.send('offer', {
        offer: offer,
      });
    } catch (error) {
      logger.error('Failed to start call', error);
      this.cleanup();
    }
  }

  async handleOffer(from: string, offer: any) {
    try {
      this.pc = await this.createPeerConnection();
      this._setupListeners();

      this.localStream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      this.localStream.getTracks().forEach((track: any) => {
        track.enabled = true;
        this.pc?.addTrack(track, this.localStream!);
      });

      useCallStore.getState().setLocalStream(this.localStream);

      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
      await this.flushPendingRemoteCandidates();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);

      wsManager.send('answer', {
        answer: answer,
      });

      useCallStore.getState().setCallState('connecting');
      useCallStore.getState().setRemoteUser(from);
    } catch (error) {
      logger.error('Failed to handle offer', error);
      this.cleanup();
    }
  }

  async handleAnswer(answer: any) {
    try {
      await this.pc?.setRemoteDescription(new RTCSessionDescription(answer));
      await this.flushPendingRemoteCandidates();
      useCallStore.getState().setCallState('connecting');
    } catch (error) {
      logger.error('Failed to handle answer', error);
    }
  }

  async handleIceCandidate(candidate: any) {
    if (!candidate) return;

    try {
      if (!this.pc?.remoteDescription) {
        this.pendingRemoteCandidates.push(candidate);
        return;
      }

      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      logger.error('Failed to handle ICE candidate', error);
    }
  }

  private async flushPendingRemoteCandidates() {
    if (!this.pc?.remoteDescription || this.pendingRemoteCandidates.length === 0) return;

    const candidates = this.pendingRemoteCandidates;
    this.pendingRemoteCandidates = [];

    for (const candidate of candidates) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        logger.error('Failed to apply queued ICE candidate', error);
      }
    }
  }

  private _setupListeners() {
    const pc = this.pc as any;
    if (!pc) return;

    pc.onicecandidate = (event: any) => {
      if (!event.candidate) {
        if (ICE_MODE === 'ipv6-direct' && !this.localCandidateVersions.has('IPv6')) {
          logger.warn('No local IPv6 ICE candidate was gathered. Check that this device/network has a public IPv6 address.');
        }
        return;
      }

      this.trackCandidate(event.candidate);
      if (event.candidate) {
        wsManager.send('ice-candidate', {
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event: any) => {
      logger.info('Remote track received:', event.track.kind);
      event.track.enabled = true;
      if (event.streams && event.streams[0]) {
        useCallStore.getState().setRemoteStream(event.streams[0]);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      logger.info('ICE Connection state:', state);
      if (state === 'connected' || state === 'completed') {
        useCallStore.getState().setCallState('connected');
      }
      if (state === 'failed' || state === 'closed') {
        const { turnEnabled } = useTurnStore.getState();
        if (!turnEnabled) {
          ToastNotification.show(
            'Call cancelled — TURN is disabled. Enable TURN in Settings for IPv4 networks.',
            4000
          );
        }
        this.cleanup();
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      logger.info('Connection state:', state);
      if (state === 'connected') {
        useCallStore.getState().setCallState('connected');
      }
      if (state === 'failed') {
        const { turnEnabled } = useTurnStore.getState();
        if (!turnEnabled) {
          ToastNotification.show(
            'Call cancelled — TURN is disabled. Enable TURN in Settings for IPv4 networks.',
            4000
          );
        }
        this.cleanup();
      }
    };
  }

  private trackCandidate(candidate: any) {
    const rawCandidate = String(candidate?.candidate ?? '');
    if (!rawCandidate) return;

    const candidateType = rawCandidate.match(/\styp\s(\S+)/)?.[1];
    if (candidateType === 'relay') {
      this.localCandidateVersions.add('relay');
      logger.info('Gathered relay ICE candidate');
      return;
    }

    const address = rawCandidate.match(/candidate:\S+\s+\d+\s+\S+\s+\d+\s+(\S+)\s+\d+/)?.[1];
    if (!address) return;

    if (address.includes(':')) {
      this.localCandidateVersions.add('IPv6');
      logger.info('Gathered IPv6 ICE candidate', address);
    } else {
      this.localCandidateVersions.add('IPv4');
      logger.info('Gathered IPv4 ICE candidate', address);
    }
  }

  async triggerIceRestart() {
    if (!this.pc || useCallStore.getState().callState !== 'connected') return;
    
    try {
      const offer = await this.pc.createOffer({ iceRestart: true });
      await this.pc.setLocalDescription(offer);
      
      const targetUser = useCallStore.getState().remoteUser;
      if (targetUser) {
        wsManager.send('offer', {
          offer: offer,
        });
      }
    } catch (error) {
      logger.error('Failed to trigger ICE restart', error);
    }
  }

  cleanup() {
    this.localStream?.getTracks().forEach((track: any) => track.stop());
    this.pc?.close();
    this.pc = null;
    this.localStream = null;
    this.incomingOffer = null;
    this.acceptWhenOfferArrives = false;
    this.pendingRemoteCandidates = [];
    wsManager.disconnect();
    useCallStore.getState().resetCall();
  }
}

export const webrtcManager = new WebRTCManager();
