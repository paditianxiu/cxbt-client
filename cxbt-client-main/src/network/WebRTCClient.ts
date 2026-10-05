export class WebRTCClient {
  public peer: RTCPeerConnection;
  public dataChannel: RTCDataChannel;
  private gameWs: WebSocket; // Game events
  private sigWs: WebSocket;  // WebRTC signaling
  public onMessage?: (msg: any) => void;
  public onBinaryMessage?: (buffer: ArrayBuffer) => void;

  constructor(gameUrl: string, signalingUrl: string, onReady?: () => void) {
    this.gameWs = new WebSocket(gameUrl);
    this.sigWs = new WebSocket(signalingUrl);
    
    this.peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    this.dataChannel = this.peer.createDataChannel('game', {
      ordered: false,
      maxRetransmits: 0
    });
    this.dataChannel.binaryType = 'arraybuffer';
    
    this.dataChannel.onopen = () => {
      console.log('WebRTC DataChannel opened!');
      if (onReady) onReady();
    };

    this.dataChannel.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer && this.onBinaryMessage) {
        this.onBinaryMessage(e.data);
      }
    };

    // Game WS handles game logic events from Redis
    this.gameWs.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (this.onMessage) this.onMessage(msg);
    };

    // Signaling WS handles only WebRTC negotiation
    this.sigWs.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'answer') {
        await this.peer.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
      } else if (msg.type === 'candidate') {
        await this.peer.addIceCandidate(msg.candidate);
      }
    };

    this.peer.onicecandidate = (e) => {
      if (e.candidate && this.sigWs.readyState === WebSocket.OPEN) {
        this.sigWs.send(JSON.stringify({ type: 'candidate', candidate: e.candidate }));
      }
    };

    this.sigWs.onopen = async () => {
      console.log('Signaling WS opened, creating offer...');
      const offer = await this.peer.createOffer();
      await this.peer.setLocalDescription(offer);
      this.sigWs.send(JSON.stringify({ type: 'offer', sdp: offer.sdp }));
    };
  }
  
  sendJSON(obj: any) {
    if (this.gameWs.readyState === WebSocket.OPEN) {
      this.gameWs.send(JSON.stringify(obj));
    }
  }

  sendMove(userId: number, x: number, z: number, yaw: number, sequence: number) {
    if (this.dataChannel.readyState !== 'open') return;
    const buffer = new ArrayBuffer(21);
    const view = new DataView(buffer);
    view.setUint8(0, 1); 
    view.setUint32(1, userId, true);
    view.setFloat32(5, x, true);
    view.setFloat32(9, z, true);
    view.setFloat32(13, yaw, true);
    view.setUint32(17, sequence, true);
    this.dataChannel.send(buffer);
  }

  close() {
    this.dataChannel.close();
    this.peer.close();
    this.gameWs.close();
    this.sigWs.close();
  }
}
