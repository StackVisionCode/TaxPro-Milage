import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { Network } from '@capacitor/network';
import { App } from '@capacitor/app';

@Injectable({ providedIn: 'root' })
export class MobileTrackingPlatform {
  async read(key: string): Promise<string | null> {
    return (await Preferences.get({ key })).value;
  }
  write(key: string, value: string): Promise<void> {
    return Preferences.set({ key, value });
  }
  onReconnect(callback: () => void) {
    return Network.addListener('networkStatusChange', (state) => {
      if (state.connected) callback();
    });
  }
  onResume(callback: () => void) {
    return App.addListener('appStateChange', (state) => {
      if (state.isActive) callback();
    });
  }
}
