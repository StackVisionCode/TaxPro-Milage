import { Injectable, inject, signal } from '@angular/core';
import { CommunicationRealtimeService } from './communication-realtime.service';
import { CommunicationApiService } from './communication-api.service';
import { CustomerTokenService } from '../services/customer-token.service';
import { PeerConnectionFactory, PeerLink, PeerSignalKind } from './media/peer-connection-factory';
import { MeetingRtcService } from './meeting-rtc.service';
import { MeetingSfuService } from './meeting-sfu.service';
import { MeetingSnapshotDto, MeetingJoinAck } from './meeting.model';
import { CallKind, IncomingCall } from './communication.model';
import { MediaPolicyDto } from './media/media-policy.model';

interface Session {
  id: string;
  type: 'call' | 'meeting';
  phase: 'incoming' | 'outgoing' | 'joining' | 'waiting' | 'active' | 'reconnecting';
  title: string;
  kind: CallKind;
  peerId?: string;
  caller?: boolean;
  conversationId?: string | null;
}
interface Remote {
  id: string;
  name: string;
  source: string;
  stream: MediaStream;
}
@Injectable({ providedIn: 'root' })
export class MobileSessionService {
  private realtime = inject(CommunicationRealtimeService);
  private api = inject(CommunicationApiService);
  private tokens = inject(CustomerTokenService);
  private factory = inject(PeerConnectionFactory);
  private rtc = inject(MeetingRtcService);
  private sfu = inject(MeetingSfuService);
  readonly session = signal<Session | null>(null);
  readonly local = signal<MediaStream | null>(null);
  readonly remote = signal<Remote[]>([]);
  readonly audioEnabled = signal(true);
  readonly videoEnabled = signal(false);
  readonly error = signal<string | null>(null);
  readonly recording = signal<string | null>(null);
  readonly consent = signal<{ type: 'call' | 'meeting'; id: string } | null>(null);
  readonly snapshot = signal<MeetingSnapshotDto | null>(null);
  private peers = new Map<string, PeerLink>();
  private peerJobs = new Map<string, Promise<PeerLink>>();
  private iceServers: RTCIceServer[] = [];
  private policy: MediaPolicyDto | null = null;
  private generation = 0;
  private signalQueues = new Map<string, Promise<void>>();
  private starting = false;
  private sfuStarting: Promise<boolean> | null = null;
  constructor() {
    this.realtime.accountChanged$.subscribe(() => this.cleanup());
    this.realtime.on<IncomingCall>('call.incoming').subscribe((dto) => {
      if (this.session()) return;
      this.error.set(null);
      this.session.set({
        id: dto.callId,
        type: 'call',
        phase: 'incoming',
        title: dto.callerDisplayName,
        kind: dto.kind,
        peerId: dto.callerUserId,
        caller: false,
        conversationId: dto.conversationId,
      });
    });
    this.realtime.on<{ callId: string; status: string }>('call.state_changed').subscribe((dto) => {
      const s = this.session();
      if (s?.type !== 'call' || s.id !== dto.callId) return;
      if (['Ended', 'Rejected', 'Cancelled', 'MissedCall', 'Failed'].includes(dto.status)) {
        this.cleanup();
        return;
      }
      if (dto.status === 'Accepted' || dto.status === 'Active') {
        this.session.set({ ...s, phase: 'active' });
        if (s.caller && s.peerId) void this.peer(s.peerId).catch((e) => this.fail(e));
      }
    });
    this.realtime
      .on<{
        callId: string;
        fromPeerUserId: string;
        kind: PeerSignalKind;
        data: Record<string, unknown>;
      }>('call.signal_from')
      .subscribe((dto) => {
        if (this.session()?.id === dto.callId) this.signal(dto.fromPeerUserId, dto.kind, dto.data);
      });
    this.realtime.on<{ callId: string }>('call.upgraded_to_video').subscribe((dto) => {
      const s = this.session();
      if (s?.id === dto.callId) this.session.set({ ...s, kind: 'Video' });
    });
    this.rtc
      .onSnapshot()
      .subscribe((dto) => void this.applySnapshot(dto).catch((e) => this.fail(e)));
    this.rtc.onParticipantChanged().subscribe((dto) => {
      const snap = this.snapshot();
      if (!snap || snap.meetingId !== dto.meetingId || dto.sequence < snap.sequence) return;
      void this.applySnapshot({
        ...snap,
        sequence: dto.sequence,
        participants: [
          ...snap.participants.filter((p) => p.userId !== dto.participant.userId),
          dto.participant,
        ],
      }).catch((e) => this.fail(e));
    });
    this.rtc.onSignalFrom().subscribe((dto) => {
      if (this.session()?.id === dto.meetingId) this.signal(dto.fromPeerUserId, dto.kind, dto.data);
    });
    this.rtc.onStateChanged().subscribe((dto) => {
      if (
        this.session()?.id === dto.meetingId &&
        ['Ended', 'Cancelled', 'Expired'].includes(dto.status)
      )
        this.cleanup();
    });
    this.rtc.onYouRemoved().subscribe((dto) => {
      if (this.session()?.id === dto.meetingId) {
        this.cleanup();
        this.error.set('Ya no estas en esta reunion.');
      }
    });
    this.rtc.onParticipantDenied().subscribe((dto) => {
      if (this.session()?.id === dto.meetingId) {
        this.cleanup();
        this.error.set('La oficina no admitio tu entrada.');
      }
    });
    this.rtc.onRecordingStateChanged().subscribe((dto) => {
      if (this.session()?.id === dto.meetingId) this.recording.set(dto.state);
    });
    this.realtime
      .on<{ callId: string; state: string }>('call.recording.state_changed')
      .subscribe((dto) => {
        if (this.session()?.id === dto.callId) this.recording.set(dto.state);
      });
    this.realtime.on<{ callId: string }>('call.recording.consent_requested').subscribe((dto) => {
      if (this.session()?.id === dto.callId) this.consent.set({ type: 'call', id: dto.callId });
    });
    this.rtc.onRecordingConsentRequested().subscribe((dto) => {
      if (this.session()?.id === dto.meetingId)
        this.consent.set({ type: 'meeting', id: dto.meetingId });
    });
    this.realtime.reconnected$.subscribe(
      () =>
        void (this.session() ? this.rejoin() : this.recoverIncoming()).catch((e) => this.fail(e))
    );
  }
  async dial(peerId: string, title: string, kind: CallKind, conversationId?: string) {
    if (this.session() || this.starting) throw new Error('Ya hay una llamada o reunion en curso.');
    this.starting = true;
    const generation = ++this.generation;
    try {
      await this.capture(kind === 'Video');
      if (generation !== this.generation) return;
      const ack = await this.realtime.command<{ callId: string }>('call.initiate', {
        calleeUserId: peerId,
        kind,
        conversationId,
        clientKey: crypto.randomUUID(),
      });
      if (generation !== this.generation) return;
      this.session.set({
        id: ack.callId,
        type: 'call',
        phase: 'outgoing',
        title,
        kind,
        peerId,
        caller: true,
        conversationId,
      });
    } catch (e) {
      this.cleanup();
      throw e;
    } finally {
      this.starting = false;
    }
  }
  async accept() {
    const s = this.session();
    if (s?.phase !== 'incoming') return;
    const generation = this.generation;
    try {
      await this.capture(s.kind === 'Video');
      if (generation !== this.generation) return;
      await this.realtime.command('call.accept', { callId: s.id, clientKey: crypto.randomUUID() });
      if (this.session()?.id === s.id) {
        this.session.set({ ...s, phase: 'active' });
        await this.peer(s.peerId!);
      }
    } catch (e) {
      this.cleanup();
      throw e;
    }
  }
  async join(meetingId: string, passcode?: string, invitationToken?: string, video = true) {
    if (this.session() || this.starting)
      throw new Error('Termina la sesion actual antes de entrar.');
    this.starting = true;
    this.error.set(null);
    const generation = ++this.generation;
    this.session.set({
      id: meetingId,
      type: 'meeting',
      phase: 'joining',
      title: 'Reunion',
      kind: video ? 'Video' : 'Audio',
    });
    try {
      await this.realtime.ready();
      await this.capture(video);
      if (generation !== this.generation) return;
      const ack = await this.rtc.join(meetingId, {
        audioDefault: true,
        videoDefault: video,
        ...(passcode ? { passcode } : {}),
        ...(invitationToken ? { invitationToken } : {}),
      });
      if (generation !== this.generation) return;
      if (ack.iceServers) this.iceServers = ack.iceServers.iceServers;
      await this.applySnapshot(ack.snapshot);
    } catch (e) {
      this.cleanup();
      throw e;
    } finally {
      this.starting = false;
    }
  }
  private async capture(video: boolean) {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Microfono y camara requieren HTTPS o una app Android instalada.');
    const generation = this.generation;
    const policy = await this.api.policy();
    const ice = await this.api.ice();
    if (generation !== this.generation) throw new Error('La sesion cambio.');
    const camera = policy.video.camera;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video
        ? {
            facingMode: 'user',
            width: { ideal: camera.maxWidth },
            height: { ideal: camera.maxHeight },
            frameRate: { ideal: camera.maxFps },
          }
        : false,
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('La sesion cambio.');
    }
    this.policy = policy;
    this.iceServers = ice.iceServers;
    this.local.set(stream);
    this.audioEnabled.set(true);
    this.videoEnabled.set(video);
  }
  private async applySnapshot(snap: MeetingSnapshotDto) {
    const s = this.session();
    if (s?.type !== 'meeting' || s.id !== snap.meetingId) return;
    if (this.snapshot() && snap.sequence < this.snapshot()!.sequence) return;
    this.snapshot.set(snap);
    const me = snap.participants.find((p) => p.userId === this.tokens.decodeToken()?.sub);
    if (!me || me.status === 'Removed' || me.status === 'Left') {
      this.cleanup();
      return;
    }
    if (me.status === 'Waiting') {
      this.session.set({ ...s, phase: 'waiting' });
      return;
    }
    this.session.set({ ...s, phase: 'active', conversationId: snap.conversationId });
    if (snap.strategy === 'Sfu') {
      for (const peer of this.peers.values()) peer.close();
      this.peers.clear();
      if (!this.sfu.isActive()) {
        const stream = this.local();
        const ok = await (this.sfuStarting ??= this.sfu
          .join(
            snap.meetingId,
            {
              audio: stream?.getAudioTracks()[0] ?? null,
              camera: stream?.getVideoTracks()[0] ?? null,
              screen: null,
              screenAudio: null,
            },
            {
              onRemoteStream: (id, source, stream) => this.setRemote(id, source, stream),
              onRemovePeer: (id) => this.removeRemote(id),
              onMediaState: (state) => {
                if (state === 'failed')
                  this.error.set('Conexion interrumpida. Sal y vuelve a entrar.');
              },
            },
            this.policy!
          )
          .finally(() => (this.sfuStarting = null)));
        if (!ok) throw new Error('No se pudo conectar a la reunion.');
      }
    } else {
      const joined = snap.participants.filter(
        (p) => p.status === 'Joined' && p.userId !== me.userId
      );
      for (const [id, peer] of this.peers)
        if (!joined.some((p) => p.userId === id)) {
          peer.close();
          this.peers.delete(id);
          this.removeRemote(id);
        }
      await Promise.all(joined.map((p) => this.peer(p.userId)));
    }
  }
  private peer(id: string): Promise<PeerLink> {
    const existing = this.peers.get(id);
    if (existing) return Promise.resolve(existing);
    const job = this.peerJobs.get(id);
    if (job) return job;
    const generation = this.generation;
    const create = Promise.resolve()
      .then(() => {
        const session = this.session();
        if (!session || !this.local() || generation !== this.generation)
          throw new Error('La sesion termino.');
        const myId = this.tokens.decodeToken()!.sub;
        const stream = this.local()!;
        const link = this.factory.create({
          iceServers: this.iceServers,
          isPolite: () => (session.type === 'call' ? !session.caller : myId.localeCompare(id) > 0),
          canOffer: () => session.type === 'meeting' || !!session.caller,
          local: {
            microphone: stream.getAudioTracks()[0] ?? null,
            camera: stream.getVideoTracks()[0] ?? null,
            screen: null,
            screenAudio: null,
            stream,
            screenStream: null,
          },
          opus: null,
          signal: (kind, data) =>
            this.realtime.emitNoAck(session.type === 'call' ? 'call.signal' : 'meeting.signal', {
              [session.type === 'call' ? 'callId' : 'meetingId']: session.id,
              targetPeerUserId: id,
              kind,
              data,
            }),
          onRemoteTrack: (source) => {
            this.setRemote(
              id,
              source,
              source === 'screen' ? link.remoteScreenStream : link.remoteCameraStream
            );
          },
          onConnected: () => {
            const s = this.session();
            if (s) this.session.set({ ...s, phase: 'active' });
          },
          onLinkState: (state) => {
            if (state === 'failed')
              this.error.set('La conexion multimedia fallo. Comprueba tu red.');
          },
        });
        this.peers.set(id, link);
        return link;
      })
      .finally(() => this.peerJobs.delete(id));
    this.peerJobs.set(id, create);
    return create;
  }
  private signal(id: string, kind: PeerSignalKind, data: Record<string, unknown>) {
    const generation = this.generation;
    const previous = this.signalQueues.get(id) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        if (generation !== this.generation) return;
        const peer = await this.peer(id);
        await peer.handleSignal(kind, data);
      })
      .catch((e) => this.fail(e));
    this.signalQueues.set(id, next);
  }
  private setRemote(id: string, source: string, stream: MediaStream) {
    const name =
      this.snapshot()?.participants.find((p) => p.userId === id)?.displayName ??
      this.session()?.title ??
      'Participante';
    this.remote.set([
      ...this.remote().filter((p) => p.id !== id || p.source !== source),
      { id, name, source, stream },
    ]);
  }
  private removeRemote(id: string) {
    this.remote.set(this.remote().filter((p) => p.id !== id));
  }
  toggleAudio() {
    const enabled = !this.audioEnabled();
    this.local()
      ?.getAudioTracks()
      .forEach((t) => (t.enabled = enabled));
    this.audioEnabled.set(enabled);
    this.status();
  }
  async toggleVideo() {
    const s = this.session();
    if (!s || s.phase !== 'active') return;
    if (!this.local()?.getVideoTracks().length) {
      if (s.type === 'call' && s.kind === 'Audio')
        await this.realtime.command('call.upgrade_to_video', {
          callId: s.id,
          clientKey: crypto.randomUUID(),
        });
      const generation = this.generation;
      const capture = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (generation !== this.generation) {
        capture.getTracks().forEach((t) => t.stop());
        return;
      }
      const track = capture.getVideoTracks()[0];
      this.local()!.addTrack(track);
      await Promise.all([...this.peers.values()].map((p) => p.replaceTrack('camera', track)));
      if (this.sfu.isActive()) await this.sfu.replaceTrack('camera', track);
      this.local.set(new MediaStream(this.local()!.getTracks()));
    }
    const enabled = !this.videoEnabled();
    this.local()
      ?.getVideoTracks()
      .forEach((t) => (t.enabled = enabled));
    this.videoEnabled.set(enabled);
    this.status();
  }
  private status() {
    const s = this.session();
    if (s)
      this.realtime.emitNoAck(s.type === 'call' ? 'call.media_status' : 'meeting.media_status', {
        [s.type === 'call' ? 'callId' : 'meetingId']: s.id,
        audioEnabled: this.audioEnabled(),
        videoEnabled: this.videoEnabled(),
        screenSharing: false,
      });
  }
  async respondConsent(accepted: boolean) {
    const c = this.consent();
    if (!c) return;
    await this.realtime.command(
      c.type === 'call' ? 'call.consent.respond' : 'meeting.consent.respond',
      {
        [c.type === 'call' ? 'callId' : 'meetingId']: c.id,
        response: accepted ? 'Accepted' : 'Rejected',
      }
    );
    this.consent.set(null);
  }
  async hangup() {
    const s = this.session();
    if (!s) return;
    const event =
      s.type === 'meeting'
        ? 'meeting.leave'
        : s.phase === 'incoming'
        ? 'call.reject'
        : s.phase === 'outgoing'
        ? 'call.cancel'
        : 'call.end';
    await this.realtime.command(event, {
      [s.type === 'meeting' ? 'meetingId' : 'callId']: s.id,
      clientKey: crypto.randomUUID(),
    });
    this.cleanup();
  }
  async leaveForLogout() {
    try {
      await this.hangup();
    } finally {
      this.cleanup();
    }
  }
  async recoverIncoming(callId?: string) {
    if (this.session() || this.starting) return;
    const generation = this.generation;
    const myId = this.tokens.decodeToken()?.sub;
    const candidates = callId
      ? [await this.api.callDetail(callId)]
      : (await this.api.history()).items;
    if (generation !== this.generation || this.session()) return;
    const call = candidates.find(
      (c) =>
        c.status === 'Ringing' &&
        c.direction === 'incoming' &&
        Date.now() - Date.parse(c.ringingAtUtc) < 60000
    );
    if (call)
      this.session.set({
        id: call.id,
        type: 'call',
        phase: 'incoming',
        title: call.counterpart.displayName || 'Oficina',
        kind: call.kind,
        peerId: call.counterpart.userId,
        caller: false,
        conversationId: call.conversationId,
      });
  }
  private async rejoin() {
    const s = this.session();
    if (!s || s.phase === 'incoming') return;
    if (s.type === 'call') {
      const ack = await this.realtime.command<{ state: { status: string } }>('call.rejoin', {
        callId: s.id,
      });
      if (['Ended', 'MissedCall', 'Failed', 'Rejected', 'Cancelled'].includes(ack.state.status)) {
        this.cleanup();
        return;
      }
      for (const peer of this.peers.values()) peer.restartIce();
    } else {
      const ack = await this.rtc.rejoin(s.id);
      await this.applySnapshot(ack.snapshot);
    }
  }
  private fail(e: unknown) {
    this.error.set(e instanceof Error ? e.message : 'Error de comunicacion.');
  }
  cleanup() {
    ++this.generation;
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
    this.peerJobs.clear();
    this.signalQueues.clear();
    this.sfu.leave();
    this.local()
      ?.getTracks()
      .forEach((t) => t.stop());
    this.local.set(null);
    this.remote.set([]);
    this.session.set(null);
    this.snapshot.set(null);
    this.consent.set(null);
    this.recording.set(null);
  }
}
