import { SessionOverlayComponent } from './communication/session-overlay.component';
import { MobilePushService } from './communication/mobile-push.service';
import { inject } from '@angular/core';
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [IonApp, IonRouterOutlet, SessionOverlayComponent],
})
export class AppComponent {
  private push=inject(MobilePushService);
}
