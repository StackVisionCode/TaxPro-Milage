import { Component, inject } from '@angular/core';
import { MobileSessionService } from './mobile-session.service';
import { CommunicationMediaDirective } from './communication-media.directive';
@Component({
  selector: 'app-session-overlay',
  standalone: true,
  imports: [CommunicationMediaDirective],
  template: ` @if (calls.session(); as s) {
    <section class="call-overlay" role="dialog" aria-modal="true" aria-label="Llamada o reunion">
      <header>
        <span>{{ s.type === 'call' ? 'Llamada' : 'Reunion' }}</span>
        <h2>{{ s.title }}</h2>
        <p>{{ phase(s.phase) }}</p>
      </header>
      @if(calls.error()){
      <p class="error" role="alert">{{ calls.error() }}</p>
      } @if(calls.recording()){
      <p class="recording">Grabacion: {{ calls.recording() }}</p>
      }
      <div class="videos">
        @if(calls.videoEnabled() && calls.local(); as stream){
        <figure>
          <video [appMedia]="stream" autoplay playsinline [muted]="true"></video>
          <figcaption>Tu {{ calls.videoEnabled() ? '' : '· camara apagada' }}</figcaption>
        </figure>
        } @for(peer of calls.remote();track peer.id+peer.source){
        @if(peer.source !== 'screen' || hasVideo(peer.stream)){
        <figure [class.audio-only]="!hasVideo(peer.stream)">
          <video [appMedia]="peer.stream" autoplay playsinline></video>
          <figcaption>
            {{ peer.name }} {{ peer.source === 'screen' ? '· pantalla' : '' }}
          </figcaption>
        </figure>
        } }
      </div>
      @if(s.phase==='waiting'){
      <p>Espera a que la oficina te admita.</p>
      } @if(calls.consent()){
      <div class="consent">
        <p>La oficina solicita grabar esta sesion. ¿Das tu consentimiento?</p>
        <button (click)="run(calls.respondConsent(true))">Aceptar grabacion</button
        ><button (click)="run(calls.respondConsent(false))">No aceptar</button>
      </div>
      }
      <footer>
        @if(s.phase==='incoming'){<button class="accept" (click)="run(calls.accept())">
          Contestar {{ s.kind === 'Video' ? 'con video' : '' }}</button
        >} @if(s.phase==='active'){
        <button (click)="calls.toggleAudio()">
          {{ calls.audioEnabled() ? 'Silenciar' : 'Activar microfono' }}
        </button>
        <button (click)="run(calls.toggleVideo())">
          {{ calls.videoEnabled() ? 'Apagar camara' : 'Activar camara' }}
        </button>
        }
        <button class="hangup" (click)="run(calls.hangup())">
          {{ s.phase === 'incoming' ? 'Rechazar' : s.type === 'meeting' ? 'Salir' : 'Colgar' }}
        </button>
      </footer>
    </section>
    }`,
  styles: [
    `
      .call-overlay {
        position: fixed;
        inset: 0;
        z-index: 100000;
        background: #0f172a;
        color: #fff;
        overflow: auto;
        padding: calc(env(safe-area-inset-top, 0px) + 20px) 18px
          calc(env(safe-area-inset-bottom, 0px) + 20px);
        display: flex;
        flex-direction: column;
        gap: 16px;
        text-align: center;
      }
      header h2 {
        margin: 8px 0;
      }
      header span,
      header p {
        color: #cbd5e1;
      }
      .videos {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
        flex: 1;
      }
      figure {
        margin: 0;
        min-height: 100px;
        align-self: center;
        background: #1e293b;
        border-radius: 14px;
        overflow: hidden;
      }
      video {
        width: 100%;
        height: min(42vh, 360px);
        object-fit: contain;
      }
      .audio-only video { height: 0; }
      .audio-only { padding: 30px 12px; }
      figcaption {
        padding: 8px;
      }
      footer,
      .consent {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        justify-content: center;
      }
      .consent p {
        width: 100%;
      }
      button {
        border: 0;
        border-radius: 24px;
        padding: 14px 20px;
        background: #334155;
        color: #fff;
        font-size: 15px;
        min-height: 48px;
      }
      .accept {
        background: #15803d;
      }
      .hangup {
        background: #b91c1c;
      }
      .error {
        color: #fca5a5;
      }
      .recording {
        color: #fde68a;
      }
    `,
  ],
})
export class SessionOverlayComponent {
  readonly calls = inject(MobileSessionService);
  hasVideo(stream: MediaStream) { return stream.getVideoTracks().some(t => t.readyState === 'live'); }
  phase(value: string) {
    return (
      (
        {
          incoming: 'Llamada entrante',
          outgoing: 'Llamando…',
          joining: 'Entrando…',
          waiting: 'Sala de espera',
          active: 'En curso',
          reconnecting: 'Reconectando…',
        } as Record<string, string>
      )[value] ?? value
    );
  }
  async run(task: Promise<unknown>) {
    try {
      await task;
    } catch (e) {
      this.calls.error.set(e instanceof Error ? e.message : 'No se pudo completar la accion.');
    }
  }
}
