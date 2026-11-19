import { MobileSessionService } from './communication/mobile-session.service';
import { MobilePushService } from './communication/mobile-push.service';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  it('should create the app', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([]),{provide:MobilePushService,useValue:{}},{provide:MobileSessionService,useValue:{session:signal(null)}}]
    }).compileComponents();
    
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
