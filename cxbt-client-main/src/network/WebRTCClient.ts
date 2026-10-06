export class WebRTCClient {
  private gameWs: WebSocket; // Game events
  public onMessage?: (msg: any) => void;

  constructor(gameUrl: string, signalingUrl: string, onReady?: () => void) {
    this.gameWs = new WebSocket(gameUrl);
    
    this.gameWs.onopen = () => {
      console.log('Game WebSocket opened!');
      if (onReady) onReady();
    };

    // Game WS handles game logic events from Redis
    this.gameWs.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (this.onMessage) this.onMessage(msg);
      } catch (err) {
        console.error('WebSocket message parsing error:', err);
      }
    };
  }
  
  sendJSON(obj: any) {
    if (this.gameWs.readyState === WebSocket.OPEN) {
      this.gameWs.send(JSON.stringify(obj));
    }
  }

  sendMove(userId: number, x: number, z: number, yaw: number, sequence: number) {
    this.sendJSON({
      type: 'sync',
      userId: userId,
      x: x,
      z: z,
      yaw: yaw,
      sequence: sequence
    });
  }

  close() {
    this.gameWs.close();
  }
}
