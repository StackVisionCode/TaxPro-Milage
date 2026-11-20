import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CommunicationApiService } from './communication-api.service';
import { CommunicationRealtimeService } from './communication-realtime.service';
import { environment } from '../../environments/environment';
describe('Mobile Communication contract', () => {
  let api: CommunicationApiService;
  let http: HttpTestingController;
  let rt: { scope: jasmine.Spy; command: jasmine.Spy };
  beforeEach(() => {
    rt = {
      scope: jasmine.createSpy().and.returnValue('tenant:customer:user'),
      command: jasmine.createSpy().and.resolveTo({}),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CommunicationRealtimeService, useValue: rt },
      ],
    });
    api = TestBed.inject(CommunicationApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('uses direct paginated GET DTOs without client owner IDs', async () => {
    const promise = api.conversations(2);
    const req = http.expectOne(
      (r) => r.url === environment.apiUrl + '/communication/conversations'
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.has('customerId')).toBeFalse();
    req.flush({ items: [], page: 2, size: 30, totalCount: 0 });
    expect((await promise).items).toEqual([]);
  });
  it('sends writes only through the established socket protocol and keeps the idempotency key', async () => {
    await api.send('conversation', 'hello', 'stable-key');
    expect(rt.command).toHaveBeenCalledOnceWith('chat.message.send', {
      conversationId: 'conversation',
      body: 'hello',
      clientKey: 'stable-key',
    });
  });
  it('rejects a response belonging to the previous account', async () => {
    const result = api.messages('conversation');
    rt.scope.and.returnValue('other-owner');
    http
      .expectOne((r) => r.url.endsWith('/conversation/messages'))
      .flush({ items: [], nextBeforeUtc: null });
    await expectAsync(result).toBeRejectedWithError('La cuenta cambio.');
  });
  it('resolves only the current portal preparer with no customer parameter', async () => {
    const result = api.myOffice();
    const req = http.expectOne(environment.apiUrl + '/communication/directory/my-office');
    expect(req.request.params.keys()).toEqual([]);
    req.flush([]);
    expect(await result).toEqual([]);
  });
  it('uses the actual read-receipt payload validated by Communication', async () => {
    await api.markRead('conversation', 'message');
    expect(rt.command.calls.mostRecent().args[0]).toBe('chat.message.mark_read');
    const payload = rt.command.calls.mostRecent().args[1];
    expect(payload.lastReadMessageId).toBe('message');
    expect(payload.clientKey).toBeTruthy();
    expect(payload.upToMessageId).toBeUndefined();
  });
});
