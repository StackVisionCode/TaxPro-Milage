import { TestBed } from '@angular/core/testing';
import { Subject, Observable } from 'rxjs';
import { MobileSessionService } from './mobile-session.service';
import { CommunicationRealtimeService } from './communication-realtime.service';
import { CommunicationApiService } from './communication-api.service';
import { CustomerTokenService } from '../services/customer-token.service';
import { PeerConnectionFactory } from './media/peer-connection-factory';
import { MeetingRtcService } from './meeting-rtc.service';
import { MeetingSfuService } from './meeting-sfu.service';
import { MediaPolicyDto } from './media/media-policy.model';
describe('Mobile call lifecycle', () => {
  let calls: MobileSessionService;
  let events: Map<string, Subject<unknown>>;
  let command: jasmine.Spy;
  let account: Subject<void>;
  let leave: jasmine.Spy;
  const event = (name: string) => {
    if (!events.has(name)) events.set(name, new Subject());
    return events.get(name)!;
  };
  beforeEach(() => {
    events = new Map();
    command = jasmine.createSpy().and.resolveTo({});
    account = new Subject();
    leave = jasmine.createSpy();
    const empty = new Subject();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CommunicationRealtimeService,
          useValue: {
            on: (name: string) => event(name),
            accountChanged$: account,
            reconnected$: empty,
            command,
            emitNoAck: () => undefined,
          },
        },
        { provide: CommunicationApiService, useValue: {} },
        { provide: CustomerTokenService, useValue: { decodeToken: () => ({ sub: 'me' }) } },
        { provide: PeerConnectionFactory, useValue: { create: () => undefined } },
        { provide: MeetingSfuService, useValue: { leave, isActive: () => false } },
        {
          provide: MeetingRtcService,
          useValue: {
            onSnapshot: () => empty,
            onParticipantChanged: () => empty,
            onSignalFrom: () => empty,
            onStateChanged: () => empty,
            onYouRemoved: () => empty,
            onParticipantDenied: () => empty,
            onRecordingStateChanged: () => empty,
            onRecordingConsentRequested: () => empty,
          },
        },
      ],
    });
    calls = TestBed.inject(MobileSessionService);
  });
  const incoming = {
    callId: 'call-a',
    callerUserId: 'office-user',
    callerDisplayName: 'Oficina',
    calleeUserId: 'me',
    kind: 'Video',
    conversationId: null,
    ringingAtUtc: new Date().toISOString(),
  };
  it('rings globally without accessing camera or accepting automatically', () => {
    event('call.incoming').next(incoming);
    expect(calls.session()?.phase).toBe('incoming');
    expect(calls.local()).toBeNull();
    expect(command).not.toHaveBeenCalled();
  });
  it('rejects through call.reject before clearing the overlay', async () => {
    event('call.incoming').next(incoming);
    await calls.hangup();
    expect(command.calls.mostRecent().args[0]).toBe('call.reject');
    expect(command.calls.mostRecent().args[1].callId).toBe('call-a');
    expect(calls.session()).toBeNull();
  });
  it('does not hide a failed hangup as successful', async () => {
    event('call.incoming').next(incoming);
    command.and.rejectWith(new Error('offline'));
    await expectAsync(calls.hangup()).toBeRejected();
    expect(calls.session()?.id).toBe('call-a');
  });
  it('cleans local media and call state on account changes', () => {
    event('call.incoming').next(incoming);
    account.next();
    expect(calls.session()).toBeNull();
    expect(leave).toHaveBeenCalled();
  });
  it('does not replace an existing incoming call with another one', () => {
    event('call.incoming').next(incoming);
    event('call.incoming').next({ ...incoming, callId: 'call-b' });
    expect(calls.session()?.id).toBe('call-a');
  });
  it('only requests recording consent for the current call', () => {
    event('call.incoming').next(incoming);
    event('call.recording.consent_requested').next({ callId: 'other' });
    expect(calls.consent()).toBeNull();
    event('call.recording.consent_requested').next({ callId: 'call-a' });
    expect(calls.consent()?.id).toBe('call-a');
  });
});
