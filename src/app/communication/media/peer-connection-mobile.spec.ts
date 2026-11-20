import { PeerConnectionFactory, PeerLink } from './peer-connection-factory';
describe('Mobile peer media slots', () => {
  let original: typeof RTCPeerConnection;
  let senders: { replaceTrack: jasmine.Spy }[];
  beforeEach(() => {
    original = window.RTCPeerConnection;
    senders = [];
    class FakePeer {
      signalingState = 'stable';
      connectionState = 'new';
      iceConnectionState = 'new';
      addTransceiver(_kind: string) {
        const sender = { replaceTrack: jasmine.createSpy().and.resolveTo() };
        senders.push(sender);
        return { sender };
      }
      close() {}
      addTrack() {
        throw new Error('Not expected without tracks');
      }
    }
    window.RTCPeerConnection = FakePeer as unknown as typeof RTCPeerConnection;
  });
  afterEach(() => (window.RTCPeerConnection = original));
  it('reserves audio, camera, screen and screen-audio slots even when video starts disabled', async () => {
    const peer = new PeerConnectionFactory().create({
      iceServers: [],
      isPolite: () => false,
      canOffer: () => true,
      local: {
        microphone: null,
        camera: null,
        screen: null,
        screenAudio: null,
        stream: null,
        screenStream: null,
      },
      opus: null,
      signal: () => undefined,
    });
    expect(senders.length).toBe(4);
    const track = { kind: 'video' } as MediaStreamTrack;
    await peer.replaceTrack('camera', track);
    expect(senders[1].replaceTrack).toHaveBeenCalledOnceWith(track);
    peer.close();
  });
});
