import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CustomerSessionRefreshService } from './customer-session-refresh.service';
import { CustomerTokenService } from './customer-token.service';

describe('Account-scoped session refresh', () => {
  let service: CustomerSessionRefreshService;
  let http: HttpTestingController;
  let tokens: { refreshToken: string; setTokens: jasmine.Spy };
  beforeEach(() => {
    tokens = { refreshToken: 'account-a-refresh', setTokens: jasmine.createSpy('setTokens') };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CustomerTokenService, useValue: tokens },
      ],
    });
    service = TestBed.inject(CustomerSessionRefreshService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('does not restore an old account when its refresh finishes after logout/login', () => {
    service
      .refreshAccessToken()
      .subscribe({
        next: () => fail('Must reject old session'),
        error: (e) => expect(e.message).toContain('cuenta cambio'),
      });
    const req = http.expectOne((r) => r.url.endsWith('/auth/mobile/refresh'));
    tokens.refreshToken = 'account-b-refresh';
    req.flush({ accessToken: 'a-access', refreshToken: 'a-next' });
    expect(tokens.setTokens).not.toHaveBeenCalled();
  });
  it('does not share an in-flight refresh across different accounts', () => {
    service.refreshAccessToken().subscribe({ error: () => undefined });
    tokens.refreshToken = 'account-b-refresh';
    service.refreshAccessToken().subscribe();
    const requests = http.match((r) => r.url.endsWith('/auth/mobile/refresh'));
    expect(requests.length).toBe(2);
    expect(requests[1].request.body.refreshToken).toBe('account-b-refresh');
    requests[0].flush({ accessToken: 'a-access', refreshToken: 'a-next' });
    requests[1].flush({ accessToken: 'b-access', refreshToken: 'b-next' });
    expect(tokens.setTokens).toHaveBeenCalledOnceWith('b-access', 'b-next');
  });
});
