import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { NEVER } from 'rxjs';
import { CommunicationPage } from './communication.page';
import { CommunicationApiService } from './communication-api.service';
import { CommunicationRealtimeService } from './communication-realtime.service';
import { MobileSessionService } from './mobile-session.service';
import { MobilePushService } from './mobile-push.service';
import { CustomerTokenService } from '../services/customer-token.service';

describe('Chat composer', () => {
  let page: CommunicationPage;
  beforeEach(() => {
    TestBed.configureTestingModule({providers: [
      {provide: ActivatedRoute, useValue: {queryParamMap: NEVER}},
      {provide: CommunicationApiService, useValue: {}},
      {provide: CommunicationRealtimeService, useValue: {on: () => NEVER, reconnected$: NEVER, accountChanged$: NEVER}},
      {provide: MobileSessionService, useValue: {}},
      {provide: MobilePushService, useValue: {}},
      {provide: CustomerTokenService, useValue: {}},
    ]});
    page = TestBed.runInInjectionContext(() => new CommunicationPage());
  });
  afterEach(() => page.ngOnDestroy());
  it('inserts an emoji at the cursor and preserves the following text', () => {
    page.body = 'Hola mundo';
    const input = document.createElement('textarea');
    input.value = page.body; input.setSelectionRange(5, 5);
    page.insertEmoji('👍', input);
    expect(page.body).toBe('Hola 👍mundo');
    expect(input.selectionStart).toBe(7);
  });
  it('replaces selected text without exceeding the message limit', () => {
    page.body = 'a'.repeat(4000);
    const input = document.createElement('textarea');
    input.value = page.body; input.setSelectionRange(3998, 4000);
    page.insertEmoji('👍', input);
    expect(page.body.length).toBe(4000);
    expect(page.body.endsWith('👍')).toBeTrue();
    input.setSelectionRange(4000, 4000);
    page.insertEmoji('😀', input);
    expect(page.body.length).toBe(4000);
    expect(page.body.endsWith('👍')).toBeTrue();
  });
});
