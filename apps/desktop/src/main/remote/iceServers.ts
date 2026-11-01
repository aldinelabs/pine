/** The shape WebRTC takes for STUN and TURN servers. */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}
